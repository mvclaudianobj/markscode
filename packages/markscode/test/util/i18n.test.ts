import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { clearMarksAgentConfigSourceCache } from "../../src/marks-agent-config-source"
import { interpolate, isSupportedLanguage, MESSAGES, resolveLanguage, translate } from "../../src/util/i18n"

function withEnv(value: string | undefined, fn: () => void) {
  const previous = process.env.MARKSCODE_LANGUAGE
  const previousConfig = process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH
  try {
    if (value === undefined) delete process.env.MARKSCODE_LANGUAGE
    else process.env.MARKSCODE_LANGUAGE = value
    process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH = path.join(process.cwd(), ".missing-markscode-language-test.json")
    clearMarksAgentConfigSourceCache()
    fn()
  } finally {
    if (previous === undefined) delete process.env.MARKSCODE_LANGUAGE
    else process.env.MARKSCODE_LANGUAGE = previous
    if (previousConfig === undefined) delete process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH
    else process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH = previousConfig
    clearMarksAgentConfigSourceCache()
  }
}

describe("i18n", () => {
  test("resolveLanguage defaults to en-US", () => {
    withEnv(undefined, () => {
      expect(resolveLanguage()).toBe("en-US")
      expect(resolveLanguage(undefined)).toBe("en-US")
    })
  })

  test("resolveLanguage honors config language", () => {
    withEnv(undefined, () => {
      expect(resolveLanguage("pt-BR")).toBe("pt-BR")
      expect(resolveLanguage("en-US")).toBe("en-US")
    })
  })

  test("resolveLanguage lets MARKSCODE_LANGUAGE override config", () => {
    withEnv("pt-BR", () => {
      expect(resolveLanguage("en-US")).toBe("pt-BR")
      expect(resolveLanguage(undefined)).toBe("pt-BR")
    })
  })

  test("resolveLanguage lets marks_agent config override env and config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const source = path.join(dir, "modules.json")
        await Bun.write(source, JSON.stringify({ modules: { markscode: { configurator: { env: { MARKSCODE_LANGUAGE: "pt-BR" } } } } }))
        return source
      },
    })
    const previousConfig = process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH
    const previousEnv = process.env.MARKSCODE_LANGUAGE
    try {
      process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH = tmp.extra
      process.env.MARKSCODE_LANGUAGE = "en-US"
      clearMarksAgentConfigSourceCache()
      expect(resolveLanguage("en-US")).toBe("pt-BR")
    } finally {
      if (previousConfig === undefined) delete process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH
      else process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH = previousConfig
      if (previousEnv === undefined) delete process.env.MARKSCODE_LANGUAGE
      else process.env.MARKSCODE_LANGUAGE = previousEnv
      clearMarksAgentConfigSourceCache()
    }
  })

  test("resolveLanguage ignores unsupported values", () => {
    withEnv("fr-FR", () => {
      expect(resolveLanguage("pt-BR")).toBe("pt-BR")
      expect(resolveLanguage(undefined)).toBe("en-US")
    })
  })

  test("isSupportedLanguage", () => {
    expect(isSupportedLanguage("en-US")).toBe(true)
    expect(isSupportedLanguage("pt-BR")).toBe(true)
    expect(isSupportedLanguage("fr-FR")).toBe(false)
    expect(isSupportedLanguage(undefined)).toBe(false)
  })

  test("translate returns the localized string", () => {
    expect(translate("pt-BR", "palette.title")).toBe("Comandos")
    expect(translate("en-US", "palette.title")).toBe("Commands")
  })

  test("translate falls back to en-US for missing keys", () => {
    expect(translate("pt-BR", "which_key.show_shortcuts")).toBe("Mostrar atalhos de teclado com")
    expect(translate("en-US", "which_key.show_shortcuts")).toBe("Show keyboard shortcuts with")
    expect(translate("pt-BR", "missing.key")).toBe("missing.key")
  })

  test("translate falls back to the provided fallback", () => {
    expect(translate("pt-BR", "missing.key", "fallback text")).toBe("fallback text")
  })

  test("interpolate replaces placeholders", () => {
    expect(interpolate("Press {shortcut} {rest}", { shortcut: "ctrl+p", rest: "to open" })).toBe(
      "Press ctrl+p to open",
    )
    expect(interpolate("Use {command} in {n} themes", { command: "/themes", n: "16" })).toBe("Use /themes in 16 themes")
  })

  test("interpolate keeps unknown placeholders", () => {
    expect(interpolate("Run {highlight}/connect{/highlight} now", {})).toBe(
      "Run {highlight}/connect{/highlight} now",
    )
  })

  test("catalog contains the main keys", () => {
    expect(MESSAGES["en-US"]["palette.title"]).toBe("Commands")
    expect(MESSAGES["en-US"]["tip.attach_files"]).toBeDefined()
    expect(MESSAGES["en-US"]["which_key.show_shortcuts"]).toBeDefined()
    expect(MESSAGES["en-US"]["help.title"]).toBeDefined()
    expect(MESSAGES["pt-BR"]["palette.title"]).toBe("Comandos")
    expect(MESSAGES["pt-BR"]["tip.no_models"]).toBe("Rode {highlight}/connect{/highlight} para adicionar um provedor de IA e começar a codar")
  })
})
