import { Effect, Layer, Schema, Context, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import path from "path"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import semver from "semver"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { NpmConfig } from "@opencode-ai/core/npm-config"

const log = Log.create({ service: "installation" })

// MARKSCODE_MARKS_UPDATER_START
const INSTALL_URLS = [
  process.env.MARKSCODE_INSTALL_URL || "https://code.marks.ia.br/install",
  process.env.MARKSCODE_INSTALL_FALLBACK_URL || "https://marks.fenixsol.com.br/install",
].filter(Boolean)

const INSTALL_WINDOWS_URLS = [
  process.env.MARKSCODE_INSTALL_WINDOWS_URL || "https://code.marks.ia.br/install-windows.ps1",
  process.env.MARKSCODE_INSTALL_WINDOWS_FALLBACK_URL || "https://marks.fenixsol.com.br/install-windows.ps1",
].filter(Boolean)

const LATEST_URLS = [
  process.env.MARKSCODE_LATEST_URL || "https://code.marks.ia.br/bin/latest.json",
  "https://code.marks.ia.br/bin/latest.txt",
  "https://marks.fenixsol.com.br/bin/latest.json",
  "https://marks.fenixsol.com.br/bin/latest.txt",
].filter(Boolean)

const PROVIDERS_SYNC_URL = process.env.MARKS_PROVIDERS_URL || "https://marks.fenixsol.com.br/providers"
const PROVIDERS_SYNC_ARGS =
  process.env.MARKS_PROVIDERS_ARGS || "--preset main"
const MARKSCODE_GITHUB_REPO = process.env.MARKSCODE_GITHUB_REPO || "mvclaudianobj/markscode"

function normalizeMarksVersion(input: string) {
  return input.trim().replace(/^v/, "")
}

async function latestFromMarks() {
  for (const url of LATEST_URLS) {
    const res = await fetch(url).catch(() => undefined)
    if (!res || !res.ok) continue
    const text = await res.text().catch(() => "")
    if (!text.trim()) continue
    let value = ""
    const contentType = (res.headers.get("content-type") || "").toLowerCase()
    if (contentType.includes("json") || text.trim().startsWith("{")) {
      try {
        const body = JSON.parse(text) as { version?: string; latest?: string; tag?: string; tag_name?: string }
        value = body.version || body.latest || body.tag || body.tag_name || ""
      } catch {}
    } else {
      value = text.split(/\s+/)[0] || ""
    }
    const normalized = normalizeMarksVersion(value)
    if (normalized) return normalized
  }

  const token = process.env.MARKSCODE_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ""
  if (token) {
    const res = await fetch("https://api.github.com/repos/" + MARKSCODE_GITHUB_REPO + "/releases/latest", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }).catch(() => undefined)
    if (res?.ok) {
      const body = (await res.json().catch(() => undefined)) as { tag_name?: string; name?: string } | undefined
      const normalized = normalizeMarksVersion(body?.tag_name || body?.name || "")
      if (normalized) return normalized
    }
  }

  throw new Error(
    "Could not determine latest MarksCode version from code.marks.ia.br/fallback. " +
      "Private GitHub fallback requires MARKSCODE_GITHUB_TOKEN, GITHUB_TOKEN or GH_TOKEN.",
  )
}

async function syncProvidersAfterUpgrade() {
  const disabled = process.env.MARKS_PROVIDERS_SYNC === "0" || process.env.MARKS_PROVIDERS_SYNC === "false"
  if (disabled || process.platform === "win32") return
  await Bun.spawn(["bash", "-lc", "curl -fsSL " + PROVIDERS_SYNC_URL + " | bash -s -- " + PROVIDERS_SYNC_ARGS], {
    stdout: "ignore",
    stderr: "ignore",
  }).exited
}
// MARKSCODE_MARKS_UPDATER_END
















export type Method = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

export type ReleaseType = "patch" | "minor" | "major"

