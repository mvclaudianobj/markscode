import { Cache, Clock, Duration, Effect, Layer, Option, Schema, SchemaGetter, Context } from "effect"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"

import { withTransientReadRetry } from "@/util/effect-http-client"
import { setRemoteMemoryConfig } from "@/memory-config"
import { setBrainConfig } from "@/brain-config"
import { beginRagConfigUpdate, clearRagConfig, setRagConfig } from "@/rag/rag-config"
import { isRecord } from "@/util/record"
import { AccountRepo, type AccountRow, type ActiveSnapshot } from "./repo"
import { normalizeServerUrl } from "./url"
import {
  type AccountError,
  AccessToken,
  AccountID,
  DeviceCode,
  Info,
  RefreshToken,
  AccountServiceError,
  AccountTransportError,
  AccountUnauthorizedError,
  Login,
  Org,
  OrgID,
  PollDenied,
  PollError,
  PollExpired,
  PollPending,
  type PollResult,
  PollSlow,
  PollSuccess,
  UserCode,
} from "./schema"

export {
  AccountID,
  type AccountError,
  AccountRepoError,
  AccountServiceError,
  AccountTransportError,
  AccountUnauthorizedError,
  AccessToken,
  RefreshToken,
  DeviceCode,
  UserCode,
  Info,
  Org,
  OrgID,
  Login,
  PollSuccess,
  PollPending,
  PollSlow,
  PollExpired,
  PollDenied,
  PollError,
  PollResult,
} from "./schema"

export type AccountOrgs = {
  account: Info
  orgs: readonly Org[]
}

export type ActiveOrg = {
  account: Info
  org: Org
}

export type ActiveOrgLease = {
  active: ActiveOrg
  accessToken: AccessToken
  revision: number
}

export type OrgResolution = {
  account: Info
  orgs: readonly Org[]
  active: Option.Option<Org>
}

type OrgResolutionSnapshot = {
  resolution: OrgResolution
  revision: number
}

export type MarkspanelQuotaPlan = {
  id?: string | number | null
  slug?: string | null
  name?: string | null
}

export type MarkspanelQuotaSubscription = {
  id?: string | number | null
  status?: string | null
  asaas_status?: string | null
  next_due_date?: string | null
  ends_at?: string | null
}

export type MarkspanelQuotaCounter = {
  limit: number
  used: number
  remaining: number
  pct: number
  warning: boolean
  exhausted: boolean
}

export type MarkspanelQuota = {
  tier: string
  tier_name?: string | null
  tier_id?: string | number | null
  tier_source?: string | null
  hard_limit: boolean
  billing_state?: string | null
  fallback_applied?: boolean
  contracted_plan?: MarkspanelQuotaPlan | null
  effective_plan?: MarkspanelQuotaPlan | null
  subscription?: MarkspanelQuotaSubscription | null
  message?: string | null
  monthly?: MarkspanelQuotaCounter
  daily?: MarkspanelQuotaCounter
  monthly_requests?: MarkspanelQuotaCounter
  daily_requests?: MarkspanelQuotaCounter
}

class RemoteConfig extends Schema.Class<RemoteConfig>("RemoteConfig")({
  config: Schema.Record(Schema.String, Schema.Json),
  brain: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
  rag: Schema.optional(Schema.Json),
}) {}

const DurationFromSeconds = Schema.Number.pipe(
  Schema.decodeTo(Schema.Duration, {
    decode: SchemaGetter.transform((n) => Duration.seconds(n)),
    encode: SchemaGetter.transform((d) => Duration.toSeconds(d)),
  }),
)

class TokenRefresh extends Schema.Class<TokenRefresh>("TokenRefresh")({
  access_token: AccessToken,
  refresh_token: RefreshToken,
  expires_in: DurationFromSeconds,
}) {}

class DeviceAuth extends Schema.Class<DeviceAuth>("DeviceAuth")({
  device_code: DeviceCode,
  user_code: UserCode,
  verification_uri_complete: Schema.String,
  expires_in: DurationFromSeconds,
  interval: DurationFromSeconds,
}) {}

class DeviceTokenSuccess extends Schema.Class<DeviceTokenSuccess>("DeviceTokenSuccess")({
  access_token: AccessToken,
  refresh_token: RefreshToken,
  token_type: Schema.Literal("Bearer"),
  expires_in: DurationFromSeconds,
}) {}

