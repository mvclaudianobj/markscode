export type RtkStats = {
  chars: number
  lines: number
}

export type RtkCompressInput = {
  text: string
  max_lines?: number
  max_chars?: number
}

export type RtkCompressResult = {
  text: string
  input: RtkStats
  output: RtkStats
}

export type RtkExtractInput = {
  text: string
  pattern: string
  regex?: boolean
  context?: number
  limit?: number
}

export type RtkExtractMatch = {
  line: number
  text: string
  match: boolean
}

export type RtkExtractResult = {
  matches: RtkExtractMatch[]
  input: RtkStats
  output: RtkStats
  pattern: string
}

const ansiPattern = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

export function stripRtkAnsi(text: string) {
  return text.replace(ansiPattern, "")
}

export function rtkStats(text: string): RtkStats {
  return {
    chars: text.length,
    lines: text.length ? text.split("\n").length : 0,
  }
}

function normalizeText(text: string) {
  return stripRtkAnsi(text.replace(/\r\n?/g, "\n"))
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function limitLines(lines: string[], maxLines: number) {
  if (lines.length <= maxLines) return lines
  if (maxLines <= 2) return lines.slice(0, maxLines)
  const head = Math.max(1, Math.floor((maxLines - 1) / 2))
  const tail = Math.max(1, maxLines - head - 1)
  return [...lines.slice(0, head), `[... ${lines.length - head - tail} lines omitted ...]`, ...lines.slice(lines.length - tail)]
}

function limitChars(text: string, maxChars: number) {
  if (text.length <= maxChars) return text
  if (maxChars <= 32) return text.slice(0, maxChars)
  const marker = "\n[... content omitted ...]\n"
  const side = Math.max(1, Math.floor((maxChars - marker.length) / 2))
  return text.slice(0, side).trimEnd() + marker + text.slice(-side).trimStart()
}

export function compressRtkText(input: RtkCompressInput): RtkCompressResult {
  const normalized = normalizeText(input.text)
  const maxLines = Math.max(1, Math.floor(input.max_lines ?? 120))
  const maxChars = Math.max(1, Math.floor(input.max_chars ?? 12000))
  const byLines = limitLines(normalized ? normalized.split("\n") : [], maxLines).join("\n")
  const text = limitChars(byLines, maxChars)
  return {
    text,
    input: rtkStats(input.text),
    output: rtkStats(text),
  }
}

function matcher(input: RtkExtractInput) {
  if (input.regex) return new RegExp(input.pattern, "i")
  const needle = input.pattern.toLowerCase()
  return { test: (line: string) => line.toLowerCase().includes(needle) }
}

export function extractRtkText(input: RtkExtractInput): RtkExtractResult {
  const text = normalizeText(input.text)
  const lines = text ? text.split("\n") : []
  const test = matcher(input)
  const context = Math.max(0, Math.floor(input.context ?? 0))
  const limit = Math.max(1, Math.floor(input.limit ?? 50))
  const selected = new Set<number>()
  lines.forEach((line, index) => {
    if (selected.size >= limit * (context * 2 + 1)) return
    if (!test.test(line)) return
    Array.from({ length: context * 2 + 1 }, (_, offset) => index - context + offset)
      .filter((lineIndex) => lineIndex >= 0 && lineIndex < lines.length)
      .forEach((lineIndex) => selected.add(lineIndex))
  })
  const matches = [...selected].sort((a, b) => a - b).map((index) => ({
    line: index + 1,
    text: lines[index] ?? "",
    match: test.test(lines[index] ?? ""),
  }))
  const outputText = matches.map((item) => item.text).join("\n")
  return {
    matches,
    input: rtkStats(input.text),
    output: rtkStats(outputText),
    pattern: input.pattern,
  }
}

export * as Rtk from "./rtk"
