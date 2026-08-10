import { hasMemoriesAPIKey, resolveMemoryConfig } from "./memory-config"
import type { MemoryIdentity } from "./memory-identity"
import { Effect, Option } from "effect"
import { Account } from "@/account/account"
import { makeRuntime } from "@/effect/run-service"
import { getMarksAgentBoolean, getMarksAgentString } from "./marks-agent-config-source"
export type MemoryMode = "short_term" | "long_term" | "visual"
export type MemoryType = "episodic" | "semantic" | "procedural"

export interface SaveMemoryInput {
  user_id: string
  session_id: string
  type: MemoryType
  memory_mode?: MemoryMode
  title?: string
  subject?: string
  content: string
  importance?: number
  tags?: string[]
  triggers?: string[]
  retrieval_cues?: string[]
  mnemonic_techniques?: string[]
  visual_refs?: string[]
  source_name?: string
  identity?: MemoryIdentity["identity"]
  customer_id?: string
  org_id?: string
  metadata?: Record<string, unknown>
  dedup?: boolean
  session_rollup?: boolean
}

export interface HumanContext {
  short_term: MemoryRecord[]
  long_term: MemoryRecord[]
  visual: MemoryRecord[]
}

export interface MemoryRecord {
  id: string
  user_id: string
  session_id: string
  type: MemoryType
  memory_mode?: MemoryMode
  title?: string
  subject?: string
  content: string
  importance: number
  tags: string[]
  triggers?: string[]
  retrieval_cues?: string[]
  mnemonic_techniques?: string[]
  visual_refs?: string[]
  source_name?: string
  created_at: string
  updated_at: string
}

export interface EnsureHumanMemoryLayersInput {
  user_id: string
  session_id: string
  source_name?: string
  identity?: MemoryIdentity["identity"]
  customer_id?: string
  org_id?: string
  metadata?: Record<string, unknown>
}

export interface EnsureHumanMemoryLayersResult {
  ok: boolean
  ensured: MemoryMode[]
  created: MemoryMode[]
  existing: MemoryMode[]
  errors: string[]
}

export interface RecallInput {
  user_id: string
  session_id?: string
  cue: string
  limit?: number
  timeout_ms?: number
}

export interface RecallResult {
  memories: MemoryRecord[]
  scores: number[]
}

export interface SessionContextResult {
  messages?: Array<{ role?: string; content?: string; text?: string; created_at?: string }>
  items?: Array<{ role?: string; content?: string; text?: string; created_at?: string }>
  memories?: Array<{ role?: string; content?: string; text?: string; created_at?: string }>
}

export interface SearchMemoriesResult {
  memories?: MemoryRecord[]
  items?: MemoryRecord[]
}

export interface SessionCompactInput {
  user_id: string
  session_id: string
  limit?: number
  refresh?: boolean
  include_content?: boolean
  content_preview?: number
}

export interface ContextSafetyResult {
  safe: boolean
  reason: string
  severity: "info" | "warning" | "critical"
  estimated_tokens: number
  safe_limit_tokens: number
  hard_limit_tokens: number
  recommendation: string
  handoff_available: boolean
}

const DEFAULT_MEMORIES_URL = "http://api.marks.ia.br:8689"
const HUMAN_MEMORY_LAYER_MODES: MemoryMode[] = ["short_term", "long_term", "visual"]
const HUMAN_MEMORY_LAYER_MARKER_TAG = "markscode-system-memory-layer"
const humanMemoryLayerEnsures = new Map<string, Promise<EnsureHumanMemoryLayersResult>>()
const accountRuntime = makeRuntime(Account.Service, Account.defaultLayer)
const activeOrgConfigLoads = new Set<string>()

function isHumanMemoryLayerMarker(memory: Partial<MemoryRecord> | undefined) {
  return Boolean(memory?.tags?.includes(HUMAN_MEMORY_LAYER_MARKER_TAG) || memory?.source_name === "markscode-memory-layer-ensure")
}

function withoutHumanMemoryLayerMarkers(context: HumanContext): HumanContext {
  return {
    short_term: (context.short_term || []).filter((memory) => !isHumanMemoryLayerMarker(memory)),
    long_term: (context.long_term || []).filter((memory) => !isHumanMemoryLayerMarker(memory)),
    visual: (context.visual || []).filter((memory) => !isHumanMemoryLayerMarker(memory)),
  }
}

