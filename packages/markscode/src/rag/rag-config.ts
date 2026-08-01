import { Schema } from "effect"

import type { AccountID, OrgID } from "@/account/schema"

export class Search extends Schema.Class<Search>("RagSearch")({
  mode: Schema.Literal("lexical"),
  query_records_audit_row: Schema.Boolean,
}) {}

export class Capabilities extends Schema.Class<Capabilities>("RagCapabilities")({
  health: Schema.Boolean,
  list_collections: Schema.Boolean,
  create_collection: Schema.Boolean,
  create_source: Schema.Boolean,
  ingest_document: Schema.Boolean,
  query: Schema.Boolean,
  get_document: Schema.Boolean,
  embeddings: Schema.Boolean,
  hybrid_search: Schema.Boolean,
}) {}

export class Limits extends Schema.Class<Limits>("RagLimits")({
  query_limit_max: Schema.Int.check(Schema.isGreaterThan(0)),
  chunk_max_chars: Schema.Int.check(Schema.isGreaterThan(0)),
  chunk_overlap_chars: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}) {}

export class Remote extends Schema.Class<Remote>("RemoteRagConfig")({
  enabled: Schema.Boolean,
  version: Schema.Literal(1),
  base_url: Schema.String,
  requires_org: Schema.Literal(true),
  auth: Schema.Literal("account_bearer"),
  org_context: Schema.optional(Schema.Literal("validated")),
  search: Search,
  capabilities: Capabilities,
  limits: Limits,
}) {}

export type Config = Omit<Remote, "base_url"> & {
  base_url: string
  account_id: AccountID
  org_id: OrgID
  account_origin: string
  revision: number
}

export type Revision = {
  accountID: AccountID
  orgID: OrgID
  revision: number
}

const configs = new Map<AccountID, Map<OrgID, Config>>()
const revisions = new Map<AccountID, Map<OrgID, number>>()
let generation = 0

const decode = Schema.decodeUnknownOption(Remote)
const get = <A>(entries: Map<AccountID, Map<OrgID, A>>, accountID: AccountID, orgID: OrgID) =>
  entries.get(accountID)?.get(orgID)
const set = <A>(entries: Map<AccountID, Map<OrgID, A>>, accountID: AccountID, orgID: OrgID, value: A) => {
  const account = entries.get(accountID) ?? new Map<OrgID, A>()
  account.set(orgID, value)
  entries.set(accountID, account)
}
const remove = <A>(entries: Map<AccountID, Map<OrgID, A>>, accountID: AccountID, orgID: OrgID) => {
  const account = entries.get(accountID)
  if (!account) return
  account.delete(orgID)
  if (account.size === 0) entries.delete(accountID)
}

const rootRelative = (value: string) => {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("?") || value.includes("#")) return
  try {
    const decoded = Array.from({ length: 8 }).reduce<string>((current) => decodeURIComponent(current), value)
    if (decodeURIComponent(decoded) !== decoded || decoded.includes("\\") || decoded.split("/").some((segment) => segment === "..")) return
    return value
  } catch {
    return
  }
}

export function beginRagConfigUpdate(accountID: AccountID, orgID: OrgID): Revision {
  const revision = ++generation
  set(revisions, accountID, orgID, revision)
  remove(configs, accountID, orgID)
  return { accountID, orgID, revision }
}

export function setRagConfig(
  value: unknown,
  input: { accountID: AccountID; orgID: OrgID; accountUrl: string },
  expected = beginRagConfigUpdate(input.accountID, input.orgID),
) {
  if (
    expected.accountID !== input.accountID ||
    expected.orgID !== input.orgID ||
    get(revisions, input.accountID, input.orgID) !== expected.revision
  ) return false
  const parsed = decode(value)
  if (parsed._tag === "None") return false
  const path = rootRelative(parsed.value.base_url)
  const account = URL.parse(input.accountUrl)
  if (!path || !account) return false
  if (!account.origin || account.username || account.password || account.search || account.hash) return false
  const base = URL.parse(path, account.origin)
  if (!base) return false
  if (base.origin !== account.origin || base.username || base.password || base.search || base.hash) return false
  set(configs, input.accountID, input.orgID, {
    ...parsed.value,
    base_url: base.toString().replace(/\/+$/, ""),
    account_id: input.accountID,
    org_id: input.orgID,
    account_origin: account.origin,
    revision: expected.revision,
  })
  return true
}

export function getRagConfig(accountID: AccountID, orgID: OrgID) {
  return get(configs, accountID, orgID)
}

export function isCurrent(config: Config) {
  return get(configs, config.account_id, config.org_id) === config &&
    get(revisions, config.account_id, config.org_id) === config.revision
}

export function clearRagConfig(scope?: Revision | { accountID: AccountID; orgID?: OrgID }) {
  if (scope && "revision" in scope) {
    if (get(revisions, scope.accountID, scope.orgID) !== scope.revision) return false
    set(revisions, scope.accountID, scope.orgID, ++generation)
    remove(configs, scope.accountID, scope.orgID)
    return true
  }
  if (scope?.orgID) {
    set(revisions, scope.accountID, scope.orgID, ++generation)
    remove(configs, scope.accountID, scope.orgID)
    return true
  }
  if (scope) {
    const orgs = new Set([
      ...(configs.get(scope.accountID)?.keys() ?? []),
      ...(revisions.get(scope.accountID)?.keys() ?? []),
    ])
    orgs.forEach((orgID) => set(revisions, scope.accountID, orgID, ++generation))
    configs.delete(scope.accountID)
    return true
  }
  generation += 1
  configs.clear()
  revisions.clear()
  return true
}

export * as RagConfig from "./rag-config"
