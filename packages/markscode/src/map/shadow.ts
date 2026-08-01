import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { and, eq } from "drizzle-orm"

import type { AccountError } from "@/account/account"
import { AccountStateTable } from "@/account/account.sql"
import { AccountID, OrgID } from "@/account/schema"
import type { SessionID } from "@/session/schema"
import { Database } from "@/storage/db"
import { MapBinding } from "./binding"
import { MapSessionBindingTable } from "./binding.sql"
import { MapClient } from "./client"
import { Binding, WireID } from "./schema"
import { MapSessionShadowTable } from "./shadow.sql"

const freshness = 30_000
const itemLimit = 1_000
export const entityByteLimit = 64 * 1024
export const totalByteLimit = 192 * 1024

export class Shadow extends Schema.Class<Shadow>("Map.Shadow")({
  sessionID: WireID,
  bindingRevision: Schema.Int,
  accountID: WireID,
  accountRevision: Schema.Int,
  orgID: WireID,
  projectID: WireID,
  moduleID: Schema.optional(WireID),
  taskID: Schema.optional(WireID),
  projectVersion: Schema.Int,
  moduleVersion: Schema.optional(Schema.Int),
  taskVersion: Schema.optional(Schema.Int),
  projectJson: Schema.String,
  moduleJson: Schema.optional(Schema.String),
  taskJson: Schema.optional(Schema.String),
  timeObserved: Schema.Number,
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}) {}

export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()("MapShadowValidationError", {
  reason: Schema.Literals(["project", "module", "task", "hierarchy", "organization"]),
}) {}

export class LimitError extends Schema.TaggedErrorClass<LimitError>()("MapShadowLimitError", {
  reason: Schema.Literals(["items", "entity", "total"]),
}) {}

export type Error = MapClient.Error | AccountError | ValidationError | LimitError

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Option.Option<Shadow>>
  readonly observe: (sessionID: SessionID) => Effect.Effect<Option.Option<Shadow>, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MapShadow") {}

export const use = serviceUse(Service)