function isHumanMemoryLayerDuplicate(error: unknown) {
  return error instanceof Error && /already|conflict|duplicate|exists|http_409/i.test(error.message)
}

function resolveBaseURL() {
  return resolveMemoryConfig().memories.url
}

function resolveAPIKey() {
  return resolveMemoryConfig().memories.api_key
}

const defaultActiveOrgLeaseHeaders = (): Promise<Record<string, string>> =>
  accountRuntime.runPromise(() =>
    Account.Service.use((account) =>
      account.acquireActiveOrgLease().pipe(
        Effect.flatMap((lease) => {
          if (Option.isNone(lease)) return Effect.succeed({})
          const cacheKey = `${lease.value.active.account.id}:${lease.value.active.org.id}:${lease.value.revision}`
          const loadConfig = activeOrgConfigLoads.has(cacheKey)
            ? Effect.void
            : account.configActive(lease.value.active).pipe(
                Effect.tap(() => Effect.sync(() => activeOrgConfigLoads.add(cacheKey))),
                Effect.asVoid,
                Effect.catch(() => Effect.void),
              )
          return loadConfig.pipe(
            Effect.as({
              Authorization: "Bearer " + lease.value.accessToken,
              "x-org-id": lease.value.active.org.id,
              "x-customer-id": lease.value.active.account.id,
            }),
          )
        }),
        Effect.catch(() => Effect.succeed({})),
      ),
    ),
  )

let activeOrgLeaseHeaders = defaultActiveOrgLeaseHeaders

export function setActiveOrgLeaseHeadersForTest(loader: typeof activeOrgLeaseHeaders) {
  activeOrgLeaseHeaders = loader
  return () => {
    activeOrgLeaseHeaders = defaultActiveOrgLeaseHeaders
  }
}

const hasActiveOrgLease = async () => Object.keys(await activeOrgLeaseHeaders()).length > 0

export function memoriesAPIStatus() {
  const config = resolveMemoryConfig()
  return {
    url: config.memories.url,
    api_key_configured: Boolean(config.memories.api_key),
    api_key_source: config.memories.api_key_source,
    timeout_ms: config.memories.timeout_ms,
    user_id: config.user_id,
  }
}

function payloadImportance(value: number | undefined) {
  if (value === undefined || value === 0.7) return undefined
  return value
}

function requestTimeoutMs(value?: number) {
  const memoryConfig = resolveMemoryConfig()
  const configured = Number(
    getMarksAgentString("MARKSCODE_MEMORIES_API_TIMEOUT_MS") || process.env.MARKSCODE_MEMORIES_API_TIMEOUT_MS || process.env.MEMORIES_API_TIMEOUT_MS || "",
  )
  const raw = Number.isFinite(value) ? Number(value) : Number.isFinite(configured) && configured > 0 ? configured : memoryConfig.memories.timeout_ms
  return Math.min(30000, Math.max(1000, Math.floor(raw || 10000)))
}

async function request(path: string, init?: RequestInit & { timeout_ms?: number }): Promise<any> {
  const headers = new Headers(init?.headers || {})
  Object.entries(await activeOrgLeaseHeaders()).forEach(([key, value]) => {
    if (!headers.has(key)) headers.set(key, value)
  })
  const apiKey = resolveAPIKey()
  if (!headers.has("X-API-Key") && apiKey.trim()) headers.set("X-API-Key", apiKey)
  if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json")

  const timeoutMs = requestTimeoutMs(init?.timeout_ms)
  const { timeout_ms: _timeoutMs, ...requestInit } = init || {}
  void _timeoutMs
  const res = await fetch(`${resolveBaseURL()}${path}`, {
    ...requestInit,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  })

  const text = await res.text().catch(() => "")
  let body: any = {}
  if (text.trim()) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text }
    }
  }

  if (!res.ok) {
    const reason = res.status === 401 || res.status === 403
      ? "sessão Markspanel ausente ou expirada; faça login pelo fluxo OAuth/device do MarksCode/Markspanel"
      : (body && (body.error || body.message)) || `http_${res.status}`
    throw new Error(`Memories API error: ${reason}`)
  }

  return body
}

