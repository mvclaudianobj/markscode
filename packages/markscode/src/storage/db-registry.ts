import { Database as SQLiteDatabase } from "bun:sqlite"
import { Global } from "@opencode-ai/core/global"
import { MarkscodePath } from "@/markscode-path"
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from "fs"
import os from "os"
import path from "path"

export type DatabaseStatus = "ok" | "invalid-sqlite" | "unsupported-schema" | "permission-denied" | "missing" | "error"

export type DatabaseInfo = {
  path: string
  realpath: string
  label: string
  status: DatabaseStatus
  reason?: string
  size?: number
  mtime?: string
  summary: {
    sessions?: number
    projects?: number
    accounts?: number
    latestSession?: {
      id: string
      title: string
      updated: number
    }
  }
}

export type IgnoredInfo = {
  path: string
  reason: string
}

export type Registry = {
  version: 1
  generatedAt: string
  roots: string[]
  databases: DatabaseInfo[]
  ignored: IgnoredInfo[]
}

const DB_PATTERN = /^(?:opencode|markscode)(?:-.+)?\.db$/
const SIDECAR_PATTERN = /\.db-(?:wal|shm)$/

export const registryPath = () => path.join(Global.Path.state, "db-registry.json")

export function normalizePath(candidate: string | undefined) {
  if (!candidate || candidate === ":memory:") return
  const expanded = candidate.startsWith("~/") ? path.join(os.homedir(), candidate.slice(2)) : candidate
  return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(MarkscodePath.dataDir(), expanded))
}

export function canonical(candidate: string) {
  return existsSync(candidate) ? realpathSync(candidate) : path.resolve(candidate)
}

function uniq(items: (string | undefined)[]) {
  return items.filter((item): item is string => !!item).filter((item, index, arr) => arr.indexOf(item) === index)
}

