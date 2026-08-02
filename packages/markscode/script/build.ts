#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

import { Script } from "@opencode-ai/script"
import pkg from "../package.json"

// Load migrations from migration directories
const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const sourcemapsFlag = process.argv.includes("--sourcemaps")
const plugin = createSolidTransformPlugin()
const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")

const createEmbeddedWebUIBundle = async () => {
  console.log(`Building Web UI to embed in the binary`)
  const appDir = path.join(import.meta.dirname, "../../app")
  const dist = path.join(appDir, "dist")
  await $`OPENCODE_CHANNEL=${Script.channel} bun run --cwd ${appDir} build`
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.endsWith(".map"))
    .sort()
  const imports = files.map((file, i) => {
    const spec = path.relative(dir, path.join(dist, file)).replaceAll("\\", "/")
    return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
  })
  const entries = files.map((file, i) => `  ${JSON.stringify(file)}: file_${i},`)
  return [
    `// Import all files as file_$i with type: "file"`,
    ...imports,
    `// Export with original mappings`,
    `export default {`,
    ...entries,
    `}`,
  ].join("\n")
}

const embeddedFileMap = skipEmbedWebUi ? null : await createEmbeddedWebUIBundle()

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "x64",
    avx2: false,
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: false,
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "x64",
    avx2: false,
  },
  {
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
    avx2: false,
  },
]

const targets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }

      // When building for the current platform, prefer a single native binary by default.
      // Baseline binaries require additional Bun artifacts and can be flaky to download.
      if (item.avx2 === false) {
        return baselineFlag
      }

      // also skip abi-specific builds for the same reason
      if (item.abi !== undefined) {
        return false
      }

      return true
    })
  : allTargets

const memvidBinaryName = (os: string) => os === "win32" ? "markscode-memvid.exe" : "markscode-memvid"

const targetPlatformArch = (item: { os: string; arch: string; abi?: "musl" }) => `${item.os}-${item.arch}${item.abi ? `-${item.abi}` : ""}`

const isCurrentRuntimeTarget = (item: { os: string; arch: string; abi?: "musl" }) => item.os === process.platform && item.arch === process.arch && item.abi === undefined

const canExecuteMemvidTarget = (item: { os: string; arch: string; abi?: "musl" }) => item.os === process.platform && item.arch === process.arch

const memvidRustTargets: Record<string, string> = {
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64-musl": "x86_64-unknown-linux-musl",
  "linux-arm64-musl": "aarch64-unknown-linux-musl",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
}

function runMemvidCommand(args: string[], cwd?: string) {
  const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" })
  return {
    ok: result.exitCode === 0,
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr).trim(),
    exitCode: result.exitCode ?? 1,
  }
}

function compatibleOfficialMemvidCLI(file: string) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false
  const result = runMemvidCommand([file, "contract", "--json"])
  if (!result.ok) return false
  try {
    const body = JSON.parse(result.stdout) as Record<string, unknown>
    return body.tool === "markscode-memvid" && Number(body.contract_version) === 1
  } catch {
    return false
  }
}

function existingMemvidSidecar(file: string) {
  return fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size > 0
}

async function validateMemvidSidecar(file: string, item: { os: string; arch: string; abi?: "musl" }) {
  if (canExecuteMemvidTarget(item)) {
    if (!compatibleOfficialMemvidCLI(file)) throw new Error(`markscode-memvid failed contract validation at ${file}`)
    return
  }
  if (!existingMemvidSidecar(file)) throw new Error(`markscode-memvid sidecar missing or empty at ${file}`)
}

function memvidSidecarCandidates(item: { os: string; arch: string; abi?: "musl" }, targetName: string) {
  return [
    process.env.MARKSCODE_MEMVID_CLI && isCurrentRuntimeTarget(item) ? process.env.MARKSCODE_MEMVID_CLI : undefined,
    path.join(dir, "vendor/memvid", targetPlatformArch(item), memvidBinaryName(item.os)),
    path.join(dir, "vendor/memvid", targetName, memvidBinaryName(item.os)),
  ].filter((candidate): candidate is string => Boolean(candidate))
}

