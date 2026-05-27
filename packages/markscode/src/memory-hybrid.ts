import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs"
import { homedir, tmpdir } from "os"
import { dirname, join } from "path"
import { importMemories, recallHumanMemories, type MemoryMode, type MemoryType } from "./memories-api"

export type MemoryProvider = "cloud" | "local" | "hybrid"

export interface HybridRecallInput {
  user_id?: string
  session_id?: string
  cue: string
  limit?: number
  max_chars?: number
  provider?: MemoryProvider
}

export interface HybridRecallItem {
  id?: string
  source: "cloud" | "local"
  content: string
  score?: number
  title?: string
  subject?: string
  tags?: string[]
}

export interface HybridRecallResult {
  memories: HybridRecallItem[]
  provider: MemoryProvider
  local_available: boolean
  cloud_available: boolean
  errors: string[]
}

export interface HybridSource {
  id: string
  name: string
  type: "cloud" | "local" | "file" | "directory" | "session" | "unknown"
  available: boolean
  path?: string
  count?: number
  reason?: string
}

export interface HybridSourcesResult {
  sources: HybridSource[]
  local_available: boolean
  cloud_available: boolean
  errors: string[]
}

export interface HybridIngestItem {
  source: string
  source_path?: string
  source_id?: string
  user_id: string
  session_id?: string
  type: "episodic" | "semantic" | "procedural"
  memory_mode: "short_term" | "long_term" | "visual"
  title?: string
  subject?: string
  content: string
  importance: number
  tags: string[]
  metadata?: Record<string, unknown>
}

export interface HybridIngestInput {
  user_id?: string
  session_id?: string
  source?: string
  path?: string
  source_name?: string
  subject?: string
  limit?: number
  write_cloud?: boolean
  write_memvid?: boolean
  dry_run?: boolean
}

export interface HybridIngestPreviewResult {
  source: string
  count: number
  items: HybridIngestItem[]
  warnings: string[]
}

export interface HybridIngestResult {
  source: string
  count: number
  imported_cloud?: unknown
  memvid?: unknown
  errors: string[]
  warnings: string[]
}

interface LocalMemoryStatus {
  available: boolean
  cli?: string
  dir?: string
  reason?: string
}

interface CommandResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number
}

interface MemvidWriteResult {
  available: boolean
  path: string
  method: string
  planned_count: number
  written: number
  item_count: number
  verified?: boolean
  searchable?: boolean
  export_path?: string
  reason?: string
  errors?: string[]
}

const PROVIDERS = new Set<MemoryProvider>(["cloud", "local", "hybrid"])
const INGEST_SOURCES = ["markscode-legacy-json", "marksclaw-sqlite", "marksclaw-markdown", "memories-api-sqlite", "markscode-session-db", "opencode-session-db"]
const REPO_ROOT = "/media/marcos/Arquivos/projetos/marks"
const PROVIDER_CONTEXT_CUE_TERMS = [
  "proxy claude",
  "claude proxy",
  "proxy local claude",
  "anthropic proxy",
  "local-proxy2",
  "codex claude",
  "codex-claude",
  "meridian",
  "18082",
]
const PROVIDER_CONTEXT_EXPANSION_TERMS = [
  "codex-claude",
  "ClaudeMaxPlugin",
  "Anthropic",
  "local-proxy2",
  "18082",
  "Meridian",
  "ANTHROPIC_PROXY_PORT",
  "CLAUDE_PROXY_PORT",
  "plugin.opencode",
  "runtime-host",
  "automator.sh",
  "markscode.json",
  "ecosystem/systems/codex-claude",
]

function saneLimit(value?: number) {
  const raw = Number.isFinite(value) ? Number(value) : Number(process.env.MARKSCODE_MEMORY_RECALL_LIMIT || 4)
  return Math.min(12, Math.max(1, Math.floor(raw || 4)))
}

function saneMaxChars(value?: number) {
  const raw = Number.isFinite(value) ? Number(value) : Number(process.env.MARKSCODE_MEMORY_MAX_CHARS || 1200)
  return Math.min(12000, Math.max(200, Math.floor(raw || 1200)))
}

function saneIngestLimit(value?: number) {
  if (!Number.isFinite(value)) return 100
  return Math.min(5000, Math.max(1, Math.floor(Number(value))))
}

function providerFrom(value?: string): MemoryProvider {
  const provider = String(value || process.env.MARKSCODE_MEMORY_PROVIDER || "hybrid").toLowerCase()
  return PROVIDERS.has(provider as MemoryProvider) ? (provider as MemoryProvider) : "hybrid"
}

function expandHybridMemoryCue(cue: string) {
  const normalized = cue.toLowerCase().replace(/[\s_]+/g, " ").trim()
  const hyphenNormalized = normalized.replace(/[\s_]+/g, "-")
  const shouldExpand = PROVIDER_CONTEXT_CUE_TERMS.some((term) => normalized.includes(term) || hyphenNormalized.includes(term))
  if (!shouldExpand) return cue
  return Array.from(new Set([cue.trim(), ...PROVIDER_CONTEXT_EXPANSION_TERMS].filter(Boolean))).join(" ")
}

function runCommand(args: string[]) {
  const result = runCommandDetailed(args)
  return result.ok ? result.stdout.trim() : undefined
}

function runCommandDetailed(args: string[]): CommandResult {
  try {
    const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" })
    return {
      ok: result.exitCode === 0,
      stdout: new TextDecoder().decode(result.stdout).trim(),
      stderr: new TextDecoder().decode(result.stderr).trim(),
      exitCode: result.exitCode ?? 1,
    }
  } catch (err) {
    return { ok: false, stdout: "", stderr: errorMessage(err), exitCode: 1 }
  }
}

