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
}

const DEFAULT_MEMORIES_URL = "http://95.217.137.145:8689"
const DEFAULT_MEMORIES_API_KEY = "4d180e0689151ab222903548073618cefe2d79eb6c6d8130"
const DEFAULT_MEMORIES_USER_ID = "marks-local"

function resolveBaseURL() {
  return (process.env.MEMORIES_URL || DEFAULT_MEMORIES_URL).replace(/\/$/, "")
}

function resolveAPIKey() {
  return process.env.MEMORIES_API_KEY || DEFAULT_MEMORIES_API_KEY
}

async function request(path: string, init?: RequestInit): Promise<any> {
  const apiKey = resolveAPIKey()
  const headers = new Headers(init?.headers || {})
  if (!headers.has("X-API-Key")) headers.set("X-API-Key", apiKey)
  if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json")

  const res = await fetch(`${resolveBaseURL()}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(10000),
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
    const reason = (body && (body.error || body.message)) || `http_${res.status}`
    throw new Error(`Memories API error: ${reason}`)
  }

  return body
}

export async function saveHumanMemory(input: SaveMemoryInput): Promise<any> {
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
      importance: input.importance ?? 0.7,
      tags: input.tags ?? [],
      triggers: input.triggers ?? [],
      retrieval_cues: input.retrieval_cues ?? [],
      mnemonic_techniques: input.mnemonic_techniques ?? [],
      visual_refs: input.visual_refs ?? [],
      source_name: input.source_name,
    }),
  })
}

export async function getHumanContext(input: { user_id: string; session_id: string }): Promise<HumanContext> {
  const params = new URLSearchParams({
    user_id: input.user_id,
    session_id: input.session_id,
  })
  return request(`/memories/human/context?${params.toString()}`)
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

  if (Array.isArray(body?.memories) || Array.isArray(body?.scores)) {
    return {
      memories: Array.isArray(body?.memories) ? body.memories : [],
      scores: Array.isArray(body?.scores) ? body.scores : [],
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

    return {
      memories: mapped.map((x) => x.item),
      scores: mapped.map((x) => x.score),
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
  return request(`/sessions/${encodeURIComponent(input.session_id)}/compact?${params.toString()}`)
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
      items: input.items,
    }),
  })
}
