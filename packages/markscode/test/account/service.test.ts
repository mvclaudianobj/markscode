import { expect, test } from "bun:test"
import { Deferred, Duration, Effect, Fiber, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http"

import { AccountRepo } from "../../src/account/repo"
import { Account } from "../../src/account/account"
import {
  AccessToken,
  AccountID,
  AccountTransportError,
  DeviceCode,
  Login,
  Org,
  OrgID,
  RefreshToken,
  UserCode,
} from "../../src/account/schema"
import { Database } from "@/storage/db"
import { testEffect } from "../lib/effect"
import { RagConfig } from "@/rag/rag-config"

const truncate = Layer.effectDiscard(
  Effect.sync(() => {
    const db = Database.Client()
    db.run(/*sql*/ `DELETE FROM account_state`)
    db.run(/*sql*/ `DELETE FROM account`)
  }),
)

const it = testEffect(Layer.merge(AccountRepo.layer, truncate))

const insideEagerRefreshWindow = Duration.toMillis(Duration.minutes(1))
const outsideEagerRefreshWindow = Duration.toMillis(Duration.minutes(10))

const live = (client: HttpClient.HttpClient) =>
  Account.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)))

const json = (req: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )

const encodeOrg = Schema.encodeSync(Org)

const org = (id: string, name: string) => encodeOrg(new Org({ id: OrgID.make(id), name }))

const login = () =>
  new Login({
    code: DeviceCode.make("device-code"),
    user: UserCode.make("user-code"),
    url: "https://one.example.com/verify",
    server: "https://one.example.com",
    expiry: Duration.seconds(600),
    interval: Duration.seconds(5),
  })

const deviceTokenClient = (body: unknown, status = 400) =>
  HttpClient.make((req) =>
    Effect.succeed(
      req.url === "https://one.example.com/auth/device/token" ? json(req, body, status) : json(req, {}, 404),
    ),
  )

const poll = (body: unknown, status = 400) =>
  Account.Service.use((s) => s.poll(login())).pipe(Effect.provide(live(deviceTokenClient(body, status))))

const persist = (orgID: Option.Option<OrgID>) =>
  AccountRepo.Service.use((r) =>
    r.persistAccount({
      id: AccountID.make("user-1"),
      email: "user@example.com",
      url: "https://one.example.com",
      accessToken: AccessToken.make("at_1"),
      refreshToken: RefreshToken.make("rt_1"),
      expiry: Date.now() + outsideEagerRefreshWindow,
      orgID,
    }),
  )

const orgClient = (remoteOrgs: unknown) =>
  HttpClient.make((req) =>
    Effect.succeed(req.url === "https://one.example.com/api/orgs" ? json(req, remoteOrgs) : json(req, {}, 404)),
  )

const active = (id: string, orgID: string): Account.ActiveOrg => ({
  account: {
    id: AccountID.make(id),
    email: "user@example.com",
    url: "https://one.example.com",
    active_org_id: OrgID.make(orgID),
  },
  org: new Org({ id: OrgID.make(orgID), name: "Selected" }),
})

test("filterRemoteConfigForFreePlan removes explicitly paid models for free quota", () => {
  expect(
    Account.filterRemoteConfigForFreePlan(
      {
        memories: { enabled: true },
        provider: {
          markspanel: {
            models: {
              "gpt-plus": { tier: "plus" },
              "gpt-pro": { name: "GPT Pro" },
              "big-pickle": { name: "Big Pickle" },
              "llama-free": { access: "free" },
              zero: { cost: { input: 0, output: 0 } },
              unmarked: { name: "Unmarked" },
            },
          },
          paid: {
            models: {
              premium: { plan: "premium" },
              team: { required_plan: "team" },
              enterprise: { availability: "enterprise" },
            },
          },
        },
      },
      { tier: "free", hard_limit: true },
    ),
  ).toEqual({
    memories: { enabled: true },
    provider: {
      markspanel: {
        models: {
          "big-pickle": { name: "Big Pickle" },
          "llama-free": { access: "free" },
          zero: { cost: { input: 0, output: 0 } },
          unmarked: { name: "Unmarked" },
        },
      },
    },
  })
})

test("filterRemoteConfigForFreePlan preserves config for paid quota", () => {
  const config = { provider: { markspanel: { models: { "gpt-plus": { tier: "plus" } } } } }
  expect(Account.filterRemoteConfigForFreePlan(config, { tier: "plus", hard_limit: false })).toBe(config)
})

it.live("login normalizes trailing slashes in the provided server URL", () =>
  Effect.gen(function* () {
    const seen: Array<string> = []
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        seen.push(`${req.method} ${req.url}`)

        if (req.url === "https://one.example.com/auth/device/code") {
          return json(req, {
            device_code: "device-code",
            user_code: "user-code",
            verification_uri_complete: "/device?user_code=user-code",
            expires_in: 600,
            interval: 5,
          })
        }

        return json(req, {}, 404)
      }),
    )

    const result = yield* Account.use.login("https://one.example.com/").pipe(Effect.provide(live(client)))

    expect(seen).toEqual(["POST https://one.example.com/auth/device/code"])
    expect(result.server).toBe("https://one.example.com")
    expect(result.url).toBe("https://one.example.com/device?user_code=user-code")
  }),
)

