import { afterEach, beforeEach, describe, expect } from "bun:test"
import { join } from "path"
import { Global } from "@opencode-ai/core/global"
import { Effect, Layer } from "effect"
import type { Agent } from "../../src/agent/agent"
import { NamedError } from "@opencode-ai/core/util/error"
import { Skill } from "../../src/skill"
import { Permission } from "../../src/permission"
import { SystemPrompt } from "../../src/session/system"
import { isPreferredNamePromptPending } from "../../src/session/system"
import { clearMarksAgentConfigSourceCache } from "../../src/marks-agent-config-source"
import type { Provider } from "../../src/provider/provider"
import { testEffect } from "../lib/effect"
import { tmpdir } from "../fixture/fixture"

const originalEnv = Object.fromEntries(
  [
    "MARKSCODE_AGENT_CONFIG_SOURCE_PATH",
    "MARKSCODE_AGENT_SECRET_RESOLVE",
    "MARKSCODE_ACCOUNT_NAME",
    "MARKSCODE_PROFILE_NAME",
    "MARKSCODE_USER_NAME",
    "MARKSCODE_PREFERRED_NAME",
    "MARKSCODE_RUNTIME_PROMPT_USER_NAME",
    "MARKS_ACCOUNT_NAME",
    "MARKS_USER_NAME",
  ].map((key) => [key, process.env[key]]),
)
const originalStatePath = Global.Path.state

const fakeModel = {
  id: "fake",
  providerID: "test",
  name: "Fake",
  limit: { context: 1, input: 1, output: 1 },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  capabilities: {
    toolcall: true,
    attachment: false,
    reasoning: false,
    temperature: true,
    input: { text: true, image: false, audio: false, video: false },
    output: { text: true, image: false, audio: false, video: false },
  },
  api: { npm: "@ai-sdk/openai" },
  options: {},
} as Provider.Model

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

const skills: Skill.Info[] = [
  {
    name: "zeta-skill",
    description: "Zeta skill.",
    location: "/tmp/zeta-skill/SKILL.md",
    content: "# zeta-skill",
  },
  {
    name: "alpha-skill",
    description: "Alpha skill.",
    location: "/tmp/alpha-skill/SKILL.md",
    content: "# alpha-skill",
  },
  {
    name: "middle-skill",
    description: "Middle skill.",
    location: "/tmp/middle-skill/SKILL.md",
    content: "# middle-skill",
  },
  {
    name: "manual-skill",
    location: "/tmp/manual-skill/SKILL.md",
    content: "# manual-skill",
  },
]

const build: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

const it = testEffect(
  SystemPrompt.layer.pipe(
    Layer.provide(
      Layer.succeed(
        Skill.Service,
        Skill.Service.of({
          get: (name) => Effect.succeed(skills.find((skill) => skill.name === name)),
          require: (name) => {
            const info = skills.find((skill) => skill.name === name)
            if (info) return Effect.succeed(info)
            return Effect.fail(new Skill.NotFoundError({ name, available: skills.map((skill) => skill.name) }))
          },
          all: () => Effect.succeed(skills),
          dirs: () => Effect.succeed([]),
          available: () => Effect.succeed(skills),
        }),
      ),
    ),
  ),
)

