import type { TuiPlugin, TuiPluginApi, TuiPluginModule, TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show } from "solid-js"

const id = "internal:sidebar-memories"

type LayerEntry = { name: string; status: string; reason?: string }

function parseLayers(raw: string): LayerEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => ({
        name: String(entry.name ?? "").trim(),
        status: String(entry.status ?? "").trim(),
        reason: entry.reason === undefined ? undefined : String(entry.reason),
      }))
      .filter((entry) => entry.name.length > 0 && entry.status.length > 0)
  } catch {
    return []
  }
}

function getLayerColor(status: string, theme: TuiThemeCurrent) {
  if (status === "ok") return theme.success
  if (status === "warning") return theme.warning
  if (status === "unavailable" || status === "error") return theme.error
  return theme.textMuted
}

function formatStatus(status: string) {
  if (status === "ok") return "ok"
  if (status === "warning") return "atenção"
  if (status === "unavailable") return "indisponível"
  if (status === "error") return "erro"
  return status
}

function formatOverall(status: string) {
  if (status === "healthy") return "saudável"
  if (status === "degraded") return "atenção"
  if (status === "critical") return "crítico"
  return status
}

function compactReason(reason?: string) {
  if (!reason) return ""
  const value = reason.replace(/^.*\/([^/]+)$/, "$1")
  if (value.length <= 42) return " — " + value
  return " — " + value.slice(0, 39) + "..."
}

const LAYER_LABEL: Record<string, string> = {
  cloud: "Remote Memories API",
  graphfy: "Graphfy Knowledge Graph",
  "Graphfy Knowledge Graph": "Graphfy Knowledge Graph",
  "Cápsula Memvid": "Cápsula Memvid",
  local: "Cápsula Memvid",
  memory_md: "Memory MD",
  "Memory MD": "Memory MD",
  project_tasks: "Project Tasks",
  "Project Tasks": "Project Tasks",
  session_db: "Session DB",
  "Session DB": "Session DB",
  remote_api: "Remote Memories API",
  "Remote Memories API": "Remote Memories API",
  "Memória Remota API": "Remote Memories API",
  compact: "Compactação",
  "Compactação": "Compactação",
  handoff: "Hand-off",
  "Hand-off": "Hand-off",
}

const LAYER_DESCRIPTION: Record<string, string> = {
  cloud: "API de memórias remotas (Memories API)",
  graphfy: "Grafo de conhecimento semântico",
  "Graphfy Knowledge Graph": "Grafo de conhecimento semântico",
  "Cápsula Memvid": "Memória compactada em vídeo/embedding",
  local: "Memória compactada em vídeo/embedding",
  memory_md: "Arquivos Markdown de memória por sessão",
  "Memory MD": "Arquivos Markdown de memória por sessão",
  project_tasks: "Tarefas e contexto de projetos ativos",
  "Project Tasks": "Tarefas e contexto de projetos ativos",
  session_db: "Banco de sessões e histórico de mensagens",
  "Session DB": "Banco de sessões e histórico de mensagens",
  remote_api: "API de memórias remotas (Memories API)",
  "Remote Memories API": "API de memórias remotas (Memories API)",
  "Memória Remota API": "API de memórias remotas (Memories API)",
  compact: "Pipeline de compactação e deduplicação",
  "Compactação": "Pipeline de compactação e deduplicação",
  handoff: "Transferência de contexto entre sessões",
  "Hand-off": "Transferência de contexto entre sessões",
}

