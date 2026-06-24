import { Database as SQLiteDatabase } from "bun:sqlite"
import type { SQLQueryBindings } from "bun:sqlite"
import { Database } from "@/storage/db"
import { Schema } from "effect"
import { existsSync, realpathSync } from "fs"
import path from "path"
import { DbRegistry } from "@/storage/db-registry"

type Row = {
  id: string
  project_id: string
  workspace_id: string | null
  parent_id: string | null
  slug: string
  directory: string
  title: string
  version: string
  share_url: string | null
  summary_additions: number | null
  summary_deletions: number | null
  summary_files: number | null
  summary_diffs: string | null
  revert: string | null
  permission: string | null
  time_created: number
  time_updated: number
  time_compacting: number | null
  time_archived: number | null
  project_id_join: string | null
  project_name: string | null
  project_worktree: string | null
}

export type Info = {
  id: string
  slug: string
  projectID: string
  workspaceID?: string
  parentID?: string
  directory: string
  title: string
  version: string
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
  }
  project: {
    id: string
    name?: string
    worktree: string
  } | null
  source: {
    dbPath: string
    label: string
    active: boolean
  }
}

export const Info = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  projectID: Schema.String,
  workspaceID: Schema.optional(Schema.String),
  parentID: Schema.optional(Schema.String),
  directory: Schema.String,
  title: Schema.String,
  version: Schema.String,
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
    compacting: Schema.optional(Schema.Number),
    archived: Schema.optional(Schema.Number),
  }),
  project: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      name: Schema.optional(Schema.String),
      worktree: Schema.String,
    }),
  ),
  source: Schema.Struct({
    dbPath: Schema.String,
    label: Schema.String,
    active: Schema.Boolean,
  }),
}).annotate({ identifier: "AllDbSession" })

export const ImportInput = Schema.Struct({
  sourceDbPath: Schema.String,
  sessionID: Schema.String,
}).annotate({ identifier: "AllDbSessionImportInput" })

export const ImportResult = Schema.Struct({
  sessionID: Schema.String,
  imported: Schema.Boolean,
}).annotate({ identifier: "AllDbSessionImportResult" })

function canonical(candidate: string) {
  return existsSync(candidate) ? realpathSync(candidate) : path.resolve(candidate)
}

function candidatePaths() {
  return DbRegistry.scan({ currentPath: Database.getPath(), persist: true }).databases
    .filter((db) => db.status === "ok")
    .map((db) => db.path)
    .filter((item, index, arr) => arr.findIndex((other) => canonical(other) === canonical(item)) === index)
}

function tableExists(db: SQLiteDatabase, table: string) {
  return !!db.query("select name from sqlite_master where type = 'table' and name = ?1").get(table)
}

function columns(db: SQLiteDatabase, table: string) {
  return (db.query(`pragma table_info(${JSON.stringify(table)})`).all() as { name: string }[]).map((row) => row.name)
}

function quoteIdentifier(value: string) {
  return JSON.stringify(value)
}

function placeholders(count: number) {
  return Array.from({ length: count }, (_, index) => `?${index + 1}`).join(", ")
}

function insertRows(target: SQLiteDatabase, table: string, cols: string[], rows: Record<string, unknown>[]) {
  if (rows.length === 0 || cols.length === 0) return
  const sql = `insert into ${quoteIdentifier(table)} (${cols.map(quoteIdentifier).join(", ")}) values (${placeholders(cols.length)})`
  const query = target.query(sql)
  rows.forEach((row) => query.run(...(cols.map((column) => row[column]) as SQLQueryBindings[])))
}

function copyRows(input: {
  source: SQLiteDatabase
  target: SQLiteDatabase
  table: string
  where: string
  value: string
  sourceTables: Set<string>
  targetTables: Set<string>
}) {
  if (!input.sourceTables.has(input.table) || !input.targetTables.has(input.table)) return
  const cols = columns(input.source, input.table).filter((column) => columns(input.target, input.table).includes(column))
  const rows = input.source
    .query(`select ${cols.map(quoteIdentifier).join(", ")} from ${quoteIdentifier(input.table)} where ${quoteIdentifier(input.where)} = ?1`)
    .all(input.value) as Record<string, unknown>[]
  insertRows(input.target, input.table, cols, rows)
}

function assertNoConflicts(input: { source: SQLiteDatabase; target: SQLiteDatabase; table: string; where: string; value: string; sourceTables: Set<string>; targetTables: Set<string> }) {
  if (!input.sourceTables.has(input.table) || !input.targetTables.has(input.table)) return
  if (!columns(input.source, input.table).includes("id") || !columns(input.target, input.table).includes("id")) return
  const conflicts = input.source
    .query(
      `select id from ${quoteIdentifier(input.table)} where ${quoteIdentifier(input.where)} = ?1 and id in (select id from ${quoteIdentifier(input.table)})`,
    )
    .all(input.value) as { id: string }[]
  if (conflicts.some((row) => !!input.target.query(`select id from ${quoteIdentifier(input.table)} where id = ?1`).get(row.id))) {
    throw new Error(`Import conflict in ${input.table}`)
  }
}