function commandExists(name: string) {
  return runCommand(["bash", "-lc", "command -v " + JSON.stringify(name)])
}

function dataHome() {
  return process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local/share")
}

function defaultMemvidCapsulePath() {
  return process.env.MARKSCODE_MEMVID_CAPSULE?.trim() || join(dataHome(), "markscode/memory/hybrid.mv2")
}

function sqliteJSON(db: string, sql: string) {
  if (!commandExists("sqlite3") || !existsSync(db)) return undefined
  const result = runCommand(["sqlite3", "-readonly", "-json", db, sql])
  if (!result) return []
  try {
    const parsed = JSON.parse(result)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function detectLocalMemvid(): LocalMemoryStatus {
  const configuredCLI = process.env.MARKSCODE_MEMVID_CLI?.trim()
  if (configuredCLI) {
    return { available: true, cli: configuredCLI, reason: "MARKSCODE_MEMVID_CLI configured" }
  }

  const foundCLI = commandExists("memvid-cli") || commandExists("memvid")
  if (foundCLI) {
    return { available: true, cli: foundCLI, reason: "memvid CLI found in PATH" }
  }

  const dir = process.env.MEMVID_DIR?.trim() || join(REPO_ROOT, "ecosystem/systems/memvid")
  if (dir && existsSync(join(dir, "Cargo.toml"))) {
    return { available: true, dir, reason: "MEMVID_DIR contains Cargo.toml; CLI not installed" }
  }

  return { available: false, reason: "No MARKSCODE_MEMVID_CLI, memvid CLI, or MEMVID_DIR/Cargo.toml detected" }
}

function normalizeCloudResult(result: unknown): HybridRecallItem[] {
  if (!result || typeof result !== "object") return []
  const body = result as Record<string, unknown>

  if (Array.isArray(body.memories)) {
    const scores = Array.isArray(body.scores) ? body.scores : []
    return body.memories.flatMap((memory, index) => normalizeMemoryRecord(memory, numberOrUndefined(scores[index])))
  }

  if (Array.isArray(body.items)) {
    return body.items.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return []
      const row = entry as Record<string, unknown>
      return normalizeMemoryRecord(row.item ?? row, numberOrUndefined(row.score))
    })
  }

  return []
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function stringArrayOrUndefined(value: unknown) {
  if (!Array.isArray(value)) return undefined
  return value.map(String).filter(Boolean)
}

function normalizeMemoryRecord(memory: unknown, score?: number): HybridRecallItem[] {
  if (!memory || typeof memory !== "object") return []
  const row = memory as Record<string, unknown>
  const content = String(row.content || row.text || row.value || "").trim()
  if (!content) return []
  return [
    {
      id: row.id ? String(row.id) : undefined,
      source: "cloud" as const,
      content,
      score,
      title: row.title ? String(row.title) : undefined,
      subject: row.subject ? String(row.subject) : undefined,
      tags: stringArrayOrUndefined(row.tags),
    },
  ]
}

async function recallLocalMemvid(input: HybridRecallInput, status: LocalMemoryStatus) {
  void input
  if (!status.available) return []

  // v1 intentionally does not guess Memvid command semantics. It only reports
  // local availability and keeps recall fail-open until a stable CLI contract is installed.
  return [] as HybridRecallItem[]
}

function firstExisting(paths: string[]) {
  return paths.find((path) => path && existsSync(path))
}

function uniquePaths(paths: string[]) {
  return Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)))
}

function marksclawWorkspaces() {
  return uniquePaths([
    process.env.MARKSCLAW_WORKSPACE?.trim() || "",
    "/root/.marksclaw/workspace",
    "/root/.zeroclaw/workspace",
  ])
}

function legacyJSONCandidates(input?: HybridIngestInput) {
  return [
    input?.source === "markscode-legacy-json" && input.path ? input.path : "",
    join(process.cwd(), ".markscode/memories.json"),
    join(REPO_ROOT, ".markscode/memories.json"),
    join(REPO_ROOT, "markscode/.markscode/memories.json"),
  ].filter(Boolean)
}

function marksclawSQLiteCandidates(input?: HybridIngestInput) {
  return uniquePaths([
    input?.source === "marksclaw-sqlite" && input.path ? input.path : "",
    ...marksclawWorkspaces().map((base) => join(base, "memory/brain.db")),
  ])
}

function marksclawMarkdownCandidates(input?: HybridIngestInput) {
  const bases = marksclawWorkspaces()
  const explicit = input?.source === "marksclaw-markdown" && input.path ? [input.path] : []
  return uniquePaths([
    ...explicit,
    ...bases.flatMap((base) => [join(base, "MEMORY.md"), join(base, "MEMORY_SNAPSHOT.md")]),
    ...bases.flatMap((base) => safeReadDir(join(base, "memory")).filter((file) => file.endsWith(".md")).map((file) => join(base, "memory", file))),
  ]).filter((path) => !path.includes("/node_modules/") && !path.includes("/templates/"))
}

function memoriesAPISQLiteCandidates(input?: HybridIngestInput) {
  return [
    input?.source === "memories-api-sqlite" && input.path ? input.path : "",
    join(REPO_ROOT, "memories/memories.db"),
    join(REPO_ROOT, "ecosystem/systems/memories/memories.db"),
  ].filter(Boolean)
}

function xdgDataHomeCandidates() {
  return uniquePaths([
    process.env.XDG_DATA_HOME?.trim() || "",
    "/root/.local/share",
    "/home/marcos/.local/share",
  ])
}

function markscodeSessionDBCandidates(input?: HybridIngestInput) {
  return uniquePaths([
    input?.source === "markscode-session-db" && input.path ? input.path : "",
    process.env.MARKSCODE_DB?.trim() || "",
    ...xdgDataHomeCandidates().map((base) => join(base, "markscode/markscode.db")),
  ])
}

