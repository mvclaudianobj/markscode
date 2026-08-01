import { describe, expect, test } from "bun:test"
import {
  canChooseMapModuleOrTask,
  clearMapModuleTaskInKV,
  getMapBindingFromKV,
  mapContextOptions,
  mapContextRows,
  mapLifecycleBindingPatch,
  setMapBindingInKV,
} from "@/map-tui-kv"

const store = () => {
  const values = new Map<string, string>()
  return {
    values,
    get: (key: string) => values.get(key),
    set: (key: string, value: string) => values.set(key, value),
  }
}

describe("MAP TUI KV helpers", () => {
  test("project-only binding permits choosing module and task", () => {
    const kv = store()
    const binding = setMapBindingInKV({
      kv,
      sessionID: "session-1",
      patch: { project_id: "project-1", module_id: undefined, task_id: undefined },
      host: "host-1",
      actor: "actor-1",
    })

    expect(canChooseMapModuleOrTask(binding)).toBe(true)
    expect(getMapBindingFromKV(kv, "session-1").module_id).toBeUndefined()
    expect(getMapBindingFromKV(kv, "session-1").task_id).toBeUndefined()
  })

  test("clearing a project resets module and task without blocking later selection", () => {
    const kv = store()
    setMapBindingInKV({
      kv,
      sessionID: "session-2",
      patch: { project_id: "project-1", module_id: "module-1", task_id: "task-1", task_title: "Task" },
      host: "host-1",
      actor: "actor-1",
    })

    const binding = clearMapModuleTaskInKV({
      kv,
      sessionID: "session-2",
      patch: { project_id: "project-2" },
      host: "host-1",
      actor: "actor-1",
    })

    expect(binding.project_id).toBe("project-2")
    expect(binding.module_id).toBeUndefined()
    expect(binding.task_id).toBeUndefined()
    expect(canChooseMapModuleOrTask(binding)).toBe(true)
  })

  test("task binding lifecycle stores last phase and status", () => {
    const patch = mapLifecycleBindingPatch({
      binding: { task_id: "task-1", task_title: "Old", task_status: "open" },
      result: { session: { phase: "progress" }, task: { id: "task-1", project_id: "project-1", module_id: "module-1", title: "New", status: "in_progress" } },
      fallbackPhase: "progress",
      note: "checkpoint remoto",
    })

    expect(patch).toMatchObject({
      task_id: "task-1",
      task_title: "New",
      task_status: "in_progress",
      last_phase: "progress",
      last_progress_note: "checkpoint remoto",
    })
  })

  test("reload context rows include recent events", () => {
    const rows = mapContextRows({
      host: "host-1",
      actor: "actor-1",
      binding: { project_id: "project-1", module_id: "module-1", task_title: "Task" },
      data: {
        project: { id: "project-1", slug: "project", name: "Project" },
        module: { id: "module-1", project_id: "project-1", slug: "module", name: "Module" },
        tasks: [{ id: "task-1", project_id: "project-1", module_id: "module-1", title: "Task", status: "open" }],
        recent_events: [{ note: "checkpoint remoto" }, { event_type: "markscode_auto_session_checkpoint" }],
      },
    })

    expect(rows.join("\n")).toContain("checkpoint remoto")
    expect(rows.join("\n")).toContain("markscode_auto_session_checkpoint")
  })

  test("reload context options organize recent events without prompt rows", () => {
    const options = mapContextOptions({
      host: "host-1",
      actor: "actor-1",
      binding: { project_id: "project-1", module_id: "module-1", task_title: "Task" },
      data: {
        project: { id: "project-1", slug: "project", name: "Project" },
        module: { id: "module-1", project_id: "project-1", slug: "module", name: "Module" },
        tasks: [{ id: "task-1", project_id: "project-1", module_id: "module-1", title: "Task", status: "open" }],
        recent_events: [{ note: "checkpoint remoto" }, { event_type: "markscode_auto_session_checkpoint" }],
      },
    })

    expect(options.map((option) => option.category)).toContain("Projeto")
    expect(options.map((option) => option.category)).toContain("Módulo/Task")
    expect(options.map((option) => option.category)).toContain("Tasks")
    expect(options.filter((option) => option.category === "Evoluções recentes").map((option) => option.title)).toEqual(["checkpoint remoto", "markscode_auto_session_checkpoint"])
    expect(options.at(-1)?.title).toBe("Fechar")
  })
})
