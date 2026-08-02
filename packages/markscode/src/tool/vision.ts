import { Effect, Schema } from "effect"
import os from "os"
import path from "path"
import { existsSync } from "fs"
import * as Tool from "./tool"
import { getMarksAgentString } from "../marks-agent-config-source"

const DEFAULT_TIMEOUT = 60
const MAX_TIMEOUT = 180
const MAX_OUTPUT = 20_000

type CommandResult = { exitCode: number; stdout: string; stderr: string }

export const Parameters = Schema.Struct({
  mode: Schema.Literals(["screen", "file"])
    .annotate({ description: "Capture the current screen or parse an existing image file. Defaults to screen.", default: "screen" })
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("screen" as const))),
  imagePath: Schema.optional(Schema.String).annotate({ description: "Existing image path when mode is file" }),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in seconds (max 180). Defaults to 60" }),
  includeImage: Schema.optional(Schema.Boolean)
    .annotate({ description: "Attach the screenshot or input image when possible. Defaults to true" })
    .pipe(Schema.withDecodingDefault(Effect.succeed(true))),
})

export const VisionTool = Tool.define(
  "vision",
  Effect.succeed({
    description:
      "Capture a local screenshot or inspect an existing image with an optional OmniParser-compatible sidecar. The sidecar should receive the image path and write analysis to stdout.",
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const mode = params.mode ?? "screen"
        const timeout = Math.min(Math.max(params.timeout ?? DEFAULT_TIMEOUT, 1), MAX_TIMEOUT)
        const parser = resolveOmniParser()
        const requestedPath = mode === "file" ? params.imagePath : undefined

        yield* ctx.ask({
          permission: "vision",
          patterns: [mode, requestedPath, parser?.display].filter((item): item is string => Boolean(item)),
          always: ["*"],
          metadata: {
            mode,
            imagePath: requestedPath,
            sidecar: parser?.display,
            risk: "Screen capture and image parsing can expose sensitive local information.",
          },
        })

        const imagePath = mode === "file" ? requestedPath : yield* captureScreen(ctx)
        if (!imagePath) return missingInput(mode)
        if (!existsSync(imagePath)) return missingFile(imagePath)

        const started = Date.now()
        const result = parser ? yield* runParser(parser.command, omniParserArgs(imagePath), timeout, ctx) : undefined
        const bytes = params.includeImage ? yield* Effect.promise(() => Bun.file(imagePath).bytes()) : undefined
        const output = result
          ? parserOutput(imagePath, parser.display, result, Date.now() - started)
          : parserMissingOutput(imagePath)

        return {
          title: params.mode === "screen" ? "Screen vision" : `Vision: ${imagePath}`,
          output,
          metadata: {
            imagePath,
            parser: parser?.display,
            exitCode: result?.exitCode,
            durationMs: result ? Date.now() - started : 0,
            configured: Boolean(parser?.configured),
          },
          attachments: bytes
            ? [
                {
                  type: "file" as const,
                  mime: "image/png",
                  url: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
                },
              ]
            : undefined,
        }
      }).pipe(Effect.orDie),
  }),
)

function resolveOmniParser() {
  const env = getMarksAgentString("MARKSCODE_OMNIPARSER_BIN") || process.env.MARKSCODE_OMNIPARSER_BIN
  if (env) return { command: expandHome(env), display: env, configured: true }
  const ecosystemEnv = getMarksAgentString("MARKS_ECOSYSTEM_DIR") || process.env.MARKS_ECOSYSTEM_DIR
  const ecosystem = ecosystemEnv ? expandHome(ecosystemEnv) : path.join(os.homedir(), ".marks", "ecosystem")
  const candidates = [
    path.join(ecosystem, "bin", "omniparser"),
    path.join(os.homedir(), ".markscode", "bin", "vendor", "omniparser", "omniparser"),
  ]
  const local = candidates.find((candidate) => existsSync(candidate))
  if (local) return { command: local, display: local, configured: true }
  return { command: "omniparser", display: "omniparser", configured: false }
}

