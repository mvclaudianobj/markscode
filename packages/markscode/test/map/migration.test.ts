import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { readFileSync, readdirSync } from "fs"
import path from "path"

const bindingTarget = "20260726213900_map_session_binding"
const shadowTarget = "20260727013229_map_session_shadow"

const migrations = () =>
  readdirSync(path.join(import.meta.dirname, "../../migration"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      timestamp: Number(entry.name.split("_")[0]),
      sql: readFileSync(path.join(import.meta.dirname, "../../migration", entry.name, "migration.sql"), "utf-8"),
    }))
    .sort((a, b) => a.timestamp - b.timestamp)

describe("map session binding migration", () => {
  test("migration SQL and snapshot contain only the intended table delta", () => {
    const root = path.join(import.meta.dirname, "../../migration")
    const snapshot = JSON.parse(readFileSync(path.join(root, bindingTarget, "snapshot.json"), "utf-8")) as {
      prevIds: string[]
      ddl: Array<{ entityType: string; name: string; table?: string }>
    }
    const previous = readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && entry.name !== bindingTarget && entry.name < bindingTarget && Bun.file(path.join(root, entry.name, "snapshot.json")).size,
      )
      .map((entry) => JSON.parse(readFileSync(path.join(root, entry.name, "snapshot.json"), "utf-8")))
      .filter((entry) => snapshot.prevIds.includes(entry.id))
      .flatMap((entry) => entry.ddl)
    const known = new Set(previous.map((entry) => JSON.stringify(entry)))
    const delta = snapshot.ddl.filter((entry) => !known.has(JSON.stringify(entry)))
    const sql = readFileSync(path.join(root, bindingTarget, "migration.sql"), "utf-8")

    expect([...new Set(delta.map((entry) => entry.table ?? entry.name))]).toEqual(["map_session_binding"])
    expect([...sql.matchAll(/(?:TABLE|REFERENCES)\s+`([^`]+)`/g)].map((match) => match[1])).toEqual([
      "map_session_binding",
      "session",
    ])
  })

  test("applies after the complete migration history", () => {
    const sqlite = new Database(":memory:")
    sqlite.run("PRAGMA foreign_keys = ON")
    const entries = migrations()
    const index = entries.findIndex((entry) => entry.name === bindingTarget)

    expect(index).toBeGreaterThan(0)
    migrate(drizzle({ client: sqlite }), entries)

    expect(sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get("map_session_binding")).toEqual({
      name: "map_session_binding",
    })
    expect(sqlite.query("PRAGMA foreign_key_list('map_session_binding')").all()).toContainEqual(
      expect.objectContaining({ table: "session", from: "session_id", to: "id", on_delete: "CASCADE" }),
    )
  })
})

describe("map session shadow migration", () => {
  test("migration and snapshot contain exactly the integral intended delta", () => {
    const root = path.join(import.meta.dirname, "../../migration")
    const sql = readFileSync(path.join(import.meta.dirname, "../../migration", shadowTarget, "migration.sql"), "utf-8")
    const predecessor = JSON.parse(readFileSync(path.join(root, bindingTarget, "snapshot.json"), "utf-8")) as {
      id: string
      ddl: Array<{ entityType: string; name: string; table?: string }>
    }
    const snapshot = JSON.parse(readFileSync(path.join(root, shadowTarget, "snapshot.json"), "utf-8")) as {
      prevIds: string[]
      ddl: Array<{ entityType: string; name: string; table?: string }>
    }
    const previous = new Set(predecessor.ddl.map((entry) => JSON.stringify(entry)))
    const delta = snapshot.ddl.filter((entry) => !previous.has(JSON.stringify(entry)))
    const entities = delta.map((entry) => `${entry.entityType}:${entry.table ?? ""}:${entry.name}`)

    expect([...sql.matchAll(/(?:TABLE|REFERENCES)\s+`([^`]+)`/g)].map((match) => match[1])).toEqual([
      "map_session_shadow",
      "map_session_binding",
      "account",
      "account_state",
      "map_session_binding",
    ])
    expect(snapshot.prevIds).toEqual([predecessor.id])
    expect(entities).toEqual([
      "columns:account_state:revision",
      "columns:map_session_binding:revision",
      "tables::map_session_shadow",
      "columns:map_session_shadow:session_id",
      "columns:map_session_shadow:binding_revision",
      "columns:map_session_shadow:account_id",
      "columns:map_session_shadow:account_revision",
      "columns:map_session_shadow:org_id",
      "columns:map_session_shadow:project_id",
      "columns:map_session_shadow:module_id",
      "columns:map_session_shadow:task_id",
      "columns:map_session_shadow:project_version",
      "columns:map_session_shadow:module_version",
      "columns:map_session_shadow:task_version",
      "columns:map_session_shadow:project_json",
      "columns:map_session_shadow:module_json",
      "columns:map_session_shadow:task_json",
      "columns:map_session_shadow:time_observed",
      "columns:map_session_shadow:time_created",
      "columns:map_session_shadow:time_updated",
      "fks:map_session_shadow:fk_map_session_shadow_session_id_map_session_binding_session_id_fk",
      "fks:map_session_shadow:fk_map_session_shadow_account_id_account_id_fk",
      "pks:map_session_shadow:map_session_shadow_pk",
      "indexes:map_session_shadow:map_session_shadow_time_observed_idx",
    ])
    expect(sql).toContain("ALTER TABLE `account_state` ADD `revision` integer DEFAULT 1 NOT NULL")
    expect(sql).toContain("ADD `revision` integer DEFAULT 1 NOT NULL")
    expect(sql).toContain("map_session_shadow_time_observed_idx")
    expect(sql).not.toContain("remote_ssh_profile")
    expect(snapshot.ddl.some((entry) => entry.table === "remote_ssh_profile" || entry.name === "remote_ssh_profile")).toBeFalse()
  })

  test("applies after the complete migration history with cascade", () => {
    const sqlite = new Database(":memory:")
    sqlite.run("PRAGMA foreign_keys = ON")
    migrate(drizzle({ client: sqlite }), migrations())

    expect(sqlite.query("PRAGMA table_info('map_session_binding')").all()).toContainEqual(
      expect.objectContaining({ name: "revision", notnull: 1, dflt_value: "1" }),
    )
    expect(sqlite.query("PRAGMA table_info('account_state')").all()).toContainEqual(
      expect.objectContaining({ name: "revision", notnull: 1, dflt_value: "1" }),
    )
    expect(sqlite.query("PRAGMA table_info('map_session_shadow')").all()).toContainEqual(
      expect.objectContaining({ name: "account_revision", notnull: 1 }),
    )
    expect(sqlite.query("PRAGMA foreign_key_list('map_session_shadow')").all()).toContainEqual(
      expect.objectContaining({ table: "map_session_binding", from: "session_id", to: "session_id", on_delete: "CASCADE" }),
    )
    expect(sqlite.query("PRAGMA foreign_key_list('map_session_shadow')").all()).toContainEqual(
      expect.objectContaining({ table: "account", from: "account_id", to: "id", on_delete: "CASCADE" }),
    )
    expect(sqlite.query("PRAGMA index_list('map_session_shadow')").all()).toContainEqual(
      expect.objectContaining({ name: "map_session_shadow_time_observed_idx" }),
    )
  })
})
