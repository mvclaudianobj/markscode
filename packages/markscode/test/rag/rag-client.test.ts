import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

import { Account } from "@/account/account"
import { AccessToken, AccountID, OrgID } from "@/account/schema"
import { RagClient } from "@/rag/rag-client"
import { RagConfig } from "@/rag/rag-config"
import { testEffect } from "../lib/effect"
import { ragRemoteConfig } from "./rag-config.test"

const active = (account = "account-1", org = "17"): Account.ActiveOrg => ({
  account: {
    id: AccountID.make(account),
    email: "user@example.com",
    url: "https://control.example.com",
    active_org_id: OrgID.make(org),
  },
  org: { id: OrgID.make(org), name: "Org" },
})

const configure = (overrides: Record<string, unknown> = {}) =>
  RagConfig.setRagConfig(ragRemoteConfig(overrides), {
    accountID: AccountID.make("account-1"),
    orgID: OrgID.make("17"),
    accountUrl: "https://control.example.com",
  })

const accountLayer = (options: {
  activeOrg?: () => Effect.Effect<Option.Option<Account.ActiveOrg>, Account.AccountError>
  token?: () => Effect.Effect<Option.Option<AccessToken>, Account.AccountError>
  active?: () => Effect.Effect<Option.Option<Account.Info>, Account.AccountError>
} = {}) => Layer.mock(Account.Service)({
  activeOrg: options.activeOrg ?? (() => Effect.succeed(Option.some(active()))),
  active: options.active ?? (() => Effect.succeed(Option.some(active().account))),
  token: options.token ?? (() => Effect.succeed(Option.some(AccessToken.make("secret-token")))),
})

const response = (request: HttpClientRequest.HttpClientRequest, body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }))

const layer = (client: HttpClient.HttpClient, account = accountLayer()) =>
  RagClient.layer.pipe(
    Layer.provide(account),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
  )

const it = testEffect(Layer.empty)

afterEach(() => RagConfig.clearRagConfig())