class DeviceTokenError extends Schema.Class<DeviceTokenError>("DeviceTokenError")({
  error: Schema.String,
  error_description: Schema.String,
}) {
  toPollResult(): PollResult {
    if (this.error === "authorization_pending") return new PollPending()
    if (this.error === "slow_down") return new PollSlow()
    if (this.error === "expired_token") return new PollExpired()
    if (this.error === "access_denied") return new PollDenied()
    return new PollError({ cause: this.error })
  }
}

const DeviceToken = Schema.Union([DeviceTokenSuccess, DeviceTokenError])

class User extends Schema.Class<User>("User")({
  id: AccountID,
  email: Schema.String,
}) {}

class ClientId extends Schema.Class<ClientId>("ClientId")({ client_id: Schema.String }) {}

class DeviceTokenRequest extends Schema.Class<DeviceTokenRequest>("DeviceTokenRequest")({
  grant_type: Schema.String,
  device_code: DeviceCode,
  client_id: Schema.String,
}) {}

class TokenRefreshRequest extends Schema.Class<TokenRefreshRequest>("TokenRefreshRequest")({
  grant_type: Schema.String,
  refresh_token: RefreshToken,
  client_id: Schema.String,
}) {}

class PasswordLoginRequest extends Schema.Class<PasswordLoginRequest>("PasswordLoginRequest")({
  email: Schema.String,
  password: Schema.String,
}) {}

class PasswordLoginResponse extends Schema.Class<PasswordLoginResponse>("PasswordLoginResponse")({
  access_token: AccessToken,
  refresh_token: RefreshToken,
  token_type: Schema.String,
  expires_in: DurationFromSeconds,
}) {}

const clientId = "opencode-cli"
const eagerRefreshThreshold = Duration.minutes(5)
const eagerRefreshThresholdMs = Duration.toMillis(eagerRefreshThreshold)

const isTokenFresh = (tokenExpiry: number | null, now: number) =>
  tokenExpiry != null && tokenExpiry > now + eagerRefreshThresholdMs

const mapAccountServiceError =
  (message = "Account service operation failed") =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, AccountError, R> =>
    effect.pipe(Effect.mapError((cause) => accountErrorFromCause(cause, message)))

const accountErrorFromCause = (cause: unknown, message: string): AccountError => {
  if (cause instanceof AccountServiceError || cause instanceof AccountTransportError) {
    return cause
  }

  if (HttpClientError.isHttpClientError(cause)) {
    switch (cause.reason._tag) {
      case "TransportError": {
        return AccountTransportError.fromHttpClientError(cause.reason)
      }
      default: {
        return new AccountServiceError({ message, cause })
      }
    }
  }

  return new AccountServiceError({ message, cause })
}

const freePattern = /free|livre/i
const paidPattern = /(?:^|[-_\s:/])(?:plus|pro|premium)(?:$|[-_\s:/])/i
const paidPlanPattern = /^(?:plus|pro|premium|paid|enterprise|team|restricted)$/i
const paidPlanFields = [
  "tier",
  "plan",
  "access",
  "billing",
  "required_plan",
  "min_plan",
  "subscription",
  "availability",
]

const textIncludes = (value: unknown, pattern: RegExp) => typeof value === "string" && pattern.test(value)

const quotaLooksFree = (quota: MarkspanelQuota | null) => {
  if (!quota) return false
  if (quota.fallback_applied === true && !quota.contracted_plan) return true
  if (
    [quota.tier, quota.tier_name, quota.effective_plan?.slug, quota.effective_plan?.name].some((value) =>
      textIncludes(value, freePattern),
    )
  ) {
    return true
  }

  if (quota.hard_limit === true) {
    return [quota.monthly, quota.monthly_requests].some((counter) => counter?.exhausted === true && counter.limit === 0)
  }

  return false
}

const modelFieldLooksFree = (value: unknown) => value === true || (typeof value === "string" && freePattern.test(value))

const modelHasZeroCost = (model: Record<string, unknown>) => {
  const cost = model.cost
  if (!isRecord(cost)) return false
  return cost.input === 0 && cost.output === 0
}

const modelFieldLooksPaid = (value: unknown) => typeof value === "string" && paidPlanPattern.test(value)

const modelHasPaidRestriction = (model: Record<string, unknown>) =>
  paidPlanFields.some((field) => modelFieldLooksPaid(model[field]))

