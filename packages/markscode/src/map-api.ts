

import { Effect, Option } from "effect"
import { Account } from "@/account/account"
import { makeRuntime } from "@/effect/run-service"
import { getMarksAgentString } from "./marks-agent-config-source"

/* MARKSCODE_MAP_API_START */

export interface MapProjectRefInput {
  project_id?: string
  project_slug?: string
}

export interface MapModuleRefInput extends MapProjectRefInput {
  module_id?: string
  module_slug?: string
}

export interface MapTaskRefInput extends MapModuleRefInput {
  task_id?: string
  title?: string
}

export interface MapProjectItem {
  id: string
  slug: string
  name: string
  description?: string | null
}

export interface MapModuleItem {
  id: string
  project_id: string
  slug: string
  name: string
  description?: string | null
}

export interface MapTaskItem {
  id: string
  project_id: string
  module_id?: string | null
  title: string
  description?: string | null
  status?: string | null
  priority?: string | null
  assignee?: string | null
}

export interface MapBootstrapInput extends MapModuleRefInput {
  host?: string
  include_tasks?: boolean
}

export interface MapBootstrapResult {
  contract?: string
  project?: MapProjectItem | null
  module?: MapModuleItem | null
  modules?: MapModuleItem[]
  tasks?: MapTaskItem[]
  host_state?: Record<string, unknown> | null
  context?: Record<string, unknown> | null
  recent_events?: Array<Record<string, unknown>>
}

export interface MapTaskUpsertInput extends MapModuleRefInput {
  title: string
  description?: string
  status?: string
  priority?: string
  assignee?: string
  actor?: string
}

export interface MapTaskUpsertResult {
  contract?: string
  action?: string
  project?: MapProjectItem | null
  module?: MapModuleItem | null
  task?: MapTaskItem | null
}

export interface MapSessionLifecycleInput extends MapTaskRefInput {
  host: string
  actor?: string
  note?: string
  task_status?: string
  progress?: string
  event_type?: string
  task_update?: {
    description?: string
    status?: string
    priority?: string
    assignee?: string
  }
  host_state?: Record<string, unknown>
}

export interface MapSessionLifecycleResult {
  contract?: string
  session?: { phase?: string }
  task?: MapTaskItem | null
  host_state?: Record<string, unknown> | null
  recent_events?: Array<Record<string, unknown>>
}

const mapBase = String(getMarksAgentString("MAP_API_BASE_URL") || getMarksAgentString("MARKSCODE_MAP_API_URL") || process.env.MAP_API_BASE_URL || process.env.MARKSCODE_MAP_API_URL || "https://map.marks.ia.br/")

const mapApiKey = () =>
  getMarksAgentString("MARKSCODE_MAP_API_KEY") ||
  getMarksAgentString("MAP_API_KEY") ||
  getMarksAgentString("MARKS_API_KEY") ||
  process.env.MARKSCODE_MAP_API_KEY ||
  process.env.MAP_API_KEY ||
  process.env.MARKS_API_KEY

const normalizeMapBase = (value: string) => {
  const raw = value.trim() || "https://map.marks.ia.br/"
  const url = new URL(raw)
  const cleanPath = url.pathname.replace(/\/+$/, "")
  if (!cleanPath || cleanPath === "/") {
    url.pathname = "/api/map/v1"
  } else if (!cleanPath.endsWith("/api/map/v1")) {
    url.pathname = cleanPath + "/api/map/v1"
  } else {
    url.pathname = cleanPath
  }
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

const accountRuntime = makeRuntime(Account.Service, Account.defaultLayer)

const activeOrgLeaseHeaders = (): Promise<Record<string, string>> =>
  accountRuntime.runPromise(() =>
    Account.Service.use((account) =>
      account.acquireActiveOrgLease().pipe(
        Effect.map((lease) => {
          if (Option.isNone(lease)) return {} as Record<string, string>
          return {
            Authorization: "Bearer " + lease.value.accessToken,
            "x-org-id": lease.value.active.org.id,
          } as Record<string, string>
        }),
        Effect.catch(() => Effect.succeed({} satisfies Record<string, string>)),
      ),
    ),
  )

const mapHeaders = async (): Promise<Record<string, string>> => {
  const leaseHeaders = await activeOrgLeaseHeaders()
  const apiKey = mapApiKey()
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
    ...leaseHeaders,
  }
}

type MapQueryInput = Record<string, unknown> | object

const mapUrl = (path: string, query?: MapQueryInput) => {
  const base = normalizeMapBase(mapBase)
  const url = new URL(base + path)
  Object.entries((query || {}) as Record<string, unknown>).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item === undefined || item === null || item === "") return
        url.searchParams.append(key, String(item))
      })
      return
    }
    url.searchParams.set(key, String(value))
  })
  return url.toString()
}

