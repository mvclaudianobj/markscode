export type BrainConfig = {
  enabled: boolean
  base_url: string
  graphfy_enabled?: boolean
  layer1?: string
  sources?: string[]
  endpoints?: string[]
}

let brainConfig: BrainConfig | undefined

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const stringValue = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

const boolValue = (value: unknown) => (typeof value === "boolean" ? value : undefined)

const stringArrayValue = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "")

function normalizeBaseUrl(base_url: string, origin?: string): string | undefined {
  try {
    if (base_url.startsWith("/")) {
      if (!origin) return undefined
      return trimTrailingSlash(new URL(base_url, origin).toString())
    }
    return trimTrailingSlash(new URL(base_url).toString())
  } catch {
    return undefined
  }
}

export function setBrainConfig(value: unknown, origin?: string): void {
  const config = asRecord(value)
  if (!config) {
    clearBrainConfig()
    return
  }

  const enabled = boolValue(config.enabled) ?? false
  const base_url = stringValue(config.base_url)

  if (!base_url) {
    clearBrainConfig()
    return
  }

  const normalizedBaseUrl = normalizeBaseUrl(base_url, origin)

  if (!normalizedBaseUrl) {
    clearBrainConfig()
    return
  }

  brainConfig = {
    enabled,
    base_url: normalizedBaseUrl,
    graphfy_enabled: boolValue(config.graphfy_enabled),
    layer1: stringValue(config.layer1),
    sources: stringArrayValue(config.sources),
    endpoints: stringArrayValue(config.endpoints),
  }
}

export function getBrainConfig(): BrainConfig | undefined {
  return brainConfig
}

export function clearBrainConfig(): void {
  brainConfig = undefined
}

export function isBrainEnabled(): boolean {
  return getBrainConfig()?.enabled === true
}

export function getBrainBaseUrl(): string | undefined {
  return getBrainConfig()?.base_url
}
