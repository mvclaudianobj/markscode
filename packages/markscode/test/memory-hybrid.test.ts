import { describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "./fixture/fixture"
import { ensureMemvidCapsule, hybridMemoryStatus, ingestHybridMemories, previewHybridIngest, recallHybridMemories } from "@/memory-hybrid"

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
