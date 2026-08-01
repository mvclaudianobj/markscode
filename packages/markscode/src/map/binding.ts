import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Context, Effect, Layer, Option } from "effect"
import { eq, sql } from "drizzle-orm"

import { Database } from "@/storage/db"
import type { SessionID } from "@/session/schema"
import { MapSessionBindingTable } from "./binding.sql"
import { Binding, type BindingInput } from "./schema"

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Option.Option<Binding>>
  readonly set: (input: BindingInput) => Effect.Effect<Binding>
  readonly remove: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MapBinding") {}

export const use = serviceUse(Service)

export const layer: Layer.Layer<Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fromRow = (row: typeof MapSessionBindingTable.$inferSelect) =>
      new Binding({
        sessionID: row.session_id,
        projectID: row.project_id,
        ...(row.project_slug !== null && { projectSlug: row.project_slug }),
        ...(row.module_id !== null && { moduleID: row.module_id }),
        ...(row.module_slug !== null && { moduleSlug: row.module_slug }),
        ...(row.task_id !== null && { taskID: row.task_id }),
        ...(row.task_title !== null && { taskTitle: row.task_title }),
        revision: row.revision,
        timeCreated: row.time_created,
        timeUpdated: row.time_updated,
      })

    const get = Effect.fn("MapBinding.get")((sessionID: SessionID) =>
      Effect.sync(() =>
        Option.fromNullishOr(
          Database.use((db) =>
            db.select().from(MapSessionBindingTable).where(eq(MapSessionBindingTable.session_id, sessionID)).get(),
          ),
        ).pipe(Option.map(fromRow)),
      ),
    )

    const set = Effect.fn("MapBinding.set")((input: BindingInput) =>
      Effect.sync(() => {
        const now = Date.now()
        const row = Database.use((db) =>
          db
            .insert(MapSessionBindingTable)
            .values({
              session_id: input.sessionID,
              project_id: input.projectID,
              project_slug: input.projectSlug,
              module_id: input.moduleID,
              module_slug: input.moduleSlug,
              task_id: input.taskID,
              task_title: input.taskTitle,
              time_created: now,
              time_updated: now,
            })
            .onConflictDoUpdate({
              target: MapSessionBindingTable.session_id,
              set: {
                project_id: input.projectID,
                project_slug: input.projectSlug,
                module_id: input.moduleID,
                module_slug: input.moduleSlug,
                task_id: input.taskID,
                task_title: input.taskTitle,
                revision: sql`${MapSessionBindingTable.revision} + 1`,
                time_updated: now,
              },
            })
            .returning()
            .get(),
        )
        return fromRow(row!)
      }),
    )

    const remove = Effect.fn("MapBinding.remove")((sessionID: SessionID) =>
      Effect.sync(() => {
        Database.use((db) => db.delete(MapSessionBindingTable).where(eq(MapSessionBindingTable.session_id, sessionID)).run())
      }),
    )

    return Service.of({ get, set, remove })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer

export * as MapBinding from "./binding"
