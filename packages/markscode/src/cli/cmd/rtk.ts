import type { Argv } from "yargs"
import { EOL } from "os"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { compressRtkText, extractRtkText } from "../../rtk"
import { which } from "../../util/which"

async function readInput(args: { text?: unknown; file?: unknown }) {
  if (args.text !== undefined) return String(args.text)
  if (args.file) return await Bun.file(String(args.file)).text()
  return await Bun.stdin.text()
}

function printResult(result: unknown, json: unknown, text: string) {
  if (json) {
    UI.println(JSON.stringify(result, null, 2) + EOL)
    return
  }
  UI.println(text + EOL)
}

export const RtkCommand = cmd({
  command: "rtk <action>",
  describe: "native deterministic RTK utilities",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        describe: "action to perform",
        type: "string",
        choices: ["status", "compress", "extract"],
      })
      .option("text", {
        describe: "input text",
        type: "string",
      })
      .option("file", {
        describe: "input file",
        type: "string",
      })
      .option("max-lines", {
        describe: "maximum output lines for compress",
        type: "number",
        default: 120,
      })
      .option("max-chars", {
        describe: "maximum output chars for compress",
        type: "number",
        default: 12000,
      })
      .option("pattern", {
        describe: "pattern for extract",
        type: "string",
      })
      .option("regex", {
        describe: "treat pattern as regex",
        type: "boolean",
      })
      .option("context", {
        describe: "context lines around extract matches",
        type: "number",
        default: 0,
      })
      .option("limit", {
        describe: "maximum matches for extract",
        type: "number",
        default: 50,
      })
      .option("json", {
        describe: "print JSON output",
        type: "boolean",
      }),
  handler: async (args) => {
    const action = String(args.action)

    if (action === "status") {
      const external = which("rtk")
      UI.println(JSON.stringify({ native: true, external: Boolean(external), external_path: external }, null, 2) + EOL)
      return
    }

    if (action === "compress") {
      const result = compressRtkText({
        text: await readInput(args),
        max_lines: Number(args.maxLines ?? 120),
        max_chars: Number(args.maxChars ?? 12000),
      })
      printResult(result, args.json, `${result.text}\n\n[input ${result.input.chars} chars/${result.input.lines} lines → output ${result.output.chars} chars/${result.output.lines} lines]`)
      return
    }

    if (action === "extract") {
      const pattern = args.pattern ? String(args.pattern) : ""
      if (!pattern) {
        UI.error("Missing --pattern argument for rtk extract")
        return
      }
      const result = extractRtkText({
        text: await readInput(args),
        pattern,
        regex: Boolean(args.regex),
        context: Number(args.context ?? 0),
        limit: Number(args.limit ?? 50),
      })
      printResult(result, args.json, `${result.matches.map((item) => `${item.line}: ${item.text}`).join("\n")}\n\n[input ${result.input.chars} chars/${result.input.lines} lines → output ${result.output.chars} chars/${result.output.lines} lines]`)
      return
    }

    UI.error(`Unknown action: ${action}`)
  },
})
