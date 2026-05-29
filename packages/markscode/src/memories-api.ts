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
