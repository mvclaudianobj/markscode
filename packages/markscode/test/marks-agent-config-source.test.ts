import { afterEach, beforeEach, describe, expect, test } from "bun:test"
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

const originalEnv = Object.fromEntries(
  [
    "MARKSCODE_AGENT_CONFIG_SOURCE_PATH",
    "MARKS_AGENT_CONFIG_SOURCE_PATH",
    "MARKSCODE_TEST_SECRET_VALUE",
    "MARKSCODE_MARKS_AGENT_BIN",
    "MARKS_AGENT_BIN",
    "MARKSCODE_MARKS_AGENT_ENV_FILE",
    "MARKS_AGENT_ENV_FILE",
    "MARKSCODE_AGENT_SECRET_RESOLVE",
    "NODE_ID",
    "MARKS_AGENT_NODE_ID",
    "MARKSCODE_MEMORIES_URL",
    "MEMORIES_URL",
    "MARKSCODE_MEMORIES_API_KEY",
    "MEMORIES_API_KEY",
    "MARKSCODE_MAP_API_KEY",
    "MAP_API_KEY",
    "MARKS_API_KEY",
    "MARKSCODE_TTS_G4F_SPACE_TOKEN",
    "MARKS_G4F_SPACE_TOKEN",
  ].map((key) => [key, process.env[key]]),
)
const bunShebang = `#!${process.execPath}\n`

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

