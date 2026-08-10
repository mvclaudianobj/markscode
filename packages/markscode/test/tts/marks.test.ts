import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { clearMarksAgentConfigSourceCache } from "../../src/marks-agent-config-source"
import { g4fSpaceDirectToken, ttsProviderNames } from "../../src/tts/marks"
import type { MarksTTSConfigSource } from "../../src/tts/marks"

const originalEnv = Object.fromEntries(
  [
    "MARKSCODE_AGENT_CONFIG_SOURCE_PATH",
    "MARKS_AGENT_CONFIG_SOURCE_PATH",
    "MARKSCODE_MARKS_AGENT_ENV_FILE",
    "MARKS_AGENT_ENV_FILE",
    "MARKSCODE_AGENT_SECRET_RESOLVE",
    "MARKSCODE_TTS_G4F_SPACE_TOKEN",
    "MARKS_G4F_SPACE_TOKEN",
    "MARKSCODE_MEMORIES_API_KEY",
    "MEMORIES_API_KEY",
    "MARKSCODE_MAP_API_KEY",
    "MAP_API_KEY",
    "MARKS_API_KEY",
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
})

afterEach(() => {
  restoreEnv()
  clearMarksAgentConfigSourceCache()
})

describe("tts.marks", () => {
  test("uses only configured g4f-space direct token sources", () => {
    delete process.env.MARKSCODE_TTS_G4F_SPACE_TOKEN
    delete process.env.MARKS_G4F_SPACE_TOKEN
    const kv: MarksTTSConfigSource = { get: <T>(key: string, fallback?: T) => (key === "markscode_tts_g4f_space_token" ? ("configured-token" as T) : fallback) }
    expect(g4fSpaceDirectToken(undefined)).toBe("")
    expect(g4fSpaceDirectToken({ kv })).toBe("configured-token")
    process.env.MARKSCODE_TTS_G4F_SPACE_TOKEN = "env-token"
    expect(g4fSpaceDirectToken(undefined)).toBe("env-token")
    delete process.env.MARKSCODE_TTS_G4F_SPACE_TOKEN
    process.env.MARKS_G4F_SPACE_TOKEN = "legacy-env-token"
    expect(g4fSpaceDirectToken(undefined)).toBe("legacy-env-token")
  })

  test("falls back from g4f-space proxy to gemini when direct token is missing", () => {
    expect(ttsProviderNames("g4f-space", "")).toEqual(["g4f-space-proxy", "g4f-gemini"])
    expect(ttsProviderNames("g4f-space", "token")).toEqual(["g4f-space-direct"])
  })
})