const modelLooksFree = (id: string, value: unknown) => {
  const model = isRecord(value) ? value : {}
  const searchable = [id, model.id, model.name].filter((item): item is string => typeof item === "string")
  if (modelHasPaidRestriction(model)) return false
  if ([model.free, model.is_free, model.tier, model.plan, model.access, model.billing].some(modelFieldLooksFree))
    return true
  if (modelHasZeroCost(model)) return true
  if (searchable.some((item) => freePattern.test(item) || /big-pickle/i.test(item))) return true
  return !searchable.some((item) => paidPattern.test(item))
}

const filterModels = (models: unknown) => {
  if (Array.isArray(models))
    return models.filter((model) =>
      modelLooksFree(isRecord(model) && typeof model.id === "string" ? model.id : "", model),
    )
  if (!isRecord(models)) return models
  return Object.fromEntries(Object.entries(models).filter(([id, model]) => modelLooksFree(id, model)))
}

const filterProviderModels = (provider: unknown) => {
  if (!isRecord(provider)) return provider
  const entries = Object.entries(provider).map(
    ([key, value]) => [key, ["model", "models"].includes(key) ? filterModels(value) : value] as const,
  )
  const result = Object.fromEntries(entries)
  const modelValues = [result.model, result.models].filter(Boolean)
  if (!modelValues.length) return result
  if (
    modelValues.some((models) =>
      Array.isArray(models) ? models.length > 0 : isRecord(models) && Object.keys(models).length > 0,
    )
  ) {
    return result
  }
}

const filterProviders = (providers: unknown) => {
  if (!isRecord(providers)) return providers
  return Object.fromEntries(
    Object.entries(providers)
      .map(([key, provider]) => [key, filterProviderModels(provider)] as const)
      .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined),
  )
}

export function filterRemoteConfigForFreePlan(config: Record<string, unknown>, quota: MarkspanelQuota | null) {
  if (!quotaLooksFree(quota)) return config
  return Object.fromEntries(
    Object.entries(config).map(
      ([key, value]) =>
        [
          key,
          ["provider", "providers"].includes(key)
            ? filterProviders(value)
            : ["model", "models"].includes(key)
              ? filterModels(value)
              : value,
        ] as const,
    ),
  )
}

export interface Interface {
  readonly active: () => Effect.Effect<Option.Option<Info>, AccountError>
  readonly activeOrg: () => Effect.Effect<Option.Option<ActiveOrg>, AccountError>
  readonly acquireActiveOrgLease: () => Effect.Effect<Option.Option<ActiveOrgLease>, AccountError>
  readonly validateActiveOrgLease: (lease: ActiveOrgLease) => Effect.Effect<boolean, AccountError>
  readonly list: () => Effect.Effect<Info[], AccountError>
  readonly orgsByAccount: () => Effect.Effect<readonly AccountOrgs[], AccountError>
  readonly remove: (accountID: AccountID) => Effect.Effect<void, AccountError>
  readonly use: (accountID: AccountID, orgID: Option.Option<OrgID>) => Effect.Effect<void, AccountError>
  readonly selectOrg: (account: Info, org: Org) => Effect.Effect<ActiveOrg, AccountError>
  readonly orgs: (accountID: AccountID) => Effect.Effect<readonly Org[], AccountError>
  readonly config: (
    accountID: AccountID,
    orgID: OrgID,
  ) => Effect.Effect<Option.Option<Record<string, unknown>>, AccountError>
  readonly configActive: (active: ActiveOrg) => Effect.Effect<Option.Option<Record<string, unknown>>, AccountError>
  readonly token: (accountID: AccountID) => Effect.Effect<Option.Option<AccessToken>, AccountError>
  readonly login: (url: string) => Effect.Effect<Login, AccountError>
  readonly poll: (input: Login) => Effect.Effect<PollResult, AccountError>
  readonly loginWithPassword: (input: {
    url: string
    email: string
    password: string
  }) => Effect.Effect<PollSuccess, AccountError>
  readonly invalidateToken: (accountID: AccountID) => Effect.Effect<void, AccountError>

  readonly reportUsage: (input: {
    active: ActiveOrg
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    totalTokens: number
    reasoningTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    costUsd?: number
    sessionId?: string
    messageId?: string
  }) => Effect.Effect<void, never>