function label(dbPath: string) {
  const base = path.basename(dbPath, ".db")
  if (base === "markscode" || base === "opencode") return "default"
  if (base.startsWith("markscode-")) return base.slice("markscode-".length)
  if (base.startsWith("opencode-")) return base.slice("opencode-".length)
  return base
}

function fromRow(row: Row, source: Info["source"]): Info {
  return {
    id: row.id,
    slug: row.slug,
    projectID: row.project_id,
    workspaceID: row.workspace_id ?? undefined,
    parentID: row.parent_id ?? undefined,
    directory: row.directory,
    title: row.title,
    version: row.version,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      compacting: row.time_compacting ?? undefined,
      archived: row.time_archived ?? undefined,
    },
    project: row.project_id_join
      ? {
          id: row.project_id_join,
          name: row.project_name ?? undefined,
          worktree: row.project_worktree ?? row.directory,
        }
      : null,
    source,
  }
}

function listDb(dbPath: string, input: { search?: string; limit: number; activePath: string }) {
  const db = new SQLiteDatabase(dbPath, { readonly: true, strict: true })
  try {
    const search = input.search?.trim().toLowerCase()
    const source = {
      dbPath,
      label: label(dbPath),
      active: canonical(dbPath) === input.activePath,
    }
    const rows = search
      ? (db
          .query(
            `select session.*, project.id as project_id_join, project.name as project_name, project.worktree as project_worktree
             from session
             left join project on project.id = session.project_id
             where session.time_archived is null
             and (lower(session.title) like ?1 or lower(session.id) like ?1 or lower(session.directory) like ?1)
             order by session.time_updated desc
             limit ?2`,
          )
          .all(`%${search}%`, input.limit) as Row[])
      : (db
          .query(
            `select session.*, project.id as project_id_join, project.name as project_name, project.worktree as project_worktree
             from session
             left join project on project.id = session.project_id
             where session.time_archived is null
             order by session.time_updated desc
             limit ?1`,
          )
          .all(input.limit) as Row[])
    return rows.map((row) => fromRow(row, source))
  } finally {
    db.close()
  }
}

export async function list(input: { search?: string; limit?: number } = {}) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  const activePath = canonical(Database.getPath())
  const sessions = candidatePaths().flatMap((dbPath) => {
    try {
      return listDb(dbPath, { search: input.search, limit, activePath })
    } catch {
      return []
    }
  })
  return sessions.toSorted((a, b) => b.time.updated - a.time.updated).slice(0, limit)
}

export async function importSession(input: typeof ImportInput.Type) {
  const activePath = canonical(Database.getPath())
  const sourcePath = candidatePaths().find((dbPath) => canonical(dbPath) === canonical(input.sourceDbPath))
  if (!sourcePath) throw new Error("Source database is not registered")
  if (canonical(sourcePath) === activePath) return { sessionID: input.sessionID, imported: false }
  const target = Database.Client().$client
  if (target.query("select id from session where id = ?1").get(input.sessionID)) return { sessionID: input.sessionID, imported: false }
  const source = new SQLiteDatabase(sourcePath, { readonly: true, strict: true })
  try {
    const sourceTables = new Set((source.query("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((row) => row.name))
    const targetTables = new Set((target.query("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((row) => row.name))
    if (!sourceTables.has("session") || !targetTables.has("session")) throw new Error("Session table is missing")
    const session = source.query("select id, project_id from session where id = ?1").get(input.sessionID) as { id: string; project_id: string } | null
    if (!session) throw new Error("Session not found in source database")
    ;["message", "part", "session_message"].forEach((table) =>
      assertNoConflicts({ source, target, table, where: "session_id", value: input.sessionID, sourceTables, targetTables }),
    )
    target.transaction(() => {
      if (sourceTables.has("project") && targetTables.has("project") && !target.query("select id from project where id = ?1").get(session.project_id)) {
        copyRows({ source, target, table: "project", where: "id", value: session.project_id, sourceTables, targetTables })
      }
      copyRows({ source, target, table: "session", where: "id", value: input.sessionID, sourceTables, targetTables })
      ;["message", "part", "todo", "session_message"].forEach((table) =>
        copyRows({ source, target, table, where: "session_id", value: input.sessionID, sourceTables, targetTables }),
      )
    })()
    return { sessionID: input.sessionID, imported: true }
  } finally {
    source.close()
  }
}

export * as SessionAllDbs from "./session-all-dbs"
