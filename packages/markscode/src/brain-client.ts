import { getBrainBaseUrl, isBrainEnabled } from "./brain-config"

export type BrainStatusResult = { ok: boolean; brain: any; error?: string }

export type BrainRecallInput = { q: string; user_id?: string; session_id?: string; limit?: number }
export type BrainRecallItem = { id?: string; content?: string; score?: number; [key: string]: unknown }
export type BrainRecallResult = { ok: boolean; items: BrainRecallItem[]; sources: Record<string, boolean>; error?: string }

export type BrainSaveInput = { content: string; title?: string; tags?: string[]; user_id?: string; session_id?: string; importance?: number; identity?: Record<string, unknown>; customer_id?: string; org_id?: string; metadata?: Record<string, unknown> }
export type BrainSaveResult = { ok: boolean; id?: string; error?: string }

export type BrainGraphInput = { q: string; user_id?: string; session_id?: string; limit?: number }
export type BrainGraphResult = { ok: boolean; items?: any[]; graph?: any; error?: string }

export type BrainIngestItem = { source: string; content: string; title?: string; tags?: string[]; user_id: string; session_id?: string; type?: string; importance?: number; identity?: Record<string, unknown>; customer_id?: string; org_id?: string; metadata?: Record<string, unknown> }
export type BrainIngestResult = { ok: boolean; ingested: number; errors?: string[]; error?: string }

export type BrainArtifactResult = { ok: boolean; artifact?: any; error?: string }

const TIMEOUT_MS = 10000

function guardBrain(): string | null {
  if (!isBrainEnabled() || !getBrainBaseUrl()) return "brain not configured"
  return null
}

async function brainFetch<T extends { ok: boolean; error?: string }>(
  path: string,
  init?: RequestInit,
  fallback: Omit<T, "ok" | "error"> = {} as Omit<T, "ok" | "error">,
): Promise<T> {
  const base = getBrainBaseUrl()
  const guard = guardBrain()
  if (guard || !base) return { ok: false, error: guard ?? "brain not configured", ...fallback } as T

  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await res.text().catch(() => "")
    let body: any = {}
    if (text.trim()) {
      try { body = JSON.parse(text) } catch { body = { raw: text } }
    }
    if (!res.ok) {
      const error = (body?.error || body?.message) ?? `http_${res.status}`
      return { ok: false, error, ...fallback } as T
    }
    return { ok: true, ...body } as T
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), ...fallback } as T
  }
}

function jsonHeaders(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "X-Client": "markscode",
    "Content-Type": "application/json",
  }
}

export async function brainStatus(token: string): Promise<BrainStatusResult> {
  const guard = guardBrain()
  if (guard) return { ok: false, brain: null, error: guard }
  return brainFetch<BrainStatusResult>("/status", {
    method: "GET",
    headers: jsonHeaders(token),
  }, { brain: null })
}

export async function brainRecall(token: string, input: BrainRecallInput): Promise<BrainRecallResult> {
  const guard = guardBrain()
  if (guard) return { ok: false, items: [], sources: {}, error: guard }
  return brainFetch<BrainRecallResult>("/recall", {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ q: input.q, user_id: input.user_id, session_id: input.session_id, limit: input.limit }),
  }, { items: [], sources: {} })
}

export async function brainSave(token: string, input: BrainSaveInput): Promise<BrainSaveResult> {
  const guard = guardBrain()
  if (guard) return { ok: false, error: guard }
  return brainFetch<BrainSaveResult>("/save", {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ content: input.content, title: input.title, tags: input.tags, user_id: input.user_id, session_id: input.session_id, ...(input.importance === undefined || input.importance === 0.7 ? {} : { importance: input.importance }), identity: input.identity, customer_id: input.customer_id, org_id: input.org_id, metadata: input.metadata }),
  })
}

export async function brainGraphQuery(token: string, input: BrainGraphInput): Promise<BrainGraphResult> {
  const guard = guardBrain()
  if (guard) return { ok: false, error: guard }
  return brainFetch<BrainGraphResult>("/graph/query", {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ q: input.q, user_id: input.user_id, session_id: input.session_id, limit: input.limit }),
  })
}

export async function brainGraphPath(token: string, input: { from: string; to: string }): Promise<BrainGraphResult> {
  const guard = guardBrain()
  if (guard) return { ok: false, error: guard }
  return brainFetch<BrainGraphResult>("/graph/path", {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify(input),
  })
}

export async function brainGraphExplain(token: string, input: { node: string }): Promise<BrainGraphResult> {
  const guard = guardBrain()
  if (guard) return { ok: false, error: guard }
  return brainFetch<BrainGraphResult>("/graph/explain", {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify(input),
  })
}

export async function brainGraphIngest(token: string, items: BrainIngestItem[]): Promise<BrainIngestResult> {
  const guard = guardBrain()
  if (guard) return { ok: false, ingested: 0, error: guard }
  return brainFetch<BrainIngestResult>("/graph/ingest", {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ items }),
  }, { ingested: 0 })
}

export async function brainGraphArtifact(token: string): Promise<BrainArtifactResult> {
  const guard = guardBrain()
  if (guard) return { ok: false, error: guard }
  return brainFetch<BrainArtifactResult>("/graph/artifact", {
    method: "GET",
    headers: jsonHeaders(token),
  })
}