it.live("login maps transport failures to account transport errors", () =>
  Effect.gen(function* () {
    const client = HttpClient.make((req) =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request: req }),
        }),
      ),
    )

    const error = yield* Effect.flip(Account.use.login("https://one.example.com").pipe(Effect.provide(live(client))))

    expect(error).toBeInstanceOf(AccountTransportError)
    if (error instanceof AccountTransportError) {
      expect(error.method).toBe("POST")
      expect(error.url).toBe("https://one.example.com/auth/device/code")
    }
  }),
)

it.live("orgsByAccount groups orgs per account", () =>
  Effect.gen(function* () {
    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id: AccountID.make("user-1"),
        email: "one@example.com",
        url: "https://one.example.com",
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + outsideEagerRefreshWindow,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id: AccountID.make("user-2"),
        email: "two@example.com",
        url: "https://two.example.com",
        accessToken: AccessToken.make("at_2"),
        refreshToken: RefreshToken.make("rt_2"),
        expiry: Date.now() + outsideEagerRefreshWindow,
        orgID: Option.none(),
      }),
    )

    const seen: Array<string> = []
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        seen.push(`${req.method} ${req.url}`)

        if (req.url === "https://one.example.com/api/orgs") {
          return json(req, [org("org-1", "One")])
        }

        if (req.url === "https://two.example.com/api/orgs") {
          return json(req, [org("org-2", "Two A"), org("org-3", "Two B")])
        }

        return json(req, [], 404)
      }),
    )

    const rows = yield* Account.use.orgsByAccount().pipe(Effect.provide(live(client)))

    expect(rows.map((row) => [row.account.id, row.orgs.map((org) => org.id)]).map(([id, orgs]) => [id, orgs])).toEqual([
      [AccountID.make("user-1"), [OrgID.make("org-1")]],
      [AccountID.make("user-2"), [OrgID.make("org-2"), OrgID.make("org-3")]],
    ])
    expect(seen).toEqual(["GET https://one.example.com/api/orgs", "GET https://two.example.com/api/orgs"])
  }),
)

it.live("activeOrg preserves a valid active org", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-current")))

    const active = yield* Account.use
      .activeOrg()
      .pipe(Effect.provide(live(orgClient([org("org-current", "Current"), org("org-other", "Other")]))))

    expect(Option.getOrThrow(active).org.id).toBe(OrgID.make("org-current"))
    expect(Option.getOrThrow(yield* AccountRepo.use.active()).active_org_id).toBe(OrgID.make("org-current"))
  }),
)

it.live("activeOrg replaces a stale active org when exactly one org exists", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-stale")))

    const active = yield* Account.use.activeOrg().pipe(Effect.provide(live(orgClient([org("org-only", "Only")]))))

    expect(Option.getOrThrow(active).org.id).toBe(OrgID.make("org-only"))
    expect(Option.getOrThrow(yield* AccountRepo.use.active()).active_org_id).toBe(OrgID.make("org-only"))
  }),
)

it.live("activeOrg clears a stale active org when no orgs exist", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-stale")))

    const active = yield* Account.use.activeOrg().pipe(Effect.provide(live(orgClient([]))))

    expect(Option.isNone(active)).toBeTrue()
    expect(Option.getOrThrow(yield* AccountRepo.use.active()).active_org_id).toBeNull()
  }),
)

it.live("activeOrg clears a stale active org without choosing among multiple orgs", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-stale")))

    const active = yield* Account.use
      .activeOrg()
      .pipe(Effect.provide(live(orgClient([org("org-one", "One"), org("org-two", "Two")]))))

    expect(Option.isNone(active)).toBeTrue()
    expect(Option.getOrThrow(yield* AccountRepo.use.active()).active_org_id).toBeNull()
  }),
)

it.live("concurrent activeOrg calls share one org request", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-current")))
    let calls = 0
    const client = HttpClient.make((req) =>
      Effect.promise(async () => {
        if (req.url === "https://one.example.com/api/orgs") {
          calls += 1
          await new Promise((resolve) => setTimeout(resolve, 25))
          return json(req, [org("org-current", "Current")])
        }
        return json(req, {}, 404)
      }),
    )

    const result = yield* Account.Service.use((service) =>
      Effect.all([service.activeOrg(), service.activeOrg()], { concurrency: 2 }),
    ).pipe(Effect.provide(live(client)))

    expect(result.every(Option.isSome)).toBeTrue()
    expect(calls).toBe(1)
  }),
)