beforeEach(() => {
  for (const key of Object.keys(originalEnv)) delete process.env[key]
  process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH = join(process.cwd(), ".marks-agent-config-source-test-missing.json")
  process.env.MARKSCODE_AGENT_SECRET_RESOLVE = "0"
  clearMarksAgentConfigSourceCache()
})

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) restoreEnv(key, value)
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
                MARKSCODE_MAP_API_KEY: { env_ref: "MARKSCODE_MISSING_SECRET_VALUE", value: "map-secret-value" },
                MAP_API_KEY: { secret: "map-secret-field" },
                MARKS_API_KEY: { api_key: "marks-api-key-field" },
                MARKSCODE_TTS_TOKEN: { token: "tts-token-field" },
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
    expect(getMarksAgentSecretValue("MARKSCODE_MAP_API_KEY")).toBe("map-secret-value")
    expect(getMarksAgentSecretValue("MAP_API_KEY")).toBe("map-secret-field")
    expect(getMarksAgentSecretValue("MARKS_API_KEY")).toBe("marks-api-key-field")
    expect(getMarksAgentSecretValue("MARKSCODE_TTS_TOKEN")).toBe("tts-token-field")
  })

  test("resolves present secret refs through marks_agent command", async () => {
    await using tmp = await tmpdir()
    process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH = join(tmp.path, "modules.json")
    process.env.MARKSCODE_MARKS_AGENT_BIN = join(tmp.path, "marks-agent-secret-resolver")
    delete process.env.MARKSCODE_AGENT_SECRET_RESOLVE
    await Bun.write(
      process.env.MARKSCODE_MARKS_AGENT_BIN,
      `${bunShebang}if (process.argv.includes("MARKSCODE_RESOLVED_SECRET")) console.log(JSON.stringify({ ok: true, secrets: { MARKSCODE_RESOLVED_SECRET: "resolved-secret-value" } }))\n`,
    )
    await Bun.$`chmod 700 ${process.env.MARKSCODE_MARKS_AGENT_BIN}`
    await Bun.write(
      process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH,
      JSON.stringify({
        modules: {
          markscode: {
            configurator: {
              secret_refs: {
                MARKSCODE_RESOLVED_SECRET: { env_ref: "MARKSCODE_MISSING_RESOLVED_SECRET", present: true },
              },
            },
          },
        },
      }),
    )

    expect(getMarksAgentSecretValue("MARKSCODE_RESOLVED_SECRET")).toBe("resolved-secret-value")
    expect(getMarksAgentSecretValue("MARKSCODE_RESOLVED_SECRET")).toBe("resolved-secret-value")
  })

  test("deduplicates absolute marks_agent fallback when override matches", async () => {
    await using tmp = await tmpdir()
    process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH = join(tmp.path, "modules.json")
    process.env.MARKSCODE_MARKS_AGENT_BIN = "/usr/local/bin/marks_agent"
    process.env.MARKSCODE_AGENT_SECRET_RESOLVE = "0"
    await Bun.write(
      process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH,
      JSON.stringify({
        modules: {
          markscode: {
            configurator: {
              secret_refs: {
                MARKSCODE_RESOLVED_SECRET: { present: true },
              },
            },
          },
        },
      }),
    )

    expect(getMarksAgentSecretValue("MARKSCODE_RESOLVED_SECRET")).toBeUndefined()
  })

  test("loads marks_agent env file and passes node id to resolver", async () => {
    await using tmp = await tmpdir()
    process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH = join(tmp.path, "modules.json")
    process.env.MARKSCODE_MARKS_AGENT_BIN = join(tmp.path, "resolver")
    process.env.MARKSCODE_MARKS_AGENT_ENV_FILE = join(tmp.path, "agent.env")
    delete process.env.MARKSCODE_AGENT_SECRET_RESOLVE
    delete process.env.NODE_ID
    delete process.env.MARKS_AGENT_NODE_ID
    await Bun.write(
      process.env.MARKSCODE_MARKS_AGENT_ENV_FILE,
      [
        "NODE_ID=test-node",
        "INGEST_URL=http://example/api/agent/v2/ingest",
        "AGENT_TOKEN='test-token'",
      ].join("\n"),
    )
    await Bun.write(
      process.env.MARKSCODE_MARKS_AGENT_BIN,
      `${bunShebang}const args = process.argv.slice(2)\nif (args[0] === "--node-id" && args[1] === "test-node" && args[2] === "--resolve-secret" && args[3] === "MARKSCODE_RESOLVED_SECRET" && process.env.INGEST_URL === "http://example/api/agent/v2/ingest" && process.env.AGENT_TOKEN === "test-token") console.log(JSON.stringify({ ok: true, secrets: { MARKSCODE_RESOLVED_SECRET: "resolved-secret-value" } }))\n`,
    )
    await Bun.$`chmod 700 ${process.env.MARKSCODE_MARKS_AGENT_BIN}`
    await Bun.write(
      process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH,
      JSON.stringify({
        modules: {
          markscode: {
            configurator: {
              secret_refs: {
                MARKSCODE_RESOLVED_SECRET: { present: true },
              },
            },
          },
        },
      }),
    )

    expect(getMarksAgentSecretValue("MARKSCODE_RESOLVED_SECRET")).toBe("resolved-secret-value")
  })

  test("prefers process node id over marks_agent env file", async () => {
    await using tmp = await tmpdir()
    process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH = join(tmp.path, "modules.json")
    process.env.MARKSCODE_MARKS_AGENT_BIN = join(tmp.path, "resolver")
    process.env.MARKSCODE_MARKS_AGENT_ENV_FILE = join(tmp.path, "agent.env")
    process.env.NODE_ID = "process-node"
    delete process.env.MARKSCODE_AGENT_SECRET_RESOLVE
    delete process.env.MARKS_AGENT_NODE_ID
    await Bun.write(process.env.MARKSCODE_MARKS_AGENT_ENV_FILE, "NODE_ID=file-node\n")
    await Bun.write(
      process.env.MARKSCODE_MARKS_AGENT_BIN,
      `${bunShebang}const args = process.argv.slice(2)\nif (args[0] === "--node-id" && args[1] === "process-node" && args[2] === "--resolve-secret" && args[3] === "MARKSCODE_RESOLVED_SECRET") console.log(JSON.stringify({ ok: true, secrets: { MARKSCODE_RESOLVED_SECRET: "resolved-secret-value" } }))\n`,
    )
    await Bun.$`chmod 700 ${process.env.MARKSCODE_MARKS_AGENT_BIN}`
    await Bun.write(
      process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH,
      JSON.stringify({
        modules: {
          markscode: {
            configurator: {
              secret_refs: {
                MARKSCODE_RESOLVED_SECRET: { present: true },
              },
            },
          },
        },
      }),
    )

    expect(getMarksAgentSecretValue("MARKSCODE_RESOLVED_SECRET")).toBe("resolved-secret-value")
  })
})
