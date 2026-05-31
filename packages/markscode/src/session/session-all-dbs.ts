import { Database as SQLiteDatabase } from "bun:sqlite"
import { Global } from "@opencode-ai/core/global"
import { Database } from "@/storage/db"
import { Schema } from "effect"
import { existsSync, readdirSync, realpathSync } from "fs"
import path from "path"

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

function knownDataDirs() {
  return [Global.Path.data, "/root/.local/share/markscode", "/home/marcos/.local/share/markscode"].filter(
    (item, index, arr) => item && arr.indexOf(item) === index,
  )
}

function normalizeCandidate(candidate: string) {
  if (!candidate || candidate === ":memory:") return
  return path.isAbsolute(candidate) ? candidate : path.join(Global.Path.data, candidate)
}

function canonical(candidate: string) {
  return existsSync(candidate) ? realpathSync(candidate) : path.resolve(candidate)
}

function candidatePaths() {
  const fromDirs = knownDataDirs().flatMap((dir) => {
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^markscode(?:-.+)?\.db$/.test(entry.name))
      .map((entry) => path.join(dir, entry.name))
  })
  return [Database.getPath(), process.env.OPENCODE_DB, process.env.MARKSCODE_DB, ...fromDirs]
    .map((item) => normalizeCandidate(item ?? ""))
    .filter((item): item is string => !!item && existsSync(item))
    .filter((item, index, arr) => arr.findIndex((other) => canonical(other) === canonical(item)) === index)
}

function label(dbPath: string) {
  const base = path.basename(dbPath, ".db")
  if (base === "markscode") return "default"
  if (base.startsWith("markscode-")) return base.slice("markscode-".length)
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

export * as SessionAllDbs from "./session-all-dbs"
