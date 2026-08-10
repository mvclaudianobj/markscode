import { describe, expect, test } from "bun:test"
import { VisualLabel } from "../src/visual-label"

describe("visual labels", () => {
  test("formats internal model labels without changing ids", () => {
    expect(VisualLabel.model("big-pickle")).toBe("Marks-big")
    expect(VisualLabel.model("kilo-auto/free")).toBe("Marks-klfree")
    expect(VisualLabel.model("opencode turbo")).toBe("marks turbo")
  })

  test("formats provider labels visually", () => {
    expect(VisualLabel.provider("opencode-go")).toBe("marks-go")
    expect(VisualLabel.provider("kilocode")).toBe("marks")
    expect(VisualLabel.provider("big-pickle")).toBe("Marks-big")
  })

  test("keeps provider and model separated in visual labels", () => {
    expect(VisualLabel.model("big-picklemarks-free")).toBe("Marks-big/marks-free")
    expect(VisualLabel.modelWithProvider({ providerID: "big-pickle", modelID: "marks-free" })).toBe(
      "Marks-big/marks-free",
    )
    expect(VisualLabel.modelWithProvider({ providerID: "opencode", modelID: "big-picklemarks-free" })).toBe(
      "marks/Marks-big/marks-free",
    )
  })
})
