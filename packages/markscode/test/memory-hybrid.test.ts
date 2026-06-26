import { describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "./fixture/fixture"
import { ensureMemvidCapsule, hybridMemoryStatus, recallHybridMemories } from "@/memory-hybrid"

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

    const result = await recallHybridMemories({ cue: "markscode plugins", limit: 3 })

    expect(result.provider).toBe("hybrid")
    expect(result.cloud_available).toBe(false)
    expect(result.errors.some((error) => /X-API-Key|missing/i.test(error))).toBe(false)
  })

  test("explicit cloud recall returns a clear local configuration error", async () => {
    clearCloudMemoryEnv()

    const result = await recallHybridMemories({ cue: "markscode plugins", limit: 3, provider: "cloud" })

    expect(result.cloud_available).toBe(false)
    expect(result.errors).toContain("cloud: Memories API key not configured")
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
})