describe("RagClient", () => {
  for (const base of ["https://control.example.com/api/rag/v1", "https://control.example.com/api/rag/v1/"]) {
    it.live(`composes exact GET endpoints under base ${base}`, () =>
      Effect.gen(function* () {
        configure()
        RagConfig.getRagConfig(AccountID.make("account-1"), OrgID.make("17"))!.base_url = base
        const seen: string[] = []
        const client = HttpClient.make((request) => {
          seen.push(request.url)
          if (request.url.endsWith("/health")) {
            return Effect.succeed(response(request, { ok: true, org_id: 17, search_mode: "lexical" }))
          }
          return Effect.succeed(response(request, { ok: true, items: [] }))
        })

        yield* RagClient.Service.use((service) => Effect.all([
          service.health(),
          service.listCollections(),
        ])).pipe(Effect.provide(layer(client)))

        expect(seen).toEqual([
          "https://control.example.com/api/rag/v1/health",
          "https://control.example.com/api/rag/v1/collections",
        ])
      }),
    )
  }

  for (const path of [
    "health",
    "https://evil.example/health",
    "//evil.example/health",
    "/../health",
    "/%2e%2e/health",
    "/%252e%252e/health",
    "/%25252525252525252525/health",
  ]) {
    it.live(`rejects unsafe endpoint ${path}`, () =>
      Effect.sync(() => {
        expect(RagClient.endpointUrl("https://control.example.com/api/rag/v1", path, "https://control.example.com")).toBeUndefined()
      }),
    )
  }

  it.live("rejects endpoint composition against a different origin", () =>
    Effect.sync(() => {
      expect(RagClient.endpointUrl(
        "https://evil.example/api/rag/v1",
        "/health",
        "https://control.example.com",
      )).toBeUndefined()
    }),
  )

  it.live("fails locally without account or org and sends zero requests", () =>
    Effect.gen(function* () {
      configure()
      let calls = 0
      const client = HttpClient.make((request) => {
        calls += 1
        return Effect.succeed(response(request, {}))
      })
      const noAccount = accountLayer({
        activeOrg: () => Effect.succeed(Option.none()),
        active: () => Effect.succeed(Option.none()),
      })
      const noOrg = accountLayer({ activeOrg: () => Effect.succeed(Option.none()) })

      const first = yield* Effect.exit(RagClient.Service.use((service) => service.health()).pipe(Effect.provide(layer(client, noAccount))))
      const second = yield* Effect.exit(RagClient.Service.use((service) => service.health()).pipe(Effect.provide(layer(client, noOrg))))

      expect(Exit.isFailure(first) && Cause.squash(first.cause)).toMatchObject({ reason: "not_logged" })
      expect(Exit.isFailure(second) && Cause.squash(second.cause)).toMatchObject({ reason: "no_org" })
      expect(calls).toBe(0)
    }),
  )

  it.live("revalidates org immediately before request and fails stale context locally", () =>
    Effect.gen(function* () {
      configure()
      let validations = 0
      let calls = 0
      const account = accountLayer({
        activeOrg: () => Effect.sync(() => Option.some(validations++ === 0 ? active() : active("account-1", "18"))),
      })
      const client = HttpClient.make((request) => {
        calls += 1
        return Effect.succeed(response(request, {}))
      })

      const exit = yield* Effect.exit(RagClient.Service.use((service) => service.health()).pipe(Effect.provide(layer(client, account))))

      expect(exit._tag).toBe("Failure")
      expect(calls).toBe(0)
    }),
  )

  it.live("fails locally when config revision changes immediately before execute", () =>
    Effect.gen(function* () {
      configure()
      let validations = 0
      let calls = 0
      const account = accountLayer({
        activeOrg: () => Effect.sync(() => {
          validations += 1
          if (validations === 3) RagConfig.clearRagConfig()
          return Option.some(active())
        }),
      })
      const client = HttpClient.make((request) => {
        calls += 1
        return Effect.succeed(response(request, {}))
      })

      const exit = yield* Effect.exit(RagClient.Service.use((service) => service.health()).pipe(Effect.provide(layer(client, account))))

      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({ reason: "disabled" })
      expect(calls).toBe(0)
    }),
  )

  it.live("sends exact auth headers and no content type on GET", () =>
    Effect.gen(function* () {
      configure()
      const seen: HttpClientRequest.HttpClientRequest[] = []
      const client = HttpClient.make((request) => {
        seen.push(request)
        return Effect.succeed(response(request, { ok: true, org_id: 17, search_mode: "lexical" }))
      })

      const result = yield* RagClient.Service.use((service) => service.health()).pipe(Effect.provide(layer(client)))

      expect(result.search_mode).toBe("lexical")
      expect(seen).toHaveLength(1)
      expect(seen[0].url).toBe("https://control.example.com/api/rag/v1/health")
      expect(seen[0].headers.authorization).toBe("Bearer secret-token")
      expect(seen[0].headers["x-org-id"]).toBe("17")
      expect(seen[0].headers.accept).toContain("application/json")
      expect(seen[0].headers["content-type"]).toBeUndefined()
    }),
  )

  for (const status of [401, 403] as const) {
    it.live(`maps ${status} to unauthorized`, () =>
      Effect.gen(function* () {
        configure()
        const client = HttpClient.make((request) => Effect.succeed(response(request, {}, status)))
        const exit = yield* Effect.exit(RagClient.Service.use((service) => service.health()).pipe(Effect.provide(layer(client))))
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
          _tag: "RagUnauthorizedError",
          status,
        })
      }),
    )
  }

  it.live("parses bounded string detail without exposing other response fields", () =>
    Effect.gen(function* () {
      configure()
      const client = HttpClient.make((request) => Effect.succeed(response(request, {
        detail: "x".repeat(600),
        token: "must-not-leak",
      }, 422)))
      const exit = yield* Effect.exit(RagClient.Service.use((service) => service.health()).pipe(Effect.provide(layer(client))))
      const error = Exit.isFailure(exit) && Cause.squash(exit.cause)
      expect(error).toMatchObject({ _tag: "RagResponseError", status: 422, detail: "x".repeat(512) })
      expect(String(error)).not.toContain("must-not-leak")
    }),
  )

  it.live("removes ansi and control characters from error detail", () =>
    Effect.gen(function* () {
      configure()
      const detail = `safe\u001b[31mred\u001b[0m\n\t\u0000\u0085end${"x".repeat(600)}`
      const client = HttpClient.make((request) => Effect.succeed(response(request, { detail, body: "must-not-leak" }, 422)))
      const exit = yield* Effect.exit(RagClient.Service.use((service) => service.health()).pipe(Effect.provide(layer(client))))
      const error = Exit.isFailure(exit) && Cause.squash(exit.cause)
      expect(error).toMatchObject({ _tag: "RagResponseError", detail: `saferedend${"x".repeat(502)}` })
      expect(String(error)).not.toContain("must-not-leak")
    }),
  )

  it.live("maps invalid persisted urls to typed errors without defects", () =>
    Effect.gen(function* () {
      configure()
      const config = RagConfig.getRagConfig(AccountID.make("account-1"), OrgID.make("17"))!
      config.base_url = "invalid"
      const client = HttpClient.make((request) => Effect.succeed(response(request, {})))
      const exit = yield* Effect.exit(RagClient.Service.use((service) => service.health()).pipe(Effect.provide(layer(client))))
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({ _tag: "RagUnavailableError" })
    }),
  )

  it.live("ignores non-string and malformed error detail", () =>
    Effect.gen(function* () {
      configure()
      const clients = [
        HttpClient.make((request) => Effect.succeed(response(request, { detail: { token: "secret" } }, 500))),
        HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, new Response("secret-token", { status: 500 })))),
      ]
      const exits = yield* Effect.forEach(clients, (client) =>
        Effect.exit(RagClient.Service.use((service) => service.health()).pipe(Effect.provide(layer(client)))),
      )
      expect(exits.map((exit) => Exit.isFailure(exit) && Cause.squash(exit.cause))).toEqual([
        expect.objectContaining({ _tag: "RagResponseError", detail: undefined }),
        expect.objectContaining({ _tag: "RagResponseError", detail: undefined }),
      ])
    }),
  )

  it.live("maps invalid json to decode error", () =>
    Effect.gen(function* () {
      configure()
      const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(
        request,
        new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
      )))
      const exit = yield* Effect.exit(RagClient.Service.use((service) => service.health()).pipe(Effect.provide(layer(client))))
      expect(exit._tag === "Failure" && exit.cause.toString()).toContain("RagDecodeError")
    }),
  )

  it.live("retries transient GET only", () =>
    Effect.gen(function* () {
      configure()
      let calls = 0
      const client = HttpClient.make((request) => {
        calls += 1
        if (calls < 3) return Effect.succeed(response(request, {}, 503))
        return Effect.succeed(response(request, { ok: true, items: [] }))
      })

      yield* RagClient.Service.use((service) => service.listCollections()).pipe(Effect.provide(layer(client)))
      expect(calls).toBe(3)
    }),
  )

  it.live("does not retry POST and preserves exact payload", () =>
    Effect.gen(function* () {
      configure()
      let calls = 0
      let body = ""
      const client = HttpClient.make((request) => {
        calls += 1
        if (request.body._tag === "Uint8Array") body = new TextDecoder().decode(request.body.body)
        return Effect.succeed(response(request, {}, 503))
      })
      const payload = { name: "Docs", description: "Knowledge" }

      yield* Effect.exit(RagClient.Service.use((service) => service.createCollection(payload)).pipe(Effect.provide(layer(client))))
      expect(calls).toBe(1)
      expect(JSON.parse(body)).toEqual(payload)
    }),
  )

  it.live("sends source document and query payloads exactly and decodes lexical query", () =>
    Effect.gen(function* () {
      configure()
      const bodies: unknown[] = []
      const client = HttpClient.make((request) => {
        if (request.body._tag === "Uint8Array") bodies.push(JSON.parse(new TextDecoder().decode(request.body.body)))
        if (request.url.endsWith("/sources")) return Effect.succeed(response(request, { ok: true, item: { id: 2, org_id: 17, collection_id: 1, source_type: "file", source_key: "a".repeat(64), name: "a.ts", metadata_json: "{}" } }))
        if (request.url.endsWith("/documents")) return Effect.succeed(response(request, { ok: true, item: { id: 3, org_id: 17, collection_id: 1, source_id: 2, title: "Title", content_hash: "b".repeat(64) } }))
        return Effect.succeed(response(request, { ok: true, search_mode: "lexical", items: [{ id: 4, org_id: 17, collection_id: 1, document_id: 3, chunk_index: 0, content: "match", score: 1.5 }] }))
      })
      const source = { collection_id: 1, source_type: "file", source_key: "a".repeat(64), name: "a.ts", external_key: "src/a.ts", metadata: { lang: "ts" } }
      const document = { collection_id: 1, source_id: 2, title: "Title", content: "Body", metadata: { path: "src/a.ts" } }
      const query = { query: "match", collection_id: 1, limit: 5 }

      yield* RagClient.Service.use((service) => Effect.all([
        service.createSource(source),
        service.ingestDocument(document),
        service.query(query),
      ])).pipe(Effect.provide(layer(client)))

      expect(bodies).toEqual([source, document, query])
    }),
  )

  it.live("decodes metadata_json as string or null and rejects object", () =>
    Effect.gen(function* () {
      configure()
      const values: unknown[] = ["{}", null, { lang: "ts" }]
      const client = HttpClient.make((request) => Effect.succeed(response(request, {
        ok: true,
        item: { id: 2, org_id: 17, collection_id: 1, source_type: "file", source_key: "a".repeat(64), name: "a.ts", metadata_json: values.shift() },
      })))
      const run = () => RagClient.Service.use((service) => service.createSource({
        collection_id: 1,
        source_type: "file",
        source_key: "a".repeat(64),
        name: "a.ts",
      })).pipe(Effect.provide(layer(client)))

      expect((yield* run()).item.metadata_json).toBe("{}")
      expect((yield* run()).item.metadata_json).toBeNull()
      expect((yield* Effect.exit(run()))._tag).toBe("Failure")
    }),
  )

  it.live("clamps explicit and default query limits to remote maximum", () =>
    Effect.gen(function* () {
      configure({ limits: { query_limit_max: 3, chunk_max_chars: 1200, chunk_overlap_chars: 160 } })
      const bodies: unknown[] = []
      const client = HttpClient.make((request) => {
        if (request.body._tag === "Uint8Array") bodies.push(JSON.parse(new TextDecoder().decode(request.body.body)))
        return Effect.succeed(response(request, { ok: true, search_mode: "lexical", items: [] }))
      })
      yield* RagClient.Service.use((service) => Effect.all([
        service.query({ query: "first", limit: 10 }),
        service.query({ query: "second" }),
      ])).pipe(Effect.provide(layer(client)))
      expect(bodies).toEqual([{ query: "first", limit: 3 }, { query: "second", limit: 3 }])
    }),
  )

  it.live("does not expose getDocument when capability remains false", () =>
    Effect.gen(function* () {
      configure()
      const client = HttpClient.make((request) => Effect.succeed(response(request, {})))
      const service = yield* RagClient.Service.pipe(Effect.provide(layer(client)))
      expect("getDocument" in service).toBeFalse()
      expect(RagConfig.getRagConfig(AccountID.make("account-1"), OrgID.make("17"))?.capabilities.get_document).toBeFalse()
    }),
  )

  it.live("exports default layer with account and fetch http", () =>
    Effect.sync(() => {
      expect(RagClient.defaultLayer).toBeDefined()
      expect(FetchHttpClient.layer).toBeDefined()
    }),
  )

  it.live("fails capability false locally", () =>
    Effect.gen(function* () {
      configure({ capabilities: { ...ragRemoteConfig().capabilities, query: false } })
      let calls = 0
      const client = HttpClient.make((request) => {
        calls += 1
        return Effect.succeed(response(request, {}))
      })

      const exit = yield* Effect.exit(RagClient.Service.use((service) => service.query({ query: "x" })).pipe(Effect.provide(layer(client))))
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({ reason: "capability" })
      expect(calls).toBe(0)
    }),
  )

  it.live("rejects invalid ids and source hash locally", () =>
    Effect.gen(function* () {
      configure()
      let calls = 0
      const client = HttpClient.make((request) => {
        calls += 1
        return Effect.succeed(response(request, {}))
      })

      const source = yield* Effect.exit(RagClient.Service.use((service) => service.createSource({
        collection_id: 0,
        source_type: "file",
        source_key: "invalid",
        name: "file",
      })).pipe(Effect.provide(layer(client))))
      const query = yield* Effect.exit(RagClient.Service.use((service) => service.query({ query: "x", limit: 0 })).pipe(
        Effect.provide(layer(client)),
      ))

      expect(Exit.isFailure(source) && Cause.squash(source.cause)).toMatchObject({ _tag: "RagDecodeError" })
      expect(Exit.isFailure(query) && Cause.squash(query.cause)).toMatchObject({ _tag: "RagDecodeError" })
      expect(calls).toBe(0)
    }),
  )
})
