import { afterEach, describe, expect, mock, test } from "bun:test"
import { clearRemoteMemoryConfig, setRemoteMemoryConfig } from "../src/memory-config"
import { ensureHumanMemoryLayers, getHumanContext, recallHumanMemories, saveHumanMemory, setActiveOrgLeaseHeadersForTest } from "../src/memories-api"

const originalFetch = globalThis.fetch
const restoreActiveOrgLeaseHeaders: Array<() => void> = []

afterEach(() => {
  globalThis.fetch = originalFetch
  restoreActiveOrgLeaseHeaders.splice(0).forEach((restore) => restore())
  clearRemoteMemoryConfig()
  delete process.env.MARKSCODE_MEMORIES_URL
  delete process.env.MARKSCODE_MEMORIES_API_KEY
})

function jsonResponse(value: unknown) {
  return Promise.resolve(new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } }))
}

describe("memories api", () => {
  test("ensures missing human memory layers once per session", async () => {
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
    expect(result.created).toEqual(["short_term", "long_term", "visual"])
    expect(cached).toBe(result)
    expect(calls).toHaveLength(3)
    expect(calls.map((call) => call.body?.memory_mode)).toEqual(["short_term", "long_term", "visual"])
    expect(calls.map((call) => call.body?.dedup)).toEqual([false, false, false])
    expect(calls.map((call) => call.body?.session_rollup)).toEqual([false, false, false])
    expect(calls.every((call) => (call.body?.tags as string[]).includes("markscode-system-memory-layer"))).toBe(true)
    expect(calls.every((call) => (call.body?.tags as string[]).includes("session:s1"))).toBe(true)
  })

  test("ensures session bootstraps even when context returns global existing layers without markers", async () => {
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
    expect(result.created).toEqual(["short_term", "long_term", "visual"])
    expect(calls.filter((call) => call.url.includes("/memories/human/context"))).toHaveLength(0)
    expect(calls.map((call) => call.body?.title)).toEqual([
      "MarksCode memory layer bootstrap: s-context:short_term",
      "MarksCode memory layer bootstrap: s-context:long_term",
      "MarksCode memory layer bootstrap: s-context:visual",
    ])
    expect(calls.every((call) => (call.body?.content as string).includes("session s-context"))).toBe(true)
  })

  test("save sends OAuth identity to primary and layer bootstraps", async () => {
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
    expect(bodies).toHaveLength(4)
    expect(bodies.map((body) => body?.user_id)).toEqual(["account-1", "account-1", "account-1", "account-1"])
    expect(bodies.map((body) => body?.memory_mode)).toEqual(["long_term", "short_term", "long_term", "visual"])
    expect(bodies.map((body) => body?.dedup)).toEqual([undefined, false, false, false])
    expect(bodies.map((body) => body?.session_rollup)).toEqual([undefined, false, false, false])
    expect(bodies.every((body) => body?.customer_id === "account-1" && body?.org_id === "org-1")).toBe(true)
    expect(bodies.every((body) => (body?.identity as Record<string, unknown>)?.provider === "markspanel-oauth")).toBe(true)
    expect(bodies.every((body) => (body?.metadata as Record<string, unknown>)?.identity_provider === "markspanel-oauth")).toBe(true)
    expect(bodies.some((body) => body?.user_id === "marks-local")).toBe(false)
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

    expect(apiKeys).toHaveLength(4)
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

  test("returns errors instead of throwing when layer ensure fails", async () => {
    process.env.MARKSCODE_MEMORIES_URL = "http://memories.test"
    globalThis.fetch = mock(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch

    const result = await ensureHumanMemoryLayers({ user_id: "u3", session_id: "s3" })

    expect(result.ok).toBe(false)
    expect(result.created).toEqual([])
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
