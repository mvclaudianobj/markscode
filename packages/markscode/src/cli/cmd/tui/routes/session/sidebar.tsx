import { useProject } from "@tui/context/project"
import { useSync } from "@tui/context/sync"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { TuiPluginRuntime } from "@/cli/cmd/tui/plugin/runtime"
import { useKV } from "../../context/kv.tsx"

import { getScrollAcceleration } from "../../util/scroll"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const project = useProject()
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const kv = useKV()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const workspaceStatus = () => {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return "error"
    return project.workspace.status(workspaceID) ?? "error"
  }
  const workspaceLabel = () => {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return "unknown"
    const info = project.workspace.get(workspaceID)
    if (!info) return "unknown"
    return `${info.type}: ${info.name}`
  }
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const mapBinding = createMemo(() => {
    const key = "map_binding:" + props.sessionID
    const raw = kv.get(key)
    if (!raw) return undefined
    try {
      const parsed = JSON.parse(String(raw))
      return parsed && typeof parsed === "object" ? parsed : undefined
    } catch {
      return undefined
    }
  })

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox
          flexGrow={1}
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <TuiPluginRuntime.Slot
              name="sidebar_title"
              mode="single_winner"
              session_id={props.sessionID}
              title={session()!.title}
              share_url={session()!.share?.url}
            >
              <box paddingRight={1}>
                <text fg={theme.text}>
                  <b>{session()!.title}</b>
                </text>
                <Show when={InstallationChannel !== "latest"}>
                  <text fg={theme.textMuted}>{props.sessionID}</text>
                </Show>
                <Show when={session()!.workspaceID}>
                  <text fg={theme.textMuted}>
                    <span style={{ fg: workspaceStatus() === "connected" ? theme.success : theme.error }}>●</span>{" "}
                    {workspaceLabel()}
                  </text>
                </Show>
                <Show when={session()!.share?.url}>
                  <text fg={theme.textMuted}>{session()!.share!.url}</text>
                </Show>
              </box>
            </TuiPluginRuntime.Slot>
            <TuiPluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />{/* MARKSCODE_SIDEBAR_MAP_START */}<box paddingRight={1} flexDirection="column"><text fg={theme.text}><b>Planning</b></text><Show when={mapBinding()} fallback={<text fg={theme.textMuted}>projeto: não vinculado</text>}><Show when={mapBinding()?.project_name || mapBinding()?.project_slug || mapBinding()?.project_id}><text fg={theme.textMuted}>projeto: {String(mapBinding()?.project_name || mapBinding()?.project_slug || mapBinding()?.project_id || "")}</text></Show><Show when={mapBinding()?.module_name || mapBinding()?.module_slug || mapBinding()?.module_id}><text fg={theme.textMuted}>módulo: {String(mapBinding()?.module_name || mapBinding()?.module_slug || mapBinding()?.module_id || "")}</text></Show><Show when={mapBinding()?.task_title || mapBinding()?.task_id}><text fg={theme.textMuted}>task: {String(mapBinding()?.task_title || mapBinding()?.task_id || "")}</text></Show><Show when={mapBinding()?.task_status}><text fg={theme.textMuted}>status: {String(mapBinding()?.task_status || "")}</text></Show><Show when={mapBinding()?.host}><text fg={theme.textMuted}>host: {String(mapBinding()?.host || "")}</text></Show><Show when={mapBinding()?.last_phase}><text fg={theme.textMuted}>fase: {String(mapBinding()?.last_phase || "")}</text></Show></Show><text fg={theme.textMuted}>use: MarksCode: Vincular Planning/MAP</text></box>{/* MARKSCODE_SIDEBAR_MAP_END */}
</box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <TuiPluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID}>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.success }}>•</span> <b>Marks</b>
              <span style={{ fg: theme.text }}>
                <b>Code</b>
              </span>{" "}
              <span>{InstallationVersion}</span>
            </text>
          </TuiPluginRuntime.Slot>
        </box>
      </box>
    </Show>
  )
}
