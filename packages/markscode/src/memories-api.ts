export type MemoryMode = "short_term" | "long_term" | "visual"
export type MemoryType = "episodic" | "semantic" | "procedural"

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
  created_at: string
  updated_at: string
}

export interface RecallInput {
  user_id: string
  session_id?: string
  cue: string
  limit?: number
}

export interface RecallResult {
  memories: MemoryRecord[]
  scores: number[]
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers || {})
  const apiKey = process.env.MEMORIES_API_KEY || ""
  if (!headers.has("X-API-Key") && apiKey.trim()) headers.set("X-API-Key", apiKey)
  if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json")

  const response = await fetch(`${(process.env.MEMORIES_URL || "http://api.marks.ia.br:8689").replace(/\/$/, "")}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(10000),
  })
  const text = await response.text().catch(() => "")
  const body = text.trim() ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(`Memories API error: ${response.status}`)
  return body
}

async function requestOpen(path: string, init?: RequestInit): Promise<unknown> {
  return request(path, init).catch(() => undefined)
}

function objectBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {}
  return body as Record<string, unknown>
}

function itemList<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[]
  const record = objectBody(body)
  if (Array.isArray(record.items)) return record.items as T[]
  if (Array.isArray(record.memories)) return record.memories as T[]
  if (Array.isArray(record.data)) return record.data as T[]
  return []
}

export async function recallHumanMemories(input: RecallInput): Promise<RecallResult> {
  const body = await request("/memories/human/recall", {
    method: "POST",
    body: JSON.stringify({
      user_id: input.user_id,
      session_id: input.session_id,
      cue: input.cue,
      limit: input.limit ?? 8,
    }),
  })
  if (!body || typeof body !== "object") return { memories: [], scores: [] }
  const result = body as Record<string, unknown>
  return {
    memories: Array.isArray(result.memories) ? (result.memories as MemoryRecord[]) : [],
    scores: Array.isArray(result.scores) ? result.scores.filter((score): score is number => typeof score === "number") : [],
  }
}

export async function importMemories(input: {
  source: string
  source_name: string
  subject?: string
  default_user_id: string
  default_session_id: string
  items: Array<{
    content: string
    type?: MemoryType
    memory_mode?: MemoryMode
    importance?: number
    tags?: string[]
  }>
}): Promise<unknown> {
  return request("/memories/import", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function getHumanContext(input?: { user_id?: string; session_id?: string; q?: string; limit?: number }) {
  const query = new URLSearchParams()
  if (input?.user_id) query.set("user_id", input.user_id)
  if (input?.session_id) query.set("session_id", input.session_id)
  if (input?.q) query.set("q", input.q)
  if (input?.limit) query.set("limit", String(input.limit))
  const body = objectBody(await requestOpen(`/memories/human/context${query.size ? `?${query}` : ""}`))
  return {
    context: typeof body.context === "string" ? body.context : "",
    memories: itemList<MemoryRecord>(body),
  }
}

export async function saveHumanMemory(input: {
  user_id?: string
  session_id?: string
  content: string
  type?: MemoryType
  memory_mode?: MemoryMode
  importance?: number
  tags?: string[]
}) {
  const body = objectBody(
    await requestOpen("/memories/human", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  )
  return {
    ok: body.ok !== false,
    memory: body.memory as MemoryRecord | undefined,
  }
}

export async function getGlobalContext(input?: { q?: string; limit?: number }) {
  const query = new URLSearchParams()
  if (input?.q) query.set("q", input.q)
  if (input?.limit) query.set("limit", String(input.limit))
  const body = objectBody(await requestOpen(`/memories/context/global${query.size ? `?${query}` : ""}`))
  return {
    context: typeof body.context === "string" ? body.context : "",
    memories: itemList<MemoryRecord>(body),
  }
}

export async function searchAdvancedMemories(input: { q: string; cross_session?: boolean; fuzzy?: boolean; limit?: number }) {
  const query = new URLSearchParams()
  query.set("q", input.q)
  if (input.cross_session) query.set("cross_session", "1")
  if (input.fuzzy) query.set("fuzzy", "1")
  if (input.limit) query.set("limit", String(input.limit))
  return {
    items: itemList<MemoryRecord>(await requestOpen(`/memories/search/advanced?${query}`)),
  }
}

export async function getSessionCompactContext(input: { session_id: string; limit?: number }) {
  const query = new URLSearchParams({ session_id: input.session_id })
  if (input.limit) query.set("limit", String(input.limit))
  const body = objectBody(await requestOpen(`/memories/session/compact-context?${query}`))
  return {
    context: typeof body.context === "string" ? body.context : "",
    summary: typeof body.summary === "string" ? body.summary : "",
    tokens: typeof body.tokens === "number" ? body.tokens : 0,
  }
}

export async function getSessionContextSafety(input: { session_id: string; token_count?: number; max_tokens?: number }) {
  const query = new URLSearchParams({ session_id: input.session_id })
  if (input.token_count) query.set("token_count", String(input.token_count))
  if (input.max_tokens) query.set("max_tokens", String(input.max_tokens))
  const body = objectBody(await requestOpen(`/memories/session/context-safety?${query}`))
  return {
    safe: typeof body.safe === "boolean" ? body.safe : true,
    should_handoff: typeof body.should_handoff === "boolean" ? body.should_handoff : false,
    reason: typeof body.reason === "string" ? body.reason : "fail-open",
    compact_context: typeof body.compact_context === "string" ? body.compact_context : "",
  }
}

export async function createSessionHandoff(input: { session_id: string; summary?: string; reason?: string; metadata?: Record<string, unknown> }) {
  const body = objectBody(
    await requestOpen("/memories/session/handoff", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  )
  return {
    ok: body.ok !== false,
    handoff_id: typeof body.handoff_id === "string" ? body.handoff_id : "",
    summary: typeof body.summary === "string" ? body.summary : input.summary ?? "",
  }
}

export async function continueSessionFromHandoff(input: { handoff_id?: string; session_id?: string }) {
  const body = objectBody(
    await requestOpen("/memories/session/handoff/continue", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  )
  return {
    ok: body.ok !== false,
    context: typeof body.context === "string" ? body.context : "",
    session_id: typeof body.session_id === "string" ? body.session_id : input.session_id ?? "",
  }
}
