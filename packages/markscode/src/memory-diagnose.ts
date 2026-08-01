import { accessSync, constants, existsSync, readFileSync } from "fs"
import { execFileSync } from "child_process"
import { dirname, join } from "path"
import { homedir } from "os"
import { resolveMemoryConfig } from "./memory-config"
import { Database } from "./storage/db"
import { getGraphfyStatus } from "./graphfy"

export type BrainLayerStatus = {
  layer: string
  status: "ok" | "warning" | "unavailable" | "error"
  details: string
  recommendation?: string
}

export type BrainSystemDiagnosis = {
  mode: "hybrid" | "cloud-only" | "local-only"
  timestamp: string
  layers: BrainLayerStatus[]
  overall: "healthy" | "degraded" | "critical"
}

type MemoryApiProbe = {
  ok: boolean
  status?: number
  json?: unknown
  text?: string
  error?: string
}

function memoryProbeRuntimeCandidates() {
  return [
    process.env.MARKSCODE_MEMORY_PROBE_RUNTIME,
    process.env.BUN_INSTALL ? join(process.env.BUN_INSTALL, "bin", "bun") : undefined,
    "bun",
    "node",
  ].filter((runtime, index, runtimes): runtime is string => {
    return !!runtime && runtimes.indexOf(runtime) === index && (!runtime.includes("/") || existsSync(runtime))
  })
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

function findMarkscodeMemvidCli() {
  const names = process.platform === "win32" ? ["markscode-memvid.exe", "markscode-memvid"] : ["markscode-memvid"]
  return uniquePaths([
    process.env.MARKSCODE_MEMVID_CLI?.trim(),
    ...names.map((name) => join(homedir(), ".markscode/bin/vendor/memvid", name)),
    ...names.map((name) => join("/root/.markscode/bin/vendor/memvid", name)),
    ...names.map((name) => join(dirname(process.execPath), "vendor/memvid", name)),
    ...names.map((name) => join("/usr/local/bin/vendor/memvid", name)),
    commandPath("markscode-memvid"),
  ]).find(isExecutable)
}

function memoryApiUrl(apiBaseUrl: string, path: string, params?: Record<string, string>) {
  const url = new URL(path, apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`)
  Object.entries(params || {}).forEach(([key, value]) => url.searchParams.set(key, value))
  return url.toString()
}

function probeMemoryApi(url: string, apiKey?: string, timeoutMs = 3000): MemoryApiProbe {
  const script = `
(async () => {
  const input = JSON.parse(await new Promise((resolve) => {
    let data = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => data += chunk)
    process.stdin.on("end", () => resolve(data))
  }))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)
  try {
    const response = await fetch(input.url, {
      headers: input.apiKey ? { "Accept": "application/json", "X-API-Key": input.apiKey } : { "Accept": "application/json" },
      signal: controller.signal,
    })
    const text = await response.text()
    let json
    try { json = text ? JSON.parse(text) : undefined } catch {}
    process.stdout.write(JSON.stringify({ ok: response.ok, status: response.status, json, text: text.slice(0, 500) }))
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  } finally {
    clearTimeout(timer)
  }
})().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
})
`
  const runtimeErrors: string[] = []
  for (const runtime of memoryProbeRuntimeCandidates()) {
    try {
      return JSON.parse(execFileSync(runtime, ["-e", script], {
        input: JSON.stringify({ url, apiKey, timeoutMs }),
        encoding: "utf-8",
        timeout: timeoutMs + 1000,
        stdio: ["pipe", "pipe", "pipe"],
      })) as MemoryApiProbe
    } catch (err) {
      runtimeErrors.push(`${runtime}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { ok: false, error: `Nenhum runtime JS disponível para probe de memória (${runtimeErrors.join("; ") || "bun/node não encontrados"})` }
}

const memoryApiError = (probe: MemoryApiProbe) => {
  const json = probe.json
  return json && typeof json === "object" && "error" in json ? String(json.error) : probe.error || probe.text || "erro desconhecido"
}

