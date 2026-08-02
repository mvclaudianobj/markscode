import { describe, expect, test } from "bun:test"
import { getMarksAgentConfigCatalog, getMarksAgentConfigGroups } from "../src/marks-agent-config-catalog"

describe("marks-agent-config-catalog", () => {
  test("has unique keys, sensitive secret refs and main groups", () => {
    const catalog = getMarksAgentConfigCatalog()
    const keys = catalog.map((item) => item.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(catalog.filter((item) => item.type === "secret_ref").every((item) => item.sensitive)).toBe(true)
    expect(catalog.filter((item) => item.sensitive).every((item) => item.type === "secret_ref")).toBe(true)
    expect(getMarksAgentConfigGroups()).toEqual(expect.arrayContaining(["MEMORIES", "TELEGRAM", "TTS", "STT", "GRAPHFY", "MAP", "QDRANT", "MEMVID", "DATABASE", "VISION", "BRAIN_OBSIDIAN", "UPDATER_INSTALL", "NOTIFIER"]))
  })
})
