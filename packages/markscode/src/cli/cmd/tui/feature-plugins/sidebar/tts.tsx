import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, Show } from "solid-js"

const id = "internal:sidebar-tts"

function envValue(key: string) {
  return typeof process !== "undefined" ? process.env[key] : undefined
}

function enabledValue(value: unknown) {
  return value === true || value === "1" || value === "true" || value === "enabled"
}

function volumeValue(value: unknown) {
  const volume = Number(value)
  if (!Number.isFinite(volume)) return 3
  return Math.min(3, Math.max(0.1, volume))
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const collapsed = createMemo(() => Boolean(props.api.kv.get("sidebar.tts.collapsed", true)))
  const enabled = createMemo(() => enabledValue(props.api.kv.get("markscode_tts_voice_mode", false)))
  const provider = createMemo(() => String(props.api.kv.get("markscode_tts_provider", envValue("MARKSCODE_TTS_PROVIDER") || "orbit-fallback") || "orbit-fallback"))
  const voice = createMemo(() => String(props.api.kv.get("markscode_tts_voice", envValue("MARKSCODE_TTS_VOICE") || "orbit") || "orbit"))
  const volume = createMemo(() => volumeValue(props.api.kv.get("markscode_tts_volume", envValue("MARKSCODE_TTS_VOLUME") || 3)))

  return (
    <box gap={1}>
      <text
        fg={theme().text}
        onMouseUp={() => props.api.kv.set("sidebar.tts.collapsed", !collapsed())}
      >
        <b>{collapsed() ? "▸" : "▾"} Marks TTS</b>
      </text>
      <Show when={!collapsed()}>
        <text fg={enabled() ? theme().success : theme().textMuted}>{"status: " + (enabled() ? "enabled" : "disabled")}</text>
      </Show>
      <Show when={!collapsed()}>
        <text fg={theme().textMuted}>{"provider: " + provider()}</text>
      </Show>
      <Show when={!collapsed()}>
        <text fg={theme().textMuted}>{"voice: " + voice()}</text>
      </Show>
      <Show when={!collapsed()}>
        <text fg={theme().textMuted}>{"volume: " + String(Math.round(volume() * 100)) + "%"}</text>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 225,
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
