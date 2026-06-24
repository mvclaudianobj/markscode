import * as prompts from "@clack/prompts"
import { Global } from "@opencode-ai/core/global"
import { existsSync, mkdirSync } from "fs"
import path from "path"
import { DbRegistry } from "./db-registry"

type Selection = "default" | "create" | "custom" | "refresh" | string

function explicitDb() {
  const value = process.env.OPENCODE_DB?.trim()
  return value ? value : undefined
}

export function shouldPrompt() {
  if (explicitDb()) return false
  if (!process.stdin.isTTY || !process.stderr.isTTY) return false
  return true
}

function summary(db: DbRegistry.DatabaseInfo) {
  const pieces: string[] = [db.status]
  if (db.summary.sessions !== undefined) pieces.push(`${db.summary.sessions} sessões`)
  if (db.summary.accounts !== undefined) pieces.push(`${db.summary.accounts} contas`)
  if (db.summary.latestSession?.title) pieces.push(`última: ${db.summary.latestSession.title}`)
  return pieces.join(" • ")
}

async function askCreate() {
  const name = await prompts.text({
    message: "Nome do novo banco",
    placeholder: "cliente-a, testes, producao...",
    validate: (value) => (String(value).trim() ? undefined : "Informe um nome para o banco."),
  })
  if (prompts.isCancel(name)) return
  const target = DbRegistry.createPath(String(name))
  process.env.OPENCODE_DB = target
  return target
}

async function askCustom() {
  const value = await prompts.text({
    message: "Caminho do banco SQLite",
    placeholder: path.join(Global.Path.data, "markscode-custom.db"),
    validate: (item) => (String(item).trim() ? undefined : "Informe um caminho."),
  })
  if (prompts.isCancel(value)) return
  const target = DbRegistry.normalizePath(String(value).trim())
  if (!target) return
  mkdirSync(path.dirname(target), { recursive: true })
  process.env.OPENCODE_DB = target
  return target
}

export async function ensureSelected(input: { currentPath: string }) {
  if (explicitDb()) return { selected: explicitDb(), prompted: false }
  if (process.env.MARKSCODE_DB?.trim()) {
    process.env.OPENCODE_DB = process.env.MARKSCODE_DB.trim()
    return { selected: process.env.OPENCODE_DB, prompted: false }
  }
  let registry = DbRegistry.scan({ currentPath: input.currentPath, persist: true })
  const forced = process.env.MARKSCODE_DB_SELECTOR === "1" || process.env.MARKSCODE_DB_SELECT === "1"
  if (!shouldPrompt() || (!forced && registry.databases.filter((db) => db.status === "ok").length < 2)) {
    return { selected: input.currentPath, prompted: false }
  }

  prompts.intro("MarksCode multi banco")
  while (true) {
    const selected = await prompts.select<Selection>({
      message: "Selecione o banco antes do login Markspanel",
      options: [
        ...registry.databases.map((db) => ({
          value: db.path,
          label: `${db.label} — ${db.path}`,
          hint: summary(db),
        })),
        { value: "default", label: "Usar banco padrão atual", hint: input.currentPath },
        { value: "create", label: "Criar novo banco...", hint: path.join(Global.Path.data, "markscode-<nome>.db") },
        { value: "custom", label: "Informar caminho customizado..." },
        { value: "refresh", label: "Atualizar varredura" },
      ],
    })
    if (prompts.isCancel(selected)) {
      prompts.outro("Banco padrão mantido.")
      return { selected: input.currentPath, prompted: true }
    }
    if (selected === "refresh") {
      registry = DbRegistry.scan({ currentPath: input.currentPath, persist: true })
      prompts.log.success(`Registry atualizado em ${DbRegistry.registryPath()}`)
      continue
    }
    const target = selected === "create" ? await askCreate() : selected === "custom" ? await askCustom() : selected === "default" ? input.currentPath : selected
    if (!target) return { selected: input.currentPath, prompted: true }
    if (target !== input.currentPath) process.env.OPENCODE_DB = target
    if (target !== ":memory:" && !existsSync(path.dirname(target))) mkdirSync(path.dirname(target), { recursive: true })
    prompts.outro(`Banco ativo: ${target}`)
    return { selected: target, prompted: true }
  }
}

export * as DbSelector from "./db-selector"
