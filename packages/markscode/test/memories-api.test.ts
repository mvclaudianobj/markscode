import { afterEach, describe, expect, mock, test } from "bun:test"
import { ensureHumanMemoryLayers, getHumanContext } from "../src/memories-api"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
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
      if (String(url).includes("/memories/human/context")) return jsonResponse({ short_term: [], long_term: [], visual: [] })
      return jsonResponse({ ok: true })
    }) as unknown as typeof fetch

    const result = await ensureHumanMemoryLayers({ user_id: "u1", session_id: "s1" })
    const cached = await ensureHumanMemoryLayers({ user_id: "u1", session_id: "s1" })

    expect(result.ok).toBe(true)
    expect(result.created).toEqual(["short_term", "long_term", "visual"])
    expect(cached).toBe(result)
    expect(calls).toHaveLength(4)
    expect(calls.slice(1).map((call) => call.body?.memory_mode)).toEqual(["short_term", "long_term", "visual"])
    expect(calls.slice(1).every((call) => (call.body?.tags as string[]).includes("markscode-system-memory-layer"))).toBe(true)
  })

  test("does not expose layer bootstrap markers in human context", async () => {
    process.env.MARKSCODE_MEMORIES_URL = "http://memories.test"
    const context = {
      short_term: [
        { id: "marker", user_id: "u2", session_id: "s2", type: "episodic", memory_mode: "short_term", content: "bootstrap", importance: 0, tags: ["markscode-system-memory-layer"], created_at: "", updated_at: "" },
        { id: "real", user_id: "u2", session_id: "s2", type: "episodic", memory_mode: "short_term", content: "real", importance: 1, tags: [], created_at: "", updated_at: "" },
      ],
      long_term: [{ id: "long", user_id: "u2", session_id: "s2", type: "semantic", memory_mode: "long_term", content: "real", importance: 1, tags: [], created_at: "", updated_at: "" }],
      visual: [{ id: "visual", user_id: "u2", session_id: "s2", type: "semantic", memory_mode: "visual", content: "real", importance: 1, tags: [], created_at: "", updated_at: "" }],
    }
    globalThis.fetch = mock(() => jsonResponse(context)) as unknown as typeof fetch

    const result = await getHumanContext({ user_id: "u2", session_id: "s2" })

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
