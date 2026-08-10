import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { clearRemoteMemoryConfig, setRemoteMemoryConfig } from "../src/memory-config"
import { ensureHumanMemoryLayers, getHumanContext, recallHumanMemories, saveHumanMemory, setActiveOrgLeaseHeadersForTest } from "../src/memories-api"
import { clearMarksAgentConfigSourceCache } from "../src/marks-agent-config-source"

const originalFetch = globalThis.fetch
const restoreActiveOrgLeaseHeaders: Array<() => void> = []
const originalEnv = Object.fromEntries(
  [
    "MARKSCODE_AGENT_CONFIG_SOURCE_PATH",
    "MARKS_AGENT_CONFIG_SOURCE_PATH",
    "MARKSCODE_MARKS_AGENT_ENV_FILE",
    "MARKS_AGENT_ENV_FILE",
    "MARKSCODE_AGENT_SECRET_RESOLVE",
    "MARKSCODE_MEMORIES_URL",
    "MEMORIES_URL",
    "MARKSCODE_MEMORIES_API_KEY",
    "MEMORIES_API_KEY",
    "MARKSCODE_MAP_API_KEY",
    "MAP_API_KEY",
    "MARKS_API_KEY",
    "MARKSCODE_TTS_G4F_SPACE_TOKEN",
    "MARKS_G4F_SPACE_TOKEN",
  ].map((key) => [key, process.env[key]]),
)

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

beforeEach(() => {
  for (const key of Object.keys(originalEnv)) delete process.env[key]
  process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH = "/tmp/markscode/marks-agent-config-source-test-missing.json"
  process.env.MARKSCODE_AGENT_SECRET_RESOLVE = "0"
  clearMarksAgentConfigSourceCache()
  clearRemoteMemoryConfig()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  restoreActiveOrgLeaseHeaders.splice(0).forEach((restore) => restore())
  clearRemoteMemoryConfig()
  restoreEnv()
  clearMarksAgentConfigSourceCache()
})

function jsonResponse(value: unknown) {
  return Promise.resolve(new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } }))
}