const mapRequest = async <T>(path: string, init?: RequestInit, query?: MapQueryInput): Promise<T> => {
  const url = mapUrl(path, query)
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...(await mapHeaders()),
        ...(init?.headers || {}),
      },
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error("Unable to connect to MAP API at " + url + ". " + reason)
  }
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const msg = res.status === 401 || res.status === 403
      ? "Sessão Markspanel ausente ou expirada; faça login pelo fluxo OAuth/device do MarksCode/Markspanel."
      : data?.error || data?.message || res.statusText || "MAP request failed"
    throw new Error(String(msg))
  }
  return data as T
}

const normalizeMapTaskStatus = (value?: string) => {
  const raw = String(value || "open").trim().toLowerCase()
  if (!raw || raw === "todo" || raw === "pending" || raw === "backlog") return "open"
  if (raw === "doing") return "in_progress"
  if (raw === "completed") return "done"
  if (raw === "cancelled" || raw === "canceled") return "blocked"
  return raw
}

const normalizeMapTaskPriority = (value?: string) => {
  const raw = String(value || "normal").trim().toLowerCase()
  if (!raw || raw === "medium") return "normal"
  return raw
}

export async function listMapProjects(): Promise<{ projects: MapProjectItem[] }> {
  const data = await mapRequest<{ projects?: MapProjectItem[]; items?: MapProjectItem[] }>("/projects")
  return { projects: data.projects || data.items || [] }
}

export async function listMapModules(input: MapProjectRefInput = {}): Promise<{ modules: MapModuleItem[] }> {
  const data = await mapRequest<{ modules?: MapModuleItem[]; items?: MapModuleItem[] }>("/modules", undefined, input)
  return { modules: data.modules || data.items || [] }
}

export async function listMapTasks(input: MapTaskRefInput = {}): Promise<{ tasks: MapTaskItem[] }> {
  const data = await mapRequest<{ tasks?: MapTaskItem[]; items?: MapTaskItem[] }>("/tasks", undefined, input)
  return { tasks: data.tasks || data.items || [] }
}

export async function getMapBootstrap(input: MapBootstrapInput): Promise<MapBootstrapResult> {
  return mapRequest("/integration/bootstrap", {
    method: "POST",
    body: JSON.stringify({
      project_id: input.project_id,
      project_slug: input.project_slug,
      module_id: input.module_id,
      module_slug: input.module_slug,
      host: input.host,
      include_tasks: input.include_tasks ?? true,
    }),
  })
}

export async function upsertMapTask(input: MapTaskUpsertInput): Promise<MapTaskUpsertResult> {
  return mapRequest("/integration/task/upsert", {
    method: "POST",
    body: JSON.stringify({
      project_id: input.project_id,
      project_slug: input.project_slug,
      module_id: input.module_id,
      module_slug: input.module_slug,
      actor: input.actor,
      task: {
        title: input.title,
        description: input.description,
        status: normalizeMapTaskStatus(input.status),
        priority: normalizeMapTaskPriority(input.priority),
        assignee: input.assignee,
      },
    }),
  })
}

export async function startMapSession(input: MapSessionLifecycleInput): Promise<MapSessionLifecycleResult> {
  return mapRequest("/integration/session/start", {
    method: "POST",
    body: JSON.stringify({
      project_id: input.project_id,
      project_slug: input.project_slug,
      module_id: input.module_id,
      module_slug: input.module_slug,
      task_id: input.task_id,
      title: input.title,
      host: input.host,
      actor: input.actor,
      note: input.note,
      task_status: input.task_status,
    }),
  })
}

export async function progressMapSession(input: MapSessionLifecycleInput): Promise<MapSessionLifecycleResult> {
  return mapRequest("/integration/session/progress", {
    method: "POST",
    body: JSON.stringify({
      project_id: input.project_id,
      project_slug: input.project_slug,
      module_id: input.module_id,
      module_slug: input.module_slug,
      task_id: input.task_id,
      title: input.title,
      host: input.host,
      actor: input.actor,
      note: input.note,
      progress: input.progress,
      event_type: input.event_type,
      task_update: input.task_update,
      host_state: input.host_state,
    }),
  })
}

export async function endMapSession(input: MapSessionLifecycleInput): Promise<MapSessionLifecycleResult> {
  return mapRequest("/integration/session/end", {
    method: "POST",
    body: JSON.stringify({
      project_id: input.project_id,
      project_slug: input.project_slug,
      module_id: input.module_id,
      module_slug: input.module_slug,
      task_id: input.task_id,
      title: input.title,
      host: input.host,
      actor: input.actor,
      note: input.note,
      task_status: input.task_status,
      host_state: input.host_state,
    }),
  })
}

/* MARKSCODE_MAP_API_END */
