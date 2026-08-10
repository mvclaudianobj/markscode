import { existsSync, readFileSync } from "fs"
import { spawnSync } from "child_process"

const DEFAULT_CONFIG_SOURCE_PATH = "/etc/marks/config/modules.json"
const DEFAULT_MARKS_AGENT_ENV_FILE = "/etc/marks/agent/agent.env"

type Configurator = {
  env?: Record<string, unknown>
  secret_refs?: Record<string, unknown>
}

let cachedPath: string | undefined
let cachedConfigurator: Configurator | undefined
const cachedSecrets = new Map<string, string | undefined>()

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

function resolveMaterializedSecret(value: unknown) {
  const ref = asRecord(value)
  return stringValue(ref?.value) || stringValue(ref?.secret) || stringValue(ref?.api_key) || stringValue(ref?.token)
}

function marksAgentSecretResolverBins() {
  return Array.from(
    new Set(
      [process.env.MARKSCODE_MARKS_AGENT_BIN?.trim() || process.env.MARKS_AGENT_BIN?.trim(), "/usr/local/bin/marks_agent", "marks_agent", "marks-agent"].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  )
}

function marksAgentEnvFilePath() {
  return (
    process.env.MARKSCODE_MARKS_AGENT_ENV_FILE?.trim() || process.env.MARKS_AGENT_ENV_FILE?.trim() || DEFAULT_MARKS_AGENT_ENV_FILE
  )
}

function parseMarksAgentEnvFile() {
  const sourcePath = marksAgentEnvFilePath()
  if (!existsSync(sourcePath)) return {}
  try {
    return Object.fromEntries(
      readFileSync(sourcePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=")
          const value = line.slice(index + 1).trim()
          return [
            line.slice(0, index).trim(),
            ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
              ? value.slice(1, -1)
              : value,
          ]
        })
        .filter(([key]) => key),
    )
  } catch {
    return {}
  }
}

function marksAgentResolveEnv() {
  return { ...parseMarksAgentEnvFile(), ...process.env }
}

function resolveSecretFromMarksAgent(key: string) {
  if (process.env.MARKSCODE_AGENT_SECRET_RESOLVE === "0") return undefined
  if (cachedSecrets.has(key)) return cachedSecrets.get(key)
  const env = marksAgentResolveEnv()
  const nodeID = env.NODE_ID || env.MARKS_AGENT_NODE_ID
  const nodeArg = nodeID ? ["--node-id", nodeID] : []
  const result = marksAgentSecretResolverBins().reduce<{ stdout: string } | undefined>((resolved, bin) => {
    if (resolved) return resolved
    const result = spawnSync(bin, [...nodeArg, "--resolve-secret", key], { encoding: "utf8", env, timeout: 5000, windowsHide: true })
    return !result.error && result.status === 0 && result.stdout.trim() ? result : undefined
  }, undefined)
  const value = parseResolvedSecret(key, result?.stdout)
  cachedSecrets.set(key, value)
  return value
}

function parseResolvedSecret(key: string, output: string | undefined) {
  try {
    return stringValue(asRecord(asRecord(JSON.parse(output || "{}"))?.secrets)?.[key])
  } catch {
    return undefined
  }
}

export function clearMarksAgentConfigSourceCache() {
  cachedPath = undefined
  cachedConfigurator = undefined
  cachedSecrets.clear()
}

export function getMarksAgentConfigValue(key: string) {
  return stringValue(asRecord(readConfigurator()?.env)?.[key])
}

export function getMarksAgentSecretValue(key: string) {
  const ref = asRecord(readConfigurator()?.secret_refs)?.[key]
  const envRef = resolveSecretRef(ref)
  return envRef
    ? stringValue(process.env[envRef]) || resolveMaterializedSecret(ref) || resolveSecretFromMarksAgent(key)
    : resolveMaterializedSecret(ref) || (asRecord(ref)?.present === true ? resolveSecretFromMarksAgent(key) : undefined)
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