export const layer: Layer.Layer<Service, never, MapBinding.Service | MapClient.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    yield* MapBinding.Service
    const client = yield* MapClient.Service
    const fromRow = (row: typeof MapSessionShadowTable.$inferSelect) =>
      new Shadow({
        sessionID: row.session_id,
        bindingRevision: row.binding_revision,
        accountID: row.account_id,
        accountRevision: row.account_revision,
        orgID: row.org_id,
        projectID: row.project_id,
        ...(row.module_id !== null && { moduleID: row.module_id }),
        ...(row.task_id !== null && { taskID: row.task_id }),
        projectVersion: row.project_version,
        ...(row.module_version !== null && { moduleVersion: row.module_version }),
        ...(row.task_version !== null && { taskVersion: row.task_version }),
        projectJson: row.project_json,
        ...(row.module_json !== null && { moduleJson: row.module_json }),
        ...(row.task_json !== null && { taskJson: row.task_json }),
        timeObserved: row.time_observed,
        timeCreated: row.time_created,
        timeUpdated: row.time_updated,
      })
    const get = Effect.fn("MapShadow.get")((sessionID: SessionID) =>
      Effect.sync(() =>
        Option.fromNullishOr(
          Database.use((db) =>
            db.select().from(MapSessionShadowTable).where(eq(MapSessionShadowTable.session_id, sessionID)).get(),
          ),
        ).pipe(Option.map(fromRow)),
      ),
    )
    const observe = Effect.fn("MapShadow.observe")((sessionID: SessionID) =>
      Effect.gen(function* () {
        const captured = Database.transaction((db) => ({
          binding: db
            .select()
            .from(MapSessionBindingTable)
            .where(eq(MapSessionBindingTable.session_id, sessionID))
            .get(),
          account: db.select().from(AccountStateTable).where(eq(AccountStateTable.id, 1)).get(),
          shadow: db.select().from(MapSessionShadowTable).where(eq(MapSessionShadowTable.session_id, sessionID)).get(),
        }))
        if (
          captured.binding === undefined ||
          captured.account === undefined ||
          captured.account.active_account_id === null ||
          captured.account.active_org_id === null
        )
          return Option.none()
        const accountID = AccountID.make(captured.account.active_account_id)
        const orgID = OrgID.make(captured.account.active_org_id)
        const accountState = captured.account
        const accountRevision = accountState.revision
        const selected = new Binding({
          sessionID: captured.binding.session_id,
          projectID: captured.binding.project_id,
          ...(captured.binding.project_slug !== null && { projectSlug: captured.binding.project_slug }),
          ...(captured.binding.module_id !== null && { moduleID: captured.binding.module_id }),
          ...(captured.binding.module_slug !== null && { moduleSlug: captured.binding.module_slug }),
          ...(captured.binding.task_id !== null && { taskID: captured.binding.task_id }),
          ...(captured.binding.task_title !== null && { taskTitle: captured.binding.task_title }),
          revision: captured.binding.revision,
          timeCreated: captured.binding.time_created,
          timeUpdated: captured.binding.time_updated,
        })
        const existing = Option.fromNullishOr(captured.shadow).pipe(Option.map(fromRow))
        const age = Option.isSome(existing) ? Date.now() - existing.value.timeObserved : -1
        if (
          Option.isSome(existing) &&
          existing.value.bindingRevision === selected.revision &&
          existing.value.accountRevision === accountRevision &&
          existing.value.accountID === accountID &&
          existing.value.orgID === orgID &&
          existing.value.projectID === selected.projectID &&
          existing.value.moduleID === selected.moduleID &&
          existing.value.taskID === selected.taskID &&
          age >= 0 &&
          age < freshness
        )
          return existing

        const observed = yield* client.authenticated((scope) =>
          Effect.gen(function* () {
            const projects = yield* scope.projects()
            if (projects.items.length > itemLimit) return yield* new LimitError({ reason: "items" })
            const project = projects.items.find((item) => item.id === selected.projectID)
            if (!project) return yield* new ValidationError({ reason: "project" })
            if (project.org_id !== orgID) return yield* new ValidationError({ reason: "organization" })
            const modules =
              selected.moduleID !== undefined ? yield* scope.modules({ project_id: project.id }) : undefined
            if (modules !== undefined && modules.items.length > itemLimit)
              return yield* new LimitError({ reason: "items" })
            const module =
              selected.moduleID !== undefined ? modules?.items.find((item) => item.id === selected.moduleID) : undefined
            if (selected.moduleID !== undefined && module === undefined)
              return yield* new ValidationError({ reason: "module" })
            if (module !== undefined && (module.org_id !== project.org_id || module.project_id !== project.id)) {
              return yield* new ValidationError({ reason: "hierarchy" })
            }
            const tasks =
              selected.taskID !== undefined
                ? yield* scope.tasks({ project_id: project.id, ...(module && { module_id: module.id }) })
                : undefined
            if (tasks !== undefined && tasks.items.length > itemLimit) return yield* new LimitError({ reason: "items" })
            const task =
              selected.taskID !== undefined ? tasks?.items.find((item) => item.id === selected.taskID) : undefined
            if (selected.taskID !== undefined && task === undefined)
              return yield* new ValidationError({ reason: "task" })
            if (
              task &&
              (task.org_id !== project.org_id ||
                task.project_id !== project.id ||
                task.module_id !== (module?.id ?? null))
            )
              return yield* new ValidationError({ reason: "hierarchy" })
            const projectJson = JSON.stringify(project)
            const moduleJson = module !== undefined ? JSON.stringify(module) : undefined
            const taskJson = task !== undefined ? JSON.stringify(task) : undefined
            const sizes = [projectJson, moduleJson, taskJson]
              .filter((value): value is string => value !== undefined)
              .map((value) => Buffer.byteLength(value))
            if (sizes.reduce((sum, size) => sum + size, 0) > totalByteLimit)
              return yield* new LimitError({ reason: "total" })
            if (sizes.some((size) => size > entityByteLimit)) return yield* new LimitError({ reason: "entity" })
            const now = Date.now()
            const saved = Database.transaction(
              (db) => {
                const currentBinding = db
                  .select()
                  .from(MapSessionBindingTable)
                  .where(
                    and(
                      eq(MapSessionBindingTable.session_id, sessionID),
                      eq(MapSessionBindingTable.revision, selected.revision),
                      eq(MapSessionBindingTable.project_id, selected.projectID),
                    ),
                  )
                  .get()
                const state = db.select().from(AccountStateTable).where(eq(AccountStateTable.id, 1)).get()
                if (
                  !currentBinding ||
                  currentBinding.module_id !== (selected.moduleID ?? null) ||
                  currentBinding.task_id !== (selected.taskID ?? null) ||
                  state?.active_account_id !== accountID ||
                  state.active_org_id !== orgID ||
                  state.revision !== accountRevision
                )
                  return
                db.insert(MapSessionShadowTable)
                  .values({
                    session_id: sessionID,
                    binding_revision: selected.revision,
                    account_id: accountID,
                    account_revision: accountRevision,
                    org_id: orgID,
                    project_id: project.id,
                    module_id: module?.id,
                    task_id: task?.id,
                    project_version: project.version,
                    module_version: module?.version,
                    task_version: task?.version,
                    project_json: projectJson,
                    module_json: moduleJson,
                    task_json: taskJson,
                    time_observed: now,
                    time_created: now,
                    time_updated: now,
                  })
                  .onConflictDoUpdate({
                    target: MapSessionShadowTable.session_id,
                    set: {
                      binding_revision: selected.revision,
                      account_id: accountID,
                      account_revision: accountRevision,
                      org_id: orgID,
                      project_id: project.id,
                      module_id: module?.id,
                      task_id: task?.id,
                      project_version: project.version,
                      module_version: module?.version,
                      task_version: task?.version,
                      project_json: projectJson,
                      module_json: moduleJson,
                      task_json: taskJson,
                      time_observed: now,
                      time_updated: now,
                    },
                  })
                  .run()
                return db
                  .select()
                  .from(MapSessionShadowTable)
                  .where(eq(MapSessionShadowTable.session_id, sessionID))
                  .get()
              },
              { behavior: "immediate" },
            )
            return Option.fromNullishOr(saved).pipe(Option.map(fromRow))
          }),
        )
        return observed
      }),
    )
    return Service.of({ get, observe })
  }),
)

export * as MapShadow from "./shadow"
