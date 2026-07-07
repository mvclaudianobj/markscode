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
  cloud: "Memória remota",
  "Cápsula Memvid": "Cápsula Memvid",
  local: "Memória local",
  memory_md: "Memória do projeto",
  project_tasks: "Tarefas do projeto",
  session_db: "Histórico da sessão",
  remote_api: "Memória remota",
  compact: "Compactação",
  handoff: "Continuidade",
}

const LAYER_DESCRIPTION: Record<string, string> = {
  cloud: "API sincronizada",
  "Cápsula Memvid": "Memvid guarda contexto offline",
  local: "Memvid guarda contexto offline",
  memory_md: "MEMORY.md encontrado",
  project_tasks: "tarefas do projeto disponíveis",
  session_db: "markscode.db ativo",
  remote_api: "API sincronizada",
  compact: "reduz contexto longo",
  handoff: "hand-off preparado",
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
            {(layer) => (
              <text fg={getLayerColor(layer.status, theme())}>
                {(LAYER_LABEL[layer.name] ?? String(layer.name)) + ": " + formatStatus(layer.status) + " — " + (LAYER_DESCRIPTION[layer.name] ?? "camada disponível") + (layer.name === "local" ? compactReason(layer.reason) : "")}
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