it.live("activeOrg does not reactivate an account changed during org request", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-a")))
    yield* AccountRepo.use.persistAccount({
      id: AccountID.make("user-2"),
      email: "two@example.com",
      url: "https://two.example.com",
      accessToken: AccessToken.make("at_2"),
      refreshToken: RefreshToken.make("rt_2"),
      expiry: Date.now() + outsideEagerRefreshWindow,
      orgID: Option.none(),
    })
    yield* AccountRepo.use.use(AccountID.make("user-1"), Option.some(OrgID.make("org-a")))
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined)
        yield* Deferred.await(release)
        return json(req, [org("org-a", "A")])
      }),
    )
    const fiber = yield* Account.use.activeOrg().pipe(Effect.provide(live(client)), Effect.forkChild)
    yield* Deferred.await(started)
    yield* AccountRepo.use.use(AccountID.make("user-2"), Option.none())
    yield* Deferred.succeed(release, undefined)

    expect(Option.isNone(yield* Fiber.join(fiber))).toBeTrue()
    expect(Option.getOrThrow(yield* AccountRepo.use.active()).id).toBe(AccountID.make("user-2"))
  }),
)

it.live("activeOrg preserves a newer org selection changed during org request", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-1")))
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined)
        yield* Deferred.await(release)
        return json(req, [org("org-1", "One"), org("org-2", "Two")])
      }),
    )
    const fiber = yield* Account.use.activeOrg().pipe(Effect.provide(live(client)), Effect.forkChild)
    yield* Deferred.await(started)
    yield* AccountRepo.use.use(AccountID.make("user-1"), Option.some(OrgID.make("org-2")))
    yield* Deferred.succeed(release, undefined)

    expect(Option.isNone(yield* Fiber.join(fiber))).toBeTrue()
    expect(Option.getOrThrow(yield* AccountRepo.use.active()).active_org_id).toBe(OrgID.make("org-2"))
  }),
)

it.live("activeOrg rejects an ABA selection change during org request", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-a")))
    const observed = yield* AccountRepo.use.state()
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    let calls = 0
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        calls += 1
        yield* Deferred.succeed(started, undefined)
        yield* Deferred.await(release)
        return json(req, [org("org-a", "A")])
      }),
    )
    const fiber = yield* Account.use.activeOrg().pipe(Effect.provide(live(client)), Effect.forkChild)
    yield* Deferred.await(started)
    yield* AccountRepo.use.use(AccountID.make("user-1"), Option.some(OrgID.make("org-b")))
    yield* AccountRepo.use.use(AccountID.make("user-1"), Option.some(OrgID.make("org-a")))
    yield* Deferred.succeed(release, undefined)

    expect(Option.isNone(yield* Fiber.join(fiber))).toBeTrue()
    expect(calls).toBe(1)
    expect(Option.getOrThrow(yield* AccountRepo.use.active()).active_org_id).toBe(OrgID.make("org-a"))
    expect((yield* AccountRepo.use.state()).revision).toBe(observed.revision + 2)
  }),
)

it.live("active org lease acquires once and local validation detects ABA without HTTP", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-a")))
    let calls = 0
    const client = HttpClient.make((req) => {
      calls += 1
      return Effect.succeed(json(req, [org("org-a", "A"), org("org-b", "B")]))
    })
    const service = yield* Account.Service.pipe(Effect.provide(live(client)))
    const lease = Option.getOrThrow(yield* service.acquireActiveOrgLease())

    expect(calls).toBe(1)
    expect(lease.active.account.id).toBe(AccountID.make("user-1"))
    expect(lease.active.org.id).toBe(OrgID.make("org-a"))
    expect(lease.accessToken).toBe(AccessToken.make("at_1"))
    expect(yield* service.validateActiveOrgLease(lease)).toBeTrue()
    expect(calls).toBe(1)

    yield* AccountRepo.use.use(AccountID.make("user-1"), Option.some(OrgID.make("org-b")))
    yield* AccountRepo.use.use(AccountID.make("user-1"), Option.some(OrgID.make("org-a")))

    expect(yield* service.validateActiveOrgLease(lease)).toBeFalse()
    expect(calls).toBe(1)
  }),
)

it.live("activeOrg failure does not clear a valid selection", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-current")))
    let calls = 0
    let available = false
    const client = HttpClient.make((req) => {
      calls += 1
      return Effect.succeed(
        available ? json(req, [org("org-current", "Current")]) : json(req, { error: "temporary" }, 503),
      )
    })

    const result = yield* Effect.exit(Account.use.activeOrg().pipe(Effect.provide(live(client))))
    available = true
    const retry = yield* Account.use.activeOrg().pipe(Effect.provide(live(client)))

    expect(result._tag).toBe("Failure")
    expect(Option.getOrThrow(retry).org.id).toBe(OrgID.make("org-current"))
    expect(calls).toBeGreaterThan(1)
    expect(Option.getOrThrow(yield* AccountRepo.use.active()).active_org_id).toBe(OrgID.make("org-current"))
  }),
)