async function postHumanMemory(input: SaveMemoryInput): Promise<any> {
  return request("/memories/human", {
    method: "POST",
    body: JSON.stringify({
      user_id: input.user_id,
      session_id: input.session_id,
      type: input.type,
      memory_mode: input.memory_mode || "long_term",
      title: input.title,
      subject: input.subject,
      content: input.content,
      ...(payloadImportance(input.importance) !== undefined ? { importance: payloadImportance(input.importance) } : {}),
      tags: input.tags ?? [],
      triggers: input.triggers ?? [],
      retrieval_cues: input.retrieval_cues ?? [],
      mnemonic_techniques: input.mnemonic_techniques ?? [],
      visual_refs: input.visual_refs ?? [],
      source_name: input.source_name,
      identity: input.identity,
      customer_id: input.customer_id,
      org_id: input.org_id,
      metadata: input.metadata,
      dedup: input.dedup,
      session_rollup: input.session_rollup,
    }),
  })
}

export async function saveHumanMemory(input: SaveMemoryInput): Promise<any> {
  const result = await postHumanMemory(input)
  await ensureHumanMemoryLayers({
    user_id: input.user_id,
    session_id: input.session_id,
    source_name: input.source_name,
    identity: input.identity,
    customer_id: input.customer_id,
    org_id: input.org_id,
    metadata: input.metadata,
  }).catch(() => undefined)
  return result
}

async function ensureHumanMemoryLayersOnce(input: EnsureHumanMemoryLayersInput): Promise<EnsureHumanMemoryLayersResult> {
  return { ok: true, ensured: HUMAN_MEMORY_LAYER_MODES, created: [], existing: HUMAN_MEMORY_LAYER_MODES, errors: [] }
}

export async function ensureHumanMemoryLayers(input: EnsureHumanMemoryLayersInput): Promise<EnsureHumanMemoryLayersResult> {
  const key = [input.user_id, input.session_id, input.source_name || "", input.customer_id || "", input.org_id || ""].join("\0")
  const current = humanMemoryLayerEnsures.get(key)
  if (current) return current
  const next = ensureHumanMemoryLayersOnce(input)
  humanMemoryLayerEnsures.set(key, next)
  const result = await next
  if (!result.ok) humanMemoryLayerEnsures.delete(key)
  return result
}

export async function getHumanContext(input: { user_id: string; session_id: string }): Promise<HumanContext> {
  const params = new URLSearchParams({
    user_id: input.user_id,
    session_id: input.session_id,
  })
  return request(`/memories/human/context?${params.toString()}`).then(withoutHumanMemoryLayerMarkers)
}

export async function recallHumanMemories(input: RecallInput): Promise<RecallResult> {
  const oauthHeaders = await activeOrgLeaseHeaders()
  const configUserID = resolveMemoryConfig().user_id.trim()
  const body = await request("/memories/human/recall", {
    method: "POST",
    headers: oauthHeaders,
    body: JSON.stringify({
      user_id: configUserID && configUserID !== "marks-local" ? configUserID : input.user_id,
      session_id: input.session_id,
      cue: input.cue,
      limit: input.limit ?? 8,
    }),
    timeout_ms: input.timeout_ms,
  })

  if (Array.isArray(body?.memories) || Array.isArray(body?.scores)) {
    const pairs = (Array.isArray(body?.memories) ? body.memories : [])
      .map((memory: MemoryRecord, index: number) => ({ memory, score: Array.isArray(body?.scores) && typeof body.scores[index] === "number" ? body.scores[index] : 0 }))
      .filter((entry: { memory: MemoryRecord; score: number }) => !isHumanMemoryLayerMarker(entry.memory))
    return {
      memories: pairs.map((entry: { memory: MemoryRecord; score: number }) => entry.memory),
      scores: pairs.map((entry: { memory: MemoryRecord; score: number }) => entry.score),
    }
  }

  if (Array.isArray(body?.items)) {
    const mapped: Array<{ item: MemoryRecord; score: number }> = body.items.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== "object") return []
      const item = "item" in entry ? entry.item : undefined
      const score = "score" in entry && typeof entry.score === "number" ? entry.score : 0
      if (!item || typeof item !== "object") return []
      return [{ item: item as MemoryRecord, score }]
    })

    const filtered = mapped.filter((x) => !isHumanMemoryLayerMarker(x.item))
    return {
      memories: filtered.map((x) => x.item),
      scores: filtered.map((x) => x.score),
    }
  }

  return { memories: [], scores: [] }
}

