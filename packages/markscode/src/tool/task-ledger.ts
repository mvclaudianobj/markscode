import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const MAX_PREVIEW_LENGTH = 4_000
const MAX_ERROR_LENGTH = 4_000
const REDACTED = "[REDACTED]"

export interface TaskLedgerInput {
  projectRoot?: string
  parentSessionId: string
  parentMessageId: string
  callId?: string
  childSessionId: string
  resumedTaskId?: string
  description: string
  subagentType: string
  command?: string
  background: boolean
  model?: {
    providerID?: string
    modelID?: string
  }
  prompt: string
}

export interface TaskLedgerHandle {
  filePath: string
  number: number
  entry: TaskLedgerEntry
}

interface TaskLedgerEntry {
  number: number
  status: "running" | "completed" | "error"
  created_at: string
  completed_at?: string
  parent_session_id: string
  parent_message_id: string
  call_id?: string
  child_session_id: string
  resumed_task_id?: string
  description: string
  subagent_type: string
  command?: string
  background: boolean
  model?: {
    provider?: string
    model?: string
  }
  prompt_preview: string
  prompt_length: number
  result_summary?: string
  result_length?: number
  error?: string
}

export function startTaskLedger(input: TaskLedgerInput): TaskLedgerHandle | undefined {
  const tasksDir = path.join(input.projectRoot ?? process.cwd(), ".tasks")
  fs.mkdirSync(tasksDir, { recursive: true })

  return allocateLedgerFile(tasksDir, slug(input.description), makeEntry(input))
}

export function completeTaskLedger(handle: TaskLedgerHandle | undefined, resultText: string) {
  if (!handle) return
  const entry = {
    ...handle.entry,
    status: "completed" as const,
    completed_at: new Date().toISOString(),
    result_summary: clip(redact(resultText), MAX_PREVIEW_LENGTH),
    result_length: resultText.length,
  }
  writeLedger(handle.filePath, entry)
  appendIndex(handle.filePath, entry)
}

export function errorTaskLedger(handle: TaskLedgerHandle | undefined, error: string) {
  if (!handle) return
  const entry = {
    ...handle.entry,
    status: "error" as const,
    completed_at: new Date().toISOString(),
    error: clip(redact(error), MAX_ERROR_LENGTH),
  }
  writeLedger(handle.filePath, entry)
  appendIndex(handle.filePath, entry)
}

function makeEntry(input: TaskLedgerInput): Omit<TaskLedgerEntry, "number"> {
  return {
    status: "running",
    created_at: new Date().toISOString(),
    parent_session_id: input.parentSessionId,
    parent_message_id: input.parentMessageId,
    ...(input.callId ? { call_id: input.callId } : {}),
    child_session_id: input.childSessionId,
    ...(input.resumedTaskId ? { resumed_task_id: input.resumedTaskId } : {}),
    description: input.description,
    subagent_type: input.subagentType,
    ...(input.command ? { command: redact(input.command) } : {}),
    background: input.background,
    ...(input.model
      ? {
          model: {
            provider: input.model.providerID,
            model: input.model.modelID,
          },
        }
      : {}),
    prompt_preview: clip(redact(input.prompt), MAX_PREVIEW_LENGTH),
    prompt_length: input.prompt.length,
  }
}

function allocateLedgerFile(tasksDir: string, name: string, entry: Omit<TaskLedgerEntry, "number">) {
  return Array.from({ length: 10_000 }, (_, index) => index + 1).reduce<TaskLedgerHandle | undefined>((allocated, number) => {
    if (allocated) return allocated
    const filePath = path.join(tasksDir, `${String(number).padStart(4, "0")}-${name}.json`)
    try {
      const fd = fs.openSync(filePath, "wx")
      const next = { number, ...entry }
      fs.writeFileSync(fd, JSON.stringify(next, undefined, 2) + "\n")
      fs.closeSync(fd)
      return { filePath, number, entry: next }
    } catch (error) {
      if (isFileExists(error)) return undefined
      throw error
    }
  }, undefined)
}

function writeLedger(filePath: string, entry: TaskLedgerEntry) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(entry, undefined, 2) + "\n")
  fs.renameSync(tmp, filePath)
}

function appendIndex(filePath: string, entry: TaskLedgerEntry) {
  fs.appendFileSync(
    path.join(path.dirname(filePath), "index.md"),
    [
      `- ${entry.completed_at ?? entry.created_at} #${String(entry.number).padStart(4, "0")} ${entry.status} ${entry.background ? "background" : "foreground"} ${entry.subagent_type}: ${entry.description}`,
      entry.result_summary ? `  - result: ${singleLine(entry.result_summary)}` : undefined,
      entry.error ? `  - error: ${singleLine(entry.error)}` : undefined,
      `  - file: ${path.basename(filePath)}`,
      "",
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n"),
  )
}

function redact(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) =>
      /(?:password|senha|api[_-]?key|token|secret)/i.test(line)
        ? line.replace(/(:|=)\s*[^\s,;]+/g, `$1 ${REDACTED}`)
        : line,
    )
    .join("\n")
}

function clip(text: string, max: number) {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n[truncated ${text.length - max} chars]`
}

function singleLine(text: string) {
  return clip(text.replace(/\s+/g, " ").trim(), 500)
}

function slug(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "task"
  )
}

function isFileExists(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST"
}
