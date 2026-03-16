import { Global } from "./global"
import { Filesystem } from "./util/filesystem"

type AccessCache = {
  username: string
  expires_at: string
  last_login_at: string
  memories_api_key?: string
}

type AccessResult = {
  allowed: boolean
  reason?: string
  expires_at?: string
  username?: string
}

export namespace Access {
  function now() {
    return Date.now()
  }

  function expiry(input: string) {
    const text = input.trim()
    if (!text) return 0
    const iso = text.includes("T") ? text : `${text}T00:00:00Z`
    const n = Date.parse(iso)
    return Number.isFinite(n) ? n : 0
  }

  function day(input: string) {
    const n = Date.parse(input)
    if (!Number.isFinite(n)) return 0
    return n
  }

  function api() {
    return (process.env.MARKSCODE_ACCESS_API || "http://95.217.137.145:8789").replace(/\/$/, "")
  }

  function cachePath() {
    return `${Global.Path.config}/access.json`
  }

  async function readCache() {
    const file = cachePath()
    if (!(await Filesystem.exists(file))) return undefined
    return await Filesystem.readJson<AccessCache>(file).catch(() => undefined)
  }

  async function writeCache(data: AccessCache) {
    await Filesystem.writeJson(cachePath(), data, 0o600)
  }

  async function validate(username: string, password: string) {
    const url = `${api()}/auth`
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(7000),
    }).catch(() => undefined)
    if (!res) return { allowed: false, reason: "api_unreachable" } satisfies AccessResult
    const body = (await res.json().catch(() => ({}))) as AccessResult
    if (!res.ok) return { allowed: false, reason: body.reason || `http_${res.status}` }
    return body
  }

  export async function ensure(
    input: () => Promise<{ username: string; password: string; memories_api_key?: string } | undefined>,
  ) {
    if (process.env.MARKSCODE_ACCESS_BYPASS === "1") return

    const cache = await readCache()
    if (!process.env.MEMORIES_API_KEY && cache?.memories_api_key) {
      process.env.MEMORIES_API_KEY = cache.memories_api_key
    }

    if (cache) {
      const expiresAt = expiry(cache.expires_at)
      if (expiresAt <= now()) {
        throw new Error("Access denied: account expired. Renew your subscription.")
      }

      const lastLoginAt = day(cache.last_login_at)
      const oneDay = 24 * 60 * 60 * 1000
      if (lastLoginAt > 0 && now() - lastLoginAt < oneDay) return
    }

    const envUser = process.env.MARKSCODE_ACCESS_USERNAME || process.env.MARKSCODE_USERNAME
    const envPass = process.env.MARKSCODE_ACCESS_PASSWORD || process.env.MARKSCODE_PASSWORD

    const creds = envUser && envPass ? { username: envUser, password: envPass } : await input()
    if (!creds) throw new Error("Access denied: missing credentials")

    const memoriesApiKey =
      process.env.MEMORIES_API_KEY || creds.memories_api_key || cache?.memories_api_key || ""
    if (!memoriesApiKey.trim()) {
      throw new Error("Access denied: missing memories api key")
    }
    process.env.MEMORIES_API_KEY = memoriesApiKey.trim()

    const checked = await validate(creds.username, creds.password)
    if (!checked.allowed || !checked.expires_at) {
      throw new Error(`Access denied: ${checked.reason || "not_allowed"}`)
    }

    if (expiry(checked.expires_at) <= now()) {
      throw new Error("Access denied: account expired. Renew your subscription.")
    }

    await writeCache({
      username: checked.username || creds.username,
      expires_at: checked.expires_at,
      last_login_at: new Date().toISOString(),
      memories_api_key: process.env.MEMORIES_API_KEY,
    })
  }
}