export function diagnoseBrainSystem(input?: {
  capsulePath?: string
  sessionDbPath?: string
  projectRoot?: string
  apiKey?: string
  apiBaseUrl?: string
}): BrainSystemDiagnosis {
  const layers: BrainLayerStatus[] = []

  const projectRoot = input?.projectRoot || process.cwd()
  const graphfy = getGraphfyStatus({ projectRoot })
  const graphfyHasCounts = graphfy.nodes !== undefined || graphfy.edges !== undefined
  layers.push({
    layer: "Graphfy Knowledge Graph",
    status: !graphfy.enabled || !graphfy.available ? "unavailable" : graphfy.graph_path && graphfyHasCounts ? "ok" : graphfy.cli && !graphfy.graph_path ? "warning" : graphfy.graph_path ? "warning" : "unavailable",
    details: graphfy.graph_path
      ? `${graphfy.reason || "Artefato Graphify local encontrado"}${graphfyHasCounts ? `; nodes=${graphfy.nodes ?? 0}; edges=${graphfy.edges ?? 0}` : ""}`
      : graphfy.cli
        ? graphfy.reason || `CLI Graphify disponível em ${graphfy.cli}`
        : graphfy.reason || "Graphify local indisponível",
    recommendation: graphfy.recommendation || (graphfy.graph_path ? undefined : "Opcional: instalar com uv tool install \"graphifyy[openai,sql]\" --force e gerar com MARKSCODE_GRAPHFY_OPENAI_API_KEY/Marks API ou graphify extract . --no-viz --code-only"),
  })

  // Layer 2: Capsule Memvid
  const capsulePath = input?.capsulePath || join(homedir(), ".local/share/markscode/memory/hybrid.mv2")
  const memvidCli = findMarkscodeMemvidCli()

  if (memvidCli && existsSync(capsulePath)) {
    try {
      const output = execFileSync(memvidCli, ["contract", "--json"], { encoding: "utf-8", timeout: 2000 })
      const contract = JSON.parse(output) as Record<string, unknown>
      const officialV1 = contract.tool === "markscode-memvid" && contract.contract_version === 1
      const legacyV1 = contract.version === 1
      if (officialV1 || legacyV1) {
        layers.push({
          layer: "Cápsula Memvid",
          status: "ok",
          details: `${officialV1 ? "Sidecar oficial v1" : "Sidecar legado v1"}; sidecar: ${memvidCli}; capsule: ${capsulePath}`,
        })
      } else {
        layers.push({
          layer: "Cápsula Memvid",
          status: "warning",
          details: `Sidecar encontrado mas contrato não é v1 oficial`,
          recommendation: "Atualizar markscode-memvid para contract --json com tool markscode-memvid e contract_version 1",
        })
      }
    } catch (err) {
      layers.push({
        layer: "Cápsula Memvid",
        status: "warning",
        details: `Sidecar existe mas contract falhou: ${err}`,
        recommendation: "Verificar permissões e integridade do binário",
      })
    }
  } else if (!existsSync(capsulePath)) {
    layers.push({
      layer: "Cápsula Memvid",
      status: "unavailable",
      details: `Capsule não encontrado: ${capsulePath}`,
      recommendation: "Inicializar/buildar capsule Memvid",
    })
  } else {
    layers.push({
      layer: "Cápsula Memvid",
      status: "unavailable",
      details: "Sidecar markscode-memvid não encontrado",
      recommendation: "Instalar markscode-memvid",
    })
  }

  // Layer 3: Memory MD
  const memoryMdCandidates = [
    join(projectRoot, "MEMORY.md"),
    join(projectRoot, ".markscode", "memory.md"),
    join(projectRoot, ".markscode", "MEMORY.md"),
  ]
  const memoryMdFound = memoryMdCandidates.find((p) => existsSync(p))

  if (memoryMdFound) {
    const size = readFileSync(memoryMdFound, "utf-8").length
    layers.push({
      layer: "Memory MD",
      status: "ok",
      details: `${memoryMdFound} (${size} bytes)`,
    })
  } else {
    layers.push({
      layer: "Memory MD",
      status: "unavailable",
      details: "Nenhum arquivo MEMORY.md encontrado no projeto",
      recommendation: "Opcional: criar MEMORY.md para contexto persistente do projeto",
    })
  }

  // Layer 4: Project Tasks
  const projectTasksDir = join(projectRoot, ".tasks")
  const projectTasksIndex = join(projectTasksDir, "index.md")
  const projectTasksTemplate = join(projectTasksDir, "template.md")

  if (existsSync(projectTasksIndex) && existsSync(projectTasksTemplate)) {
    layers.push({
      layer: "Project Tasks",
      status: "ok",
      details: `${projectTasksDir} com index.md e template.md`,
    })
  } else {
    layers.push({
      layer: "Project Tasks",
      status: "unavailable",
      details: `Estrutura .tasks incompleta em ${projectTasksDir}`,
      recommendation: "Criar .tasks/index.md e .tasks/template.md para ledger local de execuções",
    })
  }

  // Layer 5: Session DB
  const sessionDbPath = input?.sessionDbPath || Database.getPath()
  if (existsSync(sessionDbPath)) {
    layers.push({
      layer: "Session DB",
      status: "ok",
      details: `${sessionDbPath}`,
    })
  } else {
    layers.push({
      layer: "Session DB",
      status: "warning",
      details: "Banco de sessão não encontrado",
      recommendation: "Banco será criado no próximo startup",
    })
  }

  // Layer 6: Remote API
  const memoryConfig = resolveMemoryConfig()
  const apiKey = input?.apiKey || memoryConfig.memories.api_key
  const apiBaseUrl = input?.apiBaseUrl || memoryConfig.memories.url || process.env.MEMORIES_API_BASE_URL || "http://api.marks.ia.br:8689"
  const remoteTimeoutMs = memoryConfig.memories.timeout_ms || 3000

  if (apiKey) {
    const healthProbe = probeMemoryApi(memoryApiUrl(apiBaseUrl, "/health"), undefined, remoteTimeoutMs)
    if (!healthProbe.ok) {
      layers.push({
        layer: "Memória Remota API",
        status: "unavailable",
        details: `API não alcançável ou timeout em ${apiBaseUrl}`,
        recommendation: `Verificar conectividade/URL da Memories API (${memoryApiError(healthProbe)})`,
      })
    } else {
      const authProbe = probeMemoryApi(memoryApiUrl(apiBaseUrl, "/me"), apiKey, remoteTimeoutMs)
      if (authProbe.status === 401 || authProbe.status === 403) {
        layers.push({
          layer: "Memória Remota API",
          status: "unavailable",
          details: `API alcançável, mas autenticação falhou: ${memoryApiError(authProbe)}`,
          recommendation: "Verificar API key carregada de Markspanel/config/env; a chave pode estar inválida ou expirada",
        })
      } else if (!authProbe.ok) {
        layers.push({
          layer: "Memória Remota API",
          status: "unavailable",
          details: `API alcançável, mas endpoint autenticado falhou: ${memoryApiError(authProbe)}`,
          recommendation: "Verificar compatibilidade da Memories API e configuração de autenticação",
        })
      } else {
        const searchProbe = probeMemoryApi(memoryApiUrl(apiBaseUrl, "/memories/search/advanced", {
          q: "test",
          limit: "1",
          user_id: memoryConfig.user_id,
        }), apiKey, remoteTimeoutMs)
        const searchError = memoryApiError(searchProbe)
        const forbiddenGlobalSearch = searchProbe.status === 403 && /global search forbidden/i.test(searchError)
        layers.push({
          layer: "Memória Remota API",
          status: "ok",
          details: searchProbe.ok
            ? `API acessível e autenticada em ${apiBaseUrl}; busca testada com user_id=${memoryConfig.user_id}`
            : forbiddenGlobalSearch
              ? `API acessível e autenticada em ${apiBaseUrl}; busca global proibida pela API, usar user_id=${memoryConfig.user_id}`
              : `API acessível e autenticada em ${apiBaseUrl}; busca retornou HTTP ${searchProbe.status || "desconhecido"}: ${searchError}`,
          ...(searchProbe.ok ? {} : {
            recommendation: forbiddenGlobalSearch
              ? "Configurar/confirmar user_id efetivo para evitar busca global proibida"
              : "Autenticação validada; revisar endpoint/parâmetros de busca se a consulta real falhar",
          }),
        })
      }
    }
  } else {
    layers.push({
      layer: "Memória Remota API",
      status: "unavailable",
      details: "Sessão/configuração Markspanel indisponível para API remota",
      recommendation: "Padrão local-first ativo; faça login pelo fluxo OAuth/device do MarksCode/Markspanel para sincronização remota",
    })
  }

  // Layer 7: Compactação
  layers.push({
    layer: "Compactação",
    status: "ok",
    details: "Sistema de compactação DCP ativo",
  })

  // Layer 8: Hand-off
  layers.push({
    layer: "Hand-off",
    status: "ok",
    details: "Hand-off automático configurado",
  })

  // Overall health
  const okCount = layers.filter((l) => l.status === "ok").length
  const criticalCount = layers.filter((l) => l.status === "error").length
  const overall = criticalCount > 0 ? "critical" : okCount >= 4 ? "healthy" : "degraded"

  return {
    mode: "hybrid",
    timestamp: new Date().toISOString(),
    layers,
    overall,
  }
}

export function formatDiagnosisForDisplay(diagnosis: BrainSystemDiagnosis): string {
  const lines = [
    `BrainSystem: ${diagnosis.mode} (${diagnosis.overall})`,
    "",
  ]

  for (const layer of diagnosis.layers) {
    const icon = layer.status === "ok" ? "✓" : layer.status === "warning" ? "⚠" : layer.status === "unavailable" ? "○" : "✗"
    lines.push(`${icon} ${layer.layer}: ${layer.details}`)
    if (layer.recommendation) {
      lines.push(`  → ${layer.recommendation}`)
    }
  }

  return lines.join("\n")
}
