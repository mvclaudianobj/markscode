import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, Show } from "solid-js"

const id = "internal:sidebar-browser"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const collapsed = createMemo(() => Boolean(props.api.kv.get("sidebar.browser.collapsed", true)))
  const active = createMemo(() => Boolean(props.api.kv.get("browser_mode_active", false)))

  return (
    <box gap={1}>
      <text
        fg={theme().text}
        onMouseUp={() => props.api.kv.set("sidebar.browser.collapsed", !collapsed())}
      >
        <b>{collapsed() ? "▸" : "▾"} Browser Mode</b>
      </text>
      <Show when={!collapsed()}>
        <text fg={active() ? theme().success : theme().textMuted}>status: {active() ? "active" : "inactive"}</text>
      </Show>
      <Show when={!collapsed()}>
        <text fg={theme().textMuted}>shortcut: /browser-mode-status</text>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 240,
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
