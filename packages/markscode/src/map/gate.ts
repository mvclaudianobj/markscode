import { Context, Effect, Layer, Option } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"

import { Account } from "@/account/account"
import { InstanceState } from "@/effect/instance-state"
import type { SessionID } from "@/session/schema"
import { MapBinding } from "./binding"
import { MapClient } from "./client"
import { MapShadow } from "./shadow"

export interface Interface {
  readonly bind: (sessionID: SessionID) => Effect.Effect<void>
  readonly prompt: (sessionID: SessionID) => Effect.Effect<void>
  readonly progress: (input: { sessionID: SessionID; status?: MapClient.UpdateTaskInput["status"]; event?: string }) => Effect.Effect<void>
  readonly tool: (input: { sessionID: SessionID; tool: string; source: "builtin" | "mcp" }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MapGate") {}

const activeStatuses = ["in_progress", "open", "todo", "pending"] as const
const projectMatch = (project: MapClient.Project, ctx: { directory: string; worktree: string; project: { id: string; name?: string } }) => {
  const metadata = Option.liftThrowable(() => JSON.parse(project.metadata_json) as Record<string, unknown>)()
  const values = Option.isSome(metadata) ? Object.values(metadata.value).filter((value): value is string => typeof value === "string") : []
  return [project.id, project.slug, project.name, ...values].includes(ctx.project.id) ||
    (ctx.project.name !== undefined && [project.slug, project.name, ...values].includes(ctx.project.name)) ||
    values.includes(ctx.directory) ||
    values.includes(ctx.worktree)
}

export const layer: Layer.Layer<Service, never, MapShadow.Service | MapBinding.Service | MapClient.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const shadow = yield* MapShadow.Service
    const binding = yield* MapBinding.Service
    const client = yield* MapClient.Service
    const observe = (sessionID: SessionID) =>
      shadow.observe(sessionID).pipe(
        Effect.catch(() => Effect.void),
        Effect.catchDefect(() => Effect.void),
        Effect.timeoutOption("2 seconds"),
        Effect.asVoid,
      )
    const failOpen = <E, R>(effect: Effect.Effect<void, E, R>) =>
      effect.pipe(Effect.catch(() => Effect.void), Effect.catchDefect(() => Effect.void), Effect.timeoutOption("2 seconds"), Effect.asVoid)
    const bind = Effect.fn("MapGate.bind")((sessionID: SessionID) =>
      failOpen(Effect.gen(function* () {
        if (Option.isSome(yield* binding.get(sessionID))) return
        const ctx = yield* InstanceState.context
        yield* client.authenticated((scope) => Effect.gen(function* () {
          const capabilities = yield* scope.capabilities()
          if (!capabilities.reads.includes("projects") || !capabilities.reads.includes("tasks")) return
          const projects = yield* scope.projects()
          const project = projects.items.find((item) => projectMatch(item, ctx)) ?? projects.items.find((item) => item.status === "active")
          if (!project) return
          const tasks = yield* scope.tasks({ project_id: project.id })
          const task = activeStatuses.flatMap((status) => tasks.items.filter((item) => item.status === status))[0]
          yield* binding.set({
            sessionID,
            projectID: project.id,
            projectSlug: project.slug,
            ...(task && { taskID: task.id, taskTitle: task.title }),
          })
        }))
      })),
    )
    const progress = Effect.fn("MapGate.progress")((input: { sessionID: SessionID; status?: MapClient.UpdateTaskInput["status"]; event?: string }) =>
      failOpen(Effect.gen(function* () {
        const current = yield* binding.get(input.sessionID)
        if (Option.isNone(current) || current.value.taskID === undefined) return
        const taskID = current.value.taskID
        yield* client.authenticated((scope) => Effect.gen(function* () {
          if (input.event !== undefined) {
            yield* scope.createEvent({
              event_type: input.event,
              aggregate_type: "task",
              aggregate_id: taskID,
              source_session: input.sessionID,
            })
          }
          if (input.status !== undefined) yield* scope.updateTask(taskID, { status: input.status })
        }))
      })),
    )

    return Service.of({
      bind,
      prompt: Effect.fn("MapGate.prompt")(observe),
      progress,
      tool: Effect.fn("MapGate.tool")((input) => observe(input.sessionID)),
    })
  }),
)

const shadowLayer = MapShadow.layer.pipe(Layer.provideMerge(MapBinding.layer), Layer.provideMerge(MapClient.layer))

export const liveLayer: Layer.Layer<Service, never, Account.Service | HttpClient.HttpClient> = layer.pipe(
  Layer.provide(shadowLayer),
)

export const defaultLayer: Layer.Layer<Service> = liveLayer.pipe(
  Layer.provide(Account.defaultLayer),
  Layer.provide(FetchHttpClient.layer),
)

export * as MapGate from "./gate"