export async function getSessionContext(input: {
  user_id: string
  session_id: string
  limit?: number
}): Promise<SessionContextResult> {
  const params = new URLSearchParams({
    user_id: input.user_id,
    limit: String(input.limit ?? 20),
  })
  return request(`/sessions/${encodeURIComponent(input.session_id)}/context?${params.toString()}`)
}

export async function searchSessionMemories(input: {
  user_id: string
  session_id: string
  limit?: number
}): Promise<SearchMemoriesResult> {
  return request("/memories/search", {
    method: "POST",
    body: JSON.stringify({
      user_id: input.user_id,
      session_id: input.session_id,
      limit: input.limit ?? 50,
    }),
  })
}

export async function getSessionCompactContext(input: SessionCompactInput): Promise<any> {
  const params = new URLSearchParams({
    user_id: input.user_id,
    limit: String(input.limit ?? 5),
  })
  if (input.refresh) params.set("refresh", "1")
  if (input.include_content) params.set("include_content", "1")
  if (typeof input.content_preview === "number" && Number.isFinite(input.content_preview)) {
    params.set("content_preview", String(Math.max(1, Math.floor(input.content_preview))))
  }
  return request("/sessions/" + encodeURIComponent(input.session_id) + "/compact?" + params.toString())
}

export async function getSessionContextSafety(input: {
  user_id: string
  session_id: string
}): Promise<ContextSafetyResult> {
  const params = new URLSearchParams({
    user_id: input.user_id,
  })
  return request(`/sessions/${encodeURIComponent(input.session_id)}/context/safety?${params.toString()}`)
}

export async function createSessionHandoff(input: {
  user_id: string
  session_id: string
  project_key?: string
  target_tokens?: number
  limit?: number
  store_memory?: boolean
}): Promise<any> {
  return request(`/sessions/${encodeURIComponent(input.session_id)}/handoff`, {
    method: "POST",
    body: JSON.stringify({
      user_id: input.user_id,
      project_key: input.project_key,
      target_tokens: input.target_tokens,
      limit: input.limit,
      store_memory: input.store_memory ?? true,
    }),
  })
}

export async function continueSessionFromHandoff(input: {
  user_id: string
  source_session_id: string
  new_session_id?: string
  target_tokens?: number
  handoff?: any
}): Promise<any> {
  return request("/sessions/continue", {
    method: "POST",
    body: JSON.stringify({
      user_id: input.user_id,
      source_session_id: input.source_session_id,
      new_session_id: input.new_session_id,
      target_tokens: input.target_tokens,
      handoff: input.handoff,
    }),
  })
}

export async function rebuildCompactMemories(input?: { limit?: number; force?: boolean }): Promise<any> {
  return request("/memories/compact/rebuild", {
    method: "POST",
    body: JSON.stringify({
      limit: input?.limit ?? 2000,
      force: input?.force ?? true,
    }),
  })
}

export async function importMemories(input: {
  source: string
  source_name: string
  subject?: string
  default_user_id: string
  default_session_id: string
  identity?: MemoryIdentity["identity"]
  customer_id?: string
  org_id?: string
  metadata?: Record<string, unknown>
  items: Array<{
    content: string
    type?: MemoryType
    memory_mode?: MemoryMode
    importance?: number
    tags?: string[]
    triggers?: string[]
    retrieval_cues?: string[]
    mnemonic_techniques?: string[]
    visual_refs?: string[]
  }>
}): Promise<any> {
  return request("/memories/import", {
    method: "POST",
    body: JSON.stringify({
      source: input.source,
      source_name: input.source_name,
      subject: input.subject,
      default_user_id: input.default_user_id,
      default_session_id: input.default_session_id,
      identity: input.identity,
      customer_id: input.customer_id,
      org_id: input.org_id,
      metadata: input.metadata,
      items: input.items,
    }),
  })
}

export interface GlobalContextInput {
  user_id?: string
  session_id?: string
  query?: string
  limit?: number
  timeout_ms?: number
}

export interface GlobalContextResult {
  memories: Array<{
    id: string
    title?: string
    subject?: string
    content: string
    importance: number
    tags: string[]
    created_at: string
  }>
  sessions: Array<{ session_id: string; last_message?: string; created_at?: string }>
}