  readonly quota: (accountID: AccountID) => Effect.Effect<MarkspanelQuota | null, never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Account") {}

export const use = serviceUse(Service)

export const layer: Layer.Layer<Service, never, AccountRepo.Service | HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const repo = yield* AccountRepo.Service
    const http = yield* HttpClient.HttpClient
    const httpRead = withTransientReadRetry(http)
    const httpOk = HttpClient.filterStatusOk(http)
    const httpReadOk = HttpClient.filterStatusOk(httpRead)

    const executeRead = (request: HttpClientRequest.HttpClientRequest) =>
      httpRead.execute(request).pipe(mapAccountServiceError("HTTP request failed"))

    const executeReadOk = (request: HttpClientRequest.HttpClientRequest) =>
      httpReadOk.execute(request).pipe(mapAccountServiceError("HTTP request failed"))

    const executeEffectOk = <E>(request: Effect.Effect<HttpClientRequest.HttpClientRequest, E>) =>
      request.pipe(
        Effect.flatMap((req) => httpOk.execute(req)),
        mapAccountServiceError("HTTP request failed"),
      )

    const executeEffect = <E>(request: Effect.Effect<HttpClientRequest.HttpClientRequest, E>) =>
      request.pipe(
        Effect.flatMap((req) => http.execute(req)),
        mapAccountServiceError("HTTP request failed"),
      )

    const refreshToken = Effect.fnUntraced(function* (row: AccountRow) {
      const now = yield* Clock.currentTimeMillis

      const response = yield* executeEffectOk(
        HttpClientRequest.post(`${row.url}/auth/device/token`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.schemaBodyJson(TokenRefreshRequest)(
            new TokenRefreshRequest({
              grant_type: "refresh_token",
              refresh_token: row.refresh_token,
              client_id: clientId,
            }),
          ),
        ),
      )

      const parsed = yield* HttpClientResponse.schemaBodyJson(TokenRefresh)(response).pipe(
        mapAccountServiceError("Failed to decode response"),
      )

      const expiry = Option.some(now + Duration.toMillis(parsed.expires_in))

      yield* repo.persistToken({
        accountID: row.id,
        accessToken: parsed.access_token,
        refreshToken: parsed.refresh_token,
        expiry,
      })

      return parsed.access_token
    })

    const refreshTokenCache = yield* Cache.make<AccountID, AccessToken, AccountError>({
      capacity: Number.POSITIVE_INFINITY,
      timeToLive: Duration.zero,
      lookup: Effect.fnUntraced(function* (accountID) {
        const maybeAccount = yield* repo.getRow(accountID)
        if (Option.isNone(maybeAccount)) {
          return yield* Effect.fail(new AccountServiceError({ message: "Account not found during token refresh" }))
        }

        const account = maybeAccount.value
        const now = yield* Clock.currentTimeMillis
        if (isTokenFresh(account.token_expiry, now)) {
          return account.access_token
        }

        return yield* refreshToken(account)
      }),
    })

    const resolveToken = Effect.fnUntraced(function* (row: AccountRow) {
      const now = yield* Clock.currentTimeMillis
      if (isTokenFresh(row.token_expiry, now)) {
        return row.access_token
      }

      return yield* Cache.get(refreshTokenCache, row.id)
    })

    const resolveAccess = Effect.fnUntraced(function* (accountID: AccountID) {
      const maybeAccount = yield* repo.getRow(accountID)
      if (Option.isNone(maybeAccount)) return Option.none()

      const account = maybeAccount.value
      const accessToken = yield* resolveToken(account)
      return Option.some({ account, accessToken })
    })

    const fetchOrgs = Effect.fnUntraced(function* (url: string, accessToken: AccessToken) {
      const response = yield* executeReadOk(
        HttpClientRequest.get(`${url}/api/orgs`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bearerToken(accessToken),
        ),
      )

      return yield* HttpClientResponse.schemaBodyJson(Schema.Array(Org))(response).pipe(
        mapAccountServiceError("Failed to decode response"),
      )
    })

    const fetchUser = Effect.fnUntraced(function* (url: string, accessToken: AccessToken) {
      const response = yield* executeReadOk(
        HttpClientRequest.get(`${url}/api/user`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bearerToken(accessToken),
        ),
      )

      return yield* HttpClientResponse.schemaBodyJson(User)(response).pipe(
        mapAccountServiceError("Failed to decode response"),
      )
    })