export const Event = {
  Updated: BusEvent.define(
    "installation.updated",
    Schema.Struct({
      version: Schema.String,
    }),
  ),
  UpdateAvailable: BusEvent.define(
    "installation.update-available",
    Schema.Struct({
      version: Schema.String,
    }),
  ),
}

export function getReleaseType(current: string, latest: string): ReleaseType {
  const currMajor = semver.major(current)
  const currMinor = semver.minor(current)
  const newMajor = semver.major(latest)
  const newMinor = semver.minor(latest)

  if (newMajor > currMajor) return "major"
  if (newMinor > currMinor) return "minor"
  return "patch"
}

export const Info = z
  .object({
    version: z.string(),
    latest: z.string(),
  })
  .meta({
    ref: "InstallationInfo",
  })
export type Info = z.infer<typeof Info>

export const USER_AGENT = `markscode/${InstallationChannel}/${InstallationVersion}/${Flag.OPENCODE_CLIENT}`

export function isPreview() {
  return InstallationChannel !== "latest"
}

export function isLocal() {
  return InstallationChannel === "local"
}

export class UpgradeFailedError extends Schema.TaggedErrorClass<UpgradeFailedError>()("UpgradeFailedError", {
  stderr: Schema.String,
}) {}

// Response schemas for external version APIs
const GitHubRelease = Schema.Struct({ tag_name: Schema.String })
const NpmPackage = Schema.Struct({ version: Schema.String })
const BrewFormula = Schema.Struct({ versions: Schema.Struct({ stable: Schema.String }) })
const BrewInfoV2 = Schema.Struct({
  formulae: Schema.Array(Schema.Struct({ versions: Schema.Struct({ stable: Schema.String }) })),
})
const ChocoPackage = Schema.Struct({
  d: Schema.Struct({ results: Schema.Array(Schema.Struct({ Version: Schema.String })) }),
})
const ScoopManifest = NpmPackage

export interface Interface {
  readonly info: () => Effect.Effect<Info>
  readonly method: () => Effect.Effect<Method>
  readonly latest: (method?: Method) => Effect.Effect<string>
  readonly upgrade: (method: Method, target: string) => Effect.Effect<void, UpgradeFailedError>
}

export class Service extends Context.Service<Service, Interface>()("@markscode/Installation") {}

