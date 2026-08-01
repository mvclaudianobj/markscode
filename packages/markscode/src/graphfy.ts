import { accessSync, constants, existsSync, readFileSync } from "fs"
import { execFileSync } from "child_process"
import { dirname, join } from "path"
import { compressRtkText } from "./rtk"

export type GraphfyStatus = {
  available: boolean
  enabled: boolean
  cli?: string
  graph_path?: string
  nodes?: number
  edges?: number
  reason?: string
  recommendation?: string
}

function isDisabled() {
  return process.env.MARKSCODE_GRAPHFY_ENABLED === "0" || process.env.MARKSCODE_GRAPHIFY_ENABLED === "0"
}

function isExecutable(path: string) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function commandPath(command: string) {
  try {
    return execFileSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf-8", timeout: 1000 }).trim() || undefined
  } catch {
    return undefined
  }
}

function uniquePaths(paths: (string | undefined)[]) {
  return paths.filter((path, index, all): path is string => Boolean(path?.trim()) && all.indexOf(path) === index)
}

function envValue(keys: string[]) {
  return keys.map((key) => process.env[key]?.trim()).find(Boolean)
}

function hasProviderPrefix(model: string) {
  return /^[A-Za-z0-9][\w.-]*\/.+/.test(model)
}

function graphfyMarksOpenAI() {
  const baseUrl = envValue([
    "MARKSCODE_GRAPHFY_OPENAI_BASE_URL",
    "MARKSCODE_GRAPHIFY_OPENAI_BASE_URL",
    "MARKSCODE_MARKS_API_BASE_URL",
    "MARKS_OPENAI_BASE_URL",
  ]) || "https://api.marks.ia.br/v1"
  const model = envValue([
    "MARKSCODE_GRAPHFY_MODEL",
    "MARKSCODE_GRAPHIFY_MODEL",
    "MARKSCODE_MARKS_MODEL",
    "MARKS_MODEL",
  ]) || "MarksAI-3.0.0"
  const apiKey = envValue([
    "MARKSCODE_GRAPHFY_OPENAI_API_KEY",
    "MARKSCODE_GRAPHIFY_OPENAI_API_KEY",
    "MARKSCODE_API_KEY",
    "MARKS_API_KEY",
    "OPENAI_API_KEY",
  ])
  const useOpenAI = Boolean(apiKey && hasProviderPrefix(model))
  return {
    args: useOpenAI ? ["--backend", "openai", "--model", model] : ["--code-only"],
    env: useOpenAI ? { ...process.env, OPENAI_BASE_URL: baseUrl, OPENAI_MODEL: model, OPENAI_API_KEY: apiKey } : process.env,
  }
}

export function findGraphfyCli() {
  return uniquePaths([
    process.env.MARKSCODE_GRAPHFY_CLI?.trim(),
    process.env.MARKSCODE_GRAPHIFY_CLI?.trim(),
    commandPath("graphify"),
  ]).find((path) => path === "graphify" || path.includes("/") ? isExecutable(path) : Boolean(commandPath(path)))
}

function graphCandidates(projectRoot: string) {
  return uniquePaths([
    process.env.MARKSCODE_GRAPHFY_GRAPH?.trim(),
    process.env.MARKSCODE_GRAPHIFY_GRAPH?.trim(),
    join(projectRoot, "graphify-out", "graph.json"),
    join(projectRoot, "graph.json"),
  ])
}

function nodeEdgeCounts(json: unknown) {
  const root = json && typeof json === "object" && "graph" in json && json.graph && typeof json.graph === "object" ? json.graph : json
  const nodes = root && typeof root === "object" && "nodes" in root && Array.isArray(root.nodes) ? root.nodes.length : undefined
  const edges = root && typeof root === "object" && "edges" in root && Array.isArray(root.edges) ? root.edges.length : undefined
  return { nodes, edges }
}

function reportHint(graphPath: string) {
  const reportPath = join(dirname(graphPath), "GRAPH_REPORT.md")
  if (!existsSync(reportPath)) return undefined
  try {
    const result = compressRtkText({ text: readFileSync(reportPath, "utf-8"), max_lines: 6, max_chars: 600 })
    return `GRAPH_REPORT.md presente (${result.input.chars} chars; resumo RTK ${result.output.chars} chars)`
  } catch {
    return "GRAPH_REPORT.md presente, mas leitura falhou"
  }
}