it.live("activeOrg prevents config from using a stale org id", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-stale")))
    const configOrgIDs: string[] = []
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        if (req.url === "https://one.example.com/api/orgs") {
          return json(req, [org("org-one", "One"), org("org-two", "Two")])
        }
        if (req.url === "https://one.example.com/api/config") {
          configOrgIDs.push(req.headers["x-org-id"] ?? "")
          return json(req, { config: {} })
        }

        if (req.url === "https://one.example.com/api/orgs") return json(req, [org("org-9", "Nine")])
        return json(req, {}, 404)
      }),
    )
    yield* Account.Service.use((service) =>
      Effect.gen(function* () {
        const resolved = yield* service.activeOrg()
        if (Option.isSome(resolved)) yield* service.configActive(resolved.value)
      }),
    ).pipe(Effect.provide(live(client)))

    expect(configOrgIDs).toEqual([])
    expect(Option.getOrThrow(yield* AccountRepo.use.active()).active_org_id).toBeNull()
  }),
)

it.live("token refresh persists the new token", () =>
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id,
        email: "user@example.com",
        url: "https://one.example.com",
        accessToken: AccessToken.make("at_old"),
        refreshToken: RefreshToken.make("rt_old"),
        expiry: Date.now() - 1_000,
        orgID: Option.none(),
      }),
    )

    const client = HttpClient.make((req) =>
      Effect.succeed(
        req.url === "https://one.example.com/auth/device/token"
          ? json(req, {
              access_token: "at_new",
              refresh_token: "rt_new",
              expires_in: 600,
            })
          : json(req, {}, 404),
      ),
    )

    const token = yield* Account.use.token(id).pipe(Effect.provide(live(client)))

    expect(Option.getOrThrow(token)).toBeDefined()
    expect(String(Option.getOrThrow(token))).toBe("at_new")

    const row = yield* AccountRepo.use.getRow(id)
    const value = Option.getOrThrow(row)
    expect(value.access_token).toBe(AccessToken.make("at_new"))
    expect(value.refresh_token).toBe(RefreshToken.make("rt_new"))
    expect(value.token_expiry).toBeGreaterThan(Date.now())
  }),
)

it.live("token refreshes before expiry when inside the eager refresh window", () =>
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id,
        email: "user@example.com",
        url: "https://one.example.com",
        accessToken: AccessToken.make("at_old"),
        refreshToken: RefreshToken.make("rt_old"),
        expiry: Date.now() + insideEagerRefreshWindow,
        orgID: Option.none(),
      }),
    )

    let refreshCalls = 0
    const client = HttpClient.make((req) =>
      Effect.promise(async () => {
        if (req.url === "https://one.example.com/auth/device/token") {
          refreshCalls += 1
          return json(req, {
            access_token: "at_new",
            refresh_token: "rt_new",
            expires_in: 60,
          })
        }

        return json(req, {}, 404)
      }),
    )

    const token = yield* Account.use.token(id).pipe(Effect.provide(live(client)))

    expect(String(Option.getOrThrow(token))).toBe("at_new")
    expect(refreshCalls).toBe(1)

    const row = yield* AccountRepo.use.getRow(id)
    const value = Option.getOrThrow(row)
    expect(value.access_token).toBe(AccessToken.make("at_new"))
    expect(value.refresh_token).toBe(RefreshToken.make("rt_new"))
  }),
)

it.live("concurrent config and token requests coalesce token refresh", () =>
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id,
        email: "user@example.com",
        url: "https://one.example.com",
        accessToken: AccessToken.make("at_old"),
        refreshToken: RefreshToken.make("rt_old"),
        expiry: Date.now() - 1_000,
        orgID: Option.some(OrgID.make("org-9")),
      }),
    )

    let refreshCalls = 0
    const client = HttpClient.make((req) =>
      Effect.promise(async () => {
        if (req.url === "https://one.example.com/auth/device/token") {
          refreshCalls += 1

          if (refreshCalls === 1) {
            await new Promise((resolve) => setTimeout(resolve, 25))
            return json(req, {
              access_token: "at_new",
              refresh_token: "rt_new",
              expires_in: 600,
            })
          }

          return json(
            req,
            {
              error: "invalid_grant",
              error_description: "refresh token already used",
            },
            400,
          )
        }

        if (req.url === "https://one.example.com/api/config") {
          return json(req, { config: { theme: "light", seats: 5 } })
        }

        if (req.url === "https://one.example.com/api/orgs") return json(req, [org("org-9", "Nine")])

        return json(req, {}, 404)
      }),
    )

    const [cfg, token] = yield* Account.Service.use((s) =>
      Effect.all([s.configActive(active("user-1", "org-9")), s.token(id)], { concurrency: 2 }),
    ).pipe(Effect.provide(live(client)))

    expect(Option.getOrThrow(cfg)).toEqual({ theme: "light", seats: 5 })
    expect(String(Option.getOrThrow(token))).toBe("at_new")
    expect(refreshCalls).toBe(1)

    const row = yield* AccountRepo.use.getRow(id)
    const value = Option.getOrThrow(row)
    expect(value.access_token).toBe(AccessToken.make("at_new"))
    expect(value.refresh_token).toBe(RefreshToken.make("rt_new"))
  }),
)

