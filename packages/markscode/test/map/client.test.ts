import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

import { Account } from "@/account/account"
import { AccessToken, AccountID, OrgID } from "@/account/schema"
import { MapClient } from "@/map/client"
import { testEffect } from "../lib/effect"

const active = (org = "org-1"): Account.ActiveOrg => ({
  account: {
    id: AccountID.make("account-1"),
    email: "user@example.com",
    url: "https://marks.ia.br",
    active_org_id: OrgID.make(org),
  },
  org: { id: OrgID.make(org), name: "Org" },
})

const lease = (org = "org-1"): Account.ActiveOrgLease => ({
  active: active(org),
  accessToken: AccessToken.make("secret-token"),
  revision: 1,
})

const accountLayer = (
  options: {
    activeOrg?: () => Effect.Effect<Option.Option<Account.ActiveOrg>, Account.AccountError>
    active?: () => Effect.Effect<Option.Option<Account.Info>, Account.AccountError>
    token?: () => Effect.Effect<Option.Option<AccessToken>, Account.AccountError>
    acquireActiveOrgLease?: () => Effect.Effect<Option.Option<Account.ActiveOrgLease>, Account.AccountError>
    validateActiveOrgLease?: (lease: Account.ActiveOrgLease) => Effect.Effect<boolean, Account.AccountError>
  } = {},
) =>
  Layer.mock(Account.Service)({
    activeOrg: options.activeOrg ?? (() => Effect.succeed(Option.some(active()))),
    active: options.active ?? (() => Effect.succeed(Option.some(active().account))),
    token: options.token ?? (() => Effect.succeed(Option.some(AccessToken.make("secret-token")))),
    acquireActiveOrgLease: options.acquireActiveOrgLease ?? (() => Effect.succeed(Option.some(lease()))),
    validateActiveOrgLease: options.validateActiveOrgLease ?? (() => Effect.succeed(true)),
  })

const response = (request: HttpClientRequest.HttpClientRequest, body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )

const layer = (client: HttpClient.HttpClient, account = accountLayer()) =>
  MapClient.layer.pipe(Layer.provide(account), Layer.provide(Layer.succeed(HttpClient.HttpClient, client)))

const it = testEffect(Layer.empty)

afterEach(() => {
  delete process.env.MAP_API_BASE_URL
  delete process.env.MARKSCODE_MAP_API_URL
})