export function getGraphfyStatus(input?: { projectRoot?: string }): GraphfyStatus {
  const enabled = !isDisabled()
  const cli = findGraphfyCli()
  const graphPath = graphCandidates(input?.projectRoot || process.cwd()).find((path) => existsSync(path))
  if (!enabled) {
    return {
      available: false,
      enabled,
      cli,
      graph_path: graphPath,
      reason: "Graphfy desativado por ambiente",
      recommendation: "Remover MARKSCODE_GRAPHFY_ENABLED=0 ou MARKSCODE_GRAPHIFY_ENABLED=0 para ativar",
    }
  }
  if (graphPath) {
    try {
      const counts = nodeEdgeCounts(JSON.parse(readFileSync(graphPath, "utf-8")))
      const report = reportHint(graphPath)
      return {
        available: true,
        enabled,
        cli,
        graph_path: graphPath,
        ...counts,
        reason: [`Artefato Graphify encontrado em ${graphPath}`, report].filter(Boolean).join("; "),
      }
    } catch (err) {
      return {
        available: true,
        enabled,
        cli,
        graph_path: graphPath,
        reason: `Artefato Graphify encontrado, mas JSON não pôde ser lido: ${err instanceof Error ? err.message : String(err)}`,
        recommendation: "Regerar com MARKSCODE_GRAPHFY_OPENAI_API_KEY/Marks API ou usar graphify extract . --no-viz --code-only",
      }
    }
  }
  if (cli) {
    return {
      available: true,
      enabled,
      cli,
      reason: `CLI Graphify disponível em ${cli}, sem graph.json local`,
      recommendation: "Gerar com MARKSCODE_GRAPHFY_OPENAI_API_KEY/Marks API ou graphify extract . --no-viz --code-only",
    }
  }
  return {
    available: false,
    enabled,
    reason: "Graphify local não encontrado",
    recommendation: "Opcional: instalar com uv tool install \"graphifyy[openai,sql]\" --force e gerar com MARKSCODE_GRAPHFY_OPENAI_API_KEY/Marks API ou --code-only",
  }
}

export * as Graphfy from "./graphfy"

export type GraphfySetupResult = {
  success: boolean
  step: "detect_installer" | "install" | "extract" | "done"
  message: string
  cli?: string
}

export type GraphfyExtractResult = {
  success: boolean
  step: "detect_cli" | "extract" | "done"
  message: string
  cli?: string
}

export async function graphfyExtract(projectRoot?: string): Promise<GraphfyExtractResult> {
  if (isDisabled()) {
    return {
      success: true,
      step: "done",
      message: "Graphfy desativado por ambiente.",
    }
  }
  const root = projectRoot || process.cwd()
  const cli = findGraphfyCli()
  if (!cli) {
    return {
      success: false,
      step: "detect_cli",
      message: "Graphify não encontrado. Use instalação automática ou instale graphifyy[openai,sql] via uv/pipx.",
    }
  }
  const marksOpenAI = graphfyMarksOpenAI()
  try {
    execFileSync(cli, ["extract", root, "--no-viz", ...marksOpenAI.args], { encoding: "utf-8", timeout: 10 * 60 * 1000, cwd: root, env: marksOpenAI.env })
  } catch (err) {
    return {
      success: false,
      step: "extract",
      message: `Falha ao gerar Graphify: ${err instanceof Error ? err.message : String(err)}`,
      cli,
    }
  }
  return { success: true, step: "done", message: "Graphify gerado com sucesso.", cli }
}

function detectInstaller(): { cmd: string; args: string[] } | undefined {
  const isWin = process.platform === "win32"
  if (isWin) {
    for (const cmd of ["uv", "pipx"]) {
      try {
        execFileSync("where", [cmd], { encoding: "utf-8", timeout: 2000 })
        return cmd === "uv" ? { cmd: "uv", args: ["tool", "install", "graphifyy[openai,sql]", "--force"] } : { cmd: "pipx", args: ["install", "graphifyy[openai,sql]", "--force"] }
      } catch {}
    }
    return undefined
  }
  for (const candidate of [
    process.env.HOME ? `${process.env.HOME}/.local/bin/uv` : undefined,
    "/usr/local/bin/uv",
    commandPath("uv"),
  ]) {
    if (candidate && isExecutable(candidate)) return { cmd: candidate, args: ["tool", "install", "graphifyy[openai,sql]", "--force"] }
  }
  const pipx = commandPath("pipx")
  if (pipx) return { cmd: pipx, args: ["install", "graphifyy[openai,sql]", "--force"] }
  return undefined
}

export async function graphfyAutoSetup(projectRoot?: string): Promise<GraphfySetupResult> {
  if (isDisabled()) {
    return {
      success: true,
      step: "done",
      message: "Graphfy desativado por ambiente.",
    }
  }
  const root = projectRoot || process.cwd()
  const installer = detectInstaller()
  if (!installer) {
    return {
      success: false,
      step: "detect_installer",
      message: "Nenhum instalador encontrado (uv ou pipx). Instale uv: https://docs.astral.sh/uv/",
    }
  }
  try {
    execFileSync(installer.cmd, installer.args, { encoding: "utf-8", timeout: 60000 })
  } catch (err) {
    return {
      success: false,
      step: "install",
      message: `Falha ao instalar graphifyy[openai,sql]: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  const cli = findGraphfyCli()
  if (!cli) {
    return {
      success: false,
      step: "install",
      message: "graphifyy[openai,sql] instalado mas CLI graphify não encontrado no PATH. Reinicie o terminal ou verifique o PATH.",
    }
  }
  const marksOpenAI = graphfyMarksOpenAI()
  try {
    execFileSync(cli, ["extract", root, "--no-viz", ...marksOpenAI.args], { encoding: "utf-8", timeout: 120000, cwd: root, env: marksOpenAI.env })
  } catch (err) {
    return {
      success: false,
      step: "extract",
      message: `CLI disponível mas extração falhou: ${err instanceof Error ? err.message : String(err)}`,
      cli,
    }
  }
  return { success: true, step: "done", message: "Graphify instalado e grafo gerado com sucesso.", cli }
}