const memvidSourceDir = process.env.MARKSCODE_MEMVID_SOURCE_DIR || process.env.MEMVID_DIR || "/media/marcos/Arquivos/projetos/marks/ecosystem/systems/memvid"
const requireMemvid = process.env.MARKSCODE_REQUIRE_MEMVID === "1"

function memvidErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function graphifyEnvValue(keys: string[]) {
  return keys.map((key) => process.env[key]?.trim()).find(Boolean)
}

function graphifyDisabled() {
  return process.env.MARKSCODE_GRAPHFY_ENABLED === "0" || process.env.MARKSCODE_GRAPHIFY_ENABLED === "0"
}

function graphifyHasProviderPrefix(model: string) {
  return /^[A-Za-z0-9][\w.-]*\/.+/.test(model)
}

function graphifyMarksOpenAI() {
  const baseUrl = graphifyEnvValue([
    "MARKSCODE_GRAPHFY_OPENAI_BASE_URL",
    "MARKSCODE_GRAPHIFY_OPENAI_BASE_URL",
    "MARKSCODE_MARKS_API_BASE_URL",
    "MARKS_OPENAI_BASE_URL",
  ]) || "https://api.marks.ia.br/v1"
  const model = graphifyEnvValue([
    "MARKSCODE_GRAPHFY_MODEL",
    "MARKSCODE_GRAPHIFY_MODEL",
    "MARKSCODE_MARKS_MODEL",
    "MARKS_MODEL",
  ]) || "MarksAI-3.0.0"
  const apiKey = graphifyEnvValue([
    "MARKSCODE_GRAPHFY_OPENAI_API_KEY",
    "MARKSCODE_GRAPHIFY_OPENAI_API_KEY",
    "MARKSCODE_API_KEY",
    "MARKS_API_KEY",
    "OPENAI_API_KEY",
  ])
  const useOpenAI = Boolean(apiKey && graphifyHasProviderPrefix(model))
  return {
    args: useOpenAI ? ["extract", ".", "--no-viz", "--backend", "openai", "--model", model] : ["extract", ".", "--no-viz", "--code-only"],
    env: useOpenAI ? { ...process.env, OPENAI_BASE_URL: baseUrl, OPENAI_MODEL: model, OPENAI_API_KEY: apiKey } : process.env,
  }
}

async function prepareMemvidVendorSidecars(items: { os: string; arch: string; abi?: "musl" }[]) {
  if (process.env.MARKSCODE_PREPARE_MEMVID_VENDOR === "0") return
  if (!fs.existsSync(path.join(memvidSourceDir, "Cargo.toml"))) return
  const itemsByTarget = new Map(items.map((item) => [targetPlatformArch(item), item]))
  for (const item of itemsByTarget.values()) {
    const rustTarget = memvidRustTargets[targetPlatformArch(item)]
    if (!rustTarget) continue
    console.log(`Preparing Memvid vendor sidecar for ${targetPlatformArch(item)} using ${rustTarget}`)
    const result = runMemvidCommand(["cargo", "build", "--release", "--bin", "markscode-memvid", "--target", rustTarget], memvidSourceDir)
    if (!result.ok) {
      const message = `Failed to build markscode-memvid vendor sidecar for ${targetPlatformArch(item)}${result.stderr.includes("rustup target add") ? `; hint: rustup target add ${rustTarget}` : ""}`
      if (requireMemvid) throw new Error(`${message}: ${result.stderr || result.stdout}`)
      console.warn(message)
      continue
    }
    const source = path.join(memvidSourceDir, "target", rustTarget, "release", memvidBinaryName(item.os))
    const destination = path.join(dir, "vendor/memvid", targetPlatformArch(item), memvidBinaryName(item.os))
    try {
      await validateMemvidSidecar(source, item)
      await fs.promises.mkdir(path.dirname(destination), { recursive: true })
      await fs.promises.copyFile(source, destination)
      if (item.os !== "win32") await fs.promises.chmod(destination, 0o755)
      await validateMemvidSidecar(destination, item)
    } catch (error) {
      const message = `Failed to prepare markscode-memvid vendor sidecar for ${targetPlatformArch(item)}: ${memvidErrorMessage(error)}`
      if (requireMemvid) throw new Error(message)
      console.warn(message)
    }
  }
}