function children(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function userDirs(root: string) {
  return children(root)
    .filter((entry) => entry.isDirectory())
    .slice(0, 80)
    .map((entry) => path.join(root, entry.name))
}

function envDirs() {
  return [process.env.LOCALAPPDATA, process.env.APPDATA, process.env.USERPROFILE]
}

function candidateRoots(input: { currentPath?: string } = {}) {
  const home = os.homedir()
  return uniq([
    MarkscodePath.dataDir(),
    input.currentPath ? path.dirname(input.currentPath) : undefined,
    normalizePath(process.env.MARKSCODE_DB) ? path.dirname(normalizePath(process.env.MARKSCODE_DB)!) : undefined,
    normalizePath(process.env.OPENCODE_DB) ? path.dirname(normalizePath(process.env.OPENCODE_DB)!) : undefined,
    path.join(home, ".local/share/markscode"),
    path.join(home, ".local/share/opencode"),
    path.join(home, ".config/markscode"),
    path.join(home, ".config/opencode"),
    "/root/.local/share/markscode",
    "/root/.local/share/opencode",
    "/root/.config/markscode",
    "/root/.config/opencode",
    ...userDirs("/home").flatMap((dir) => [
      path.join(dir, ".local/share/markscode"),
      path.join(dir, ".local/share/opencode"),
      path.join(dir, ".config/markscode"),
      path.join(dir, ".config/opencode"),
    ]),
    path.join(home, "Library/Application Support/markscode"),
    path.join(home, "Library/Application Support/opencode"),
    ...userDirs("/Users").flatMap((dir) => [
      path.join(dir, "Library/Application Support/markscode"),
      path.join(dir, "Library/Application Support/opencode"),
    ]),
    ...envDirs().flatMap((dir) => (dir ? [path.join(dir, "markscode"), path.join(dir, "opencode")] : [])),
    ...userDirs("/mnt/c/Users").flatMap((dir) => [
      path.join(dir, "AppData/Local/markscode"),
      path.join(dir, "AppData/Local/opencode"),
      path.join(dir, "AppData/Roaming/markscode"),
      path.join(dir, "AppData/Roaming/opencode"),
    ]),
    "/var/lib/markscode",
    "/var/lib/opencode",
    "/usr/local/share/markscode",
    "/usr/local/share/opencode",
    "/opt/markscode",
    "/opt/opencode",
  ]).filter((dir) => existsSync(dir))
}

function isDbCandidate(file: string, targeted: boolean) {
  if (SIDECAR_PATTERN.test(file)) return false
  if (!file.endsWith(".db")) return false
  if (DB_PATTERN.test(path.basename(file))) return true
  return targeted
}

function discoverFiles(roots: string[]) {
  const ignored: IgnoredInfo[] = []
  const files = roots.flatMap((root) => {
    const appDir = /(?:^|[/\\])(?:opencode|markscode)$/.test(root)
    return children(root)
      .slice(0, 400)
      .flatMap((entry) => {
        const file = path.join(root, entry.name)
        if (!entry.isFile()) {
          if (entry.name.endsWith(".db")) ignored.push({ path: file, reason: "not-regular-file" })
          return []
        }
        if (!isDbCandidate(file, appDir)) {
          if (entry.name.endsWith(".db") || SIDECAR_PATTERN.test(entry.name)) ignored.push({ path: file, reason: "pattern" })
          return []
        }
        return [file]
      })
  })
  return { files, ignored }
}

function scalar(db: SQLiteDatabase, sql: string) {
  const row = db.query(sql).get() as Record<string, unknown> | null
  return typeof row?.value === "number" ? row.value : undefined
}

function validate(file: string): DatabaseInfo {
  const real = canonical(file)
  const stat = existsSync(file) ? statSync(file) : undefined
  const base = path.basename(file, ".db")
  const label = base === "opencode" || base === "markscode" ? "default" : base.replace(/^(?:opencode|markscode)-/, "")
  if (!stat) return { path: file, realpath: real, label, status: "missing", summary: {} }
  try {
    const db = new SQLiteDatabase(file, { readonly: true, strict: true })
    try {
      const tables = new Set(
        (
          db
            .query("select name from sqlite_master where type = 'table'")
            .all() as { name: string }[]
        ).map((row) => row.name),
      )
      const supported = tables.has("session") || tables.has("project") || tables.has("account") || tables.has("account_state")
      const latest = tables.has("session")
        ? (db
            .query("select id, title, time_updated as updated from session order by time_updated desc limit 1")
            .get() as { id: string; title: string; updated: number } | null)
        : undefined
      return {
        path: file,
        realpath: real,
        label,
        status: supported ? "ok" : "unsupported-schema",
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        summary: {
          sessions: tables.has("session") ? scalar(db, "select count(*) as value from session") : undefined,
          projects: tables.has("project") ? scalar(db, "select count(*) as value from project") : undefined,
          accounts: tables.has("account") ? scalar(db, "select count(*) as value from account") : undefined,
          latestSession: latest ?? undefined,
        },
      }
    } finally {
      db.close()
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      path: file,
      realpath: real,
      label,
      status: /permission|access|denied/i.test(reason) ? "permission-denied" : /sqlite|database/i.test(reason) ? "invalid-sqlite" : "error",
      reason,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      summary: {},
    }
  }
}

export function scan(input: { currentPath?: string; persist?: boolean } = {}): Registry {
  const roots = candidateRoots(input)
  const discovered = discoverFiles(roots)
  const explicit = [normalizePath(input.currentPath), normalizePath(process.env.OPENCODE_DB), normalizePath(process.env.MARKSCODE_DB)]
    .filter((item): item is string => !!item && item !== ":memory:")
    .filter((item) => existsSync(item))
  const databases = uniq([...explicit, ...discovered.files])
    .filter((item, index, arr) => arr.findIndex((other) => canonical(other) === canonical(item)) === index)
    .map(validate)
    .toSorted((a, b) => (b.summary.latestSession?.updated ?? 0) - (a.summary.latestSession?.updated ?? 0) || a.path.localeCompare(b.path))
  const registry: Registry = {
    version: 1,
    generatedAt: new Date().toISOString(),
    roots,
    databases,
    ignored: discovered.ignored,
  }
  if (input.persist ?? true) persist(registry)
  return registry
}

export function persist(registry: Registry) {
  mkdirSync(path.dirname(registryPath()), { recursive: true })
  writeFileSync(registryPath(), JSON.stringify(registry, null, 2) + "\n")
}

export function createPath(name: string) {
  const safe = name
    .trim()
    .toLowerCase()
    .replace(/\.db$/i, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
  const finalName = safe || `novo-${Date.now()}`
  mkdirSync(MarkscodePath.dataDir(), { recursive: true })
  return path.join(MarkscodePath.dataDir(), `markscode-${finalName}.db`)
}

export * as DbRegistry from "./db-registry"