it.live("config sends the selected org header", () =>
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id,
        email: "user@example.com",
        url: "https://one.example.com",
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + outsideEagerRefreshWindow,
        orgID: Option.none(),
      }),
    )

    const seen: { auth?: string; org?: string } = {}
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        if (req.url === "https://one.example.com/api/config") {
          seen.auth = req.headers.authorization
          seen.org = req.headers["x-org-id"]
          return json(req, { config: { theme: "light", seats: 5 } })
        }

        if (req.url === "https://one.example.com/api/orgs") return json(req, [org("org-9", "Nine")])
        return json(req, {}, 404)
      }),
    )

    const cfg = yield* Account.Service.use((s) => s.configActive(active("user-1", "org-9"))).pipe(
      Effect.provide(live(client)),
    )

    expect(Option.getOrThrow(cfg)).toEqual({ theme: "light", seats: 5 })
    expect(seen).toEqual({
      auth: "Bearer at_1",
      org: "org-9",
    })
  }),
)

it.live("config captures valid top-level rag while returning only config", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-9")))
    const client = HttpClient.make((req) => {
      if (req.url.endsWith("/api/orgs")) return Effect.succeed(json(req, [org("org-9", "Nine")]))
      if (req.url.endsWith("/api/config"))
        return Effect.succeed(
          json(req, {
            config: { theme: "light" },
            rag: {
              enabled: true,
              version: 1,
              base_url: "/api/rag/v1",
              requires_org: true,
              auth: "account_bearer",
              search: { mode: "lexical", query_records_audit_row: true },
              capabilities: {
                health: true,
                list_collections: true,
                create_collection: true,
                create_source: true,
                ingest_document: true,
                query: true,
                get_document: false,
                embeddings: false,
                hybrid_search: false,
              },
              limits: { query_limit_max: 50, chunk_max_chars: 1200, chunk_overlap_chars: 160 },
            },
          }),
        )
      if (req.url.endsWith("/api/markscode/ai/quota")) return Effect.succeed(json(req, {}, 404))
      return Effect.succeed(json(req, {}, 404))
    })

    const result = yield* Account.Service.use((service) =>
      service.config(AccountID.make("user-1"), OrgID.make("org-9")),
    ).pipe(Effect.provide(live(client)))

    expect(Option.getOrThrow(result)).toEqual({ theme: "light" })
    expect(RagConfig.getRagConfig(AccountID.make("user-1"), OrgID.make("org-9"))).toMatchObject({
      base_url: "https://one.example.com/api/rag/v1",
      account_id: AccountID.make("user-1"),
      org_id: OrgID.make("org-9"),
    })
    RagConfig.clearRagConfig()
  }),
)

it.live("config absence failure and account switch clear stale rag", () =>
  Effect.gen(function* () {
    RagConfig.setRagConfig(
      {
        enabled: true,
        version: 1,
        base_url: "/api/rag/v1",
        requires_org: true,
        auth: "account_bearer",
        search: { mode: "lexical", query_records_audit_row: true },
        capabilities: {
          health: true,
          list_collections: true,
          create_collection: true,
          create_source: true,
          ingest_document: true,
          query: true,
          get_document: false,
          embeddings: false,
          hybrid_search: false,
        },
        limits: { query_limit_max: 50, chunk_max_chars: 1200, chunk_overlap_chars: 160 },
      },
      { accountID: AccountID.make("user-1"), orgID: OrgID.make("org-9"), accountUrl: "https://one.example.com" },
    )
    yield* persist(Option.some(OrgID.make("org-9")))
    const client = HttpClient.make((req) => {
      if (req.url.endsWith("/api/orgs")) return Effect.succeed(json(req, [org("org-9", "Nine")]))
      if (req.url.endsWith("/api/config")) return Effect.succeed(json(req, { config: {} }))
      return Effect.succeed(json(req, {}, 404))
    })

    yield* Account.Service.use((service) => service.config(AccountID.make("user-1"), OrgID.make("org-9"))).pipe(
      Effect.provide(live(client)),
    )
    expect(RagConfig.getRagConfig(AccountID.make("user-1"), OrgID.make("org-9"))).toBeUndefined()

    RagConfig.setRagConfig(
      {
        enabled: true,
        version: 1,
        base_url: "/api/rag/v1",
        requires_org: true,
        auth: "account_bearer",
        search: { mode: "lexical", query_records_audit_row: true },
        capabilities: {
          health: true,
          list_collections: true,
          create_collection: true,
          create_source: true,
          ingest_document: true,
          query: true,
          get_document: false,
          embeddings: false,
          hybrid_search: false,
        },
        limits: { query_limit_max: 50, chunk_max_chars: 1200, chunk_overlap_chars: 160 },
      },
      { accountID: AccountID.make("user-1"), orgID: OrgID.make("org-9"), accountUrl: "https://one.example.com" },
    )
    yield* Account.Service.use((service) =>
      service.use(AccountID.make("user-1"), Option.some(OrgID.make("org-9"))),
    ).pipe(Effect.provide(live(client)))
    expect(RagConfig.getRagConfig(AccountID.make("user-1"), OrgID.make("org-9"))).toBeUndefined()
  }),
)

