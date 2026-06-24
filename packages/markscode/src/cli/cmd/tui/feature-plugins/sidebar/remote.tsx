import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo } from "solid-js"
import { Show } from "solid-js"

const id = "internal:sidebar-remote"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const collapsed = createMemo(() => Boolean(props.api.kv.get("sidebar.remote.collapsed", true)))
  const mode = createMemo(() => Boolean(props.api.kv.get("remote_ssh_mode", false)))
  const cfg = createMemo(() => props.api.kv.get("remote_ssh_config", {}) as Record<string, unknown>)
  const profiles = createMemo(() => String(props.api.kv.get("remote_ssh_profile_names", "") || ""))
  const activeProfiles = createMemo(() => profiles().split(",").map((x) => x.trim()).filter(Boolean))
  const host = createMemo(() => String(cfg().host || "-"))
  const user = createMemo(() => String(cfg().user || "-"))
  const alias = createMemo(() => String(cfg().host_alias || ""))
  const target = createMemo(() => (alias() ? alias() : user() + "@" + host()))

  return (
    <box gap={1}>
      <text
        fg={theme().text}
        onMouseUp={() => props.api.kv.set("sidebar.remote.collapsed", !collapsed())}
      >
        <b>{collapsed() ? "▸" : "▾"} Multi Remote mode</b>
      </text>
      <Show when={!collapsed()}>
        <text fg={mode() ? theme().success : theme().textMuted}>{"status: " + (mode() ? "active" : "inactive")}</text>
      </Show>
      <Show when={!collapsed()}>
        <text fg={theme().textMuted}>{"target: " + target()}</text>
      </Show>
      <Show when={!collapsed()}>
        <text fg={theme().textMuted}>{"profiles: " + (activeProfiles().length ? activeProfiles().join(", ") : "none")}</text>
      </Show>
      <Show when={!collapsed()}>
        <text fg={theme().textMuted}>shortcut: /remote-ssh-profiles</text>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 230,
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
