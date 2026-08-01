import type { TuiPlugin, TuiPluginApi, TuiRouteCurrent } from "@opencode-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { useBindings } from "../../keymap"
import { useTheme } from "@tui/context/theme"
import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { existsSync } from "fs"
import path from "node:path"
import { homedir } from "node:os"

const id = "internal:navigator"
const route = "navigator"

function params(api: TuiPluginApi) {
  return ("params" in api.route.current ? api.route.current.params : undefined) as
    | {
        returnRoute?: TuiRouteCurrent
        initialUrl?: string
        initialError?: string
      }
    | undefined
}

function normalizeUrl(input: string) {
  const value = input.trim()
  if (!value) return undefined
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`
  const url = URL.parse(candidate)
  if (!url || !["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return undefined
  return url.toString()
}

const obscuraNotFound = "Obscura não encontrado. Defina MARKSCODE_OBSCURA_BIN, coloque o binário em ${MARKS_ECOSYSTEM_DIR:-~/.marks/ecosystem}/bin/obscura, ou instale no PATH."

function envString(name: string) {
  const value = Bun.env[name]?.trim()
  return value || undefined
}

function envBoolean(name: string) {
  return ["1", "true", "yes", "on"].includes(Bun.env[name]?.trim().toLowerCase() ?? "")
}

function obscuraTimeoutSeconds() {
  const value = Number.parseInt(envString("MARKSCODE_OBSCURA_TIMEOUT_SECONDS") ?? "45", 10)
  if (!Number.isFinite(value)) return 45
  return Math.min(Math.max(value, 5), 120)
}

function marksEcosystemDir() {
  return envString("MARKS_ECOSYSTEM_DIR") ?? path.join(homedir(), ".marks", "ecosystem")
}

function marksEcosystemDisplay() {
  return `${envString("MARKS_ECOSYSTEM_DIR") ?? "~/.marks/ecosystem"}/bin/obscura`
}

function obscuraBin() {
  const configured = envString("MARKSCODE_OBSCURA_BIN")
  if (configured) return configured
  return (
    [
      path.join(marksEcosystemDir(), "bin", "obscura"),
      path.join(homedir(), ".markscode", "bin", "vendor", "obscura", "obscura"),
      path.resolve(process.cwd(), "../../../ecosystem/systems/obscura/target/release/obscura"),
      path.resolve(process.cwd(), "../ecosystem/systems/obscura/target/release/obscura"),
    ]
      .find((candidate) => existsSync(candidate)) ?? "obscura"
  )
}

function obscuraArgs(url: string) {
  const proxy = envString("MARKSCODE_OBSCURA_PROXY")
  const storageDir = envString("MARKSCODE_OBSCURA_STORAGE_DIR")
  const args = [
    obscuraBin(),
    "fetch",
    url,
    "--dump",
    "markdown",
    "--quiet",
    "--timeout",
    String(obscuraTimeoutSeconds()),
  ]
  if (envBoolean("MARKSCODE_OBSCURA_STEALTH")) args.push("--stealth")
  if (proxy) args.push("--proxy", proxy)
  if (storageDir) args.push("--storage-dir", storageDir)
  if (envBoolean("MARKSCODE_OBSCURA_ALLOW_PRIVATE_NETWORK")) args.push("--allow-private-network")
  return args
}

function summarize(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500)
}

function preview(value: string) {
  return value.trim().split("\n").slice(0, 28).join("\n").slice(0, 4_000)
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

async function fetchWithObscura(url: string, signal: AbortSignal) {
  const proc = Bun.spawn(obscuraArgs(url), { stdout: "pipe", stderr: "pipe", signal })
  const timer = setTimeout(() => proc.kill(), (obscuraTimeoutSeconds() + 5) * 1000)
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited.catch(() => 124),
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]).finally(() => clearTimeout(timer))
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() }
}

function back(api: TuiPluginApi) {
  const returnRoute = params(api)?.returnRoute
  api.route.navigate(returnRoute?.name ?? "home", returnRoute && "params" in returnRoute ? returnRoute.params : undefined)
}

function prompt(api: TuiPluginApi, title: string, value?: string) {
  return new Promise<string | null>((resolve) => {
    const Prompt = api.ui.DialogPrompt
    api.ui.dialog.replace(
      () => (
        <Prompt
          title={title}
          placeholder="ex: marks.ia.br ou https://marks.ia.br"
          value={value}
          onConfirm={(input) => resolve(input)}
          onCancel={() => resolve(null)}
        />
      ),
      () => resolve(null),
    )
  })
}

function View(props: { api: TuiPluginApi }) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const [currentUrl, setCurrentUrl] = createSignal(params(props.api)?.initialUrl ?? "https://marks.ia.br/")
  const [history, setHistory] = createSignal<string[]>([currentUrl()])
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal(params(props.api)?.initialError ?? "")
  const [content, setContent] = createSignal("")
  let requestId = 0
  let controller: AbortController | undefined

  function cancelOperation(message = "Operação cancelada.") {
    if (!loading()) return false
    requestId++
    controller?.abort()
    controller = undefined
    setLoading(false)
    setError(message)
    return true
  }

  async function openUrl(value: string) {
    const next = normalizeUrl(value)
    if (!next) {
      setError("URL inválida. Informe um domínio ou URL http/https.")
      setLoading(false)
      return
    }
    controller?.abort()
    const requestController = new AbortController()
    controller = requestController
    const currentRequest = ++requestId
    setError("")
    setContent("")
    setCurrentUrl(next)
    setHistory((items) => [next, ...items.filter((item) => item !== next)].slice(0, 5))
    setLoading(true)
    try {
      const result = await fetchWithObscura(next, requestController.signal)
      if (currentRequest !== requestId) return
      if (requestController.signal.aborted) {
        setError("Operação cancelada.")
        return
      }
      if (result.exitCode !== 0) {
        if (result.exitCode === 143) {
          setError("Obscura foi encerrado por timeout/cancelamento. Aumente MARKSCODE_OBSCURA_TIMEOUT_SECONDS se necessário.")
          return
        }
        setError(summarize(result.stderr) || `Obscura falhou com status ${result.exitCode}.`)
        return
      }
      if (!result.stdout) {
        setError("Obscura não retornou conteúdo para esta URL.")
        return
      }
      setContent(preview(result.stdout))
    } catch (error) {
      if (currentRequest !== requestId) return
      setError(errorCode(error) === "ENOENT" ? obscuraNotFound : summarize(error instanceof Error ? error.message : String(error)))
    } finally {
      if (currentRequest === requestId) setLoading(false)
    }
  }

  function reloadUrl() {
    void openUrl(currentUrl())
  }

  async function promptUrl() {
    const value = await prompt(props.api, "Abrir URL no Navigator", currentUrl())
    props.api.ui.dialog.clear()
    if (value === null) return
    void openUrl(value)
  }

  onMount(() => {
    const initialUrl = params(props.api)?.initialUrl
    if (initialUrl) void openUrl(initialUrl)
  })

  onCleanup(() => {
    controller?.abort()
  })

  useBindings(() => ({
    commands: [
      {
        name: "navigator.route.openUrl",
        title: "Abrir URL no Navigator",
        category: "Navigator",
        run: promptUrl,
      },
    ],
    bindings: [
      {
        key: "escape",
        desc: "Voltar",
        group: "Navigator",
        cmd() {
          if (loading()) cancelOperation("Operação cancelada antes de voltar.")
          back(props.api)
        },
      },
      {
        key: "o",
        desc: "Abrir URL",
        group: "Navigator",
        cmd: "navigator.route.openUrl",
      },
      {
        key: "r",
        desc: "Recarregar URL",
        group: "Navigator",
        cmd: reloadUrl,
      },
      {
        key: "c",
        desc: "Cancelar operação",
        group: "Navigator",
        cmd() {
          cancelOperation()
        },
      },
    ],
  }))

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
      paddingTop={2}
      paddingLeft={4}
      paddingRight={4}
      paddingBottom={2}
    >
      <box
        width="100%"
        height="100%"
        border={true}
        borderColor={theme.borderActive}
        backgroundColor={theme.backgroundPanel}
        paddingTop={2}
        paddingLeft={3}
        paddingRight={3}
        paddingBottom={2}
        gap={2}
      >
        <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
          Marks Navigator
        </text>
        <box border={["left"]} borderColor={theme.success} paddingLeft={2} gap={1}>
          <text fg={theme.success} wrapMode="none">
            Obscura adapter CLI opcional
          </text>
          <text fg={theme.textMuted}>Usa MARKSCODE_OBSCURA_BIN, binário do ecosystem Marks, sidecar MarksCode, source checkout ou obscura no PATH ao abrir uma URL.</text>
          <text fg={theme.textMuted}>Padrão ecosystem: {marksEcosystemDisplay()}</text>
          <text fg={theme.textMuted}>Envs: MARKSCODE_OBSCURA_TIMEOUT_SECONDS, MARKSCODE_OBSCURA_STEALTH, MARKSCODE_OBSCURA_PROXY, MARKSCODE_OBSCURA_STORAGE_DIR, MARKSCODE_OBSCURA_ALLOW_PRIVATE_NETWORK.</text>
          <text fg={theme.textMuted}>
            Timeout: {obscuraTimeoutSeconds()}s; proxy: {envString("MARKSCODE_OBSCURA_PROXY") ? "configurado" : "não configurado"}; rede privada: {envBoolean("MARKSCODE_OBSCURA_ALLOW_PRIVATE_NETWORK") ? "habilitada" : "desativada por padrão"}.
          </text>
        </box>
        <box border={true} borderColor={theme.borderSubtle} paddingTop={1} paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
          <text fg={theme.text}>URL atual: {currentUrl()}</text>
          <text fg={loading() ? theme.warning : theme.success}>Status: {loading() ? "carregando" : "pronto"}</text>
          <Show when={error()}>
            <text fg={theme.error}>{error()}</text>
          </Show>
          <text fg={theme.textMuted}>Pressione o para informar URL; r para recarregar; c para cancelar; ESC para voltar.</text>
        </box>
        <box border={true} borderColor={theme.borderSubtle} paddingTop={1} paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>Histórico recente</text>
          <For each={history()}>{(item) => <text fg={item === currentUrl() ? theme.text : theme.textMuted}>{item}</text>}</For>
        </box>
        <box border={true} borderColor={theme.borderSubtle} paddingTop={1} paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>Conteúdo</text>
          <Show when={content()} fallback={<text fg={theme.textMuted}>{loading() ? "Carregando prévia..." : "Abra uma URL para carregar a prévia markdown/texto."}</text>}>
            <text fg={theme.text}>{content()}</text>
          </Show>
        </box>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.route.register([
    {
      name: route,
      render: () => <View api={api} />,
    },
  ])

  api.keymap.registerLayer({
    commands: [
      {
        name: "navigator.open",
        title: "Abrir navegador Marks",
        category: "Marks",
        namespace: "palette",
        run() {
          api.route.navigate(route, { returnRoute: api.route.current })
          api.ui.dialog.clear()
        },
      },
      {
        name: "navigator.openUrl",
        title: "Abrir URL no Navigator",
        category: "Marks",
        namespace: "palette",
        async run() {
          const value = await prompt(api, "Abrir URL no Navigator")
          api.ui.dialog.clear()
          if (value === null) return
          const initialUrl = normalizeUrl(value)
          api.route.navigate(route, {
            returnRoute: api.route.current,
            initialUrl,
            initialError: initialUrl ? undefined : "URL inválida. Informe um domínio ou URL http/https.",
          })
        },
      },
    ],
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
