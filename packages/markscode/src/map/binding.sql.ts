import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

import { SessionTable } from "@/session/session.sql"
import type { SessionID } from "@/session/schema"
import { Timestamps } from "@/storage/schema.sql"

export const MapSessionBindingTable = sqliteTable("map_session_binding", {
  session_id: text()
    .$type<SessionID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  project_id: text().notNull(),
  project_slug: text(),
  module_id: text(),
  module_slug: text(),
  task_id: text(),
  task_title: text(),
  revision: integer().notNull().default(1),
  ...Timestamps,
})