export async function getGlobalContext(input: GlobalContextInput): Promise<GlobalContextResult> {
  const params = new URLSearchParams({
    ...(input.user_id && { user_id: input.user_id }),
    ...(input.session_id && { session_id: input.session_id }),
    ...(input.query && { query: input.query }),
    limit: String(input.limit ?? 10),
  })
  return request(`/memories/global/context?${params.toString()}`, { timeout_ms: input.timeout_ms })
}

export interface SearchAdvancedInput {
  user_id?: string
  session_id?: string
  query?: string
  type?: "episodic" | "semantic" | "procedural"
  memory_mode?: "short_term" | "long_term" | "visual"
  source?: string
  importance_min?: number
  date_from?: string
  date_to?: string
  tags?: string[]
  limit?: number
  offset?: number
  fuzzy?: boolean
  cross_session?: boolean
  timeout_ms?: number
}

export interface SearchAdvancedResult {
  memories: Array<{
    id: string
    title?: string
    subject?: string
    content: string
    importance: number
    tags: string[]
    created_at: string
  }>
  total: number
}

export interface RecallAdminFallbackInput {
  query: string
  limit?: number
  timeout_ms?: number
  allow?: boolean
}

function adminFallbackLimit(value?: number) {
  if (!Number.isFinite(value)) return 3
  return Math.min(5, Math.max(1, Math.floor(Number(value))))
}

function adminFallbackEnabled() {
  return getMarksAgentBoolean("MARKSCODE_ADMIN_MEMORY_FALLBACK") ?? /^(1|true|on)$/i.test(process.env.MARKSCODE_ADMIN_MEMORY_FALLBACK || "")
}

function adminFallbackQueries(query: string) {
  const normalized = query.trim().replace(/\s+/g, " ")
  const lower = normalized.toLowerCase()
  const expansions = [
    /graph\/ingest|brain graph ingest/.test(lower) ? "markscode brain graph ingest" : undefined,
    /memories\/human|memories human|flood/.test(lower) ? "memories human flood" : undefined,
    /markspanel|gateway timeout|timeout|async|worker/.test(lower) ? "markspanel gateway timeout async worker" : undefined,
    /marks1|async|graph\/ingest|memories\/human/.test(lower) ? "brain graph ingest memories human async marks1" : undefined,
  ].filter((value): value is string => Boolean(value))
  return Array.from(new Set([normalized, ...expansions])).filter(Boolean).slice(0, 3)
}

function isAdminFallbackPlaceholder(memory: SearchAdvancedResult["memories"][number]) {
  return /memory layer bootstrap|placeholder|ignore in recall/i.test([memory.title, memory.subject, memory.content].filter(Boolean).join("\n")) && adminFallbackCleanContent(memory.content).length < 80
}

function adminFallbackCleanContent(content: string) {
  return String(content || "").replace(/^\s*MarksCode system memory layer bootstrap placeholder for session\b[\s\S]*?Ignore in recall and user-facing context\.\s*/i, "").trim()
}

function isTasksIndexMemory(memory: SearchAdvancedResult["memories"][number]) {
  return /^index\.md$/i.test(String(memory.title || "").trim()) || /^#\s*Tasks\s+Index/i.test(String(memory.content || "").trimStart())
}

function adminFallbackRank(memory: SearchAdvancedResult["memories"][number]) {
  const cleanContent = adminFallbackCleanContent(memory.content)
  const text = [memory.title, memory.subject, cleanContent, ...(Array.isArray(memory.tags) ? memory.tags : [])].filter(Boolean).join("\n").toLowerCase()
  return (text.includes("/api/markscode/brain/graph/ingest") ? 100 : 0)
    + (text.includes("/memories/human") ? 80 : 0)
    + (text.includes("async") ? 35 : 0)
    + (text.includes("markspanel") ? 25 : 0)
    + (text.includes("marks1") ? 20 : 0)
    + (cleanContent.length > 200 ? 10 : 0)
    + (isAdminFallbackPlaceholder(memory) ? -200 : 15)
    + (isTasksIndexMemory(memory) ? -150 : 0)
}

