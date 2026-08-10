import { describe, expect, test } from "bun:test"
import { TuiKeybind } from "../../src/cli/cmd/tui/config/keybind"

describe("tui keybinds", () => {
  test("submits dialog prompts with return by default", () => {
    const keybinds = TuiKeybind.Keybinds.parse({})

    expect(keybinds.dialog_prompt_submit).toBe("return")
    expect(TuiKeybind.CommandMap.dialog_prompt_submit).toBe("dialog.prompt.submit")
  })

  test("accepts legacy dialog prompt submit key", () => {
    const keybinds = TuiKeybind.Keybinds.parse({ "dialog.prompt.submit": "ctrl+return" } as TuiKeybind.KeybindOverrides)

    expect(keybinds.dialog_prompt_submit).toBe("ctrl+return")
    expect(TuiKeybind.unknownKeys({ "dialog.prompt.submit": "ctrl+return" })).toEqual([])
  })

  test("accepts dialog prompt submit key", () => {
    const keybinds = TuiKeybind.Keybinds.parse({ dialog_prompt_submit: "ctrl+y" })

    expect(keybinds.dialog_prompt_submit).toBe("ctrl+y")
    expect(TuiKeybind.unknownKeys({ dialog_prompt_submit: "ctrl+y" })).toEqual([])
  })

  test("maps preferred name command key", () => {
    const keybinds = TuiKeybind.Keybinds.parse({})

    expect(keybinds.markscode_profile_name).toBe("ctrl+y")
    expect(TuiKeybind.CommandMap.markscode_profile_name).toBe("markscode.profile.name")
  })
})