it.live("legacy config signature revalidates before sending", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-9")))
    const seen: string[] = []
    const client = HttpClient.make((req) => {
      if (req.url.endsWith("/api/orgs")) return Effect.succeed(json(req, [org("org-9", "Nine")]))
      if (req.url.endsWith("/api/config")) {
        seen.push(req.headers["x-org-id"] ?? "")
        return Effect.succeed(json(req, { config: {} }))
      }
      return Effect.succeed(json(req, {}, 404))
    })

    yield* Account.Service.use((service) => service.config(AccountID.make("user-1"), OrgID.make("org-9"))).pipe(
      Effect.provide(live(client)),
    )

    expect(seen).toEqual(["org-9"])
  }),
)

it.live("config sends no request when active org changes before validation", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-1")))
    let configCalls = 0
    const client = HttpClient.make((req) => {
      if (req.url.endsWith("/api/orgs")) return Effect.succeed(json(req, [org("org-1", "One"), org("org-2", "Two")]))
      configCalls += 1
      return Effect.succeed(json(req, { config: {} }))
    })
    yield* AccountRepo.use.use(AccountID.make("user-1"), Option.some(OrgID.make("org-2")))

    const result = yield* Account.Service.use((service) => service.configActive(active("user-1", "org-1"))).pipe(
      Effect.provide(live(client)),
    )

    expect(Option.isNone(result)).toBeTrue()
    expect(configCalls).toBe(0)
  }),
)

it.live("config sends no request when active org changes after reconciliation", () =>
  Effect.gen(function* () {
    yield* AccountRepo.use.persistAccount({
      id: AccountID.make("user-1"),
      email: "user@example.com",
      url: "https://one.example.com",
      accessToken: AccessToken.make("at_old"),
      refreshToken: RefreshToken.make("rt_old"),
      expiry: Date.now() - 1,
      orgID: Option.some(OrgID.make("org-1")),
    })
    const refreshing = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    let configCalls = 0
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        if (req.url.endsWith("/api/orgs")) return json(req, [org("org-1", "One"), org("org-2", "Two")])
        if (req.url.endsWith("/auth/device/token")) {
          yield* Deferred.succeed(refreshing, undefined)
          yield* Deferred.await(release)
          return json(req, { access_token: "at_new", refresh_token: "rt_new", expires_in: 600 })
        }
        if (req.url.endsWith("/api/config")) configCalls += 1
        return json(req, { config: {} })
      }),
    )
    const fiber = yield* Account.Service.use((service) => service.configActive(active("user-1", "org-1"))).pipe(
      Effect.provide(live(client)),
      Effect.forkChild,
    )
    yield* Deferred.await(refreshing)
    yield* AccountRepo.use.use(AccountID.make("user-1"), Option.some(OrgID.make("org-2")))
    yield* Deferred.succeed(release, undefined)

    expect(Option.isNone(yield* Fiber.join(fiber))).toBeTrue()
    expect(configCalls).toBe(0)
  }),
)

it.live("old remote config response cannot reinstall rag after account lifecycle clear", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-1")))
    const requested = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        if (req.url.endsWith("/api/orgs")) return json(req, [org("org-1", "One"), org("org-2", "Two")])
        if (req.url.endsWith("/api/config")) {
          yield* Deferred.succeed(requested, undefined)
          yield* Deferred.await(release)
          return json(req, {
            config: {},
            rag: {
              enabled: true,
              version: 1,
              base_url: "/api/rag/v1",
              requires_org: true,
              auth: "account_bearer",
              search: { mode: "lexical", query_records_audit_row: true },
              capabilities: {
                health: true,
                list_collections: true,
                create_collection: true,
                create_source: true,
                ingest_document: true,
                query: true,
                get_document: false,
                embeddings: false,
                hybrid_search: false,
              },
              limits: { query_limit_max: 50, chunk_max_chars: 1200, chunk_overlap_chars: 160 },
            },
          })
        }
        return json(req, {}, 404)
      }),
    )

    yield* Account.Service.use((service) =>
      Effect.gen(function* () {
        const fiber = yield* service.config(AccountID.make("user-1"), OrgID.make("org-1")).pipe(Effect.forkChild)
        yield* Deferred.await(requested)
        yield* service.use(AccountID.make("user-1"), Option.some(OrgID.make("org-2")))
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(fiber)
      }),
    ).pipe(Effect.provide(live(client)))

    expect(RagConfig.getRagConfig(AccountID.make("user-1"), OrgID.make("org-1"))).toBeUndefined()
  }),
)