export const layer: Layer.Layer<Service, never, HttpClient.HttpClient | ChildProcessSpawner.ChildProcessSpawner> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const httpOk = HttpClient.filterStatusOk(withTransientReadRetry(http))
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const text = Effect.fnUntraced(
        function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
          const proc = ChildProcess.make(cmd[0], cmd.slice(1), {
            cwd: opts?.cwd,
            env: opts?.env,
            extendEnv: true,
          })
          const handle = yield* spawner.spawn(proc)
          const out = yield* Stream.mkString(Stream.decodeText(handle.stdout))
          yield* handle.exitCode
          return out
        },
        Effect.scoped,
        Effect.catch(() => Effect.succeed("")),
      )

      const run = Effect.fnUntraced(
        function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
          const proc = ChildProcess.make(cmd[0], cmd.slice(1), {
            cwd: opts?.cwd,
            env: opts?.env,
            extendEnv: true,
          })
          const handle = yield* spawner.spawn(proc)
          const [stdout, stderr] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
            { concurrency: 2 },
          )
          const code = yield* handle.exitCode
          return { code, stdout, stderr }
        },
        Effect.scoped,
        Effect.catch(() => Effect.succeed({ code: ChildProcessSpawner.ExitCode(1), stdout: "", stderr: "" })),
      )

      const getBrewFormula = Effect.fnUntraced(function* () {
        const tapFormula = yield* text(["brew", "list", "--formula", "anomalyco/tap/markscode"])
        if (tapFormula.includes("markscode")) return "anomalyco/tap/markscode"
        const coreFormula = yield* text(["brew", "list", "--formula", "markscode"])
        if (coreFormula.includes("markscode")) return "markscode"
        return "markscode"
      })

      const upgradeCurl = Effect.fnUntraced(
        function* (target: string) {
          let last: { code: ChildProcessSpawner.ExitCode; stdout: string; stderr: string } | undefined
          if (process.platform === "win32") {
            for (const url of INSTALL_WINDOWS_URLS) {
              const cmd = "irm " + url + " | iex; install-windows.ps1 -Version " + target
              const result = yield* run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd])
              last = result
              if (result.code === 0) return result
            }
            return last || { code: ChildProcessSpawner.ExitCode(1), stdout: "", stderr: "No MarksCode Windows install URL available" }
          }

          for (const url of INSTALL_URLS) {
            const cmd = "curl -fsSL " + url + " | bash -s -- --version " + target + " --preset main"
            const result = yield* run(["bash", "-lc", cmd])
            last = result
            if (result.code === 0) return result
          }
          return last || { code: ChildProcessSpawner.ExitCode(1), stdout: "", stderr: "No MarksCode install URL available" }
        },
        Effect.scoped,
        Effect.orDie,
      )

      const result: Interface = {
        info: Effect.fn("Installation.info")(function* () {
          return {
            version: InstallationVersion,
            latest: yield* result.latest(),
          }
        }),
        method: Effect.fn("Installation.method")(function* () {
          if (process.execPath.includes(path.join(".markscode", "bin"))) return "curl" as Method
          if (process.execPath.includes(path.join(".local", "bin"))) return "curl" as Method
          const exec = process.execPath.toLowerCase()

          const checks: Array<{ name: Method; command: () => Effect.Effect<string> }> = [
            { name: "npm", command: () => text(["npm", "list", "-g", "--depth=0"]) },
            { name: "yarn", command: () => text(["yarn", "global", "list"]) },
            { name: "pnpm", command: () => text(["pnpm", "list", "-g", "--depth=0"]) },
            { name: "bun", command: () => text(["bun", "pm", "ls", "-g"]) },
            { name: "brew", command: () => text(["brew", "list", "--formula", "markscode"]) },
            { name: "scoop", command: () => text(["scoop", "list", "markscode"]) },
            { name: "choco", command: () => text(["choco", "list", "--limit-output", "markscode"]) },
          ]

          checks.sort((a, b) => {
            const aMatches = exec.includes(a.name)
            const bMatches = exec.includes(b.name)
            if (aMatches && !bMatches) return -1
            if (!aMatches && bMatches) return 1
            return 0
          })

          for (const check of checks) {
            const output = yield* check.command()
            const installedName =
              check.name === "brew" || check.name === "choco" || check.name === "scoop" ? "markscode" : "markscode-ai"
            if (output.includes(installedName)) {
              return check.name
            }
          }

          return "unknown" as Method
        }),
        latest: Effect.fn("Installation.latest")(function* (installMethod?: Method) {
          const detectedMethod = installMethod || (yield* result.method())

          if (detectedMethod === "curl" || detectedMethod === "unknown") {
            return yield* Effect.tryPromise(() => latestFromMarks())
          }

          if (detectedMethod === "brew") {
            const formula = yield* getBrewFormula()
            if (formula.includes("/")) {
              const infoJson = yield* text(["brew", "info", "--json=v2", formula])
              const info = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(BrewInfoV2))(infoJson)
              return info.formulae[0].versions.stable
            }
            const response = yield* httpOk.execute(
              HttpClientRequest.get("https://formulae.brew.sh/api/formula/markscode.json").pipe(
                HttpClientRequest.acceptJson,
              ),
            )
            const data = yield* HttpClientResponse.schemaBodyJson(BrewFormula)(response)
            return data.versions.stable
          }

          if (detectedMethod === "npm" || detectedMethod === "bun" || detectedMethod === "pnpm") {
            const response = yield* httpOk.execute(
              HttpClientRequest.get(
                `${yield* NpmConfig.registry(process.cwd())}/markscode-ai/${InstallationChannel}`,
              ).pipe(HttpClientRequest.acceptJson),
            )
            const data = yield* HttpClientResponse.schemaBodyJson(NpmPackage)(response)
            return data.version
          }

          if (detectedMethod === "choco") {
            const response = yield* httpOk.execute(
              HttpClientRequest.get(
                "https://community.chocolatey.org/api/v2/Packages?$filter=Id%20eq%20%27markscode%27%20and%20IsLatestVersion&$select=Version",
              ).pipe(HttpClientRequest.setHeaders({ Accept: "application/json;odata=verbose" })),
            )
            const data = yield* HttpClientResponse.schemaBodyJson(ChocoPackage)(response)
            return data.d.results[0].Version
          }

          if (detectedMethod === "scoop") {
            const response = yield* httpOk.execute(
              HttpClientRequest.get(
                "https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/markscode.json",
              ).pipe(HttpClientRequest.setHeaders({ Accept: "application/json" })),
            )
            const data = yield* HttpClientResponse.schemaBodyJson(ScoopManifest)(response)
            return data.version
          }
          return yield* Effect.tryPromise(() => latestFromMarks())
        }, Effect.orDie),
        upgrade: Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {
          let upgradeResult: { code: ChildProcessSpawner.ExitCode; stdout: string; stderr: string } | undefined
          switch (m) {
            case "curl":
              upgradeResult = yield* upgradeCurl(target)
              break
            case "npm":
              upgradeResult = yield* run(["npm", "install", "-g", `markscode-ai@${target}`])
              break
            case "pnpm":
              upgradeResult = yield* run(["pnpm", "install", "-g", `markscode-ai@${target}`])
              break
            case "bun":
              upgradeResult = yield* run(["bun", "install", "-g", `markscode-ai@${target}`])
              break
            case "brew": {
              const formula = yield* getBrewFormula()
              const env = { HOMEBREW_NO_AUTO_UPDATE: "1" }
              if (formula.includes("/")) {
                const tap = yield* run(["brew", "tap", "anomalyco/tap"], { env })
                if (tap.code !== 0) {
                  upgradeResult = tap
                  break
                }
                const repo = yield* text(["brew", "--repo", "anomalyco/tap"])
                const dir = repo.trim()
                if (dir) {
                  const pull = yield* run(["git", "pull", "--ff-only"], { cwd: dir, env })
                  if (pull.code !== 0) {
                    upgradeResult = pull
                    break
                  }
                }
              }
              upgradeResult = yield* run(["brew", "upgrade", formula], { env })
              break
            }
            case "choco":
              upgradeResult = yield* run(["choco", "upgrade", "markscode", `--version=${target}`, "-y"])
              break
            case "scoop":
              upgradeResult = yield* run(["scoop", "install", `markscode@${target}`])
              break
            default:
              return yield* new UpgradeFailedError({ stderr: `Unknown method: ${m}` })
          }
          if (!upgradeResult || upgradeResult.code !== 0) {
            const stderr = m === "choco" ? "not running from an elevated command shell" : upgradeResult?.stderr || ""
            return yield* new UpgradeFailedError({ stderr })
          }
          yield* Effect.tryPromise(() => syncProvidersAfterUpgrade()).pipe(
          Effect.catch((error: unknown) =>
            Effect.sync(() => {
              log.warn("providers sync failed", { error: error instanceof Error ? error.message : String(error) })
            }),
          ),
        )
        log.info("upgraded", {
            method: m,
            target,
            stdout: upgradeResult.stdout,
            stderr: upgradeResult.stderr,
          })
          yield* text([process.execPath, "--version"])
        }),
      }

      return Service.of(result)
    }),
  )

export const defaultLayer = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
)

const { runPromise } = makeRuntime(Service, defaultLayer)

export async function info() {
  return runPromise((svc) => svc.info())
}

export async function method() {
  return runPromise((svc) => svc.method())
}

export async function latest(m?: Method) {
  return runPromise((svc) => svc.latest(m))
}

export async function upgrade(m: Method, target: string) {
  return runPromise((svc) => svc.upgrade(m, target))
}

export * as Installation from "."
