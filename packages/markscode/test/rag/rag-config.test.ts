import { afterEach, expect, test } from "bun:test"

import { AccountID, OrgID } from "@/account/schema"
import { RagConfig } from "@/rag/rag-config"

const context = {
  accountID: AccountID.make("account-1"),
  orgID: OrgID.make("17"),
  accountUrl: "https://control.example.com",
}

const remote = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
})

afterEach(() => RagConfig.clearRagConfig())

const get = () => RagConfig.getRagConfig(context.accountID, context.orgID)

test("old config without rag remains disabled", () => {
  RagConfig.setRagConfig(undefined, context)
  expect(get()).toBeUndefined()
})

test("captures valid flags capabilities and resolves relative base url", () => {
  RagConfig.setRagConfig(remote(), context)
  expect(get()).toMatchObject({
    enabled: true,
    version: 1,
    base_url: "https://control.example.com/api/rag/v1",
    account_id: AccountID.make("account-1"),
    org_id: OrgID.make("17"),
    capabilities: { query: true, get_document: false, embeddings: false },
  })
})

test("normalizes root-relative base url", () => {
  RagConfig.setRagConfig(remote({ base_url: "/api/rag/v1/" }), context)
  expect(get()?.base_url).toBe("https://control.example.com/api/rag/v1")
})

for (const base_url of [
  "https://control.example.com/api/rag/v1",
  "//evil.example/rag",
  "/api\\rag",
  "/api/rag?token=secret",
  "/api/rag#fragment",
  "/api/../admin",
  "/api/%2e%2e/admin",
  "/api/%2e%2e%2fadmin",
  "/api/%252e%252e/admin",
  "/api/%2525252525252525252e%2525252525252525252e/admin",
  "/api/%E0%A4%A",
]) test(`rejects malicious base url ${base_url}`, () => {
  RagConfig.setRagConfig(remote({ base_url }), context)
  expect(get()).toBeUndefined()
})

test("stale update cannot reinstall config after a newer clear", () => {
  const stale = RagConfig.beginRagConfigUpdate(context.accountID, context.orgID)
  RagConfig.clearRagConfig()
  expect(RagConfig.setRagConfig(remote(), context, stale)).toBeFalse()
  expect(get()).toBeUndefined()
})

test("keeps account and org configs isolated", () => {
  RagConfig.setRagConfig(remote(), context)
  expect(RagConfig.getRagConfig(AccountID.make("account-2"), context.orgID)).toBeUndefined()
  expect(RagConfig.getRagConfig(context.accountID, OrgID.make("18"))).toBeUndefined()
})

test("keeps ids containing nul and delimiters isolated", () => {
  const first = { accountID: AccountID.make("a\0b|c"), orgID: OrgID.make("d"), accountUrl: context.accountUrl }
  const second = { accountID: AccountID.make("a"), orgID: OrgID.make("b|c\0d"), accountUrl: context.accountUrl }
  RagConfig.setRagConfig(remote({ limits: { query_limit_max: 11, chunk_max_chars: 1200, chunk_overlap_chars: 160 } }), first)
  RagConfig.setRagConfig(remote({ limits: { query_limit_max: 22, chunk_max_chars: 1200, chunk_overlap_chars: 160 } }), second)
  expect(RagConfig.getRagConfig(first.accountID, first.orgID)?.limits.query_limit_max).toBe(11)
  expect(RagConfig.getRagConfig(second.accountID, second.orgID)?.limits.query_limit_max).toBe(22)
  RagConfig.clearRagConfig({ accountID: first.accountID })
  expect(RagConfig.getRagConfig(first.accountID, first.orgID)).toBeUndefined()
  expect(RagConfig.getRagConfig(second.accountID, second.orgID)?.limits.query_limit_max).toBe(22)
})

export { remote as ragRemoteConfig }
