import { readdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { brainGraphIngest, type BrainIngestItem } from "./brain-client"
import { isBrainEnabled } from "./brain-config"

export type { BrainIngestItem }

export interface BrainIngestorInput {
  token: string
  user_id: string
  session_id?: string
  sources?: ("md" | "sessions" | "profile" | "graphfy" | "obsidian")[]
  dry_run?: boolean
}

export interface BrainIngestorResult {
  ok: boolean
  sources_collected: string[]
  total_items: number
  ingested?: number
  errors: string[]
}

const SECRET_PATTERN = /password|secret|token|key|api_key|bearer/i
const CHUNK_SIZE = 800
const MAX_ITEMS = 500

function chunkText(text: string): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = start + CHUNK_SIZE
    if (end >= text.length) {
      chunks.push(text.slice(start))
      break
    }
    const lastSpace = text.lastIndexOf(" ", end)
    const cutAt = lastSpace > start ? lastSpace : end
    chunks.push(text.slice(start, cutAt))
    start = cutAt + (lastSpace > start ? 1 : 0)
  }
  return chunks.filter((c) => c.trim().length > 0)
}

function dbPath(): string {
  const base = process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local/share")
  return join(base, "markscode/markscode.db")
}

async function collectMdItems(user_id: string, session_id?: string): Promise<BrainIngestItem[]> {
  const cwd = process.cwd()
  const targets = ["MEMORY.md", "Memory.md", "memory.md", "MEMORY_SNAPSHOT.md"]
  const items: BrainIngestItem[] = []

  for (const name of targets) {
    try {
      const content = await readFile(join(cwd, name), "utf8")
      for (const chunk of chunkText(content)) {
        items.push({ source: "md", content: chunk, title: name, user_id, session_id, type: "semantic", tags: ["md", name] })
      }
    } catch {
    }
  }

  try {
    const tasksDir = join(cwd, ".tasks")
    const taskFiles = await readdir(tasksDir)
    for (const file of taskFiles.filter((f) => f.endsWith(".md"))) {
      try {
        const content = await readFile(join(tasksDir, file), "utf8")
        for (const chunk of chunkText(content)) {
          items.push({ source: "md", content: chunk, title: file, user_id, session_id, type: "procedural", tags: ["md", "tasks"] })
        }
      } catch {
      }
    }
  } catch {
  }

  try {
    const entries = await readdir(cwd)
    for (const entry of entries.filter((f) => f.endsWith(".MD") && !targets.includes(f))) {
      try {
        const s = await stat(join(cwd, entry))
        if (!s.isFile()) continue
        const content = await readFile(join(cwd, entry), "utf8")
        for (const chunk of chunkText(content)) {
          items.push({ source: "md", content: chunk, title: entry, user_id, session_id, type: "semantic", tags: ["md"] })
        }
      } catch {
      }
    }
  } catch {
  }

  return items
}

function filterSecrets(content: string): string {
  return content
    .split("\n")
    .filter((line) => !SECRET_PATTERN.test(line))
    .join("\n")
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return ""
  }
}

function fieldText(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value == null) return ""
  return compactJson(value)
}

function textFromData(data: unknown, keys: string[]): string {
  if (!isRecord(data)) return typeof data === "string" ? data : ""
  return keys.map((key) => fieldText(data[key]).trim()).find(Boolean) ?? ""
}

function fallbackTextFromData(data: unknown): string {
  if (!isRecord(data)) return typeof data === "string" ? data : ""
  return compactJson(data)
}

function roleFromData(data: unknown): string {
  const role = isRecord(data) && typeof data.role === "string"
    ? data.role
    : isRecord(data) && isRecord(data.info) && typeof data.info.role === "string"
      ? data.info.role
      : "message"
  return role.trim().toLowerCase() || "message"
}

function collectPartText(db: Database, message_id: string): string {
  try {
    return db
      .query<{ data: string }, [string]>("SELECT data FROM part WHERE message_id = ? ORDER BY id")
      .all(message_id)
      .map((row) => textFromData(parseJson(row.data), ["text", "content", "message", "input", "output"]).trim())
      .filter(Boolean)
      .join("\n")
  } catch {
    return ""
  }
}

async function collectSessionItems(user_id: string, session_id?: string): Promise<BrainIngestItem[]> {
  const db = new Database(dbPath(), { readonly: true })
  try {
    const rows = db
      .query<{ id: string; session_id: string; time_created: number; data: string }, []>(
        "SELECT id, session_id, time_created, data FROM message ORDER BY time_created DESC LIMIT 100"
      )
      .all()

    return rows.flatMap((row) => {
      const data = parseJson(row.data)
      const role = roleFromData(data)
      const directContent = textFromData(data, ["content", "text", "message"]).trim()
      const content = directContent || collectPartText(db, row.id).trim() || fallbackTextFromData(data).trim()
      const filtered = filterSecrets(content).trim().slice(0, 4000)
      if (!filtered) return []
      return [
        {
          source: "sessions",
          content: filtered,
          user_id,
          session_id: row.session_id || session_id,
          type: "episodic" as const,
          tags: ["session", role],
          metadata: { message_id: row.id, role, created_at: row.time_created },
        },
      ]
    })
  } catch (err) {
    if (err instanceof Error && /no such (table|column)|SQLITE_ERROR/i.test(err.message)) return []
    throw err
  } finally {
    db.close()
  }
}