async function buildNativeMemvidSidecar(item: { os: string; arch: string; abi?: "musl" }) {
  if (!isCurrentRuntimeTarget(item)) return undefined
  if (!fs.existsSync(path.join(memvidSourceDir, "Cargo.toml"))) return undefined
  console.log(`Building official Memvid sidecar from ${memvidSourceDir}`)
  const result = runMemvidCommand(["cargo", "build", "--release", "--bin", "markscode-memvid"], memvidSourceDir)
  if (!result.ok) throw new Error(`Failed to build markscode-memvid: ${result.stderr || result.stdout}`)
  const binary = path.join(memvidSourceDir, "target", "release", memvidBinaryName(item.os))
  if (!compatibleOfficialMemvidCLI(binary)) throw new Error(`Built markscode-memvid is not contract_version 1 compatible: ${binary}`)
  return binary
}

async function copyMemvidSidecar(item: { os: string; arch: string; abi?: "musl" }, targetName: string) {
  const builtSource = await buildNativeMemvidSidecar(item)
  const source = builtSource || memvidSidecarCandidates(item, targetName).find((candidate) => canExecuteMemvidTarget(item) ? compatibleOfficialMemvidCLI(candidate) : existingMemvidSidecar(candidate))
  if (!source) {
    const message = `Official Memvid sidecar not bundled for ${targetName}; set MARKSCODE_MEMVID_CLI to a compatible markscode-memvid or add vendor/memvid/${targetPlatformArch(item)}/${memvidBinaryName(item.os)}`
    if (process.env.MARKSCODE_REQUIRE_MEMVID === "1") throw new Error(message)
    console.warn(message)
    return
  }

  const destination = path.join(dir, "dist", targetName, "bin", "vendor/memvid", memvidBinaryName(item.os))
  await fs.promises.mkdir(path.dirname(destination), { recursive: true })
  await fs.promises.copyFile(source, destination)
  if (item.os !== "win32") await fs.promises.chmod(destination, 0o755)
  await validateMemvidSidecar(destination, item)
  console.log(`Bundled Memvid sidecar for ${targetName}: ${source} -> ${destination}`)
}

async function setupGraphify() {
  if (graphifyDisabled()) {
    console.log("setupGraphify: disabled by MARKSCODE_GRAPHFY_ENABLED=0")
    return
  }

  const uvCandidates = [
    process.env.UV_PATH,
    path.join(process.env.HOME ?? "/root", ".local/bin/uv"),
    "/usr/local/bin/uv",
    "/usr/bin/uv",
  ].filter(Boolean) as string[]

  const uv = uvCandidates.find((p) => {
    try { return fs.existsSync(p) } catch { return false }
  })

  if (!uv) {
    console.warn("setupGraphify: uv not found; skipping graphify setup")
    return
  }

  console.log(`setupGraphify: installing graphifyy extras via uv (${uv})`)
  try {
    await $`${uv} tool install graphifyy[openai,sql] --force --quiet`.quiet()
    console.log("setupGraphify: graphifyy extras installed")
  } catch {
    console.warn("setupGraphify: uv tool install graphifyy extras failed; skipping")
    return
  }

  const graphifyCandidates = [
    path.join(process.env.HOME ?? "/root", ".local/bin/graphify"),
    "/usr/local/bin/graphify",
  ]
  const graphify = graphifyCandidates.find((p) => {
    try { return fs.existsSync(p) } catch { return false }
  })

  if (!graphify) {
    console.warn("setupGraphify: graphify binary not found after install; skipping extract")
    return
  }

  console.log(`setupGraphify: running graphify extract (${graphify})`)
  try {
    const graphifyOpenAI = graphifyMarksOpenAI()
    const result = Bun.spawnSync([graphify, ...graphifyOpenAI.args], { cwd: dir, env: graphifyOpenAI.env, stdout: "pipe", stderr: "pipe" })
    if (result.exitCode !== 0) {
      console.warn(new TextDecoder().decode(result.stderr).trim() || "setupGraphify: graphify extract failed")
      return
    }
    console.log("setupGraphify: graphify extract done")
  } catch {
    console.warn("setupGraphify: graphify extract failed (non-fatal)")
  }
}