function opencodeSessionDBCandidates(input?: HybridIngestInput) {
  return uniquePaths([
    input?.source === "opencode-session-db" && input.path ? input.path : "",
    process.env.OPENCODE_DB?.trim() || "",
    ...xdgDataHomeCandidates().flatMap((base) => [join(base, "opencode/markscode.db"), join(base, "opencode/opencode.db")]),
  ])
}

function safeReadDir(path: string) {
  try {
    return existsSync(path) && statSync(path).isDirectory() ? readdirSync(path) : []
  } catch {
    return []
  }
}

function sourceItem(input: HybridIngestInput | undefined, source: string, path: string | undefined, available: boolean, reason?: string, count?: number): HybridSource {
  return { id: source, name: source, type: path ? "file" : "unknown", available, path, count, reason }
}

function sessionSourceItem(source: "markscode-session-db" | "opencode-session-db", input?: HybridIngestInput): HybridSource {
  const candidates = source === "markscode-session-db" ? markscodeSessionDBCandidates(input) : opencodeSessionDBCandidates(input)
  const existing = candidates.filter((path) => existsSync(path))
  const path = existing.find((candidate) => inspectSessionDB(candidate).available) || existing[0]
  if (!path) return sourceItem(input, source, undefined, false, "No local session sqlite DB found")
  if (!commandExists("sqlite3")) return sourceItem(input, source, path, false, "sqlite3 CLI not found")
  const inspection = inspectSessionDB(path)
  if (!inspection.available) return sourceItem(input, source, path, false, inspection.reason || "DB lacks session/message/part-like tables")
  return { id: source, name: source, type: "session", available: true, path, count: parseSessionDB(input || { source }, source).items.length }
}

async function inspectSource(source: string, input?: HybridIngestInput): Promise<HybridSource> {
  if (source === "markscode-legacy-json") {
    const path = firstExisting(legacyJSONCandidates(input))
    if (!path) return sourceItem(input, source, undefined, false, "No legacy .markscode/memories.json found")
    return sourceItem(input, source, path, true, undefined, parseLegacyJSON(input || { source }).items.length)
  }
  if (source === "marksclaw-sqlite") {
    const path = firstExisting(marksclawSQLiteCandidates(input))
    if (!path) return sourceItem(input, source, undefined, false, "Marksclaw brain.db not found")
    if (!commandExists("sqlite3")) return sourceItem(input, source, path, false, "sqlite3 CLI not found")
    return sourceItem(input, source, path, true, undefined, parseMarksclawSQLite(input || { source }).items.length)
  }
  if (source === "marksclaw-markdown") {
    const paths = marksclawMarkdownCandidates(input).filter((path) => existsSync(path))
    if (!paths.length) return sourceItem(input, source, undefined, false, "Marksclaw markdown memories not found")
    return { id: source, name: source, type: "directory", available: true, path: dirname(paths[0]), count: parseMarksclawMarkdown(input || { source }).items.length }
  }
  if (source === "memories-api-sqlite") {
    const path = firstExisting(memoriesAPISQLiteCandidates(input))
    if (!path) return sourceItem(input, source, undefined, false, "Memories API sqlite DB not found")
    if (!commandExists("sqlite3")) return sourceItem(input, source, path, false, "sqlite3 CLI not found")
    return sourceItem(input, source, path, true, undefined, parseMemoriesAPISQLite(input || { source }).items.length)
  }
  if (source === "markscode-session-db" || source === "opencode-session-db") return sessionSourceItem(source, input)
  return sourceItem(input, source, input?.path, false, "Unknown source")
}

function baseItem(input: HybridIngestInput, source: string, content: string, extra?: Partial<HybridIngestItem>): HybridIngestItem {
  return {
    source,
    user_id: input.user_id || process.env.MEMORIES_USER_ID || "marks-local",
    session_id: input.session_id,
    type: extra?.type || "semantic",
    memory_mode: extra?.memory_mode || "long_term",
    title: extra?.title,
    subject: extra?.subject || input.subject,
    content: content.trim(),
    importance: extra?.importance ?? 0.7,
    tags: Array.from(new Set([...(extra?.tags || []), source].filter(Boolean))),
    source_path: extra?.source_path,
    source_id: extra?.source_id,
    metadata: extra?.metadata,
  }
}

function parseLegacyJSON(input: HybridIngestInput): HybridIngestPreviewResult {
  const path = firstExisting(legacyJSONCandidates(input))
  const warnings: string[] = []
  if (!path) return { source: "markscode-legacy-json", count: 0, items: [], warnings: ["No legacy memories.json found"] }
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, Record<string, unknown>>
    const items = Object.entries(data).flatMap(([subject, value]) => {
      if (!value || typeof value !== "object") return []
      const words = Array.isArray(value.palavras) ? value.palavras.map(String).filter(Boolean) : []
      const advances = Array.isArray(value.avancos) ? value.avancos.map(String).filter(Boolean) : []
      const summary = String(value.resumo || "").trim()
      const content = [summary, advances.length ? "Avan\u00E7os: " + advances.join("; ") : "", words.length ? "Palavras: " + words.join(", ") : ""].filter(Boolean).join("\n")
      if (!content.trim()) return []
      return [baseItem(input, "markscode-legacy-json", content, { source_path: path, source_id: subject, subject, tags: words, metadata: { updated: value.updated, palavras: words, avancos: advances } })]
    })
    return limitedPreview("markscode-legacy-json", items, warnings, input.limit)
  } catch (err) {
    return { source: "markscode-legacy-json", count: 0, items: [], warnings: ["legacy json parse failed: " + errorMessage(err)] }
  }
}