describe("memories api", () => {
  test("ensures memory layers without creating bootstrap placeholders", async () => {
    process.env.MARKSCODE_MEMORIES_URL = "http://memories.test"
    process.env.MARKSCODE_MEMORIES_API_KEY = "test-key"
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = []
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return jsonResponse({ ok: true })
    }) as unknown as typeof fetch

    const result = await ensureHumanMemoryLayers({ user_id: "u1", session_id: "s1" })
    const cached = await ensureHumanMemoryLayers({ user_id: "u1", session_id: "s1" })

    expect(result.ok).toBe(true)
    expect(result.created).toEqual([])
    expect(result.existing).toEqual(["short_term", "long_term", "visual"])
    expect(cached).toBe(result)
    expect(calls).toHaveLength(0)
  })

  test("skips bootstrap creation when context has existing layers", async () => {
    process.env.MARKSCODE_MEMORIES_URL = "http://memories.test"
    process.env.MARKSCODE_MEMORIES_API_KEY = "test-key"
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = []
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (String(url).includes("/memories/human/context")) {
        return jsonResponse({
          short_term: [{ id: "global-short", user_id: "u1", session_id: "other", type: "episodic", memory_mode: "short_term", content: "global", importance: 1, tags: [], created_at: "", updated_at: "" }],
          long_term: [{ id: "global-long", user_id: "u1", session_id: "other", type: "semantic", memory_mode: "long_term", content: "global", importance: 1, tags: [], created_at: "", updated_at: "" }],
          visual: [{ id: "global-visual", user_id: "u1", session_id: "other", type: "semantic", memory_mode: "visual", content: "global", importance: 1, tags: [], created_at: "", updated_at: "" }],
        })
      }
      return jsonResponse({ ok: true })
    }) as unknown as typeof fetch

    const result = await ensureHumanMemoryLayers({ user_id: "u1", session_id: "s-context" })

    expect(result.ok).toBe(true)
    expect(result.created).toEqual([])
    expect(result.existing).toEqual(["short_term", "long_term", "visual"])
    expect(calls).toHaveLength(0)
  })

  test("save sends OAuth identity to primary without layer bootstraps", async () => {
    process.env.MARKSCODE_MEMORIES_URL = "http://memories.test"
    process.env.MARKSCODE_MEMORIES_API_KEY = "test-key"
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = []
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return jsonResponse({ ok: true })
    }) as unknown as typeof fetch

    await saveHumanMemory({
      user_id: "account-1",
      session_id: "session-oauth",
      type: "episodic",
      memory_mode: "long_term",
      content: "conteúdo humano",
      identity: { provider: "markspanel-oauth", user_id: "account-1", customer_id: "account-1", org_id: "org-1", account_id: "account-1" },
      customer_id: "account-1",
      org_id: "org-1",
      metadata: { identity_provider: "markspanel-oauth", org_id: "org-1" },
    })

    const bodies = calls.filter((call) => call.url.endsWith("/memories/human")).map((call) => call.body)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]?.user_id).toBe("account-1")
    expect(bodies[0]?.memory_mode).toBe("long_term")
    expect(bodies[0]?.customer_id).toBe("account-1")
    expect(bodies[0]?.org_id).toBe("org-1")
    expect((bodies[0]?.identity as Record<string, unknown>)?.provider).toBe("markspanel-oauth")
    expect((bodies[0]?.metadata as Record<string, unknown>)?.identity_provider).toBe("markspanel-oauth")
  })

  test("save resolves api key after active org config load", async () => {
    process.env.MARKSCODE_MEMORIES_URL = "http://memories.test"
    const apiKeys: Array<string | null> = []
    restoreActiveOrgLeaseHeaders.push(
      setActiveOrgLeaseHeadersForTest(async () => {
        setRemoteMemoryConfig({ api_key: "remote-config-key" }, "active-config")
        return { Authorization: "Bearer oauth-token", "x-org-id": "org-1", "x-customer-id": "account-1" }
      }),
    )
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      apiKeys.push(new Headers(init?.headers).get("X-API-Key"))
      return jsonResponse({ ok: true })
    }) as unknown as typeof fetch

    await saveHumanMemory({ user_id: "account-1", session_id: "session-config", type: "episodic", memory_mode: "long_term", content: "conteúdo humano" })

    expect(apiKeys).toHaveLength(1)
    expect(apiKeys.every((apiKey) => apiKey === "remote-config-key")).toBe(true)
  })

  test("recall uses provided active identity user id", async () => {
    process.env.MARKSCODE_MEMORIES_URL = "http://memories.test"
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = []
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return jsonResponse({ memories: [], scores: [] })
    }) as unknown as typeof fetch

    await recallHumanMemories({ user_id: "account-1", session_id: "session-oauth", cue: "contexto necessário" })

    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ user_id: "account-1", session_id: "session-oauth", cue: "contexto necessário" })
    expect(calls[0].body?.user_id).not.toBe("marks-local")
  })

  test("recall prefers remote memories user id over OAuth account id", async () => {
    process.env.MARKSCODE_MEMORIES_URL = "http://memories.test"
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = []
    restoreActiveOrgLeaseHeaders.push(
      setActiveOrgLeaseHeadersForTest(async () => {
        setRemoteMemoryConfig({ api_key: "remote-config-key", user_id: "mvclaudiano" }, "active-config")
        return { Authorization: "Bearer oauth-token", "x-org-id": "org-1", "x-customer-id": "6" }
      }),
    )
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return jsonResponse({ memories: [], scores: [] })
    }) as unknown as typeof fetch

    await recallHumanMemories({ user_id: "6", session_id: "session-oauth", cue: "contexto necessário" })

    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ user_id: "mvclaudiano", session_id: "session-oauth", cue: "contexto necessário" })
    expect(calls[0].body?.user_id).not.toBe("6")
  })

  test("does not expose layer bootstrap markers in human context", async () => {
    process.env.MARKSCODE_MEMORIES_URL = "http://memories.test"
    const calls: Array<{ url: string; method?: string }> = []
    const context = {
      short_term: [
        { id: "marker", user_id: "u2", session_id: "s2", type: "episodic", memory_mode: "short_term", content: "bootstrap", importance: 0, tags: ["markscode-system-memory-layer"], created_at: "", updated_at: "" },
        { id: "real", user_id: "u2", session_id: "s2", type: "episodic", memory_mode: "short_term", content: "real", importance: 1, tags: [], created_at: "", updated_at: "" },
      ],
      long_term: [{ id: "long", user_id: "u2", session_id: "s2", type: "semantic", memory_mode: "long_term", content: "real", importance: 1, tags: [], created_at: "", updated_at: "" }],
      visual: [{ id: "visual", user_id: "u2", session_id: "s2", type: "semantic", memory_mode: "visual", content: "real", importance: 1, tags: [], created_at: "", updated_at: "" }],
    }
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method })
      return jsonResponse(context)
    }) as unknown as typeof fetch

    const result = await getHumanContext({ user_id: "u2", session_id: "s2" })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("http://memories.test/memories/human/context?user_id=u2&session_id=s2")
    expect(calls[0].method).toBeUndefined()
    expect(calls.some((call) => call.url.endsWith("/memories/human") || call.method === "POST")).toBe(false)
    expect(result.short_term.map((memory) => memory.id)).toEqual(["real"])
    expect(result.long_term).toHaveLength(1)
    expect(result.visual).toHaveLength(1)
  })

  test("returns success without network calls since bootstrap was removed", async () => {
    process.env.MARKSCODE_MEMORIES_URL = "http://memories.test"
    globalThis.fetch = mock(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch

    const result = await ensureHumanMemoryLayers({ user_id: "u3", session_id: "s3" })

    expect(result.ok).toBe(true)
    expect(result.created).toEqual([])
    expect(result.existing).toEqual(["short_term", "long_term", "visual"])
    expect(result.errors).toEqual([])
  })
})