function markAdminFallbackMemory(memory: SearchAdvancedResult["memories"][number]) {
  const cleanContent = adminFallbackCleanContent(memory.content)
  return {
    ...memory,
    title: "[admin_fallback_unscoped] " + (memory.title || memory.subject || memory.id || "memory"),
    subject: memory.subject ? "[admin_fallback_unscoped] " + memory.subject : "admin_fallback_unscoped",
    content: cleanContent || memory.content,
    tags: Array.from(new Set([...(Array.isArray(memory.tags) ? memory.tags : []), "admin_fallback_unscoped"])),
  }
}

export async function searchAdvancedMemories(input: SearchAdvancedInput): Promise<SearchAdvancedResult> {
  const params = new URLSearchParams()
  if (input.query) {
    params.set("q", input.query)
    params.set("query", input.query)
  }
  if (input.user_id) params.set("user_id", input.user_id)
  if (input.session_id) params.set("session_id", input.session_id)
  else if (input.cross_session !== false) params.set("cross_session", "1")
  if (input.type) params.set("type", input.type)
  if (input.memory_mode) params.set("memory_mode", input.memory_mode)
  if (input.source) params.set("source", input.source)
  if (typeof input.importance_min === "number") params.set("importance_min", String(input.importance_min))
  if (input.date_from) params.set("date_from", input.date_from)
  if (input.date_to) params.set("date_to", input.date_to)
  if (Array.isArray(input.tags) && input.tags.length) params.set("tags", input.tags.join(","))
  params.set("limit", String(input.limit ?? 20))
  if (typeof input.offset === "number" && Number.isFinite(input.offset)) {
    params.set("offset", String(Math.max(0, Math.floor(input.offset))))
  }
  params.set("fuzzy", input.fuzzy === false ? "0" : "1")

  const data: any = await request("/memories/search/advanced?" + params.toString(), { timeout_ms: input.timeout_ms })
  const memories = Array.isArray(data?.memories) ? data.memories : Array.isArray(data?.items) ? data.items : []
  return {
    memories,
    total: typeof data?.total === "number" ? data.total : memories.length,
  }
}

export async function recallAdminFallbackMemories(input: RecallAdminFallbackInput): Promise<SearchAdvancedResult> {
  if (input.allow !== true && !adminFallbackEnabled()) throw new Error("admin_fallback_unscoped disabled")
  const oauthHeaders = await activeOrgLeaseHeaders()
  const hasOAuth = Object.keys(oauthHeaders).length > 0
  if (!hasOAuth && !resolveAPIKey().trim()) throw new Error("admin_fallback_unscoped unavailable: no auth method available")
  const withImportance = (query: string) => searchAdvancedMemories({
    query,
    fuzzy: true,
    cross_session: true,
    importance_min: 0.5,
    limit: 5,
    timeout_ms: input.timeout_ms ?? 1500,
  }).catch(() => ({ memories: [], total: 0 }))
  const withoutImportance = (query: string) => searchAdvancedMemories({
    query,
    fuzzy: true,
    cross_session: true,
    limit: 5,
    timeout_ms: input.timeout_ms ?? 1500,
  }).catch(() => ({ memories: [], total: 0 }))
  const queries = adminFallbackQueries(input.query)
  const primaryResults = await Promise.all(queries.map(withImportance))
  const primaryMemories = primaryResults.flatMap((r) => r.memories)
  const results = primaryMemories.length > 0 ? primaryResults : await Promise.all(queries.map(withoutImportance))
  const deduped = new Map<string, SearchAdvancedResult["memories"][number]>()
  results.flatMap((result) => result.memories).forEach((memory) => {
    deduped.set(String(memory.id || memory.content || memory.title || "").toLowerCase(), memory)
  })
  const ranked = Array.from(deduped.values()).sort((a, b) => adminFallbackRank(b) - adminFallbackRank(a))
  return {
    memories: ranked.slice(0, adminFallbackLimit(input.limit)).map(markAdminFallbackMemory),
    total: ranked.length,
  }
}

export interface RecentMemoryTopic {
  topic: string
  source: string
  title?: string
  subject?: string
  content_preview?: string
  tags?: string[]
  created_at?: string
  count?: number
}

export interface RecentMemoryTopicsResult {
  available: boolean
  source: "cloud"
  topics: RecentMemoryTopic[]
  errors: string[]
  status: string
}