describe("session.system", () => {
  it.effect("tracks preferred name prompt pending state", () =>
    Effect.gen(function* () {
      expect(isPreferredNamePromptPending({})).toBe(true)
      expect(isPreferredNamePromptPending({ configured: "Senhor Marcos" })).toBe(false)
      expect(isPreferredNamePromptPending({ stored: "Marcos" })).toBe(false)
      expect(isPreferredNamePromptPending({ dismissed: true })).toBe(false)
    }),
  )

  beforeEach(() => {
    for (const key of Object.keys(originalEnv)) delete process.env[key]
    process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH = join(process.cwd(), ".marks-agent-system-test-missing.json")
    process.env.MARKSCODE_AGENT_SECRET_RESOLVE = "0"
    SystemPrompt.setPromptUserName(undefined)
    clearMarksAgentConfigSourceCache()
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) restoreEnv(key, value)
    Global.Path.state = originalStatePath
    SystemPrompt.setPromptUserName(undefined)
    clearMarksAgentConfigSourceCache()
  })

  it.effect("keeps default user name without configured name", () =>
    Effect.gen(function* () {
      expect(SystemPrompt.resolvePromptUserName()).toBe("Senhor Marcos")
      expect(SystemPrompt.fixed()).toContain("Senhor Marcos")
      expect(SystemPrompt.fixed()).not.toContain("{{MARKSCODE_PROMPT_USER_NAME}}")
      expect(SystemPrompt.fixed()).not.toStartWith("Nome/tratamento atual do usuário:")
    }),
  )

  it.effect("uses configured names literally from marks_agent env and global", () =>
    Effect.gen(function* () {
      process.env.MARKSCODE_ACCOUNT_NAME = "Marcos"
      expect(SystemPrompt.resolvePromptUserName()).toBe("Marcos")
      expect(SystemPrompt.fixed()).toContain("Marcos")
      expect(SystemPrompt.fixed()).not.toContain("Sr. Marcos")

      delete process.env.MARKSCODE_ACCOUNT_NAME
      SystemPrompt.setPromptUserName("Doutor Marcos")
      expect(SystemPrompt.resolvePromptUserName()).toBe("Doutor Marcos")
    }),
  )

  it.effect("propagates runtime preferred name to fixed and provider prompts", () =>
    Effect.gen(function* () {
      SystemPrompt.setPromptUserName("Meu Nome")
      expect(process.env.MARKSCODE_RUNTIME_PROMPT_USER_NAME).toBe("Meu Nome")
      const fixed = SystemPrompt.fixed()
      expect(fixed).toStartWith("Nome/tratamento atual do usuário: Meu Nome.")
      expect(fixed).toContain("Meu Nome")
      expect(fixed).not.toContain("Senhor Marcos")
      expect(fixed).not.toContain("{{MARKSCODE_PROMPT_USER_NAME}}")
      const provider = SystemPrompt.provider(fakeModel).join("\n")
      expect(provider).toStartWith("Nome/tratamento atual do usuário: Meu Nome.")
      expect(provider).toContain("Meu Nome")
      expect(provider).not.toContain("Senhor Marcos")
      expect(provider).not.toContain("{{MARKSCODE_PROMPT_USER_NAME}}")
    }),
  )

  it.effect("loads saved preferred name for fixed prompt without runtime state", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await using tmp = await tmpdir()
        Global.Path.state = tmp.path
        const saved = await SystemPrompt.savePromptUserName("Novo Nome")
        SystemPrompt.setPromptUserName(undefined)
        delete process.env.MARKSCODE_RUNTIME_PROMPT_USER_NAME

        expect(saved).toBe("Novo Nome")
        expect(await Bun.file(join(Global.Path.state, "prompt-user-name.json")).json()).toEqual({ name: "Novo Nome" })
        expect(SystemPrompt.loadStoredPromptUserName()).toBe("Novo Nome")
        expect(SystemPrompt.resolvePromptUserName()).toBe("Novo Nome")
        expect(SystemPrompt.fixed()).toContain("Novo Nome")
        expect(SystemPrompt.fixed()).not.toContain("Senhor Marcos")
      })
    }),
  )

  it.effect("renders fixed prompt from state file without placeholder or default", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await using tmp = await tmpdir()
        Global.Path.state = tmp.path
        await Bun.write(join(Global.Path.state, "prompt-user-name.json"), JSON.stringify({ name: "Novo Nome" }))
        SystemPrompt.setPromptUserName(undefined)
        delete process.env.MARKSCODE_RUNTIME_PROMPT_USER_NAME

        const fixed = SystemPrompt.fixed()
        expect(fixed).toContain("Novo Nome")
        expect(fixed).not.toContain("{{MARKSCODE_PROMPT_USER_NAME}}")
        expect(fixed).not.toContain("Senhor Marcos")
      })
    }),
  )

  it.effect("fails open when stored preferred name is missing or invalid", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await using tmp = await tmpdir()
        Global.Path.state = tmp.path

        expect(SystemPrompt.loadStoredPromptUserName()).toBeUndefined()
        await Bun.write(join(Global.Path.state, "prompt-user-name.json"), "{")
        expect(SystemPrompt.loadStoredPromptUserName()).toBeUndefined()
      })
    }),
  )

  it.effect("clears runtime preferred name without clearing configured env priority", () =>
    Effect.gen(function* () {
      process.env.MARKSCODE_ACCOUNT_NAME = "Nome Env"
      SystemPrompt.setPromptUserName("Meu Nome")
      expect(SystemPrompt.resolvePromptUserName()).toBe("Nome Env")
      SystemPrompt.setPromptUserName(undefined)
      expect(process.env.MARKSCODE_RUNTIME_PROMPT_USER_NAME).toBeUndefined()
      expect(SystemPrompt.resolvePromptUserName()).toBe("Nome Env")
    }),
  )

  it.effect("uses marks_agent config before global name", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await using tmp = await tmpdir()
        process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH = join(tmp.path, "modules.json")
        await Bun.write(
          process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH,
          JSON.stringify({ modules: { markscode: { configurator: { env: { MARKSCODE_PROFILE_NAME: "Eng. Marcos" } } } } }),
        )
        clearMarksAgentConfigSourceCache()
        SystemPrompt.setPromptUserName("Outro Nome")
        expect(SystemPrompt.resolvePromptUserName()).toBe("Eng. Marcos")
      })
    }),
  )

  it.effect("sanitizes whitespace and limits chars", () =>
    Effect.gen(function* () {
      SystemPrompt.setPromptUserName("  Senhor\n\tMarcos  ".repeat(10))
      expect(SystemPrompt.resolvePromptUserName()).toBe("Senhor Marcos Senhor Marcos Senhor Marcos Senhor Marcos Senhor Marcos Senhor Mar")
      expect(SystemPrompt.resolvePromptUserName().length).toBe(80)
    }),
  )

  it.effect("skills output is sorted by name and stable across calls", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const first = yield* prompt.skills(build)
      const second = yield* prompt.skills(build)
      const output = first ?? (yield* Effect.fail(new NamedError.Unknown({ message: "missing skills output" })))

      expect(first).toBe(second)

      const alpha = output.indexOf("<name>alpha-skill</name>")
      const middle = output.indexOf("<name>middle-skill</name>")
      const zeta = output.indexOf("<name>zeta-skill</name>")

      expect(alpha).toBeGreaterThan(-1)
      expect(middle).toBeGreaterThan(alpha)
      expect(zeta).toBeGreaterThan(middle)
      expect(output).not.toContain("manual-skill")
    }),
  )
})