const LAYER_ORDER: Record<string, number> = {
  graphfy: 1,
  "Graphfy Knowledge Graph": 1,
  "Cápsula Memvid": 2,
  local: 2,
  memory_md: 3,
  "Memory MD": 3,
  project_tasks: 4,
  "Project Tasks": 4,
  session_db: 5,
  "Session DB": 5,
  cloud: 6,
  remote_api: 6,
  "Remote Memories API": 6,
  "Memória Remota API": 6,
  compact: 7,
  "Compactação": 7,
  handoff: 8,
  "Hand-off": 8,
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const collapsed = createMemo(() => Boolean(props.api.kv.get("sidebar.memories.collapsed", true)))
  const overall = createMemo(() => String(props.api.kv.get("brainsystem_overall", "") || ""))
  const layersRaw = createMemo(() => String(props.api.kv.get("brainsystem_layers", "") || ""))
  const ok = createMemo(() => String(props.api.kv.get("memories_cloud_last_sync_ok", "") || "") === "1")
  const localRaw = createMemo(() => String(props.api.kv.get("memories_hybrid_local_available", "") || ""))
  const local = createMemo(() => localRaw() === "1")
  const count = createMemo(() => String(props.api.kv.get("memories_cloud_last_sync_count", "0") || ""))
  const at = createMemo(() => String(props.api.kv.get("memories_cloud_last_sync_at", "") || ""))
  const capsule = createMemo(() => String(props.api.kv.get("memories_hybrid_capsule", "") || ""))
  const brainPluginActive = createMemo(() => String(props.api.kv.get("brainsystem_brain_plugin_active", "") || ""))
  const brainEnabled = createMemo(() => String(props.api.kv.get("brainsystem_brain_enabled", "") || "") === "1")
  const brainGraphfyEnabled = createMemo(() => String(props.api.kv.get("brainsystem_brain_graphfy_enabled", "") || "") === "1")

  const layers = createMemo<LayerEntry[]>(() => {
    return parseLayers(layersRaw())
  })

  return (
    <box gap={1}>
      <text
        fg={theme().text}
        onMouseUp={() => props.api.kv.set("sidebar.memories.collapsed", !collapsed())}
      >
        <b>{collapsed() ? String.fromCharCode(0x25b8) : String.fromCharCode(0x25be)} BrainSystem</b>
        <span style={{ fg: theme().textMuted }}> hybrid</span>
      </text>
      <Show when={!collapsed()}>
        <Show when={overall()}>
          <text fg={overall() === "healthy" ? theme().success : overall() === "degraded" ? theme().warning : theme().error}>
            {"BrainSystem: " + formatOverall(overall())}
          </text>
        </Show>
        <Show when={layers().length > 0}>
          <For each={layers()}>
            {(layer, index) => (
              <text fg={getLayerColor(layer.status, theme())}>
                {"Camada " + String(LAYER_ORDER[layer.name] ?? index() + 1) + ": " + (LAYER_LABEL[layer.name] ?? String(layer.name)) + ": " + formatStatus(layer.status) + " — " + (LAYER_DESCRIPTION[layer.name] ?? "camada disponível") + (layer.name === "local" ? compactReason(layer.reason) : "")}
              </text>
            )}
          </For>
        </Show>
        <Show when={layers().length === 0}>
          <text fg={ok() ? theme().success : theme().textMuted}>{"Memória remota: " + (ok() ? "ok — API sincronizada" : "verificando...")}</text>
          <text fg={local() ? theme().success : theme().textMuted}>{"Memória local: " + (local() ? "ok — Memvid guarda contexto offline" : "indisponível")}</text>
        </Show>
        <text fg={brainPluginActive() === "native" || brainPluginActive() === "1" ? theme().success : theme().textMuted}>
          {"Brain nativo: " + (brainPluginActive() === "native" || brainPluginActive() === "1" ? "ativo — sem plugin externo" : "nativo")}
        </text>
        <text fg={theme().textMuted}>{"items: " + (count() || "0") + " " + String.fromCharCode(0x00b7) + " sync: " + at()}</text>
        <Show when={capsule()}>
          <text fg={theme().textMuted}>{"cápsula: " + compactReason(capsule()).replace(/^ — /, "")}</text>
        </Show>
        <text fg={theme().textMuted}>search: /memory-search</text>
        <Show when={overall() && overall() !== "healthy"}>
          <text fg={theme().warning}>repair: /memory-repair</text>
        </Show>
        <text fg={theme().textMuted}>ingest: /brain-ingest</text>
        <Show when={brainEnabled()}>
          <text fg={theme().success}>{"Brain: Graphfy " + (brainGraphfyEnabled() ? "\u2713" : "\u2717")}</text>
        </Show>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 220,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