    const decideOrg = (account: Info, accountOrgs: readonly Org[]): OrgResolution => {
      const current = accountOrgs.find((item) => item.id === account.active_org_id)
      const selected = current ?? (accountOrgs.length === 1 ? accountOrgs[0] : undefined)
      return {
        account: new Info({
          id: account.id,
          email: account.email,
          url: account.url,
          active_org_id: selected?.id ?? null,
        }),
        orgs: accountOrgs,
        active: Option.fromNullishOr(selected),
      }
    }

    const token = Effect.fn("Account.token")((accountID: AccountID) =>
      resolveAccess(accountID).pipe(Effect.map(Option.map((r) => r.accessToken))),
    )

    const orgsByAccount = Effect.fn("Account.orgsByAccount")(function* () {
      const accounts = yield* repo.list()
      return yield* Effect.forEach(
        accounts,
        (account) =>
          orgs(account.id).pipe(
            Effect.catch(() => Effect.succeed([] as readonly Org[])),
            Effect.map((orgs) => ({ account, orgs })),
          ),
        { concurrency: 3 },
      )
    })

    const orgs = Effect.fn("Account.orgs")(function* (accountID: AccountID) {
      const resolved = yield* resolveAccess(accountID)
      if (Option.isNone(resolved)) return []

      const { account, accessToken } = resolved.value

      return yield* fetchOrgs(account.url, accessToken)
    })

    const reconcile = (
      snapshot: ActiveSnapshot,
      accountOrgs: readonly Org[],
    ): Effect.Effect<Option.Option<OrgResolutionSnapshot>, AccountError> =>
      Effect.gen(function* () {
        const resolved = decideOrg(snapshot.account, accountOrgs)
        if (resolved.account.active_org_id === snapshot.account.active_org_id) {
          const current = yield* repo.activeSnapshot()
          if (Option.isNone(current) || current.value.revision !== snapshot.revision) return Option.none()
          return Option.some({ resolution: resolved, revision: snapshot.revision })
        }
        const updated = yield* repo.compareAndUse({
          accountID: snapshot.account.id,
          expectedOrgID: Option.fromNullishOr(snapshot.account.active_org_id),
          expectedRevision: snapshot.revision,
          orgID: Option.fromNullishOr(resolved.account.active_org_id),
        })
        if (updated) return Option.some({ resolution: resolved, revision: snapshot.revision + 1 })
        return Option.none()
      })

    const orgCache = yield* Cache.make<AccountID, Option.Option<OrgResolutionSnapshot>, AccountError>({
      capacity: Number.POSITIVE_INFINITY,
      timeToLive: Duration.zero,
      lookup: Effect.fnUntraced(function* (accountID) {
        const active = yield* repo.activeSnapshot()
        if (Option.isNone(active) || active.value.account.id !== accountID) {
          return yield* new AccountServiceError({
            message: "Active account changed during organization reconciliation",
          })
        }
        return yield* reconcile(active.value, yield* orgs(accountID))
      }),
    })

    const activeOrg = Effect.fn("Account.activeOrg")(function* () {
      const activeAccount = yield* repo.active()
      if (Option.isNone(activeAccount)) return Option.none<ActiveOrg>()

      const resolved = yield* Cache.get(orgCache, activeAccount.value.id)
      return Option.flatMap(resolved, (value) =>
        Option.map(value.resolution.active, (org) => ({ account: value.resolution.account, org })),
      )
    })

    const validateActiveOrgLease = Effect.fn("Account.validateActiveOrgLease")(function* (lease: ActiveOrgLease) {
      const current = yield* repo.activeSnapshot()
      return Option.exists(
        current,
        (snapshot) =>
          snapshot.revision === lease.revision &&
          snapshot.account.id === lease.active.account.id &&
          snapshot.account.active_org_id === lease.active.org.id,
      )
    })

