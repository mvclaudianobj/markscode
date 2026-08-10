import { describe, expect, test } from "bun:test"
import { getMarksAgentConfigCatalog, getMarksAgentConfigGroups } from "../src/marks-agent-config-catalog"

describe("marks-agent-config-catalog", () => {
  test("has unique keys, sensitive secret refs and main groups", () => {
    const catalog = getMarksAgentConfigCatalog()
    const keys = catalog.map((item) => item.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(catalog.filter((item) => item.type === "secret_ref").every((item) => item.sensitive)).toBe(true)
    expect(catalog.filter((item) => item.sensitive).every((item) => item.type === "secret_ref")).toBe(true)
    expect(getMarksAgentConfigGroups()).toEqual(expect.arrayContaining(["PROFILE", "MEMORIES", "TELEGRAM", "TTS", "STT", "GRAPHFY", "MAP", "QDRANT", "MEMVID", "DATABASE", "VISION", "BRAIN_OBSIDIAN", "UPDATER_INSTALL", "NOTIFIER", "EFFICIENCY", "UI"]))
    expect(keys).toEqual(expect.arrayContaining(["MARKSCODE_ACCOUNT_NAME", "MARKSCODE_PROFILE_NAME", "MARKSCODE_USER_NAME", "MARKSCODE_PREFERRED_NAME", "MARKS_ACCOUNT_NAME", "MARKS_USER_NAME", "MARKSCODE_RTK_AUTO", "MARKSCODE_RTK_EXTERNAL", "MARKSCODE_RTK_BIN", "MARKSCODE_RTK_MAX_LINES", "MARKSCODE_RTK_MAX_CHARS", "MARKSCODE_PONYTAIL_MODE", "MARKSCODE_CAVEMAN_OUTPUT", "MARKSCODE_LANGUAGE"]))
  })
})