describe("MapClient", () => {
  it.live("exposes GET-only operations", () =>
    Effect.gen(function* () {
      const client = HttpClient.make((request) =>
        Effect.succeed(response(request, { status: "ok", service: "map", version: "v3" })),
      )
      const service = yield* MapClient.Service.pipe(Effect.provide(layer(client)))
      expect(Object.keys(service).sort()).toEqual([
        "authenticated",
        "capabilities",
        "createEvent",
        "events",
        "health",
        "me",
        "modules",
        "orgs",
        "projects",
        "tasks",
        "updateTask",
      ])
    }),
  )

  it.live("calls public health without auth and uses exact URL and headers", () =>
    Effect.gen(function* () {
      const seen: HttpClientRequest.HttpClientRequest[] = []
      const client = HttpClient.make((request) => {
        seen.push(request)
        return Effect.succeed(response(request, { status: "ok", service: "map", version: "v3" }))
      })
      yield* MapClient.Service.use((service) => service.health()).pipe(Effect.provide(layer(client)))
      expect(seen).toHaveLength(1)
      expect(seen[0].method).toBe("GET")
      expect(seen[0].url).toBe("https://map.marks.ia.br/api/map/v3/health")
      expect(seen[0].headers.authorization).toBeUndefined()
      expect(seen[0].headers["x-org-id"]).toBeUndefined()
      expect(seen[0].headers["user-agent"]).toBe("markscode/1.1.0")
      expect(seen[0].headers.accept).toContain("application/json")
      expect(seen[0].headers["content-type"]).toBeUndefined()
    }),
  )

  it.live("sends zero protected requests without account org or token", () =>
    Effect.gen(function* () {
      let calls = 0
      const client = HttpClient.make((request) => {
        calls += 1
        return Effect.succeed(response(request, { items: [] }))
      })
      const accounts = [
        accountLayer({
          acquireActiveOrgLease: () => Effect.succeed(Option.none()),
          active: () => Effect.succeed(Option.none()),
        }),
        accountLayer({ acquireActiveOrgLease: () => Effect.succeed(Option.none()) }),
        accountLayer({
          acquireActiveOrgLease: () => Effect.succeed(Option.none()),
          token: () => Effect.succeed(Option.none()),
        }),
      ]
      const exits = yield* Effect.forEach(accounts, (account) =>
        Effect.exit(
          MapClient.Service.use((service) => service.projects()).pipe(Effect.provide(layer(client, account))),
        ),
      )
      expect(exits.map((exit) => Exit.isFailure(exit) && Cause.squash(exit.cause))).toEqual([
        expect.objectContaining({ reason: "not_logged" }),
        expect.objectContaining({ reason: "no_org" }),
        expect.objectContaining({ reason: "no_token" }),
      ])
      expect(calls).toBe(0)
    }),
  )

  it.live("uses exact protected URLs and auth headers", () =>
    Effect.gen(function* () {
      const seen: HttpClientRequest.HttpClientRequest[] = []
      const client = HttpClient.make((request) => {
        seen.push(request)
        if (request.url.endsWith("/me"))
          return Effect.succeed(
            response(request, {
              user: { id: "u", email: "u@example.com", name: "User", extra: true },
              organization: { id: "org-1", name: "Org", role: "owner" },
            }),
          )
        if (request.url.endsWith("/orgs"))
          return Effect.succeed(response(request, [{ id: "org-1", name: "Org", role: "owner" }]))
        if (request.url.endsWith("/capabilities"))
          return Effect.succeed(
            response(request, {
              version: "v3",
              organization_id: "org-1",
              reads: ["projects", "modules", "tasks", "events"],
              writes: false,
            }),
          )
        return Effect.succeed(response(request, { items: [] }))
      })
      yield* MapClient.Service.use((service) =>
        Effect.all(
          [
            service.me(),
            service.orgs(),
            service.capabilities(),
            service.projects(),
            service.modules(),
            service.tasks(),
            service.events(),
          ],
          { concurrency: 1 },
        ),
      ).pipe(Effect.provide(layer(client)))
      expect(seen.map((request) => request.url)).toEqual([
        "https://map.marks.ia.br/api/map/v3/me",
        "https://map.marks.ia.br/api/map/v3/orgs",
        "https://map.marks.ia.br/api/map/v3/capabilities",
        "https://map.marks.ia.br/api/map/v3/projects",
        "https://map.marks.ia.br/api/map/v3/modules",
        "https://map.marks.ia.br/api/map/v3/tasks",
        "https://map.marks.ia.br/api/map/v3/events",
      ])
      expect(seen.every((request) => request.method === "GET")).toBeTrue()
      expect(seen.every((request) => request.headers.authorization === "Bearer secret-token")).toBeTrue()
      expect(seen.every((request) => request.headers["x-org-id"] === "org-1")).toBeTrue()
      expect(seen.every((request) => request.headers["user-agent"] === "markscode/1.1.0")).toBeTrue()
    }),
  )

  it.live("shares one lease and identical auth headers across a composed operation", () =>
    Effect.gen(function* () {
      let acquisitions = 0
      const seen: HttpClientRequest.HttpClientRequest[] = []
      const account = accountLayer({
        acquireActiveOrgLease: () =>
          Effect.sync(() => {
            acquisitions += 1
            return Option.some(lease())
          }),
      })
      const client = HttpClient.make((request) => {
        seen.push(request)
        return Effect.succeed(response(request, { items: [] }))
      })

      yield* MapClient.Service.use((service) =>
        service.authenticated((scope) =>
          Effect.all([scope.projects(), scope.modules(), scope.tasks()], { concurrency: 1 }),
        ),
      ).pipe(Effect.provide(layer(client, account)))

      expect(acquisitions).toBe(1)
      expect(seen.map((request) => [request.headers.authorization, request.headers["x-org-id"]])).toEqual([
        ["Bearer secret-token", "org-1"],
        ["Bearer secret-token", "org-1"],
        ["Bearer secret-token", "org-1"],
      ])
    }),
  )

  it.live("escapes filters with URLSearchParams", () =>
    Effect.gen(function* () {
      const seen: string[] = []
      const client = HttpClient.make((request) => {
        seen.push(request.url)
        return Effect.succeed(response(request, { items: [] }))
      })
      yield* MapClient.Service.use((service) =>
        Effect.all(
          [
            service.modules({ project_id: "project & one" }),
            service.tasks({ project_id: "p/1", module_id: "m?x=1" }),
            service.events({ task_id: "task#1" }),
          ],
          { concurrency: 1 },
        ),
      ).pipe(Effect.provide(layer(client)))
      expect(seen).toEqual([
        "https://map.marks.ia.br/api/map/v3/modules?project_id=project+%26+one",
        "https://map.marks.ia.br/api/map/v3/tasks?project_id=p%2F1&module_id=m%3Fx%3D1",
        "https://map.marks.ia.br/api/map/v3/events?task_id=task%231",
      ])
    }),
  )

  it.live("fails closed on org races before and after HTTP", () =>
    Effect.gen(function* () {
      let beforeChecks = 0
      let afterChecks = 0
      let beforeCalls = 0
      let afterCalls = 0
      const beforeAccount = accountLayer({
        validateActiveOrgLease: () => Effect.sync(() => beforeChecks++ !== 0),
      })
      const afterAccount = accountLayer({
        validateActiveOrgLease: () => Effect.sync(() => afterChecks++ === 0),
      })
      const beforeClient = HttpClient.make((request) => {
        beforeCalls += 1
        return Effect.succeed(response(request, { items: [] }))
      })
      const afterClient = HttpClient.make((request) => {
        afterCalls += 1
        return Effect.succeed(response(request, { items: [] }))
      })
      const before = yield* Effect.exit(
        MapClient.Service.use((service) => service.projects()).pipe(Effect.provide(layer(beforeClient, beforeAccount))),
      )
      const after = yield* Effect.exit(
        MapClient.Service.use((service) => service.projects()).pipe(Effect.provide(layer(afterClient, afterAccount))),
      )
      expect(Exit.isFailure(before) && Cause.squash(before.cause)).toMatchObject({ reason: "org_changed" })
      expect(Exit.isFailure(after) && Cause.squash(after.cause)).toMatchObject({ reason: "org_changed" })
      expect(beforeCalls).toBe(0)
      expect(afterCalls).toBe(1)
    }),
  )

  for (const status of [401, 403] as const) {
    it.live(`maps ${status} error envelope`, () =>
      Effect.gen(function* () {
        const client = HttpClient.make((request) =>
          Effect.succeed(
            response(
              request,
              {
                error: status === 401 ? "authentication_required" : "organization_denied",
                message: "denied\u001b[31m\n" + "x".repeat(600),
                secret: "must-not-leak",
              },
              status,
            ),
          ),
        )
        const exit = yield* Effect.exit(
          MapClient.Service.use((service) => service.projects()).pipe(Effect.provide(layer(client))),
        )
        const error = Exit.isFailure(exit) && Cause.squash(exit.cause)
        expect(error).toMatchObject({ _tag: "MapUnauthorizedError", status })
        expect(String(error)).not.toContain("must-not-leak")
        expect(error).toMatchObject({ detail: expect.stringMatching(/^.{512}$/s) })
      }),
    )
  }

  for (const status of [400, 503]) {
    it.live(`maps ${status} response error`, () =>
      Effect.gen(function* () {
        const client = HttpClient.make((request) =>
          Effect.succeed(
            response(
              request,
              {
                error: status === 400 ? "invalid_identifier" : "repository_unavailable",
                message: "failed",
              },
              status,
            ),
          ),
        )
        const exit = yield* Effect.exit(
          MapClient.Service.use((service) => service.projects()).pipe(Effect.provide(layer(client))),
        )
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({ _tag: "MapResponseError", status })
      }),
    )
  }

  it.live("retries transient GET responses", () =>
    Effect.gen(function* () {
      let calls = 0
      const client = HttpClient.make((request) => {
        calls += 1
        if (calls < 3)
          return Effect.succeed(response(request, { error: "repository_unavailable", message: "retry" }, 503))
        return Effect.succeed(response(request, { items: [] }))
      })
      yield* MapClient.Service.use((service) => service.projects()).pipe(Effect.provide(layer(client)))
      expect(calls).toBe(3)
    }),
  )

  it.live("cancels retry when the fixed lease changes", () =>
    Effect.gen(function* () {
      let checks = 0
      const seen: HttpClientRequest.HttpClientRequest[] = []
      const account = accountLayer({
        validateActiveOrgLease: () => Effect.sync(() => checks++ < 2),
      })
      const client = HttpClient.make((request) => {
        seen.push(request)
        if (seen.length === 1)
          return Effect.succeed(response(request, { error: "repository_unavailable", message: "retry" }, 503))
        return Effect.succeed(response(request, { items: [] }))
      })
      const exit = yield* Effect.exit(
        MapClient.Service.use((service) => service.projects()).pipe(Effect.provide(layer(client, account))),
      )
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({ reason: "org_changed" })
      expect(seen.map((request) => request.headers["x-org-id"])).toEqual(["org-1"])
      expect(checks).toBe(3)
    }),
  )

  for (const location of ["/api/map/v3/projects", "https://evil.example/projects"]) {
    it.live(`rejects redirect to ${location} without following it`, () =>
      Effect.gen(function* () {
        const seen: HttpClientRequest.HttpClientRequest[] = []
        const client = HttpClient.make((request) => {
          seen.push(request)
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(undefined, {
                status: 302,
                headers: { location },
              }),
            ),
          )
        })
        const exit = yield* Effect.exit(
          MapClient.Service.use((service) => service.projects()).pipe(Effect.provide(layer(client))),
        )
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
          _tag: "MapResponseError",
          status: 302,
        })
        expect(seen).toHaveLength(1)
      }),
    )
  }

  it.live("rejects malicious or arbitrary configured bases without HTTP", () =>
    Effect.gen(function* () {
      const values = [
        "http://map.marks.ia.br/api/map/v3",
        "https://user:pass@map.marks.ia.br/api/map/v3",
        "https://map.marks.ia.br:444/api/map/v3",
        "https://map.marks.ia.br/api/map/v3?next=https://evil.example",
        "https://map.marks.ia.br/api/map/v3#x",
        "https://evil.example/api/map/v3",
        "https://127.0.0.1/api/map/v3",
        "https://10.0.0.1/api/map/v3",
      ]
      let calls = 0
      const client = HttpClient.make((request) => {
        calls += 1
        return Effect.succeed(response(request, { items: [] }))
      })
      yield* Effect.forEach(values, (value) => {
        process.env.MAP_API_BASE_URL = value
        return Effect.exit(MapClient.Service.use((service) => service.projects()).pipe(Effect.provide(layer(client))))
      })
      expect(calls).toBe(0)
    }),
  )

  it.live("normalizes allowed configured paths to v3", () =>
    Effect.gen(function* () {
      process.env.MARKSCODE_MAP_API_URL = "https://map.marks.ia.br/legacy/"
      const seen: string[] = []
      const client = HttpClient.make((request) => {
        seen.push(request.url)
        return Effect.succeed(response(request, { items: [] }))
      })
      yield* MapClient.Service.use((service) => service.projects()).pipe(Effect.provide(layer(client)))
      expect(seen).toEqual(["https://map.marks.ia.br/api/map/v3/projects"])
    }),
  )

  it.live("decodes live collection shapes with opaque IDs JSON strings and nulls", () =>
    Effect.gen(function* () {
      const common = {
        slug: "opaque",
        name: "Name",
        description: null,
        status: "active",
        priority: "normal",
        provenance: "native",
        metadata_json: "{}",
        version: 1,
        created_by: null,
        updated_by: null,
        completed_by: null,
        source_session: null,
        created_at: "2026-07-27T00:00:00Z",
        updated_at: "2026-07-27T00:00:00Z",
        completed_at: null,
        deleted_at: null,
      }
      const client = HttpClient.make((request) => {
        if (request.url.endsWith("/projects"))
          return Effect.succeed(response(request, { items: [{ org_id: "org-x", id: "project/opaque", ...common }] }))
        if (request.url.endsWith("/modules"))
          return Effect.succeed(
            response(request, {
              items: [{ org_id: "org-x", id: "module:opaque", project_id: "project/opaque", ...common }],
            }),
          )
        if (request.url.endsWith("/tasks"))
          return Effect.succeed(
            response(request, {
              items: [
                {
                  org_id: "org-x",
                  id: "task opaque",
                  project_id: "project/opaque",
                  module_id: null,
                  title: "Task",
                  description: null,
                  status: "open",
                  priority: "high",
                  assignee_id: null,
                  due_at: null,
                  provenance: "integration",
                  metadata_json: '{"x":1}',
                  version: 2,
                  created_by: null,
                  updated_by: null,
                  completed_by: null,
                  source_session: null,
                  created_at: "2026-07-27T00:00:00Z",
                  updated_at: "2026-07-27T00:00:00Z",
                  completed_at: null,
                  deleted_at: null,
                },
              ],
            }),
          )
        return Effect.succeed(
          response(request, {
            items: [
              {
                org_id: "org-x",
                id: "event#1",
                event_type: "observed",
                aggregate_type: "task",
                aggregate_id: "task opaque",
                user_id: null,
                source_session: null,
                idempotency_key: null,
                payload_json: '{"ok":true}',
                provenance: "integration",
                version: 1,
                created_at: "2026-07-27T00:00:00Z",
              },
            ],
          }),
        )
      })
      const result = yield* MapClient.Service.use((service) =>
        Effect.all([service.projects(), service.modules(), service.tasks(), service.events()], { concurrency: 1 }),
      ).pipe(Effect.provide(layer(client)))
      expect(result[0].items[0].id).toBe("project/opaque")
      expect(result[2].items[0].module_id).toBeNull()
      expect(result[3].items[0].payload_json).toBe('{"ok":true}')
    }),
  )

  it.live("rejects malformed JSON strings and response shapes", () =>
    Effect.gen(function* () {
      const bodies = [
        { items: [{ id: 1 }] },
        {
          items: [
            {
              org_id: "org",
              id: "event",
              event_type: "x",
              aggregate_type: "task",
              aggregate_id: "task",
              user_id: null,
              source_session: null,
              idempotency_key: null,
              payload_json: {},
              provenance: "native",
              version: 1,
              created_at: "now",
            },
          ],
        },
      ]
      const client = HttpClient.make((request) => Effect.succeed(response(request, bodies.shift())))
      const exits = yield* MapClient.Service.use((service) =>
        Effect.all([Effect.exit(service.projects()), Effect.exit(service.events())], { concurrency: 1 }),
      ).pipe(Effect.provide(layer(client)))
      expect(Exit.isFailure(exits[0]) && Cause.squash(exits[0].cause) instanceof MapClient.DecodeError).toBeTrue()
      expect(Exit.isFailure(exits[1]) && Cause.squash(exits[1].cause) instanceof MapClient.DecodeError).toBeTrue()
    }),
  )

  for (const id of ["", "x".repeat(129)]) {
    it.live(`rejects invalid wire ID length ${id.length}`, () =>
      Effect.gen(function* () {
        const client = HttpClient.make((request) =>
          Effect.succeed(
            response(request, {
              items: [
                {
                  org_id: "org",
                  id,
                  event_type: "x",
                  aggregate_type: "task",
                  aggregate_id: "task",
                  user_id: null,
                  source_session: null,
                  idempotency_key: null,
                  payload_json: "{}",
                  provenance: "native",
                  version: 1,
                  created_at: "2026-07-27T00:00:00Z",
                },
              ],
            }),
          ),
        )
        const exit = yield* Effect.exit(
          MapClient.Service.use((service) => service.events()).pipe(Effect.provide(layer(client))),
        )
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause) instanceof MapClient.DecodeError).toBeTrue()
      }),
    )
  }

  for (const version of [0, -1, 1.5]) {
    it.live(`rejects invalid version ${version}`, () =>
      Effect.gen(function* () {
        const client = HttpClient.make((request) =>
          Effect.succeed(
            response(request, {
              items: [
                {
                  org_id: "org",
                  id: "event",
                  event_type: "x",
                  aggregate_type: "task",
                  aggregate_id: "task",
                  user_id: null,
                  source_session: null,
                  idempotency_key: null,
                  payload_json: "{}",
                  provenance: "native",
                  version,
                  created_at: "2026-07-27T00:00:00Z",
                },
              ],
            }),
          ),
        )
        const exit = yield* Effect.exit(
          MapClient.Service.use((service) => service.events()).pipe(Effect.provide(layer(client))),
        )
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause) instanceof MapClient.DecodeError).toBeTrue()
      }),
    )
  }

  it.live("rejects invalid timestamps", () =>
    Effect.gen(function* () {
      const client = HttpClient.make((request) =>
        Effect.succeed(
          response(request, {
            items: [
              {
                org_id: "org",
                id: "event",
                event_type: "x",
                aggregate_type: "task",
                aggregate_id: "task",
                user_id: null,
                source_session: null,
                idempotency_key: null,
                payload_json: "{}",
                provenance: "native",
                version: 1,
                created_at: "now",
              },
            ],
          }),
        ),
      )
      const exit = yield* Effect.exit(
        MapClient.Service.use((service) => service.events()).pipe(Effect.provide(layer(client))),
      )
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause) instanceof MapClient.DecodeError).toBeTrue()
    }),
  )
})
