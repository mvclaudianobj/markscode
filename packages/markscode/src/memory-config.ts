const DEFAULT_MEMORIES_URL = "http://api.marks.ia.br:8689"
const DEFAULT_MEMORIES_USER_ID = "marks-local"

const firstNonEmpty = (...values: Array<string | undefined>) => values.find((value) => value?.trim())?.trim() || ""

type RemoteMemoryConfig = {
  url?: string
  api_key?: string
  user_id?: string
  timeout_ms?: number
  source?: string
}

let remoteMemoryConfig: RemoteMemoryConfig | undefined

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const stringValue = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

const timeoutValue = (value: unknown) => {
  const raw = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN
  if (!Number.isFinite(raw) || raw <= 0) return undefined
  return Math.floor(raw)
}

export function clearRemoteMemoryConfig() {
  remoteMemoryConfig = undefined
}

export function setRemoteMemoryConfig(value: unknown, source = "remote") {
  const config = asRecord(value)
  if (!config) {
    clearRemoteMemoryConfig()
    return
  }

  const next: RemoteMemoryConfig = {
    url: stringValue(config.url) || stringValue(config.base_url) || stringValue(config.api_url),
    api_key: stringValue(config.api_key) || stringValue(config.apiKey),
    user_id: stringValue(config.user_id) || stringValue(config.userId),
    timeout_ms: timeoutValue(config.timeout_ms) || timeoutValue(config.timeoutMs),
    source,
  }

  if (!next.url && !next.api_key && !next.user_id && !next.timeout_ms) {
    clearRemoteMemoryConfig()
    return
  }

  remoteMemoryConfig = next
}

export function resolveMemoryConfig() {
  const apiKey = firstNonEmpty(
    process.env.MARKSCODE_MEMORIES_API_KEY,
    process.env.MEMORIES_API_KEY,
    remoteMemoryConfig?.api_key,
  )
  const apiKeySource = process.env.MARKSCODE_MEMORIES_API_KEY?.trim()
    ? "MARKSCODE_MEMORIES_API_KEY"
    : process.env.MEMORIES_API_KEY?.trim()
      ? "MEMORIES_API_KEY"
      : remoteMemoryConfig?.api_key
        ? remoteMemoryConfig.source || "remote"
        : "none"
  const timeoutMs = remoteMemoryConfig?.timeout_ms

  return {
    memories: {
      url: firstNonEmpty(process.env.MARKSCODE_MEMORIES_URL, process.env.MEMORIES_URL, remoteMemoryConfig?.url) || DEFAULT_MEMORIES_URL,
      api_key: apiKey,
      api_key_source: apiKeySource,
      ...(timeoutMs ? { timeout_ms: timeoutMs } : {}),
    },
    user_id:
      firstNonEmpty(process.env.MARKSCODE_MEMORIES_USER_ID, process.env.MEMORIES_USER_ID, remoteMemoryConfig?.user_id) ||
      DEFAULT_MEMORIES_USER_ID,
  }
}

export function hasMemoriesAPIKey() {
  return Boolean(resolveMemoryConfig().memories.api_key)
}