async function collectProfileItems(user_id: string, session_id?: string): Promise<BrainIngestItem[]> {
  const db = new Database(dbPath(), { readonly: true })
  try {
    const rows = db
      .query<{ id: string; name: string; host: string; user: string; protocol: string }, []>(
        "SELECT id, name, host, user, protocol FROM remote_profile"
      )
      .all()

    return rows.map((row) => ({
      source: "profile",
      content: `Remote: ${row.name} | ${row.protocol} ${row.user}@${row.host}`,
      title: row.name,
      user_id,
      session_id,
      type: "semantic" as const,
      tags: ["profile", "remote", row.protocol],
      metadata: { profile_id: row.id, host: row.host, protocol: row.protocol },
    }))
  } finally {
    db.close()
  }
}

async function collectGraphfyItems(user_id: string, session_id?: string): Promise<BrainIngestItem[]> {
  const graphPath = join(process.cwd(), "graphify-out/graph.json")
  const raw = await readFile(graphPath, "utf8")
  const parsed = JSON.parse(raw) as { nodes?: { id: string; label: string; type: string }[] }
  const nodes = parsed.nodes ?? []
  return nodes.map((node) => ({
    source: "graphfy",
    content: `${node.label} [${node.type}]`,
    title: node.label,
    user_id,
    session_id,
    type: "semantic" as const,
    tags: ["graphfy", node.type],
    metadata: { node_id: node.id, node_type: node.type },
  }))
}

async function collectObsidianItems(user_id: string, session_id?: string): Promise<BrainIngestItem[]> {
  const candidates = [
    process.env.MARKSCODE_OBSIDIAN_PATH?.trim() || "",
    join(homedir(), "Documents/Obsidian"),
    join(homedir(), "Obsidian"),
  ].filter(Boolean)

  let obsidianRoot: string | undefined
  for (const candidate of candidates) {
    try {
      const s = await stat(candidate)
      if (s.isDirectory()) {
        obsidianRoot = candidate
        break
      }
    } catch {
    }
  }

  if (!obsidianRoot) return []

  const items: BrainIngestItem[] = []
  const collected: string[] = []

  async function walk(dir: string) {
    if (collected.length >= 200) return
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (collected.length >= 200) break
      const full = join(dir, entry)
      try {
        const s = await stat(full)
        if (s.isDirectory()) {
          await walk(full)
        } else if (entry.endsWith(".md") && s.isFile()) {
          collected.push(full)
        }
      } catch {
      }
    }
  }

  await walk(obsidianRoot)

  for (const filePath of collected) {
    try {
      const content = await readFile(filePath, "utf8")
      const title = filePath.split("/").pop() ?? filePath
      for (const chunk of chunkText(content)) {
        items.push({ source: "obsidian", content: chunk, title, user_id, session_id, type: "semantic", tags: ["obsidian"] })
      }
    } catch {
    }
  }

  return items
}

export async function collectBrainItems(
  input: Pick<BrainIngestorInput, "user_id" | "session_id" | "sources">
): Promise<{ items: BrainIngestItem[]; errors: string[] }> {
  const sources = input.sources ?? ["md", "sessions", "profile", "graphfy", "obsidian"]
  const errors: string[] = []
  const allItems: BrainIngestItem[] = []

  const collectors: Array<[string, () => Promise<BrainIngestItem[]>]> = [
    ["md", () => collectMdItems(input.user_id, input.session_id)],
    ["sessions", () => collectSessionItems(input.user_id, input.session_id)],
    ["profile", () => collectProfileItems(input.user_id, input.session_id)],
    ["graphfy", () => collectGraphfyItems(input.user_id, input.session_id)],
    ["obsidian", () => collectObsidianItems(input.user_id, input.session_id)],
  ]

  const results = await Promise.allSettled(
    collectors
      .filter(([name]) => sources.includes(name as BrainIngestorInput["sources"] extends (infer U)[] | undefined ? U : never))
      .map(async ([name, fn]) => {
        try {
          return { name, items: await fn() }
        } catch (err) {
          errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
          return { name, items: [] as BrainIngestItem[] }
        }
      })
  )

  for (const result of results) {
    if (result.status === "fulfilled") allItems.push(...result.value.items)
  }

  if (allItems.length > MAX_ITEMS) {
    errors.push(`Truncated to ${MAX_ITEMS} items (collected ${allItems.length})`)
    return { items: allItems.slice(0, MAX_ITEMS), errors }
  }

  return { items: allItems, errors }
}

export async function runBrainIngestor(input: BrainIngestorInput): Promise<BrainIngestorResult> {
  if (!isBrainEnabled() && !input.dry_run) {
    return { ok: false, sources_collected: [], total_items: 0, errors: ["brain not configured"] }
  }

  const { items, errors } = await collectBrainItems({
    user_id: input.user_id,
    session_id: input.session_id,
    sources: input.sources,
  })

  const sources_collected = Array.from(new Set(items.map((i) => i.source)))

  if (input.dry_run) {
    return { ok: true, sources_collected, total_items: items.length, errors }
  }

  const result = await brainGraphIngest(input.token, items)

  return {
    ok: result.ok,
    sources_collected,
    total_items: items.length,
    ingested: result.ingested,
    errors: [...errors, ...(result.errors ?? []), ...(result.error ? [result.error] : [])],
  }
}
