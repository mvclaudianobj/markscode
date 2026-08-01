import { Effect, Option } from "effect"
import { Account, type ActiveOrgLease } from "@/account/account"
import { resolveMemoryConfig } from "./memory-config"
import { makeRuntime } from "@/effect/run-service"

export type MemoryIdentity = {
  user_id: string
  session_id?: string
  customer_id?: string
  org_id?: string
  account_id?: string
  account_url?: string
  identity?: {
    provider: "markspanel-oauth" | "memories-config" | "environment" | "local"
    user_id: string
    customer_id?: string
    org_id?: string
    account_id?: string
  }
  metadata: Record<string, string>
}

const LEGACY_LOCAL_USER_ID = "marks-local"

const envUserID = () => process.env.MARKSCODE_MEMORIES_USER_ID?.trim() || process.env.MEMORIES_USER_ID?.trim() || ""

const configuredUserID = () => resolveMemoryConfig().user_id.trim()

export const defaultMemoryUserID = () => envUserID() || configuredUserID() || LEGACY_LOCAL_USER_ID

export const memoryUserIDFromIdentity = (identity?: Pick<MemoryIdentity, "user_id"> | string) =>
  typeof identity === "string" ? identity : identity?.user_id || defaultMemoryUserID()

const accountIdentity = (session_id?: string) =>
  Effect.gen(function* () {
    const account = yield* Account.Service
    const active = yield* account.acquireActiveOrgLease().pipe(
      Effect.catch(() => Effect.succeed(Option.none<ActiveOrgLease>())),
    )
    if (Option.isNone(active)) return Option.none<MemoryIdentity>()
    return Option.some({
      user_id: active.value.active.account.id,
      session_id,
      customer_id: active.value.active.account.id,
      org_id: active.value.active.org.id,
      account_id: active.value.active.account.id,
      account_url: active.value.active.account.url,
      identity: {
        provider: "markspanel-oauth" as const,
        user_id: active.value.active.account.id,
        customer_id: active.value.active.account.id,
        org_id: active.value.active.org.id,
        account_id: active.value.active.account.id,
      },
      metadata: {
        identity_provider: "markspanel-oauth",
        account_id: active.value.active.account.id,
        org_id: active.value.active.org.id,
        account_url: active.value.active.account.url,
      },
    })
  })

export const fallbackMemoryIdentity = (session_id?: string): MemoryIdentity => {
  const user_id = defaultMemoryUserID()
  const provider = user_id === LEGACY_LOCAL_USER_ID ? "local" : envUserID() ? "environment" : "memories-config"
  return {
    user_id,
    session_id,
    identity: { provider, user_id },
    metadata: { identity_provider: provider },
  }
}

export const resolveMemoryIdentityEffect = (session_id?: string) =>
  accountIdentity(session_id).pipe(
    Effect.map((active) => Option.getOrUndefined(active) ?? fallbackMemoryIdentity(session_id)),
    Effect.catch(() => Effect.succeed(fallbackMemoryIdentity(session_id))),
  )

const accountRuntime = makeRuntime(Account.Service, Account.defaultLayer)

export const resolveMemoryIdentity = (session_id?: string) =>
  accountRuntime.runPromise(() => resolveMemoryIdentityEffect(session_id)).catch(() => fallbackMemoryIdentity(session_id))
