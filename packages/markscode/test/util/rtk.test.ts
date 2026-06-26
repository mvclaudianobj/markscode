import { describe, expect, test } from "bun:test"
import { compressRtkText, extractRtkText, stripRtkAnsi } from "../../src/rtk"

describe("rtk", () => {
  test("strips ansi sequences", () => {
    expect(stripRtkAnsi("\u001b[31merror\u001b[0m")).toBe("error")
  })

  test("compresses long text deterministically", () => {
    const result = compressRtkText({
      text: Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n\n\n"),
      max_lines: 5,
      max_chars: 200,
    })
    expect(result.text).toContain("lines omitted")
    expect(result.output.lines).toBeLessThanOrEqual(5)
    expect(result.input.chars).toBeGreaterThan(result.output.chars)
  })

  test("limits compressed chars preserving start and end", () => {
    const result = compressRtkText({ text: "a".repeat(100) + "\nEND", max_lines: 10, max_chars: 60 })
    expect(result.text).toContain("content omitted")
    expect(result.text).toContain("END")
    expect(result.output.chars).toBeLessThanOrEqual(80)
  })

  test("extracts string pattern with context", () => {
    const result = extractRtkText({ text: "alpha\nbeta\ngamma\ndelta", pattern: "gamma", context: 1 })
    expect(result.matches.map((item) => item.line)).toEqual([2, 3, 4])
    expect(result.matches.find((item) => item.line === 3)?.match).toBe(true)
  })

  test("extracts regex pattern", () => {
    const result = extractRtkText({ text: "warn: one\nerror: two", pattern: "^error", regex: true })
    expect(result.matches).toEqual([{ line: 2, text: "error: two", match: true }])
  })
})
