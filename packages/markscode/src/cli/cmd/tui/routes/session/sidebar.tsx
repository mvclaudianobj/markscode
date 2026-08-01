import { useProject } from "@tui/context/project"
import { useSync } from "@tui/context/sync"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { TuiPluginRuntime } from "@/cli/cmd/tui/plugin/runtime"
import { useKV } from "../../context/kv.tsx"

import { getScrollAcceleration } from "../../util/scroll"
import { WorkspaceLabel } from "../../component/workspace-label"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const project = useProject()
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const kv = useKV()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const sessionTitle = createMemo(() => session()?.title || props.sessionID)
  const sessionShareUrl = createMemo(() => session()?.share?.url)
  const sessionWorkspaceID = createMemo(() => session()?.workspaceID)
  const workspace = () => {
    const workspaceID = sessionWorkspaceID()
    if (!workspaceID) return
    return project.workspace.get(workspaceID)
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
  const mapText = (key: string) => {
    const binding = mapBinding() as Record<string, unknown> | undefined
    const value = binding?.[key]
    return typeof value === "string" && value.trim() ? value : undefined
  }
  const mapUpdated = createMemo(() => {
    const value = mapText("updated_at")
    if (!value) return undefined
    return value.replace("T", " ").replace(/\.\d+Z$/, "Z")
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
              title={sessionTitle()}
              share_url={sessionShareUrl()}
            >
              <box paddingRight={1}>
                <text fg={theme.text}>
                  <b>{sessionTitle()}</b>
                </text>
                <Show when={InstallationChannel !== "latest"}>
                  <text fg={theme.textMuted}>{props.sessionID}</text>
                </Show>
                <Show when={sessionWorkspaceID()}>
                  <text fg={theme.textMuted}>
                    <Show
                      when={workspace()}
                      fallback={<WorkspaceLabel type="unknown" name={sessionWorkspaceID() || "unknown"} status="error" icon />}
                    >
                      {(item) => (
                        <WorkspaceLabel
                          type={item().type}
                          name={item().name}
                          status={project.workspace.status(item().id) ?? "error"}
                          icon
                        />
                      )}
                    </Show>
                  </text>
                </Show>
                <Show when={sessionShareUrl()}>
                  <text fg={theme.textMuted}>{sessionShareUrl()}</text>
                </Show>
                <Show when={mapBinding()}>
                  <box marginTop={1} paddingTop={1}>
                    <text fg={theme.textMuted}>MAP</text>
                    <text fg={theme.text}><b>{mapText("project_name") || mapText("project_slug") || mapText("project_id") || "Projeto vinculado"}</b></text>
                    <Show when={mapText("module_name") || mapText("module_slug") || mapText("module_id")}>
                      <text fg={theme.textMuted}>Módulo: {mapText("module_name") || mapText("module_slug") || mapText("module_id")}</text>
                    </Show>
                    <Show when={mapText("task_title") || mapText("task_id")}>
                      <text fg={theme.textMuted}>Task: {mapText("task_title") || mapText("task_id")}</text>
                    </Show>
                    <Show when={mapText("task_status") || mapText("last_phase")}>
                      <text fg={theme.textMuted}>Status: {mapText("task_status") || "-"} · {mapText("last_phase") || "sem fase"}</text>
                    </Show>
                    <Show when={mapText("last_progress_note")}>
                      <text fg={theme.textMuted}>Progresso: {mapText("last_progress_note")}</text>
                    </Show>
                    <Show when={mapUpdated()}>
                      <text fg={theme.textMuted}>Atualizado: {mapUpdated()}</text>
                    </Show>
                  </box>
                </Show>
              </box>
            </TuiPluginRuntime.Slot>
<TuiPluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <TuiPluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID}>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.success }}>•</span> <b>Open</b>
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