function topicTextFromMemory(memory: Record<string, unknown>) {
  const tags = Array.isArray(memory.tags) ? memory.tags.map(String).filter(Boolean) : []
  const label = String(memory.subject || memory.title || tags[0] || "").trim()
  if (label) return label
  return String(memory.content || "").replace(/\s+/g, " ").trim().split(/[.!?;:\n]/)[0]?.slice(0, 80).trim()
}

export function deriveRecentMemoryTopics(input: { memories?: unknown[]; source?: string; limit?: number }): RecentMemoryTopic[] {
  const seen = new Map<string, RecentMemoryTopic>()
  ;(Array.isArray(input.memories) ? input.memories : []).forEach((entry) => {
    if (!entry || typeof entry !== "object") return
    const memory = entry as Record<string, unknown>
    const topic = topicTextFromMemory(memory)
    if (!topic) return
    const key = topic.toLowerCase().replace(/\s+/g, " ")
    const current = seen.get(key)
    seen.set(key, current ? { ...current, count: (current.count || 1) + 1 } : {
      topic,
      source: String(memory.source || memory.source_name || input.source || "cloud"),
      title: memory.title ? String(memory.title) : undefined,
      subject: memory.subject ? String(memory.subject) : undefined,
      content_preview: String(memory.content || memory.text || "").replace(/\s+/g, " ").trim().slice(0, 240) || undefined,
      tags: Array.isArray(memory.tags) ? memory.tags.map(String).filter(Boolean) : undefined,
      created_at: memory.created_at ? String(memory.created_at) : undefined,
      count: 1,
    })
  })
  return Array.from(seen.values()).slice(0, Math.max(1, Math.floor(input.limit || 12)))
}

export async function listRecentCloudMemoryTopics(input: { user_id?: string; session_id?: string; limit?: number; query?: string; timeout_ms?: number } = {}): Promise<RecentMemoryTopicsResult> {
  if (!hasMemoriesAPIKey() && !(await hasActiveOrgLease())) return { available: false, source: "cloud", topics: [], errors: ["Sessão Markspanel indisponível; faça login pelo fluxo OAuth/device do MarksCode/Markspanel"], status: "cloud_unconfigured" }
  const errors: string[] = []
  const limit = Math.max(1, Math.floor(input.limit || 12))
  const timeoutMs = Math.min(30000, Math.max(1000, Math.floor(Number(input.timeout_ms ?? getMarksAgentString("MARKSCODE_RECENT_TOPICS_TIMEOUT_MS") ?? process.env.MARKSCODE_RECENT_TOPICS_TIMEOUT_MS ?? 3500))))
  const query = input.query || "Markscode BrainSystem memória sessão projeto assunto tópico markscode brain memvid"
  const advanced = await searchAdvancedMemories({ user_id: input.user_id, session_id: input.session_id, query, fuzzy: true, cross_session: true, limit, timeout_ms: timeoutMs }).catch((err) => {
    errors.push("advanced: " + (err instanceof Error ? err.message : String(err)))
    return undefined
  })
  const fromAdvanced = deriveRecentMemoryTopics({ memories: advanced?.memories, source: "cloud-advanced", limit })
  if (fromAdvanced.length) return { available: true, source: "cloud", topics: fromAdvanced, errors, status: "ok" }
  const recalled = input.user_id ? await recallHumanMemories({ user_id: input.user_id, session_id: input.session_id, cue: query, limit, timeout_ms: timeoutMs }).catch((err) => {
    errors.push("recall: " + (err instanceof Error ? err.message : String(err)))
    return undefined
  }) : undefined
  const fromRecall = deriveRecentMemoryTopics({ memories: recalled?.memories, source: "cloud-recall-fallback", limit })
  if (fromRecall.length) return { available: true, source: "cloud", topics: fromRecall, errors, status: errors.length ? "fallback_recall" : "ok" }
  const global = await getGlobalContext({ user_id: input.user_id, session_id: input.session_id, query: input.query, limit, timeout_ms: timeoutMs }).catch((err) => {
    errors.push("global-context: " + (err instanceof Error ? err.message : String(err)))
    return undefined
  })
  const fromGlobal = deriveRecentMemoryTopics({ memories: global?.memories, source: "cloud-global-context", limit })
  return { available: true, source: "cloud", topics: fromGlobal, errors, status: fromGlobal.length ? "ok" : "empty_or_endpoint_unavailable" }
}