function omniParserArgs(imagePath: string) {
  const template = getMarksAgentString("MARKSCODE_OMNIPARSER_ARGS") || process.env.MARKSCODE_OMNIPARSER_ARGS
  if (!template) return [imagePath]
  const parts = template.split(" ").filter(Boolean).map((part) => (part === "{image}" ? imagePath : part))
  if (parts.includes(imagePath)) return parts
  return [...parts, imagePath]
}

function captureScreen(ctx: Tool.Context) {
  const file = path.join(os.tmpdir(), `markscode-vision-${ctx.sessionID}-${ctx.callID ?? Date.now()}.png`)
  const commands = process.platform === "darwin" ? [["screencapture", "-x", file]] : screenCommands(file)
  return Effect.gen(function* () {
    const result = yield* Effect.forEach(commands, (command) => runCommand(command[0]!, command.slice(1), 15, ctx), { concurrency: 1 })
    return result.some((item) => item.exitCode === 0 && existsSync(file)) ? file : undefined
  })
}

function screenCommands(file: string) {
  if (process.platform === "win32") return []
  return [
    ["grim", file],
    ["gnome-screenshot", "-f", file],
    ["import", "-window", "root", file],
    ["scrot", file],
  ]
}

function runParser(command: string, args: string[], timeout: number, ctx: Tool.Context) {
  return runCommand(command, args, timeout, ctx)
}

function runCommand(command: string, args: string[], timeout: number, ctx: Tool.Context) {
  return Effect.promise(async () => {
    return await runCommandPromise(command, args, timeout, ctx)
  })
}

async function runCommandPromise(command: string, args: string[], timeout: number, ctx: Tool.Context): Promise<CommandResult> {
  try {
    const process = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" })
    const timer = setTimeout(() => process.kill(), timeout * 1000)
    const result = await process.exited
      .then(async (exitCode) => ({
        exitCode,
        stdout: await new Response(process.stdout).text(),
        stderr: await new Response(process.stderr).text(),
      }))
      .catch((error: Error) => ({ exitCode: -1, stdout: "", stderr: error.message }))
    clearTimeout(timer)
    if (ctx.abort.aborted) process.kill()
    return result
  } catch (error) {
    return { exitCode: -1, stdout: "", stderr: error instanceof Error ? error.message : String(error) }
  }
}

function parserOutput(imagePath: string, parser: string, result: CommandResult, durationMs: number) {
  const stdout = limit(result.stdout.trim())
  const stderr = limit(result.stderr.trim())
  if (result.exitCode === 0) return [`Image: ${imagePath}`, `Parser: ${parser}`, `Duration: ${durationMs}ms`, stdout || "No parser output."].join("\n")
  return [
    `Image saved: ${imagePath}`,
    `OmniParser sidecar failed: ${parser}`,
    `Exit code: ${result.exitCode}`,
    stderr || stdout || "No error output.",
    configureMessage(),
  ].join("\n")
}

function parserMissingOutput(imagePath: string) {
  return [`Image saved: ${imagePath}`, "OmniParser sidecar was not configured or not available.", configureMessage()].join("\n")
}

function missingInput(mode: "screen" | "file") {
  return {
    title: "Vision unavailable",
    output: mode === "file" ? "Set imagePath when mode=file." : "Screen capture is not supported on this platform or no screenshot command was available.",
    metadata: { configured: false, durationMs: 0 },
  }
}

function missingFile(imagePath: string) {
  return {
    title: "Vision file missing",
    output: `Image file not found: ${imagePath}`,
    metadata: { imagePath, configured: false, durationMs: 0 },
  }
}

function configureMessage() {
  return "Configure MARKSCODE_OMNIPARSER_BIN or provide ~/.marks/ecosystem/bin/omniparser / ~/.markscode/bin/vendor/omniparser/omniparser. The wrapper should receive the image path and write analysis to stdout."
}

function limit(text: string) {
  if (text.length <= MAX_OUTPUT) return text
  return `${text.slice(0, MAX_OUTPUT)}\n... truncated ...`
}

function expandHome(input: string) {
  if (input === "~") return os.homedir()
  if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(os.homedir(), input.slice(2))
  return input
}