    const acquireActiveOrgLease = Effect.fn("Account.acquireActiveOrgLease")(function* () {
      const snapshot = yield* repo.activeSnapshot()
      if (Option.isNone(snapshot)) return Option.none<ActiveOrgLease>()
      const resolved = yield* resolveAccess(snapshot.value.account.id)
      if (Option.isNone(resolved) || resolved.value.account.id !== snapshot.value.account.id) {
        return Option.none<ActiveOrgLease>()
      }
      const reconciled = yield* reconcile(
        snapshot.value,
        yield* fetchOrgs(resolved.value.account.url, resolved.value.accessToken),
      )
      if (Option.isNone(reconciled) || Option.isNone(reconciled.value.resolution.active)) {
        return Option.none<ActiveOrgLease>()
      }
      const lease: ActiveOrgLease = {
        active: {
          account: reconciled.value.resolution.account,
          org: reconciled.value.resolution.active.value,
        },
        accessToken: resolved.value.accessToken,
        revision: reconciled.value.revision,
      }
      if (!(yield* validateActiveOrgLease(lease))) return Option.none<ActiveOrgLease>()
      return Option.some(lease)
    })

    const selectOrg = Effect.fn("Account.selectOrg")(function* (account: Info, org: Org) {
      clearRagConfig({ accountID: account.id })
      yield* repo.use(account.id, Option.some(org.id))
      yield* Cache.invalidate(orgCache, account.id)
      return { account: { ...account, active_org_id: org.id }, org }
    })

    const validated = Effect.fnUntraced(function* (accountID: AccountID, orgID: OrgID) {
      const active = yield* repo.active()
      if (Option.isNone(active)) return Option.none<OrgResolutionSnapshot>()
      const resolved = yield* Cache.get(orgCache, active.value.id)
      if (Option.isNone(resolved)) return Option.none<OrgResolutionSnapshot>()
      if (resolved.value.resolution.account.id !== accountID) return Option.none<OrgResolutionSnapshot>()
      if (!Option.exists(resolved.value.resolution.active, (org) => org.id === orgID)) {
        return Option.none<OrgResolutionSnapshot>()
      }
      return resolved
    })

    const matchesRevision = Effect.fnUntraced(function* (accountID: AccountID, orgID: OrgID, revision: number) {
      const current = yield* repo.activeSnapshot()
      return Option.exists(
        current,
        (snapshot) =>
          snapshot.revision === revision &&
          snapshot.account.id === accountID &&
          snapshot.account.active_org_id === orgID,
      )
    })

    const loadConfig = Effect.fnUntraced(function* (accountID: AccountID, requestedOrgID: OrgID) {
      const ragRevision = beginRagConfigUpdate(accountID, requestedOrgID)
      const current = yield* validated(accountID, requestedOrgID)
      if (Option.isNone(current)) return Option.none<Record<string, unknown>>()
      const resolved = yield* resolveAccess(accountID)
      if (Option.isNone(resolved)) return Option.none()

      const { account, accessToken } = resolved.value
      if (!(yield* matchesRevision(accountID, requestedOrgID, current.value.revision))) return Option.none()

      const response = yield* executeRead(
        HttpClientRequest.get(`${account.url}/api/config`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bearerToken(accessToken),
          HttpClientRequest.setHeaders({ "x-org-id": requestedOrgID }),
        ),
      )

      if (response.status === 401) {
        return yield* Effect.fail(
          new AccountUnauthorizedError({
            message: "Token expirado ou revogado. Faça login novamente.",
            statusCode: 401,
            accountID,
          }),
        )
      }

      if (response.status === 404) return Option.none()

      const ok = yield* HttpClientResponse.filterStatusOk(response).pipe(mapAccountServiceError())

      const parsed = yield* HttpClientResponse.schemaBodyJson(RemoteConfig)(ok).pipe(
        mapAccountServiceError("Failed to decode response"),
      )
      const quotaResponse = yield* fetchQuota(account.url, accessToken)
      const filteredConfig = filterRemoteConfigForFreePlan(parsed.config, quotaResponse)
      if (!(yield* matchesRevision(accountID, requestedOrgID, current.value.revision))) return Option.none()
      setRemoteMemoryConfig(filteredConfig.memories, `${account.url}/api/config`)
      setBrainConfig(parsed.brain ?? filteredConfig.brain, account.url)
      setRagConfig(parsed.rag, { accountID, orgID: requestedOrgID, accountUrl: account.url }, ragRevision)
      return Option.some(filteredConfig)
    })

    const config = Effect.fn("Account.config")((accountID: AccountID, orgID: OrgID) => loadConfig(accountID, orgID))
    const configActive = Effect.fn("Account.configActive")((active: ActiveOrg) =>
      loadConfig(active.account.id, active.org.id),
    )