it.live("removing an inactive account preserves active rag config", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-9")))
    yield* AccountRepo.use.persistAccount({
      id: AccountID.make("user-2"),
      email: "two@example.com",
      url: "https://two.example.com",
      accessToken: AccessToken.make("at_2"),
      refreshToken: RefreshToken.make("rt_2"),
      expiry: Date.now() + outsideEagerRefreshWindow,
      orgID: Option.some(OrgID.make("org-2")),
    })
    yield* AccountRepo.use.use(AccountID.make("user-1"), Option.some(OrgID.make("org-9")))
    RagConfig.setRagConfig(
      {
        enabled: true,
        version: 1,
        base_url: "/api/rag/v1",
        requires_org: true,
        auth: "account_bearer",
        search: { mode: "lexical", query_records_audit_row: true },
        capabilities: {
          health: true,
          list_collections: true,
          create_collection: true,
          create_source: true,
          ingest_document: true,
          query: true,
          get_document: false,
          embeddings: false,
          hybrid_search: false,
        },
        limits: { query_limit_max: 50, chunk_max_chars: 1200, chunk_overlap_chars: 160 },
      },
      { accountID: AccountID.make("user-1"), orgID: OrgID.make("org-9"), accountUrl: "https://one.example.com" },
    )

    yield* Account.Service.use((service) => service.remove(AccountID.make("user-2"))).pipe(
      Effect.provide(live(orgClient([]))),
    )

    expect(RagConfig.getRagConfig(AccountID.make("user-1"), OrgID.make("org-9"))).toBeDefined()
  }),
)

it.live("reportUsage sends reconciled org header", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-9")))
    const seen: string[] = []
    const client = HttpClient.make((req) => {
      if (req.url.endsWith("/api/orgs")) return Effect.succeed(json(req, [org("org-9", "Nine")]))
      if (req.url.endsWith("/api/markscode/ai/usage/event")) seen.push(req.headers["x-org-id"] ?? "")
      return Effect.succeed(json(req, {}))
    })

    yield* Account.use
      .reportUsage({
        active: active("user-1", "org-9"),
        provider: "test",
        model: "model",
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
      })
      .pipe(Effect.provide(live(client)))

    expect(seen).toEqual(["org-9"])
  }),
)

it.live("reportUsage sends no request for stale org context", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-2")))
    let usageCalls = 0
    const client = HttpClient.make((req) => {
      if (req.url.endsWith("/api/orgs")) return Effect.succeed(json(req, [org("org-1", "One"), org("org-2", "Two")]))
      usageCalls += 1
      return Effect.succeed(json(req, {}))
    })

    yield* Account.use
      .reportUsage({
        active: active("user-1", "org-1"),
        provider: "test",
        model: "model",
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
      })
      .pipe(Effect.provide(live(client)))

    expect(usageCalls).toBe(0)
  }),
)

it.live("reportUsage sends no request when active org changes after reconciliation", () =>
  Effect.gen(function* () {
    yield* AccountRepo.use.persistAccount({
      id: AccountID.make("user-1"),
      email: "user@example.com",
      url: "https://one.example.com",
      accessToken: AccessToken.make("at_old"),
      refreshToken: RefreshToken.make("rt_old"),
      expiry: Date.now() - 1,
      orgID: Option.some(OrgID.make("org-1")),
    })
    const refreshing = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    let usageCalls = 0
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        if (req.url.endsWith("/api/orgs")) return json(req, [org("org-1", "One"), org("org-2", "Two")])
        if (req.url.endsWith("/auth/device/token")) {
          yield* Deferred.succeed(refreshing, undefined)
          yield* Deferred.await(release)
          return json(req, { access_token: "at_new", refresh_token: "rt_new", expires_in: 600 })
        }
        if (req.url.endsWith("/api/markscode/ai/usage/event")) usageCalls += 1
        return json(req, {})
      }),
    )
    const fiber = yield* Account.Service.use((service) =>
      service.reportUsage({
        active: active("user-1", "org-1"),
        provider: "test",
        model: "model",
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
      }),
    ).pipe(Effect.provide(live(client)), Effect.forkChild)
    yield* Deferred.await(refreshing)
    yield* AccountRepo.use.use(AccountID.make("user-1"), Option.some(OrgID.make("org-2")))
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(fiber)

    expect(usageCalls).toBe(0)
  }),
)

it.live("poll stores the account and only org on success", () =>
  Effect.gen(function* () {
    const client = HttpClient.make((req) =>
      Effect.succeed(
        req.url === "https://one.example.com/auth/device/token"
          ? json(req, {
              access_token: "at_1",
              refresh_token: "rt_1",
              token_type: "Bearer",
              expires_in: 60,
            })
          : req.url === "https://one.example.com/api/user"
            ? json(req, { id: "user-1", email: "user@example.com" })
            : req.url === "https://one.example.com/api/orgs"
              ? json(req, [org("org-1", "One")])
              : json(req, {}, 404),
      ),
    )

    const res = yield* Account.Service.use((s) => s.poll(login())).pipe(Effect.provide(live(client)))

    expect(res._tag).toBe("PollSuccess")
    if (res._tag === "PollSuccess") {
      expect(res.email).toBe("user@example.com")
    }

    const active = yield* AccountRepo.use.active()
    expect(Option.getOrThrow(active)).toEqual(
      expect.objectContaining({
        id: "user-1",
        email: "user@example.com",
        active_org_id: "org-1",
      }),
    )
  }),
)

