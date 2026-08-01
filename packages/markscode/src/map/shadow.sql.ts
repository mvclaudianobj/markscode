import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

import type { AccountID, OrgID } from "@/account/schema"
import { AccountTable } from "@/account/account.sql"
import type { SessionID } from "@/session/schema"
import { Timestamps } from "@/storage/schema.sql"
import { MapSessionBindingTable } from "./binding.sql"

export const MapSessionShadowTable = sqliteTable(
  "map_session_shadow",
  {
    session_id: text()
      .$type<SessionID>()
      .primaryKey()
      .references(() => MapSessionBindingTable.session_id, { onDelete: "cascade" }),
    binding_revision: integer().notNull(),
    account_id: text().$type<AccountID>().notNull().references(() => AccountTable.id, { onDelete: "cascade" }),
    account_revision: integer().notNull(),
    org_id: text().$type<OrgID>().notNull(),
    project_id: text().notNull(),
    module_id: text(),
    task_id: text(),
    project_version: integer().notNull(),
    module_version: integer(),
    task_version: integer(),
    project_json: text().notNull(),
    module_json: text(),
    task_json: text(),
    time_observed: integer().notNull(),
    ...Timestamps,
  },
  (table) => [index("map_session_shadow_time_observed_idx").on(table.time_observed)],
)