    const login = Effect.fn("Account.login")(function* (server: string) {
      const normalizedServer = normalizeServerUrl(server)
      const response = yield* executeEffectOk(
        HttpClientRequest.post(`${normalizedServer}/auth/device/code`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.schemaBodyJson(ClientId)(new ClientId({ client_id: clientId })),
        ),
      )

      const parsed = yield* HttpClientResponse.schemaBodyJson(DeviceAuth)(response).pipe(
        mapAccountServiceError("Failed to decode response"),
      )
      return new Login({
        code: parsed.device_code,
        user: parsed.user_code,
        url: new URL(parsed.verification_uri_complete, normalizedServer).toString(),
        server: normalizedServer,
        expiry: parsed.expires_in,
        interval: parsed.interval,
      })
    })

    const poll = Effect.fn("Account.poll")(function* (input: Login) {
      const response = yield* executeEffect(
        HttpClientRequest.post(`${input.server}/auth/device/token`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.schemaBodyJson(DeviceTokenRequest)(
            new DeviceTokenRequest({
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
              device_code: input.code,
              client_id: clientId,
            }),
          ),
        ),
      )

      const parsed = yield* HttpClientResponse.schemaBodyJson(DeviceToken)(response).pipe(
        mapAccountServiceError("Failed to decode response"),
      )

      if (parsed instanceof DeviceTokenError) return parsed.toPollResult()
      const accessToken = parsed.access_token

      const user = fetchUser(input.server, accessToken)
      const orgs = fetchOrgs(input.server, accessToken)

      const [account, remoteOrgs] = yield* Effect.all([user, orgs], { concurrency: 2 })
      const previous = yield* repo.active()
      const resolved = decideOrg(
        new Info({
          id: account.id,
          email: account.email,
          url: input.server,
          active_org_id:
            Option.isSome(previous) && previous.value.id === account.id ? previous.value.active_org_id : null,
        }),
        remoteOrgs,
      )

      const now = yield* Clock.currentTimeMillis
      const expiry = now + Duration.toMillis(parsed.expires_in)
      const refreshToken = parsed.refresh_token

      clearRagConfig({ accountID: account.id })
      if (Option.isSome(previous) && previous.value.id !== account.id) clearRagConfig({ accountID: previous.value.id })
      yield* repo.persistAccount({
        id: account.id,
        email: account.email,
        url: input.server,
        accessToken,
        refreshToken,
        expiry,
        orgID: Option.fromNullishOr(resolved.account.active_org_id),
      })
      yield* Cache.invalidate(orgCache, account.id)

      return new PollSuccess({
        email: account.email,
        account: resolved.account,
        orgs: [...resolved.orgs],
        org: Option.getOrNull(resolved.active),
      })
    })

    const loginWithPassword = Effect.fn("Account.loginWithPassword")(function* (input: {
      url: string
      email: string
      password: string
    }) {
      const normalizedServer = normalizeServerUrl(input.url)

      const response = yield* executeEffect(
        HttpClientRequest.post(`${normalizedServer}/auth/device/login`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.schemaBodyJson(PasswordLoginRequest)(
            new PasswordLoginRequest({
              email: input.email,
              password: input.password,
            }),
          ),
        ),
      )

      if (response.status === 401) {
        return yield* Effect.fail(
          new AccountServiceError({ message: "Credenciais inválidas: e-mail ou senha incorretos." }),
        )
      }

      const ok = yield* HttpClientResponse.filterStatusOk(response).pipe(
        mapAccountServiceError("Falha no login com usuário e senha"),
      )

      const parsed = yield* HttpClientResponse.schemaBodyJson(PasswordLoginResponse)(ok).pipe(
        mapAccountServiceError("Falha ao decodificar resposta do login"),
      )

      const accessToken = parsed.access_token

      const user = fetchUser(normalizedServer, accessToken)
      const orgsResult = fetchOrgs(normalizedServer, accessToken)

      const [account, remoteOrgs] = yield* Effect.all([user, orgsResult], { concurrency: 2 })
      const previous = yield* repo.active()
      const resolved = decideOrg(
        new Info({
          id: account.id,
          email: account.email,
          url: normalizedServer,
          active_org_id:
            Option.isSome(previous) && previous.value.id === account.id ? previous.value.active_org_id : null,
        }),
        remoteOrgs,
      )

      const now = yield* Clock.currentTimeMillis
      const expiry = now + Duration.toMillis(parsed.expires_in)

      clearRagConfig({ accountID: account.id })
      if (Option.isSome(previous) && previous.value.id !== account.id) clearRagConfig({ accountID: previous.value.id })
      yield* repo.persistAccount({
        id: account.id,
        email: account.email,
        url: normalizedServer,
        accessToken,
        refreshToken: parsed.refresh_token,
        expiry,
        orgID: Option.fromNullishOr(resolved.account.active_org_id),
      })
      yield* Cache.invalidate(orgCache, account.id)

      return new PollSuccess({
        email: account.email,
        account: resolved.account,
        orgs: [...resolved.orgs],
        org: Option.getOrNull(resolved.active),
      })
    })

