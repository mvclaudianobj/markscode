export interface MapProject {
  id?: string
  slug?: string
  name?: string
  status?: string
}

export interface MapModule {
  id?: string
  project_id?: string
  project_slug?: string
  slug?: string
  name?: string
  status?: string
}

export interface MapTask {
  id?: string
  project_id?: string
  project_slug?: string
  module_id?: string
  module_slug?: string
  slug?: string
  title?: string
  status?: string
  priority?: string
  last_phase?: string
  map_binding?: string
}

export interface MapBootstrap {
  projects: MapProject[]
  modules: MapModule[]
  tasks: MapTask[]
}

export interface MapSession {
  id?: string
  session_id?: string
  project_id?: string
  task_id?: string
  status?: string
  last_phase?: string
}

const baseURL = () => (process.env.MARKSCODE_MAP_URL || process.env.MAP_API_URL || "").replace(/\/$/, "")

async function request(path: string, init?: RequestInit) {
  const base = baseURL()
  if (!base) return undefined
  const headers = new Headers(init?.headers || {})
  const apiKey = process.env.MARKSCODE_MAP_API_KEY || process.env.MAP_API_KEY || process.env.MARKSCODE_API_KEY || ""
  if (!headers.has("X-API-Key") && apiKey.trim()) headers.set("X-API-Key", apiKey)
  if (!headers.has("Authorization") && apiKey.trim()) headers.set("Authorization", `Bearer ${apiKey}`)
  if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json")

  return fetch(`${base}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(8000),
  })
    .then(async (response) => {
      if (!response.ok) return undefined
      const text = await response.text().catch(() => "")
      return text.trim() ? (JSON.parse(text) as unknown) : undefined
    })
    .catch(() => undefined)
}

function listFromBody<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[]
  if (!body || typeof body !== "object") return []
  const record = body as Record<string, unknown>
  if (Array.isArray(record.items)) return record.items as T[]
  if (Array.isArray(record.data)) return record.data as T[]
  if (Array.isArray(record.projects)) return record.projects as T[]
  if (Array.isArray(record.modules)) return record.modules as T[]
  if (Array.isArray(record.tasks)) return record.tasks as T[]
  return []
}

function objectFromBody<T extends object>(body: unknown, fallback: T): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fallback
  const record = body as Record<string, unknown>
  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) return record.data as T
  return body as T
}

export async function listMapProjects() {
  return listFromBody<MapProject>(await request("/projects"))
}

export async function listMapModules(input?: { project_id?: string; project_slug?: string }) {
  const query = new URLSearchParams()
  if (input?.project_id) query.set("project_id", input.project_id)
  if (input?.project_slug) query.set("project_slug", input.project_slug)
  return listFromBody<MapModule>(await request(`/modules${query.size ? `?${query}` : ""}`))
}

export async function listMapTasks(input?: { project_id?: string; project_slug?: string; module_id?: string; module_slug?: string }) {
  const query = new URLSearchParams()
  if (input?.project_id) query.set("project_id", input.project_id)
  if (input?.project_slug) query.set("project_slug", input.project_slug)
  if (input?.module_id) query.set("module_id", input.module_id)
  if (input?.module_slug) query.set("module_slug", input.module_slug)
  return listFromBody<MapTask>(await request(`/tasks${query.size ? `?${query}` : ""}`))
}

export async function getMapBootstrap(input?: { project_slug?: string }) {
  const query = new URLSearchParams()
  if (input?.project_slug) query.set("project_slug", input.project_slug)
  const body = objectFromBody<Partial<MapBootstrap>>(await request(`/bootstrap${query.size ? `?${query}` : ""}`), {})
  return {
    projects: Array.isArray(body.projects) ? body.projects : [],
    modules: Array.isArray(body.modules) ? body.modules : [],
    tasks: Array.isArray(body.tasks) ? body.tasks : [],
  }
}

export async function upsertMapTask(input: MapTask) {
  return objectFromBody<MapTask>(
    await request("/tasks", {
      method: "POST",
      body: JSON.stringify(input),
    }),
    input,
  )
}

export async function startMapSession(input: { session_id?: string; project_id?: string; task_id?: string; task_slug?: string }) {
  return objectFromBody<MapSession>(
    await request("/sessions/start", {
      method: "POST",
      body: JSON.stringify(input),
    }),
    { ...input, status: "started" },
  )
}

export async function progressMapSession(input: { session_id?: string; phase?: string; status?: string; task_id?: string }) {
  return objectFromBody<MapSession>(
    await request("/sessions/progress", {
      method: "POST",
      body: JSON.stringify(input),
    }),
    { session_id: input.session_id, task_id: input.task_id, status: input.status ?? "progress", last_phase: input.phase },
  )
}

export async function endMapSession(input: { session_id?: string; status?: string; task_id?: string }) {
  return objectFromBody<MapSession>(
    await request("/sessions/end", {
      method: "POST",
      body: JSON.stringify(input),
    }),
    { session_id: input.session_id, task_id: input.task_id, status: input.status ?? "ended" },
  )
}