await $`rm -rf dist`

await prepareMemvidVendorSidecars(targets)

const binaries: Record<string, string> = {}
if (!skipInstall) {
  await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
}





































































// Compat: ensure @opentui/solid re-exports Solid control-flow helpers
{
  const localSolid = path.resolve(dir, "node_modules/@opentui/solid/index.js")
  const rootSolid = path.resolve(dir, "../../node_modules/@opentui/solid/index.js")
  const solidFile = fs.existsSync(localSolid) ? localSolid : rootSolid
  if (fs.existsSync(solidFile)) {
    const text = fs.readFileSync(solidFile, "utf8")
    const line = 'export { For, Show, Switch, Match } from "solid-js"\n'
    if (!text.includes('export { For, Show, Switch, Match } from "solid-js"')) {
      fs.writeFileSync(solidFile, text + "\n" + line)
    }
  }
}

for (const item of targets) {
  const name = [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
  const rootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
  const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)
  const workerPath = "./src/cli/cmd/tui/worker.ts"

  // Use platform-specific bunfs root path based on target OS
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

  await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: [plugin],
    external: ["node-gyp"],
    format: "esm",
    minify: true,
    sourcemap: sourcemapsFlag ? "linked" : "none",
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace(pkg.name, "bun") as any,
      outfile: `dist/${name}/bin/markscode`,
      execArgv: [`--user-agent=markscode/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    files: embeddedFileMap ? { "markscode-web-ui.gen.ts": embeddedFileMap } : {},
    entrypoints: ["./src/index.ts", parserWorker, workerPath, ...(embeddedFileMap ? ["markscode-web-ui.gen.ts"] : [])],
    define: {
      OPENCODE_VERSION: `'${Script.version}'`,
      OPENCODE_MIGRATIONS: JSON.stringify(migrations),
      OPENCODE_MODELS_DEV: generated.modelsData,
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
      OPENCODE_WORKER_PATH: workerPath,
      OPENCODE_CHANNEL: `'${Script.channel}'`,
      OPENCODE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
    },
  })

  await copyMemvidSidecar(item, name)

  // Smoke test: only run if binary is for current platform
  if (item.os === process.platform && item.arch === process.arch && !item.abi) {
    await setupGraphify()
    const binaryPath = `dist/${name}/bin/markscode`
    console.log(`Running smoke test: ${binaryPath} --version`)
    try {
      const versionOutput = await $`${binaryPath} --version`.text()
      console.log(`Smoke test passed: ${versionOutput.trim()}`)
    } catch (e) {
      console.error(`Smoke test failed for ${name}:`, e)
      process.exit(1)
    }
  }

  await $`rm -rf ./dist/${name}/bin/tui`
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        preferUnplugged: true,
        os: [item.os],
        cpu: [item.arch],
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
}

if (Script.release) {
  const releaseRepo = process.env.GH_REPO ?? (await $`gh repo view --json nameWithOwner --jq .nameWithOwner`.text()).trim()
  if (!releaseRepo) {
    throw new Error('GH_REPO is required for release uploads. Set GH_REPO as "owner/repo" or ensure `gh repo view` works.')
  }
  const archives = []
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      const out = path.resolve("dist", `${key}.tar.gz`)
      await $`tar -czf ${out} *`.cwd(`dist/${key}/bin`)
      archives.push(out)
    } else {
      const out = path.resolve("dist", `${key}.zip`)
      await $`zip -r ${out} *`.cwd(`dist/${key}/bin`)
      archives.push(out)
    }
  }
  if (archives.length > 0) {
    await $`gh release view v${Script.version} --repo ${releaseRepo}`.quiet().catch(async () => {
      await $`gh release create v${Script.version} -d --title v${Script.version} --repo ${releaseRepo}`
    })
    await $`gh release upload v${Script.version} ${archives} --clobber --repo ${releaseRepo}`
  }
}

export { binaries }
