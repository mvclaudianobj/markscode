import { existsSync, readFileSync } from "fs"

const DEFAULT_CONFIG_SOURCE_PATH = "/etc/marks/config/modules.json"

type Configurator = {
  env?: Record<string, unknown>
  secret_refs?: Record<string, unknown>
}

let cachedPath: string | undefined
let cachedConfigurator: Configurator | undefined

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const stringValue = (value: unknown) => {
  if (typeof value === "string") return value.trim() ? value.trim() : undefined
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "boolean") return String(value)
  return undefined
}

function configSourcePath() {
  return (
    process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH?.trim() ||
    process.env.MARKS_AGENT_CONFIG_SOURCE_PATH?.trim() ||
    DEFAULT_CONFIG_SOURCE_PATH
  )
}

function readConfigurator() {
  const sourcePath = configSourcePath()
  if (cachedPath === sourcePath) return cachedConfigurator
  cachedPath = sourcePath
  cachedConfigurator = undefined
  if (!existsSync(sourcePath)) return undefined
  try {
    cachedConfigurator = asRecord(
      asRecord(asRecord(JSON.parse(readFileSync(sourcePath, "utf8")))?.modules)?.markscode,
    )?.configurator as Configurator | undefined
    return cachedConfigurator
  } catch {
    return undefined
  }
}

function resolveSecretRef(value: unknown) {
  const ref = asRecord(value)
  return stringValue(ref?.env_ref) || stringValue(ref?.env) || stringValue(ref?.name) || stringValue(value)
}

export function clearMarksAgentConfigSourceCache() {
  cachedPath = undefined
  cachedConfigurator = undefined
}

export function getMarksAgentConfigValue(key: string) {
  return stringValue(asRecord(readConfigurator()?.env)?.[key])
}

export function getMarksAgentSecretValue(key: string) {
  const envRef = resolveSecretRef(asRecord(readConfigurator()?.secret_refs)?.[key])
  return envRef ? stringValue(process.env[envRef]) : undefined
}

export function getMarksAgentString(key: string) {
  return getMarksAgentConfigValue(key) || getMarksAgentSecretValue(key)
}

export function getMarksAgentNumber(key: string) {
  const raw = getMarksAgentString(key)
  const value = raw ? Number(raw) : Number.NaN
  return Number.isFinite(value) ? value : undefined
}

export function getMarksAgentBoolean(key: string) {
  const raw = getMarksAgentString(key)
  if (!raw) return undefined
  if (/^(1|true|on|yes)$/i.test(raw)) return true
  if (/^(0|false|off|no)$/i.test(raw)) return false
  return undefined
}
