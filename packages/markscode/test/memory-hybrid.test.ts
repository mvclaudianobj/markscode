import { afterEach, describe, expect, mock, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "./fixture/fixture"
import { ensureMemvidCapsule, hybridMemoryStatus, ingestHybridMemories, previewHybridIngest, recallHybridMemories } from "@/memory-hybrid"
import { clearRemoteMemoryConfig, setRemoteMemoryConfig } from "@/memory-config"

const originalFetch = globalThis.fetch
const originalHybridMemory = process.env.MARKSCODE_HYBRID_MEMORY
const originalAdminMemoryFallback = process.env.MARKSCODE_ADMIN_MEMORY_FALLBACK

afterEach(() => {
  globalThis.fetch = originalFetch
  clearRemoteMemoryConfig()
  if (originalHybridMemory === undefined) delete process.env.MARKSCODE_HYBRID_MEMORY
  else process.env.MARKSCODE_HYBRID_MEMORY = originalHybridMemory
  if (originalAdminMemoryFallback === undefined) delete process.env.MARKSCODE_ADMIN_MEMORY_FALLBACK
  else process.env.MARKSCODE_ADMIN_MEMORY_FALLBACK = originalAdminMemoryFallback
})

function clearCloudMemoryEnv() {
  delete process.env.MARKSCODE_MEMORIES_API_KEY
  delete process.env.MEMORIES_API_KEY
  delete process.env.MARKSCODE_MEMORIES_URL
  delete process.env.MEMORIES_URL
}

describe("hybrid memory local-first", () => {
  test("status does not report cloud availability without api key", async () => {
    clearCloudMemoryEnv()

    const status = await hybridMemoryStatus() as Record<string, unknown>

    expect(status.cloud_available).toBe(false)
  })

  test("hybrid recall skips cloud without api key", async () => {
    clearCloudMemoryEnv()
    globalThis.fetch = mock(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch

    const result = await recallHybridMemories({ cue: "markscode plugins", limit: 3 })

    expect(result.provider).toBe("hybrid")
    expect(result.cloud_available).toBe(false)
    expect(result.errors.some((error) => /X-API-Key|missing/i.test(error))).toBe(false)
  })

  test("explicit cloud recall returns a clear local configuration error", async () => {
    clearCloudMemoryEnv()
    globalThis.fetch = mock(() => Promise.reject(new Error("sessão Markspanel ausente ou expirada"))) as unknown as typeof fetch

    const result = await recallHybridMemories({ cue: "markscode plugins", limit: 3, provider: "cloud" })

    expect(result.cloud_available).toBe(false)
    expect(result.errors).toContain("cloud: sessão Markspanel ausente ou expirada")
  })

  test("explicit cloud recall tries OAuth-backed request without preloaded api key", async () => {
    clearCloudMemoryEnv()
    delete process.env.MARKSCODE_HYBRID_MEMORY
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = []
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return Promise.resolve(new Response(JSON.stringify({
        memories: [{ id: "m1", user_id: "u1", session_id: "s1", type: "semantic", content: "memória cloud via oauth", importance: 1, tags: [], created_at: "", updated_at: "" }],
        scores: [0.9],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
    }) as unknown as typeof fetch

    const result = await recallHybridMemories({ provider: "cloud", cue: "contexto oauth", limit: 3 })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("http://api.marks.ia.br:8689/memories/human/recall")
    expect(result.cloud_available).toBe(true)
    expect(result.errors).not.toContain("cloud: faça login no Markspanel pelo fluxo OAuth/device")
    expect(result.memories).toMatchObject([{ source: "cloud", content: "memória cloud via oauth", score: 0.9 }])
  })

  test("cloud recall prefers remote memories user id over OAuth account id", async () => {
    clearCloudMemoryEnv()
    setRemoteMemoryConfig({ api_key: "remote-config-key", user_id: "mvclaudiano" }, "active-config")
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = []
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return Promise.resolve(new Response(JSON.stringify({ memories: [], scores: [] }), { status: 200, headers: { "Content-Type": "application/json" } }))
    }) as unknown as typeof fetch

    await recallHybridMemories({ provider: "cloud", user_id: "6", session_id: "session-oauth", cue: "contexto oauth", limit: 3 })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("http://api.marks.ia.br:8689/memories/human/recall")
    expect(calls[0].body).toMatchObject({ user_id: "mvclaudiano", session_id: "session-oauth", cue: "contexto oauth" })
    expect(calls[0].body?.user_id).not.toBe("6")
  })

  test("admin fallback is disabled by default and does not run second search", async () => {
    process.env.MARKSCODE_MEMORIES_API_KEY = "test-key"
    const calls: string[] = []
    globalThis.fetch = mock((url: string | URL | Request) => {
      calls.push(String(url))
      return Promise.resolve(new Response(JSON.stringify({ memories: [], scores: [] }), { status: 200, headers: { "Content-Type": "application/json" } }))
    }) as unknown as typeof fetch

    const result = await recallHybridMemories({ provider: "cloud", cue: "contexto admin", limit: 3 })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe("http://api.marks.ia.br:8689/memories/human/recall")
    expect(result.errors.some((error) => error.startsWith("admin_fallback_unscoped:"))).toBe(false)
  })

  test("admin fallback returns marked unscoped memory after empty cloud recall", async () => {
    process.env.MARKSCODE_MEMORIES_API_KEY = "test-key"
    process.env.MARKSCODE_ADMIN_MEMORY_FALLBACK = "1"
    const calls: string[] = []
    globalThis.fetch = mock((url: string | URL | Request) => {
      calls.push(String(url))
      if (String(url).includes("/memories/search/advanced")) {
        return Promise.resolve(new Response(JSON.stringify({ memories: [{ id: "admin-1", title: "global", subject: "global subject", content: "memória global não escopada", importance: 1, tags: ["global"], created_at: "" }], total: 1 }), { status: 200, headers: { "Content-Type": "application/json" } }))
      }
      return Promise.resolve(new Response(JSON.stringify({ memories: [], scores: [] }), { status: 200, headers: { "Content-Type": "application/json" } }))
    }) as unknown as typeof fetch

    const result = await recallHybridMemories({ provider: "cloud", cue: "contexto admin", limit: 5 })

    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain("/memories/search/advanced?")
    expect(calls[1]).toContain("cross_session=1")
    expect(calls[1]).toContain("fuzzy=1")
    expect(calls[1]).toContain("limit=5")
    expect(result.errors).toContain("admin_fallback_unscoped: used")
    expect(result.memories).toMatchObject([{ source: "cloud", content: "memória global não escopada", title: "[admin_fallback_unscoped] global", tags: ["global", "admin_fallback_unscoped"] }])
  })

  test("admin fallback override returns marked unscoped memory without env", async () => {
    process.env.MARKSCODE_MEMORIES_API_KEY = "test-key"
    delete process.env.MARKSCODE_ADMIN_MEMORY_FALLBACK
    const calls: string[] = []
    globalThis.fetch = mock((url: string | URL | Request) => {
      calls.push(String(url))
      if (String(url).includes("/memories/search/advanced")) {
        return Promise.resolve(new Response(JSON.stringify({ memories: [{ id: "admin-override", title: "global", subject: "global subject", content: "memória global autorizada", importance: 1, tags: ["global"], created_at: "" }], total: 1 }), { status: 200, headers: { "Content-Type": "application/json" } }))
      }
      return Promise.resolve(new Response(JSON.stringify({ memories: [], scores: [] }), { status: 200, headers: { "Content-Type": "application/json" } }))
    }) as unknown as typeof fetch

    const result = await recallHybridMemories({ provider: "cloud", cue: "contexto admin", limit: 5, admin_fallback: true })

    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain("/memories/search/advanced?")
    expect(result.errors).toContain("admin_fallback_unscoped: used")
    expect(result.memories).toMatchObject([{ id: "admin-override", source: "cloud", content: "memória global autorizada", title: "[admin_fallback_unscoped] global" }])
  })

  test("admin fallback complements short truncated scoped cloud recall when explicitly allowed", async () => {
    process.env.MARKSCODE_MEMORIES_API_KEY = "test-key"
    delete process.env.MARKSCODE_ADMIN_MEMORY_FALLBACK
    const calls: string[] = []
    globalThis.fetch = mock((url: string | URL | Request) => {
      calls.push(String(url))
      if (String(url).includes("/memories/search/advanced")) {
        return Promise.resolve(new Response(JSON.stringify({ memories: [{
          id: "admin-rich",
          title: "Brain graph ingest e memories human",
          subject: "marks1 markspanel",
          content: "Correção rica: /api/markscode/brain/graph/ingest usa worker async; /memories/human teve flood isolado com gateway timeout no Markspanel. ".repeat(8),
          importance: 1,
          tags: ["brain", "memories"],
          created_at: "",
        }], total: 1 }), { status: 200, headers: { "Content-Type": "application/json" } }))
      }
      return Promise.resolve(new Response(JSON.stringify({ memories: [{ id: "cloud-short", content: "Resumo parcial truncado...", importance: 1, tags: [], created_at: "", updated_at: "" }], scores: [0.4] }), { status: 200, headers: { "Content-Type": "application/json" } }))
    }) as unknown as typeof fetch

    const result = await recallHybridMemories({ provider: "cloud", cue: "pergunta sobre /api/markscode/brain/graph/ingest e /memories/human", limit: 5, admin_fallback: true })

    expect(calls.filter((call) => call.includes("/memories/search/advanced"))).toHaveLength(3)
    expect(result.errors).toContain("admin_fallback_unscoped: used")
    expect(result.memories.some((memory) => memory.id === "cloud-short" && memory.content.includes("parcial"))).toBe(true)
    expect(result.memories.some((memory) => memory.id === "admin-rich" && memory.content.includes("/api/markscode/brain/graph/ingest") && memory.content.includes("/memories/human"))).toBe(true)
  })

  test("admin fallback cleans bootstrap placeholder prefix and prioritizes strong technical memory", async () => {
    process.env.MARKSCODE_MEMORIES_API_KEY = "test-key"
    process.env.MARKSCODE_ADMIN_MEMORY_FALLBACK = "1"
    const calls: string[] = []
    globalThis.fetch = mock((url: string | URL | Request) => {
      calls.push(String(url))
      if (!String(url).includes("/memories/search/advanced")) {
        return Promise.resolve(new Response(JSON.stringify({ memories: [], scores: [] }), { status: 200, headers: { "Content-Type": "application/json" } }))
      }
      if (String(url).includes("markscode+brain+graph+ingest")) {
        return Promise.resolve(new Response(JSON.stringify({ memories: [
          { id: "placeholder", title: "Memory layer bootstrap", subject: "placeholder", content: "Ignore in recall", importance: 0, tags: [], created_at: "" },
          { id: "index", title: "index.md", subject: "procedural", content: "procedural/index.md", importance: 1, tags: ["procedural"], created_at: "" },
        ], total: 2 }), { status: 200, headers: { "Content-Type": "application/json" } }))
      }
      return Promise.resolve(new Response(JSON.stringify({ memories: [{
        id: "good-placeholder",
        title: "Memory layer bootstrap with Brain graph ingest async fix",
        subject: "marks1 markspanel",
        content: "MarksCode system memory layer bootstrap placeholder for session s-marks1. Ignore in recall and user-facing context. /api/markscode/brain/graph/ingest corrigido com worker async no marks1; flood em /memories/human isolado no Markspanel gateway timeout. ".repeat(3),
        importance: 1,
        tags: ["brain", "marks1"],
        created_at: "",
      }], total: 1 }), { status: 200, headers: { "Content-Type": "application/json" } }))
    }) as unknown as typeof fetch

    const result = await recallHybridMemories({ provider: "cloud", cue: "pergunta sobre /api/markscode/brain/graph/ingest e /memories/human async marks1", limit: 3 })

    expect(calls.filter((call) => call.includes("/memories/search/advanced"))).toHaveLength(3)
    expect(result.memories[0]).toMatchObject({ id: "good-placeholder", source: "cloud", title: "[admin_fallback_unscoped] Memory layer bootstrap with Brain graph ingest async fix" })
    expect(result.memories[0].content).toContain("/api/markscode/brain/graph/ingest")
    expect(result.memories[0].content).not.toMatch(/^MarksCode system memory layer bootstrap placeholder/i)
    expect(result.memories[0].tags).toContain("admin_fallback_unscoped")
  })

  test("admin fallback reports unavailable without throwing", async () => {
    process.env.MARKSCODE_MEMORIES_API_KEY = "test-key"
    process.env.MARKSCODE_ADMIN_MEMORY_FALLBACK = "true"
    globalThis.fetch = mock((url: string | URL | Request) => {
      if (String(url).includes("/memories/search/advanced")) return Promise.reject(new Error("offline"))
      return Promise.resolve(new Response(JSON.stringify({ memories: [], scores: [] }), { status: 200, headers: { "Content-Type": "application/json" } }))
    }) as unknown as typeof fetch

    const result = await recallHybridMemories({ provider: "cloud", cue: "contexto admin", limit: 3 })

    expect(result.errors).toContain("admin_fallback_unscoped: unavailable")
    expect(result.memories).toEqual([])
  })

  test("qdrant is disabled by default", async () => {
    const previous = process.env.MARKSCODE_QDRANT_ENABLED
    delete process.env.MARKSCODE_QDRANT_ENABLED
    globalThis.fetch = mock(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch

    const result = await recallHybridMemories({ cue: "markscode plugins", limit: 3 })

    if (previous === undefined) delete process.env.MARKSCODE_QDRANT_ENABLED
    else process.env.MARKSCODE_QDRANT_ENABLED = previous
    expect(result.qdrant_available).toBe(false)
  })

  test("memvid auto init opt-out does not create capsule", async () => {
    await using tmp = await tmpdir()
    const previous = process.env.MARKSCODE_MEMVID_AUTO_INIT
    process.env.MARKSCODE_MEMVID_AUTO_INIT = "0"

    const capsule = join(tmp.path, "memory", "hybrid.mv2")
    const result = ensureMemvidCapsule({ capsule, projectRoot: tmp.path })

    if (previous === undefined) delete process.env.MARKSCODE_MEMVID_AUTO_INIT
    else process.env.MARKSCODE_MEMVID_AUTO_INIT = previous
    expect(result.status).toBe("skipped")
    expect(existsSync(capsule)).toBe(false)
  })

  test("memvid ingest tries CLI when capsule is absent", async () => {
    await using tmp = await tmpdir()
    const previous = process.env.MARKSCODE_MEMVID_CLI
    const cli = join(tmp.path, "markscode-memvid")
    const source = join(tmp.path, "memories.json")
    const capsule = join(tmp.path, "memory", "hybrid.mv2")

    writeFileSync(cli, `#!/usr/bin/env bash
set -e
if [ "$1" = "contract" ]; then printf '{"tool":"markscode-memvid","contract_version":1}\n'; exit 0; fi
if [ "$1" = "--help" ]; then printf 'ingest\n'; exit 0; fi
if [ "$1" = "ingest" ]; then
  while [ "$#" -gt 0 ]; do
    case "$1" in --capsule|--output) shift; capsule="$1";; esac
    shift || true
  done
  mkdir -p "$(dirname "$capsule")"
  printf 'capsule\n' > "$capsule"
  exit 0
fi
exit 1
`)
    chmodSync(cli, 0o755)
    writeFileSync(source, JSON.stringify({ markscode: { resumo: "Hybrid memory CLI capsule creation regression fixture." } }))
    process.env.MARKSCODE_MEMVID_CLI = cli

    const result = await ingestHybridMemories({ source: "markscode-legacy-json", path: source, write_memvid: true, capsule })
    const memvid = result.memvid as Record<string, unknown>

    if (previous === undefined) delete process.env.MARKSCODE_MEMVID_CLI
    else process.env.MARKSCODE_MEMVID_CLI = previous
    expect(existsSync(capsule)).toBe(true)
    expect(memvid).toMatchObject({ available: true, method: "cli", written: 1 })
    expect("export_path" in memvid).toBe(false)
  })

  test("normalizeCloudResult filtra memórias com title=index.md do recall cloud", async () => {
    process.env.MARKSCODE_MEMORIES_API_KEY = "test-key"
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({
        memories: [
          { id: "noise-1", title: "index.md", content: "lixo de .tasks procedural", importance: 0.7, tags: ["procedural"], created_at: "", updated_at: "" },
          { id: "noise-2", title: "tasks/index.md", content: "outro lixo de index", importance: 0.8, tags: [], created_at: "", updated_at: "" },
          { id: "rich-1", title: "Markscode 1.1.2 24/07/2026", content: "Memória rica do release 1.1.2", importance: 0.9, tags: ["release"], created_at: "", updated_at: "" },
        ],
        scores: [0.95, 0.93, 0.88],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
    ) as unknown as typeof fetch

    const result = await recallHybridMemories({ provider: "cloud", cue: "markscode release", limit: 5 })

    expect(result.memories.find((m) => m.title === "index.md")).toBeUndefined()
    expect(result.memories.find((m) => m.title?.endsWith("index.md"))).toBeUndefined()
    expect(result.memories).toMatchObject([{ id: "rich-1", source: "cloud", title: "Markscode 1.1.2 24/07/2026", content: "Memória rica do release 1.1.2" }])
  })

  test("marksclaw markdown ingest discovers memory names and subject-matching MD files", async () => {
    await using tmp = await tmpdir()
    mkdirSync(join(tmp.path, "memory"))
    writeFileSync(join(tmp.path, "ProjectMemory.MD"), "Project memory captures release alpha context.")
    writeFileSync(join(tmp.path, "MemoryNotes.MD"), "Memory notes capture beta context.")
    writeFileSync(join(tmp.path, "context.MD"), "Generic markdown references orbital-subject for lookup.")

    const result = await previewHybridIngest({ source: "marksclaw-markdown", path: tmp.path, subject: "orbital-subject" })
    const paths = result.items.map((item) => item.source_path)

    expect(paths).toContain(join(tmp.path, "ProjectMemory.MD"))
    expect(paths).toContain(join(tmp.path, "MemoryNotes.MD"))
    expect(paths).toContain(join(tmp.path, "context.MD"))
  })
})
