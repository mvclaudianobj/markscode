import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, Show } from "solid-js"

const id = "internal:sidebar-memories"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const collapsed = createMemo(() => Boolean(props.api.kv.get("sidebar.memories.collapsed", true)))
  const at = createMemo(() => String(props.api.kv.get("memories_cloud_last_sync_at", "") || ""))
  const ok = createMemo(() => String(props.api.kv.get("memories_cloud_last_sync_ok", "") || "") === "1")
  const count = createMemo(() => String(props.api.kv.get("memories_cloud_last_sync_count", "0") || "0"))
  const err = createMemo(() => String(props.api.kv.get("memories_cloud_last_sync_error", "") || ""))
  const local = createMemo(() => String(props.api.kv.get("memories_hybrid_local_available", "") || "") === "1")
  const capsule = createMemo(() => String(props.api.kv.get("memories_hybrid_capsule", "") || ""))
  const time = createMemo(() => {
    const raw = at()
    if (!raw) return "pending"
    const date = new Date(raw)
    if (Number.isNaN(date.getTime())) return "pending"
    return date.toLocaleTimeString()
  })

  return (
    <box gap={1}>
      <text
        fg={theme().text}
        onMouseUp={() => props.api.kv.set("sidebar.memories.collapsed", !collapsed())}
      >
        <b>{collapsed() ? "▸" : "▾"} BrainSystem</b>
      </text>
      <Show when={!collapsed()}>
        <text fg={theme().textMuted}>mode: Hybrid</text>
      </Show>
      <Show when={!collapsed()}>
        <text fg={ok() ? theme().success : theme().warning}>cloud: {ok() ? "ok" : "error"}</text>
      </Show>
      <Show when={!collapsed()}>
        <text fg={local() ? theme().success : theme().textMuted}>local Memvid: {local() ? "ok" : "unavailable"}</text>
      </Show>
      <Show when={!collapsed()}>
        <text fg={theme().textMuted}>items: {count()} · sync: {time()}</text>
      </Show>
      <Show when={!collapsed() && capsule()}>
        <text fg={theme().textMuted}>capsule: {capsule()}</text>
      </Show>
      <Show when={!collapsed() && !ok() && err()}>
        <text fg={theme().warning}>{err().slice(0, 52)}</text>
      </Show>
      <Show when={!collapsed()}>
        <text fg={theme().textMuted}>search: /memory-search</text>
      </Show>
      <Show when={!collapsed()}>
        <text fg={theme().textMuted}>supermemory local: /memory-search-local</text>
      </Show>
      <Show when={!collapsed()}>
        <text fg={theme().textMuted}>supermemory global: /memory-search-global</text>
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
