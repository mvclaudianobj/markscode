import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

import { type AccountID, type OrgID } from "../account/schema"
import { Timestamps } from "../storage/schema.sql"

export const RemoteSSHProfileTable = sqliteTable(
  "remote_ssh_profile",
  {
    id: text().primaryKey(),
    account_id: text().$type<AccountID>(),
    org_id: text().$type<OrgID>(),
    name: text().notNull(),
    type: text().notNull().$default(() => "ssh"),
    host: text().notNull(),
    user: text().notNull(),
    port: integer().notNull().$default(() => 22),
    transport: text(),
    identity_file: text(),
    key_name: text(),
    host_alias: text(),
    credential_ref: text(),
    auth_method: text(),
    metadata: text(),
    ...Timestamps,
  },
  (table) => [
    index("remote_ssh_profile_name_idx").on(table.name),
    index("remote_ssh_profile_host_idx").on(table.host),
  ],
)
