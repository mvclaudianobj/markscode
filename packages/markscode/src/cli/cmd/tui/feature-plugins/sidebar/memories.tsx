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

const LAYER_LABEL: Record<string, string> = {
  cloud: "cloud",
  local: "Memvid local",
  memory_md: "MEMORY.md",
  session_db: "Session DB",
  remote_api: "Remote API",
  compact: "compactaçao",
  handoff: "hand-off",
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
            {"overall: " + overall()}
          </text>
        </Show>
        <Show when={layers().length > 0}>
          <For each={layers()}>
            {(layer) => (
              <text fg={getLayerColor(layer.status, theme())}>
                {(LAYER_LABEL[layer.name] ?? String(layer.name)) + ": " + String(layer.status) + (layer.reason ? " (" + String(layer.reason) + ")" : "")}
              </text>
            )}
          </For>
        </Show>
        <Show when={layers().length === 0}>
          <text fg={ok() ? theme().success : theme().textMuted}>{"cloud: " + (ok() ? "ok" : "checking...")}</text>
          <text fg={local() ? theme().success : theme().textMuted}>{"local Memvid: " + (local() ? "ok" : "unavailable")}</text>
        </Show>
        <text fg={theme().textMuted}>{"items: " + (count() || "0") + " " + String.fromCharCode(0x00b7) + " sync: " + at()}</text>
        <Show when={capsule()}>
          <text fg={theme().textMuted}>{"capsule: " + capsule()}</text>
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
