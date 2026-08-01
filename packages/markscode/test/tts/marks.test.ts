import { describe, expect, test } from "bun:test"
import { g4fSpaceDirectToken } from "../../src/tts/marks"
import type { MarksTTSConfigSource } from "../../src/tts/marks"

describe("tts.marks", () => {
  test("uses only configured g4f-space direct token sources", () => {
    const previousPrimary = process.env.MARKSCODE_TTS_G4F_SPACE_TOKEN
    const previousLegacy = process.env.MARKS_G4F_SPACE_TOKEN
    delete process.env.MARKSCODE_TTS_G4F_SPACE_TOKEN
    delete process.env.MARKS_G4F_SPACE_TOKEN
    try {
      const kv: MarksTTSConfigSource = { get: <T>(key: string, fallback?: T) => (key === "markscode_tts_g4f_space_token" ? ("configured-token" as T) : fallback) }
      expect(g4fSpaceDirectToken(undefined)).toBe("")
      expect(g4fSpaceDirectToken({ kv })).toBe("configured-token")
      process.env.MARKSCODE_TTS_G4F_SPACE_TOKEN = "env-token"
      expect(g4fSpaceDirectToken(undefined)).toBe("env-token")
      delete process.env.MARKSCODE_TTS_G4F_SPACE_TOKEN
      process.env.MARKS_G4F_SPACE_TOKEN = "legacy-env-token"
      expect(g4fSpaceDirectToken(undefined)).toBe("legacy-env-token")
    } finally {
      if (previousPrimary === undefined) delete process.env.MARKSCODE_TTS_G4F_SPACE_TOKEN
      else process.env.MARKSCODE_TTS_G4F_SPACE_TOKEN = previousPrimary
      if (previousLegacy === undefined) delete process.env.MARKS_G4F_SPACE_TOKEN
      else process.env.MARKS_G4F_SPACE_TOKEN = previousLegacy
    }
  })
})
