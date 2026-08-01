import type { MapBootstrapResult, MapSessionLifecycleResult } from "./map-api"

export type MapBindingKV = Record<string, unknown>

export type MapContextOption = {
  title: string
  value: string
  description?: string
  details?: string[]
  category?: string
}

export interface MapKVStore {
  get: (key: string) => unknown
  set: (key: string, value: string) => void
}

export const mapKeyFor = (sessionID: string) => "map_binding:" + sessionID

export const mapAutoCheckpointKeyFor = (sessionID: string) => "map_auto_checkpoint:" + sessionID
export const mapSuggestionSeenKeyFor = (sessionID: string) => "map_suggestion_seen:" + sessionID

export const getMapBindingFromKV = (kv: Pick<MapKVStore, "get">, sessionID?: string): MapBindingKV => {
  if (!sessionID) return {}
  try {
    const raw = kv.get(mapKeyFor(sessionID))
    if (!raw) return {}
    const data = JSON.parse(String(raw))
    return data && typeof data === "object" ? data as MapBindingKV : {}
  } catch {
    return {}
  }
}

export const setMapBindingInKV = (input: {
  kv: MapKVStore
  sessionID: string
  patch: MapBindingKV
  host: string
  actor: string
  now?: Date
}) => {
  const next: MapBindingKV = {
    ...getMapBindingFromKV(input.kv, input.sessionID),
    ...input.patch,
    session_id: input.sessionID,
    host: input.host,
    actor: input.actor,
    updated_at: (input.now ?? new Date()).toISOString(),
  }
  input.kv.set(mapKeyFor(input.sessionID), JSON.stringify(next))
  return next
}

export const clearMapModuleTaskInKV = (input: {
  kv: MapKVStore
  sessionID: string
  patch: MapBindingKV
  host: string
  actor: string
}) =>
  setMapBindingInKV({
    kv: input.kv,
    sessionID: input.sessionID,
    patch: {
      ...input.patch,
      module_id: undefined,
      module_slug: undefined,
      module_name: undefined,
      task_id: undefined,
      task_title: undefined,
      task_status: undefined,
    },
    host: input.host,
    actor: input.actor,
  })

export const canChooseMapModuleOrTask = (binding: MapBindingKV) => Boolean(binding.project_id || binding.project_slug)

export const mapContextRows = (input: {
  data: MapBootstrapResult
  binding: MapBindingKV
  host: string
  actor: string
}) => {
  const project = input.data.project
  const module = input.data.module
  const tasks = Array.isArray(input.data.tasks) ? input.data.tasks.slice(0, 8) : []
  const recentEvents = Array.isArray(input.data.recent_events) ? input.data.recent_events.slice(0, 6) : []
  return [
    "[Planning / MAP]",
    "- host: " + input.host,
    "- actor: " + input.actor,
    "- project: " + (project?.name || input.binding.project_name || input.binding.project_slug || input.binding.project_id || "(none)"),
    "- module: " + (module?.name || input.binding.module_name || input.binding.module_slug || input.binding.module_id || "(none)"),
    "- linked_task: " + (input.binding.task_title || input.binding.task_id || "(none)"),
    "",
    "Tasks:",
    ...tasks.map((item) => "- [" + String(item.status || "todo") + "] " + String(item.title || item.id || "sem titulo")),
    "",
    "Evoluções recentes:",
    ...(recentEvents.length ? recentEvents.map((item) => "- " + String(item.note || item.progress || item.event_type || item.phase || item.created_at || "evento MAP")) : ["- nenhuma evolução recente retornada pelo MAP"]),
  ]
}

export const mapContextOptions = (input: {
  data: MapBootstrapResult
  binding: MapBindingKV
  host: string
  actor: string
}): MapContextOption[] => {
  const project = input.data.project
  const module = input.data.module
  const tasks = Array.isArray(input.data.tasks) ? input.data.tasks.slice(0, 8) : []
  const recentEvents = Array.isArray(input.data.recent_events) ? input.data.recent_events.slice(0, 6) : []
  return [
    {
      title: String(project?.name || input.binding.project_name || input.binding.project_slug || input.binding.project_id || "(nenhum projeto)"),
      value: "project",
      description: String(project?.slug || input.binding.project_slug || input.binding.project_id || "Projeto MAP não vinculado"),
      details: ["host: " + input.host, "actor: " + input.actor],
      category: "Projeto",
    },
    {
      title: String(module?.name || input.binding.module_name || input.binding.module_slug || input.binding.module_id || "(nenhum módulo)"),
      value: "module",
      description: String(module?.slug || input.binding.module_slug || input.binding.module_id || "Módulo MAP não vinculado"),
      details: ["task vinculada: " + String(input.binding.task_title || input.binding.task_id || "(nenhuma)")],
      category: "Módulo/Task",
    },
    ...tasks.map((item, index) => ({
      title: String(item.title || item.id || "sem título"),
      value: "task:" + String(item.id || index),
      description: String(item.status || "todo"),
      details: ["id: " + String(item.id || "(sem id)")],
      category: "Tasks",
    })),
    ...(recentEvents.length ? recentEvents.map((item, index) => ({
      title: String(item.note || item.progress || item.event_type || item.phase || item.created_at || "evento MAP"),
      value: "event:" + index,
      description: String(item.event_type || item.phase || item.created_at || "evolução recente"),
      category: "Evoluções recentes",
    })) : [{
      title: "Nenhuma evolução recente retornada pelo MAP",
      value: "event:none",
      description: "Sem registros recentes",
      category: "Evoluções recentes",
    }]),
    {
      title: "Fechar",
      value: "close",
      description: "Voltar ao chat sem inserir contexto no prompt",
      category: "Ações",
    },
  ]
}

export const mapLifecycleBindingPatch = (input: {
  result: MapSessionLifecycleResult
  binding: MapBindingKV
  fallbackPhase: "started" | "progress" | "ended"
  note?: string
}) => {
  const task = input.result.task
  return {
    task_id: task?.id || input.binding.task_id,
    task_title: task?.title || input.binding.task_title,
    task_status: task?.status || input.binding.task_status || (input.fallbackPhase === "ended" ? "done" : "in_progress"),
    last_phase: input.result.session?.phase || input.fallbackPhase,
    ...(input.note && input.fallbackPhase === "progress" ? { last_progress_note: input.note } : {}),
    ...(input.note && input.fallbackPhase === "ended" ? { last_checkout_note: input.note } : {}),
  }
}
