import { afterEach, describe, expect, test } from "bun:test"
import { join } from "path"
import { tmpdir } from "./fixture/fixture"
import {
  clearMarksAgentConfigSourceCache,
  getMarksAgentBoolean,
  getMarksAgentConfigValue,
  getMarksAgentNumber,
  getMarksAgentString,
  getMarksAgentSecretValue,
} from "../src/marks-agent-config-source"

const previousPath = process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH
const previousFallbackPath = process.env.MARKS_AGENT_CONFIG_SOURCE_PATH
const previousSecret = process.env.MARKSCODE_TEST_SECRET_VALUE

afterEach(() => {
  process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH = previousPath
  process.env.MARKS_AGENT_CONFIG_SOURCE_PATH = previousFallbackPath
  process.env.MARKSCODE_TEST_SECRET_VALUE = previousSecret
  clearMarksAgentConfigSourceCache()
})

describe("marks-agent-config-source", () => {
  test("reads markscode configurator env and resolves secret refs", async () => {
    await using tmp = await tmpdir()
    process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH = join(tmp.path, "modules.json")
    process.env.MARKSCODE_TEST_SECRET_VALUE = "secret-value"
    await Bun.write(
      process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH,
      JSON.stringify({
        schema_version: 1,
        source: "marks_agent",
        updated_at: "2026-08-01T00:00:00.000Z",
        desired_hash: "desired",
        applied_hash: "applied",
        modules: {
          markscode: {
            configurator: {
              env: {
                MARKSCODE_MEMORY_PROVIDER: "cloud",
                MARKSCODE_HYBRID_MEMORY: true,
                MARKSCODE_MEMORY_RECALL_LIMIT: 6.0,
                MARKSCODE_MEMORY_MAX_CHARS: 1800.0,
              },
              secret_refs: {
                MARKSCODE_MEMORIES_API_KEY: { secret_ref: "vault://marks/memories", env_ref: "MARKSCODE_TEST_SECRET_VALUE" },
              },
            },
          },
        },
      }),
    )

    expect(getMarksAgentConfigValue("MARKSCODE_MEMORY_PROVIDER")).toBe("cloud")
    expect(getMarksAgentBoolean("MARKSCODE_HYBRID_MEMORY")).toBe(true)
    expect(getMarksAgentString("MARKSCODE_HYBRID_MEMORY")).toBe("true")
    expect(getMarksAgentNumber("MARKSCODE_MEMORY_RECALL_LIMIT")).toBe(6)
    expect(getMarksAgentString("MARKSCODE_MEMORY_MAX_CHARS")).toBe("1800")
    expect(getMarksAgentNumber("MARKSCODE_MEMORY_MAX_CHARS")).toBe(1800)
    expect(getMarksAgentSecretValue("MARKSCODE_MEMORIES_API_KEY")).toBe("secret-value")
  })
})