    const reportUsage = Effect.fn("Account.reportUsage")(function* (input: {
      active: ActiveOrg
      provider: string
      model: string
      inputTokens: number
      outputTokens: number
      totalTokens: number
      reasoningTokens?: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
      costUsd?: number
      sessionId?: string
      messageId?: string
    }) {
      const current = yield* validated(input.active.account.id, input.active.org.id).pipe(
        Effect.catch(() => Effect.succeed(Option.none())),
      )
      if (Option.isNone(current)) return
      const resolved = yield* resolveAccess(input.active.account.id).pipe(
        Effect.catch(() => Effect.succeed(Option.none())),
      )
      if (Option.isNone(resolved)) return

      const { account, accessToken } = resolved.value
      const matches = yield* matchesRevision(input.active.account.id, input.active.org.id, current.value.revision).pipe(
        Effect.catch(() => Effect.succeed(false)),
      )
      if (!matches) return

      yield* executeEffect(
        HttpClientRequest.post(`${account.url}/api/markscode/ai/usage/event`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bearerToken(accessToken),
          HttpClientRequest.setHeaders({ "x-org-id": input.active.org.id }),
          HttpClientRequest.bodyJson({
            provider: input.provider,
            model: input.model,
            input_tokens: input.inputTokens,
            output_tokens: input.outputTokens,
            total_tokens: input.totalTokens,
            reasoning_tokens: input.reasoningTokens ?? 0,
            cache_read_tokens: input.cacheReadTokens ?? 0,
            cache_write_tokens: input.cacheWriteTokens ?? 0,
            cost_usd: input.costUsd ?? 0,
            session_id: input.sessionId ?? "",
            message_id: input.messageId ?? "",
          }),
        ),
      ).pipe(Effect.ignore)
    })

    const fetchQuota = Effect.fnUntraced(function* (url: string, accessToken: AccessToken) {
      const response = yield* executeRead(
        HttpClientRequest.get(`${url}/api/markscode/ai/quota`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bearerToken(accessToken),
        ),
      ).pipe(Effect.catch(() => Effect.succeed(null)))

      if (!response) return null
      if (response.status !== 200) return null

      const json = yield* response.json.pipe(Effect.catch(() => Effect.succeed(null)))
      return (json as MarkspanelQuota | null) ?? null
    })

    const quota = Effect.fn("Account.quota")(function* (accountID: AccountID) {
      const resolved = yield* resolveAccess(accountID).pipe(Effect.catch(() => Effect.succeed(Option.none())))
      if (Option.isNone(resolved)) return null

      const { account, accessToken } = resolved.value
      return yield* fetchQuota(account.url, accessToken)
    })

    const invalidateToken = Effect.fn("Account.invalidateToken")((accountID: AccountID) =>
      repo.invalidateToken(accountID),
    )

    return Service.of({
      active: repo.active,
      activeOrg,
      acquireActiveOrgLease,
      validateActiveOrgLease,
      list: repo.list,
      orgsByAccount,
      remove: (accountID) =>
        Effect.sync(() => clearRagConfig({ accountID })).pipe(Effect.andThen(repo.remove(accountID))),
      use: (accountID, orgID) =>
        Effect.gen(function* () {
          const previous = yield* repo.active()
          clearRagConfig({ accountID })
          if (Option.isSome(previous) && previous.value.id !== accountID)
            clearRagConfig({ accountID: previous.value.id })
          yield* repo.use(accountID, orgID)
        }),
      selectOrg,
      orgs,
      config,
      configActive,
      token,
      login,
      poll,
      loginWithPassword,
      invalidateToken,
      reportUsage,
      quota,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AccountRepo.layer), Layer.provide(FetchHttpClient.layer))

export * as Account from "./account"