function sqliteColumns(db: string, table: string) {
  return (sqliteJSON(db, "PRAGMA table_info(" + quoteIdent(table) + ");") || []).map((row) => String((row as Record<string, unknown>).name || "")).filter(Boolean)
}

function quoteIdent(value: string) {
  return '"' + value.replace(/"/g, '""') + '"'
}

function parseMarksclawSQLite(input: HybridIngestInput): HybridIngestPreviewResult {
  const path = firstExisting(marksclawSQLiteCandidates(input))
  if (!path) return { source: "marksclaw-sqlite", count: 0, items: [], warnings: ["Marksclaw brain.db not found"] }
  if (!commandExists("sqlite3")) return { source: "marksclaw-sqlite", count: 0, items: [], warnings: ["sqlite3 CLI not found"] }
  const columns = sqliteColumns(path, "memories")
  if (!columns.length) return { source: "marksclaw-sqlite", count: 0, items: [], warnings: ["memories table not found or empty schema"] }
  const where = columns.includes("superseded_by") ? " WHERE superseded_by IS NULL OR superseded_by = ''" : ""
  const rows = sqliteJSON(path, "SELECT * FROM memories" + where + " LIMIT " + saneIngestLimit(input.limit) + ";") || []
  const items = rows.flatMap((row) => {
    const data = row as Record<string, unknown>
    const content = String(data.content || data.value || data.text || data.summary || "").trim()
    if (!content) return []
    const category = String(data.category || "").toLowerCase()
    const type: MemoryType = category === "daily" || category === "conversation" ? "episodic" : "semantic"
    const memoryMode: MemoryMode = category === "daily" || category === "conversation" ? "short_term" : "long_term"
    return [baseItem(input, "marksclaw-sqlite", content, {
      source_path: path,
      source_id: String(data.key || data.id || ""),
      type,
      memory_mode: memoryMode,
      subject: String(data.namespace || data.subject || input.subject || "").trim() || undefined,
      tags: [String(data.category || "").trim(), String(data.namespace || "").trim()].filter(Boolean),
      metadata: { key: data.key, category: data.category, namespace: data.namespace },
    })]
  })
  return limitedPreview("marksclaw-sqlite", items, [], input.limit)
}

function parseMarksclawMarkdown(input: HybridIngestInput): HybridIngestPreviewResult {
  const paths = marksclawMarkdownCandidates(input).filter((path) => existsSync(path) && statSync(path).isFile())
  const items = paths.flatMap((path) => {
    const lines = readFileSync(path, "utf8").split(/\r?\n/)
    const parsed = lines.flatMap((line, index) => {
      const text = line.replace(/^[-*+]\s+/, "").trim()
      if (!text || text.startsWith("\x60\x60\x60") || /^<!--/.test(text)) return []
      if (/^#{1,6}\s+/.test(text)) {
        const heading = text.replace(/^#{1,6}\s+/, "").trim()
        return path.includes("SNAPSHOT") && heading ? [baseItem(input, "marksclaw-markdown", heading, { source_path: path, source_id: path + ":" + (index + 1), title: heading, tags: ["markdown", "snapshot-heading"] })] : []
      }
      if (/^#{1,6}\s*$/.test(text)) return []
      return [baseItem(input, "marksclaw-markdown", text, { source_path: path, source_id: path + ":" + (index + 1), tags: ["markdown"] })]
    })
    return parsed
  })
  return limitedPreview("marksclaw-markdown", items, paths.length ? [] : ["Marksclaw markdown memories not found"], input.limit)
}

function parseMemoriesAPISQLite(input: HybridIngestInput): HybridIngestPreviewResult {
  const path = firstExisting(memoriesAPISQLiteCandidates(input))
  if (!path) return { source: "memories-api-sqlite", count: 0, items: [], warnings: ["Memories API sqlite DB not found"] }
  if (!commandExists("sqlite3")) return { source: "memories-api-sqlite", count: 0, items: [], warnings: ["sqlite3 CLI not found"] }
  const tableRows = sqliteJSON(path, "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%memories%' ORDER BY name LIMIT 1;") || []
  const table = String((tableRows[0] as Record<string, unknown> | undefined)?.name || "memories")
  const rows = sqliteJSON(path, "SELECT * FROM " + quoteIdent(table) + " LIMIT " + saneIngestLimit(input.limit) + ";") || []
  const items = rows.flatMap((row) => {
    const data = row as Record<string, unknown>
    const content = String(data.content || data.text || data.value || data.summary || "").trim()
    if (!content) return []
    return [baseItem(input, "memories-api-sqlite", content, {
      source_path: path,
      source_id: String(data.id || data.memory_id || ""),
      type: (String(data.type || "semantic") as MemoryType) || "semantic",
      memory_mode: (String(data.memory_mode || "long_term") as MemoryMode) || "long_term",
      title: data.title ? String(data.title) : undefined,
      subject: data.subject ? String(data.subject) : input.subject,
      tags: Array.isArray(data.tags) ? data.tags.map(String) : String(data.tags || "").split(",").map((x) => x.trim()).filter(Boolean),
      importance: typeof data.importance === "number" ? data.importance : 0.7,
      metadata: { imported_from_table: table },
    })]
  })
  return limitedPreview("memories-api-sqlite", items, [], input.limit)
}

function sqliteTables(db: string) {
  return (sqliteJSON(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;") || [])
    .map((row) => String((row as Record<string, unknown>).name || ""))
    .filter(Boolean)
}

function inspectSessionDB(db: string) {
  if (!commandExists("sqlite3")) return { available: false, reason: "sqlite3 CLI not found", tables: [] as string[], sessionTables: [] as string[], messageTables: [] as string[], partTables: [] as string[] }
  if (!existsSync(db)) return { available: false, reason: "DB file not found", tables: [] as string[], sessionTables: [] as string[], messageTables: [] as string[], partTables: [] as string[] }
  const tables = sqliteTables(db)
  if (!tables.length) return { available: false, reason: "sqlite DB has no readable user tables", tables, sessionTables: [] as string[], messageTables: [] as string[], partTables: [] as string[] }
  const sessionTables = tables.filter((table) => /session/i.test(table))
  const messageTables = tables.filter((table) => /message/i.test(table))
  const partTables = tables.filter((table) => /part/i.test(table))
  const available = Boolean(sessionTables.length && (messageTables.length || partTables.length))
  return { available, reason: available ? undefined : "DB lacks session/message/part-like tables", tables, sessionTables, messageTables, partTables }
}

function bestColumn(columns: string[], names: string[]) {
  return names.find((name) => columns.includes(name))
}

function sqlValue(column?: string) {
  return column ? quoteIdent(column) : "NULL"
}

function compactSafeText(value: unknown) {
  const text = String(value || "").replace(/\u0000/g, " ").replace(/\s+/g, " ").trim()
  if (!text) return ""
  if (/BEGIN (RSA|OPENSSH|PRIVATE) KEY|AKIA[0-9A-Z]{16}|OPENAI_API_KEY|MEMORIES_API_KEY|Authorization: Bearer/i.test(text)) return ""
  if (/^\s*(diff --git|@@ |\+\+\+ |--- |\{[\s\S]*"env"\s*:)/i.test(text)) return ""
  if (/tool(_| )?(result|output)|stdout|stderr/i.test(text) && text.length > 800) return ""
  return text.length > 900 ? text.slice(0, 899).trimEnd() + "\u2026" : text
}

function parseSessionMetadataRows(input: HybridIngestInput, source: string, db: string, table: string, limit: number) {
  const columns = sqliteColumns(db, table)
  const idColumn = bestColumn(columns, ["id", "session_id", "uuid"])
  const titleColumn = bestColumn(columns, ["title", "name"])
  const summaryColumn = bestColumn(columns, ["summary", "description", "prompt", "cwd", "project"])
  if (!titleColumn && !summaryColumn) return [] as HybridIngestItem[]
  const rows = sqliteJSON(db, "SELECT " + sqlValue(idColumn) + " AS session_id, " + sqlValue(titleColumn) + " AS title, " + sqlValue(summaryColumn) + " AS summary FROM " + quoteIdent(table) + " LIMIT " + limit + ";") || []
  return rows.flatMap((row) => {
    const data = row as Record<string, unknown>
    const title = compactSafeText(data.title)
    const summary = compactSafeText(data.summary)
    const content = [title ? "Sess\u00E3o: " + title : "", summary].filter(Boolean).join("\n")
    if (!content) return []
    return [baseItem(input, source, content, {
      source_path: db,
      source_id: String(data.session_id || ""),
      type: "semantic",
      memory_mode: "long_term",
      title: title || undefined,
      tags: ["session-db", "session-metadata"],
      metadata: { db_path: db, session_id: data.session_id, table },
    })]
  })
}

function parseSessionMessageRows(input: HybridIngestInput, source: string, db: string, table: string, limit: number) {
  const columns = sqliteColumns(db, table)
  const idColumn = bestColumn(columns, ["id", "message_id", "uuid"])
  const sessionColumn = bestColumn(columns, ["session_id", "sessionID", "conversation_id", "thread_id"])
  const roleColumn = bestColumn(columns, ["role", "author", "speaker", "type"])
  const textColumn = bestColumn(columns, ["content", "text", "body", "message", "data"])
  const orderColumn = bestColumn(columns, ["created_at", "updated_at", "time", "timestamp", "id"])
  if (!textColumn) return [] as HybridIngestItem[]
  const where = roleColumn ? " WHERE lower(CAST(" + quoteIdent(roleColumn) + " AS TEXT)) IN ('user','human')" : ""
  const order = orderColumn ? " ORDER BY " + quoteIdent(orderColumn) + " DESC" : ""
  const rows = sqliteJSON(db, "SELECT " + sqlValue(idColumn) + " AS message_id, " + sqlValue(sessionColumn) + " AS session_id, " + sqlValue(roleColumn) + " AS role, " + quoteIdent(textColumn) + " AS content FROM " + quoteIdent(table) + where + order + " LIMIT " + limit + ";") || []
  return rows.flatMap((row) => {
    const data = row as Record<string, unknown>
    const content = compactSafeText(data.content)
    if (!content || content.length < 12) return []
    return [baseItem(input, source, content, {
      source_path: db,
      source_id: String(data.message_id || ""),
      type: "episodic",
      memory_mode: "short_term",
      tags: ["session-db", "recent-user-text"],
      metadata: { db_path: db, session_id: data.session_id, message_id: data.message_id, table },
    })]
  })
}

function parseSessionDB(input: HybridIngestInput, source: "markscode-session-db" | "opencode-session-db"): HybridIngestPreviewResult {
  const path = firstExisting(source === "markscode-session-db" ? markscodeSessionDBCandidates(input) : opencodeSessionDBCandidates(input))
  const warnings: string[] = []
  if (!path) return { source, count: 0, items: [], warnings: ["No local session sqlite DB found"] }
  if (!commandExists("sqlite3")) return { source, count: 0, items: [], warnings: ["sqlite3 CLI not found"] }
  const inspection = inspectSessionDB(path)
  if (!inspection.available) return { source, count: 0, items: [], warnings: [inspection.reason || "DB lacks session/message/part-like tables"] }
  const limit = saneIngestLimit(input.limit)
  const metadataItems = inspection.sessionTables.flatMap((table) => parseSessionMetadataRows(input, source, path, table, limit))
  const messageItems = [...inspection.messageTables, ...inspection.partTables].flatMap((table) => parseSessionMessageRows(input, source, path, table, limit))
  if (!metadataItems.length && !messageItems.length) warnings.push("No safe session metadata or recent user text extracted")
  return limitedPreview(source, [...metadataItems, ...messageItems], warnings, input.limit)
}

function limitedPreview(source: string, items: HybridIngestItem[], warnings: string[], limit?: number): HybridIngestPreviewResult {
  const max = saneIngestLimit(limit)
  return { source, count: items.length, items: items.slice(0, max), warnings }
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function parseSource(input: HybridIngestInput): HybridIngestPreviewResult {
  if (input.source === "markscode-legacy-json") return parseLegacyJSON(input)
  if (input.source === "marksclaw-sqlite") return parseMarksclawSQLite(input)
  if (input.source === "marksclaw-markdown") return parseMarksclawMarkdown(input)
  if (input.source === "memories-api-sqlite") return parseMemoriesAPISQLite(input)
  if (input.source === "markscode-session-db") return parseSessionDB(input, "markscode-session-db")
  if (input.source === "opencode-session-db") return parseSessionDB(input, "opencode-session-db")
  if (input.source === "all" || !input.source) return parseAll(input)
  return { source: input.source, count: 0, items: [], warnings: ["Unknown hybrid ingest source: " + input.source] }
}

function parseAll(input: HybridIngestInput): HybridIngestPreviewResult {
  const warnings: string[] = []
  const seen = new Set<string>()
  const items = INGEST_SOURCES.flatMap((source) => {
    const result = parseSource({ ...input, source })
    warnings.push(...result.warnings)
    return result.items
  }).filter((item) => {
    const key = item.source + "|" + (item.source_id || "") + "|" + simpleHash(item.content)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return limitedPreview("all", items, warnings, input.limit)
}

function simpleHash(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  return String(hash >>> 0)
}

export async function listHybridSources(): Promise<HybridSourcesResult> {
  const errors: string[] = []
  const sources = await Promise.all(INGEST_SOURCES.map((source) => inspectSource(source).catch((err) => {
    errors.push(source + ": " + errorMessage(err))
    return sourceItem(undefined, source, undefined, false, errorMessage(err))
  })))
  const local = detectLocalMemvid()
  return {
    sources,
    local_available: local.available || sources.some((source) => source.available && source.id !== "memories-api-sqlite"),
    cloud_available: Boolean(process.env.MEMORIES_API_KEY || process.env.MEMORIES_URL),
    errors,
  }
}

export async function previewHybridIngest(input: HybridIngestInput): Promise<HybridIngestPreviewResult> {
  return parseSource({ ...input, dry_run: true })
}

export async function ingestHybridMemories(input: HybridIngestInput): Promise<HybridIngestResult> {
  const preview = await previewHybridIngest(input)
  const errors: string[] = []
  const warnings = [...preview.warnings]

  if (!input.write_cloud && !input.write_memvid) {
    warnings.push("No writes requested; pass --write-cloud and/or --write-memvid to ingest")
    return { source: preview.source, count: preview.count, errors, warnings }
  }

  const importedCloud = input.write_cloud
    ? await importMemories({
        source: preview.source,
        source_name: input.source_name || input.source || preview.source,
        subject: input.subject,
        default_user_id: input.user_id || process.env.MEMORIES_USER_ID || "marks-local",
        default_session_id: input.session_id || "hybrid-ingest-" + Date.now(),
        items: preview.items.map((item) => ({
          content: item.content,
          type: item.type,
          memory_mode: item.memory_mode,
          importance: item.importance,
          tags: item.tags,
        })),
      }).catch((err) => {
        errors.push("cloud: " + errorMessage(err))
        return undefined
      })
    : undefined

  const memvid = input.write_memvid ? writeMemvidCapsule(preview.items, warnings, errors) : undefined
  return { source: preview.source, count: preview.count, imported_cloud: importedCloud, memvid, errors, warnings }
}

function writeMemvidCapsule(items: HybridIngestItem[], warnings: string[], errors: string[]): MemvidWriteResult {
  const local = detectLocalMemvid()
  const capsulePath = defaultMemvidCapsulePath()
  mkdirSync(dirname(capsulePath), { recursive: true })

  if (!items.length) {
    warnings.push("No hybrid ingest items available for Memvid write")
    return { available: local.available, path: capsulePath, method: "none", planned_count: 0, written: 0, item_count: 0, reason: "no items" }
  }

  if (!local.available) {
    warnings.push("Memvid unavailable; wrote deterministic JSONL export instead of .mv2 capsule")
    return exportMemvidJSONL(capsulePath, items, "memvid-unavailable", local.reason)
  }

  const cliResult = local.cli ? tryWriteMemvidWithCLI(local.cli, capsulePath, items) : undefined
  if (cliResult?.written) return cliResult
  if (cliResult) warnings.push("Memvid CLI write unavailable or unsupported: " + (cliResult.errors || []).join("; "))

  if (local.dir) {
    const helperResult = tryWriteMemvidWithRustHelper(local.dir, capsulePath, items)
    if (helperResult.written) return helperResult
    warnings.push("Memvid Rust helper failed; wrote deterministic JSONL export instead")
    errors.push(...(helperResult.errors || []).map((err) => "memvid: " + err))
    return exportMemvidJSONL(capsulePath, items, "rust-helper-failed", helperResult.reason)
  }

  warnings.push("Memvid CLI contract unsupported and no local Rust core detected; wrote deterministic JSONL export instead")
  return exportMemvidJSONL(capsulePath, items, "cli-unsupported", cliResult?.reason)
}

function writeMemvidInputJSON(path: string, items: HybridIngestItem[]) {
  writeFileSync(path, JSON.stringify(items.map((item, index) => ({
    content: item.content,
    title: item.title || item.subject || item.source_id || item.source,
    uri: "mv2://markscode/hybrid/" + item.source + "/" + encodeURIComponent(item.source_id || String(index + 1)),
    tags: item.tags,
    source: item.source,
    source_path: item.source_path,
    source_id: item.source_id,
    user_id: item.user_id,
    session_id: item.session_id,
    type: item.type,
    memory_mode: item.memory_mode,
    importance: item.importance,
  })), null, 2))
}

function tryWriteMemvidWithCLI(cli: string, capsulePath: string, items: HybridIngestItem[]): MemvidWriteResult | undefined {
  const help = runCommandDetailed([cli, "--help"])
  const helpText = (help.stdout + "\n" + help.stderr).toLowerCase()
  if (!help.ok) return { available: true, path: capsulePath, method: "cli", planned_count: items.length, written: 0, item_count: items.length, reason: "help failed", errors: [help.stderr || "CLI help failed"] }

  const tmp = mkdtempSync(join(tmpdir(), "markscode-memvid-cli-"))
  try {
    const inputPath = join(tmp, "items.json")
    writeMemvidInputJSON(inputPath, items)
    const candidates = [
      [cli, "ingest", "--input", inputPath, "--output", capsulePath],
      [cli, "build", "--input", inputPath, "--output", capsulePath],
      [cli, "create", capsulePath, "--input", inputPath],
    ]
    const viable = candidates.filter((args) => helpText.includes(args[1]))
    const attempts = (viable.length ? viable : []).map((args) => ({ args, result: runCommandDetailed(args) }))
    const success = attempts.find((attempt) => attempt.result.ok && existsSync(capsulePath))
    if (!success) return { available: true, path: capsulePath, method: "cli", planned_count: items.length, written: 0, item_count: items.length, reason: "unknown CLI contract", errors: attempts.map((attempt) => attempt.args.join(" ") + ": " + (attempt.result.stderr || attempt.result.stdout || "failed")) }
    return validateMemvidCapsule(capsulePath, "cli", items.length)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function tryWriteMemvidWithRustHelper(memvidDir: string, capsulePath: string, items: HybridIngestItem[]): MemvidWriteResult {
  const tmp = mkdtempSync(join(tmpdir(), "markscode-memvid-helper-"))
  try {
    const inputPath = join(tmp, "items.json")
    writeMemvidInputJSON(inputPath, items)
    writeFileSync(join(tmp, "Cargo.toml"), '[package]\nname = "markscode_memvid_ingest"\nversion = "0.1.0"\nedition = "2024"\n\n[dependencies]\nmemvid-core = { path = ' + JSON.stringify(memvidDir) + ' }\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\n')
    mkdirSync(join(tmp, "src"), { recursive: true })
    writeFileSync(join(tmp, "src/main.rs"), RUST_MEMVID_HELPER)
    const result = runCommandDetailed(["cargo", "run", "--quiet", "--manifest-path", join(tmp, "Cargo.toml"), "--", inputPath, capsulePath])
    if (!result.ok || !existsSync(capsulePath)) return { available: true, path: capsulePath, method: "rust-helper", planned_count: items.length, written: 0, item_count: items.length, reason: "cargo helper failed", errors: [result.stderr || result.stdout || "cargo helper failed"] }
    return validateMemvidCapsule(capsulePath, "rust-helper", items.length)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function validateMemvidCapsule(capsulePath: string, method: string, count: number): MemvidWriteResult {
  return { available: true, path: capsulePath, method, planned_count: count, written: count, item_count: count, verified: existsSync(capsulePath), searchable: existsSync(capsulePath) }
}

function exportMemvidJSONL(capsulePath: string, items: HybridIngestItem[], reason: string, detail?: string): MemvidWriteResult {
  const exportPath = capsulePath.replace(/\.mv2$/i, "") + ".jsonl"
  mkdirSync(dirname(exportPath), { recursive: true })
  writeFileSync(exportPath, items.map((item) => JSON.stringify(item)).join("\n") + "\n")
  return { available: false, path: capsulePath, method: "jsonl-export", planned_count: items.length, written: items.length, item_count: items.length, export_path: exportPath, reason: [reason, detail].filter(Boolean).join(": ") }
}

const RUST_MEMVID_HELPER = [
  "use std::{env, fs, path::PathBuf};",
  "",
  "use memvid_core::{Memvid, PutOptions, SearchRequest};",
  "use serde::Deserialize;",
  "",
  "#[derive(Deserialize)]",
  "struct Item {",
  "    content: String,",
  "    title: Option<String>,",
  "    uri: Option<String>,",
  "    tags: Vec<String>,",
  "    source: String,",
  "    source_id: Option<String>,",
  "    user_id: String,",
  "    session_id: Option<String>,",
  "    r#type: String,",
  "    memory_mode: String,",
  "}",
  "",
  "fn main() -> Result<(), Box<dyn std::error::Error>> {",
  "    let args: Vec<String> = env::args().collect();",
  "    if args.len() != 3 {",
  "        eprintln!(\"usage: markscode_memvid_ingest <items.json> <capsule.mv2>\");",
  "        std::process::exit(2);",
  "    }",
  "",
  "    let items: Vec<Item> = serde_json::from_str(&fs::read_to_string(&args[1])?)?;",
  "    let capsule = PathBuf::from(&args[2]);",
  "    if let Some(parent) = capsule.parent() {",
  "        fs::create_dir_all(parent)?;",
  "    }",
  "    let mut mem = if capsule.exists() { Memvid::open(&capsule)? } else { Memvid::create(&capsule)? };",
  "    for (index, item) in items.iter().enumerate() {",
  "        let mut options = PutOptions::builder()",
  "            .title(item.title.clone().unwrap_or_else(|| format!(\"{} #{}\", item.source, index + 1)))",
  "            .uri(item.uri.clone().unwrap_or_else(|| format!(\"mv2://markscode/hybrid/{}/{}\", item.source, index + 1)))",
  "            .tag(\"source\", item.source.clone())",
  "            .tag(\"user_id\", item.user_id.clone())",
  "            .tag(\"type\", item.r#type.clone())",
  "            .tag(\"memory_mode\", item.memory_mode.clone());",
  "        if let Some(source_id) = &item.source_id {",
  "            options = options.tag(\"source_id\", source_id.clone());",
  "        }",
  "        if let Some(session_id) = &item.session_id {",
  "            options = options.tag(\"session_id\", session_id.clone());",
  "        }",
  "        for tag in &item.tags {",
  "            if !tag.trim().is_empty() {",
  "                options = options.tag(\"tag\", tag.clone());",
  "            }",
  "        }",
  "        mem.put_bytes_with_options(item.content.as_bytes(), options.build())?;",
  "    }",
  "    mem.commit()?;",
  "    let stats = mem.stats()?;",
  "    let query = items.first().map(|item| item.content.split_whitespace().next().unwrap_or(\"memory\")).unwrap_or(\"memory\");",
  "    let response = mem.search(SearchRequest {",
  "        query: query.to_string(),",
  "        top_k: 3,",
  "        snippet_chars: 200,",
  "        uri: None,",
  "        scope: None,",
  "        cursor: None,",
  "        as_of_frame: None,",
  "        as_of_ts: None,",
  "        no_sketch: false,",
  "        acl_context: None,",
  "        acl_enforcement_mode: memvid_core::types::AclEnforcementMode::Audit,",
  "    })?;",
  "    drop(mem);",
  "    let report = Memvid::verify(&capsule, false)?;",
  "    println!(\"written={} frames={} hits={} status={:?}\", items.len(), stats.frame_count, response.total_hits, report.overall_status);",
  "    Ok(())",
  "}",
].join("\n")

export async function hybridMemoryStatus(): Promise<unknown> {
  const local = detectLocalMemvid()
  return {
    provider: providerFrom(),
    hybrid_prompt_enabled: /^(1|true|on)$/i.test(process.env.MARKSCODE_HYBRID_MEMORY || ""),
    local_available: local.available,
    local,
    cloud_available: Boolean(process.env.MEMORIES_API_KEY || process.env.MEMORIES_URL),
    cloud_url: process.env.MEMORIES_URL || "http://api.marks.ia.br:8689",
    defaults: {
      user_id: process.env.MEMORIES_USER_ID || "marks-local",
      limit: saneLimit(),
      max_chars: saneMaxChars(),
    },
  }
}

export async function doctorHybridMemory(): Promise<unknown> {
  const status = await hybridMemoryStatus() as Record<string, unknown>
  return {
    ...status,
    ok: Boolean(status.local_available || status.cloud_available),
    checks: [
      {
        name: "cloud-memories-api-env",
        ok: Boolean(status.cloud_available),
        message: status.cloud_available
          ? "Cloud Memories API appears configured"
          : "Set MEMORIES_API_KEY and optionally MEMORIES_URL for cloud recall",
      },
      {
        name: "local-memvid-detection",
        ok: Boolean(status.local_available),
        message: (status.local as LocalMemoryStatus | undefined)?.reason || "Memvid local status unknown",
      },
    ],
  }
}

export async function recallHybridMemories(input: HybridRecallInput): Promise<HybridRecallResult> {
  const provider = providerFrom(input.provider)
  const limit = saneLimit(input.limit)
  const userID = input.user_id || process.env.MEMORIES_USER_ID || "marks-local"
  const errors: string[] = []
  const local = detectLocalMemvid()
  const expandedCue = expandHybridMemoryCue(input.cue)
  const recallInput = expandedCue === input.cue ? input : { ...input, cue: expandedCue }

  const localMemories = provider !== "cloud"
    ? await recallLocalMemvid(recallInput, local).catch((err) => {
        errors.push("local: " + errorMessage(err))
        return [] as HybridRecallItem[]
      })
    : []

  const cloudMemories = provider !== "local"
      ? await recallHumanMemories({
          user_id: userID,
          session_id: input.session_id,
          cue: expandedCue,
          limit,
        })
        .then(normalizeCloudResult)
        .catch((err) => {
          errors.push("cloud: " + errorMessage(err))
          return [] as HybridRecallItem[]
        })
    : []

  const maxChars = saneMaxChars(input.max_chars)
  return {
    provider,
    local_available: local.available,
    cloud_available: provider === "local" ? false : !errors.some((x) => x.startsWith("cloud:")),
    errors,
    memories: [...localMemories, ...cloudMemories]
      .filter((memory) => memory.content.trim())
      .slice(0, limit)
      .map((memory) => ({
        ...memory,
        content: memory.content.length > maxChars ? memory.content.slice(0, maxChars - 1).trimEnd() + "\u2026" : memory.content,
      })),
  }
}

export function formatMemoryContext(result: HybridRecallResult, maxChars?: number): string | undefined {
  if (!result.memories.length) return undefined
  const budget = saneMaxChars(maxChars)
  const lines = [
    '<memory-context provider="' + result.provider + '">',
    ...result.memories.map((memory) => {
      const label = [memory.source, memory.title || memory.subject].filter(Boolean).join(":")
      return "- [" + label + "] " + memory.content.replace(/\s+/g, " ").trim()
    }),
    "</memory-context>",
  ]
  const text = lines.join("\n")
  return text.length > budget ? text.slice(0, budget - 1).trimEnd() + "\u2026\n</memory-context>" : text
}