it.live("poll leaves the active org empty when multiple orgs exist", () =>
  Effect.gen(function* () {
    const client = HttpClient.make((req) =>
      Effect.succeed(
        req.url === "https://one.example.com/auth/device/token"
          ? json(req, {
              access_token: "at_1",
              refresh_token: "rt_1",
              token_type: "Bearer",
              expires_in: 60,
            })
          : req.url === "https://one.example.com/api/user"
            ? json(req, { id: "user-1", email: "user@example.com" })
            : req.url === "https://one.example.com/api/orgs"
              ? json(req, [org("org-1", "One"), org("org-2", "Two")])
              : json(req, {}, 404),
      ),
    )

    const result = yield* Account.use.poll(login()).pipe(Effect.provide(live(client)))

    expect(result._tag).toBe("PollSuccess")
    expect(Option.getOrThrow(yield* AccountRepo.use.active()).active_org_id).toBeNull()
  }),
)

it.live("poll preserves a valid previous org when multiple orgs exist", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-2")))
    const client = HttpClient.make((req) =>
      Effect.succeed(
        req.url === "https://one.example.com/auth/device/token"
          ? json(req, {
              access_token: "at_2",
              refresh_token: "rt_2",
              token_type: "Bearer",
              expires_in: 60,
            })
          : req.url === "https://one.example.com/api/user"
            ? json(req, { id: "user-1", email: "user@example.com" })
            : req.url === "https://one.example.com/api/orgs"
              ? json(req, [org("org-1", "One"), org("org-2", "Two")])
              : json(req, {}, 404),
      ),
    )

    const result = yield* Account.use.poll(login()).pipe(Effect.provide(live(client)))

    expect(result._tag).toBe("PollSuccess")
    expect(Option.getOrThrow(yield* AccountRepo.use.active()).active_org_id).toBe(OrgID.make("org-2"))
    if (result._tag === "PollSuccess") expect(result.org?.id).toBe(OrgID.make("org-2"))
  }),
)

for (const [name, remoteOrgs, expected] of [
  ["only org", [org("org-1", "One")], OrgID.make("org-1")],
  ["multiple orgs", [org("org-1", "One"), org("org-2", "Two")], null],
] as const) {
  it.live(`password login stores ${name} selection safely`, () =>
    Effect.gen(function* () {
      const client = HttpClient.make((req) =>
        Effect.succeed(
          req.url === "https://one.example.com/auth/device/login"
            ? json(req, {
                access_token: "at_1",
                refresh_token: "rt_1",
                token_type: "Bearer",
                expires_in: 60,
              })
            : req.url === "https://one.example.com/api/user"
              ? json(req, { id: "user-1", email: "user@example.com" })
              : req.url === "https://one.example.com/api/orgs"
                ? json(req, remoteOrgs)
                : json(req, {}, 404),
        ),
      )

      yield* Account.use
        .loginWithPassword({ url: "https://one.example.com", email: "user@example.com", password: "secret" })
        .pipe(Effect.provide(live(client)))

      expect(Option.getOrThrow(yield* AccountRepo.use.active()).active_org_id).toBe(expected)
    }),
  )
}

it.live("password login preserves a valid previous org when multiple orgs exist", () =>
  Effect.gen(function* () {
    yield* persist(Option.some(OrgID.make("org-2")))
    const client = HttpClient.make((req) =>
      Effect.succeed(
        req.url === "https://one.example.com/auth/device/login"
          ? json(req, {
              access_token: "at_2",
              refresh_token: "rt_2",
              token_type: "Bearer",
              expires_in: 60,
            })
          : req.url === "https://one.example.com/api/user"
            ? json(req, { id: "user-1", email: "user@example.com" })
            : req.url === "https://one.example.com/api/orgs"
              ? json(req, [org("org-1", "One"), org("org-2", "Two")])
              : json(req, {}, 404),
      ),
    )

    const result = yield* Account.use
      .loginWithPassword({ url: "https://one.example.com", email: "user@example.com", password: "secret" })
      .pipe(Effect.provide(live(client)))

    expect(Option.getOrThrow(yield* AccountRepo.use.active()).active_org_id).toBe(OrgID.make("org-2"))
    expect(result.org?.id).toBe(OrgID.make("org-2"))
  }),
)

for (const [name, body, expectedTag] of [
  [
    "pending",
    {
      error: "authorization_pending",
      error_description: "The authorization request is still pending",
    },
    "PollPending",
  ],
  [
    "slow",
    {
      error: "slow_down",
      error_description: "Polling too frequently, please slow down",
    },
    "PollSlow",
  ],
  [
    "denied",
    {
      error: "access_denied",
      error_description: "The authorization request was denied",
    },
    "PollDenied",
  ],
  [
    "expired",
    {
      error: "expired_token",
      error_description: "The device code has expired",
    },
    "PollExpired",
  ],
] as const) {
  it.live(`poll returns ${name} for ${body.error}`, () =>
    Effect.gen(function* () {
      const result = yield* poll(body)
      expect(result._tag).toBe(expectedTag)
    }),
  )
}

it.live("poll returns poll error for other OAuth errors", () =>
  Effect.gen(function* () {
    const result = yield* poll({
      error: "server_error",
      error_description: "An unexpected error occurred",
    })

    expect(result._tag).toBe("PollError")
    if (result._tag === "PollError") {
      expect(String(result.cause)).toContain("server_error")
    }
  }),
)
