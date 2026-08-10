import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createMemo, For, type Accessor } from "solid-js"
import { DEFAULT_THEMES, useTheme } from "@tui/context/theme"
import { useCommandShortcut } from "../../keymap"
import { useI18n, type Tr } from "@tui/context/i18n"

const themeCount = Object.keys(DEFAULT_THEMES).length

type TipPart = { text: string; highlight: boolean }
type TipShortcut = Accessor<string>
type Shortcuts = {
  agentCycle: TipShortcut
  childFirst: TipShortcut
  childNext: TipShortcut
  childPrevious: TipShortcut
  commandList: TipShortcut
  editorOpen: TipShortcut
  helpShow: TipShortcut
  inputClear: TipShortcut
  inputNewline: TipShortcut
  inputPaste: TipShortcut
  inputUndo: TipShortcut
  leader: TipShortcut
  messagesCopy: TipShortcut
  messagesFirst: TipShortcut
  messagesLast: TipShortcut
  messagesPageDown: TipShortcut
  messagesPageUp: TipShortcut
  messagesToggleConceal: TipShortcut
  preferredName: TipShortcut
  modelCycleRecent: TipShortcut
  modelList: TipShortcut
  sessionExport: TipShortcut
  sessionInterrupt: TipShortcut
  sessionList: TipShortcut
  sessionNew: TipShortcut
  sessionParent: TipShortcut
  sessionPinToggle: TipShortcut
  sessionQuickSwitch1: TipShortcut
  sessionQuickSwitch9: TipShortcut
  sessionSidebarToggle: TipShortcut
  sessionTimeline: TipShortcut
  statusView: TipShortcut
  terminalSuspend: TipShortcut
  themeList: TipShortcut
}
type Tip = string | ((shortcuts: Shortcuts) => string | undefined)

function parse(tip: string): TipPart[] {
  const parts: TipPart[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  const found = Array.from(tip.matchAll(regex))
  const state = found.reduce(
    (acc, match) => {
      const start = match.index ?? 0
      if (start > acc.index) {
        acc.parts.push({ text: tip.slice(acc.index, start), highlight: false })
      }
      acc.parts.push({ text: match[1], highlight: true })
      acc.index = start + match[0].length
      return acc
    },
    { parts, index: 0 },
  )

  if (state.index < tip.length) {
    parts.push({ text: tip.slice(state.index), highlight: false })
  }

  return parts
}

function shortcutText(value: string) {
  return `{highlight}${value}{/highlight}`
}

function commandText(tr: Tr, command: string, shortcut: string) {
  if (!shortcut) return shortcutText(command)
  return tr("tip.command_text", { command: shortcutText(command), shortcut: shortcutText(shortcut) })
}

function press(tr: Tr, shortcut: string, rest: string) {
  if (!shortcut) return undefined
  return tr("tip.press", { shortcut: shortcutText(shortcut), rest })
}

function configShortcut(api: TuiPluginApi, command: string): TipShortcut {
  return () =>
    api.tuiConfig.keybinds
      .get(command)
      .map((binding) => api.keys.formatSequence(Array.from(api.keymap.parseKeySequence(binding.key))))
      .filter(Boolean)
      .join(", ")
}

export function Tips(props: { api: TuiPluginApi; connected?: boolean }) {
  const theme = useTheme().theme
  const { tr } = useI18n()
  const tipOffset = Math.random()
  const shortcuts: Shortcuts = {
    agentCycle: useCommandShortcut("agent.cycle"),
    childFirst: configShortcut(props.api, "session.child.first"),
    childNext: configShortcut(props.api, "session.child.next"),
    childPrevious: configShortcut(props.api, "session.child.previous"),
    commandList: useCommandShortcut("command.palette.show"),
    editorOpen: useCommandShortcut("prompt.editor"),
    helpShow: useCommandShortcut("help.show"),
    inputClear: useCommandShortcut("prompt.clear"),
    inputNewline: useCommandShortcut("input.newline"),
    inputPaste: useCommandShortcut("prompt.paste"),
    inputUndo: useCommandShortcut("input.undo"),
    leader: configShortcut(props.api, "leader"),
    messagesCopy: configShortcut(props.api, "messages.copy"),
    messagesFirst: configShortcut(props.api, "session.first"),
    messagesLast: configShortcut(props.api, "session.last"),
    messagesPageDown: configShortcut(props.api, "session.page.down"),
    messagesPageUp: configShortcut(props.api, "session.page.up"),
    messagesToggleConceal: configShortcut(props.api, "session.toggle.conceal"),
    preferredName: useCommandShortcut("markscode.profile.name"),
    modelCycleRecent: useCommandShortcut("model.cycle_recent"),
    modelList: useCommandShortcut("model.list"),
    sessionExport: configShortcut(props.api, "session.export"),
    sessionInterrupt: configShortcut(props.api, "session.interrupt"),
    sessionList: useCommandShortcut("session.list"),
    sessionNew: useCommandShortcut("session.new"),
    sessionParent: configShortcut(props.api, "session.parent"),
    sessionPinToggle: configShortcut(props.api, "session.pin.toggle"),
    sessionQuickSwitch1: useCommandShortcut("session.quick_switch.1"),
    sessionQuickSwitch9: useCommandShortcut("session.quick_switch.9"),
    sessionSidebarToggle: configShortcut(props.api, "session.sidebar.toggle"),
    sessionTimeline: configShortcut(props.api, "session.timeline"),
    statusView: useCommandShortcut("opencode.status"),
    terminalSuspend: useCommandShortcut("terminal.suspend"),
    themeList: useCommandShortcut("theme.switch"),
  }
  const noModels = tr("tip.no_models")
  const noModelsParts = parse(noModels)
  const tip = createMemo(() => {
    if (props.connected === false) return noModels
    const tips = TIPS(tr).flatMap((item) => {
      const value = typeof item === "string" ? item : item(shortcuts)
      return value ? [value] : []
    })
    return tips[Math.floor(tipOffset * tips.length)] ?? noModels
  }, noModels)
  // Solid can expose a memo's initial value while a pure computation is pending.
  const parts = createMemo(() => {
    const value = tip()
    if (typeof value === "string") return parse(value)
    return noModelsParts
  }, noModelsParts)

  return (
    <box flexDirection="row" maxWidth="100%">
      <text flexShrink={0} style={{ fg: theme.warning }}>
        ● {tr("tip.prefix")}{" "}
      </text>
      <text flexShrink={1} wrapMode="word">
        <For each={parts()}>
          {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
        </For>
      </text>
    </box>
  )
}

const TIPS: (tr: Tr) => Tip[] = (tr) => [
  tr("tip.attach_files"),
  tr("tip.shell_command"),
  (shortcuts) => press(tr, shortcuts.agentCycle(), tr("tip.rest.cycle_agents")),
  tr("tip.undo"),
  tr("tip.redo"),
  tr("tip.share"),
  tr("tip.drag_drop"),
  (shortcuts) => press(tr, shortcuts.inputPaste(), tr("tip.rest.paste_images")),
  (shortcuts) => tr("tip.editor_compose", { command: commandText(tr, "/editor", shortcuts.editorOpen()) }),
  tr("tip.init"),
  (shortcuts) => tr("tip.models_switch", { command: commandText(tr, "/models", shortcuts.modelList()) }),
  (shortcuts) =>
    tr("tip.themes_switch", { command: commandText(tr, "/themes", shortcuts.themeList()), n: String(themeCount) }),
  (shortcuts) => tr("tip.new_session", { command: commandText(tr, "/new", shortcuts.sessionNew()) }),
  (shortcuts) => tr("tip.sessions_list", { command: commandText(tr, "/sessions", shortcuts.sessionList()) }),
  (shortcuts) => press(tr, shortcuts.sessionPinToggle(), tr("tip.rest.pin_session")),
  (shortcuts) =>
    shortcuts.sessionQuickSwitch1() && shortcuts.sessionQuickSwitch9()
      ? tr("tip.quick_slots", {
          start: shortcutText(shortcuts.sessionQuickSwitch1()),
          end: shortcutText(shortcuts.sessionQuickSwitch9()),
        })
      : undefined,
  tr("tip.compact"),
  (shortcuts) => tr("tip.export_session", { command: commandText(tr, "/export", shortcuts.sessionExport()) }),
  (shortcuts) => press(tr, shortcuts.messagesCopy(), tr("tip.rest.copy_last_message")),
  (shortcuts) => press(tr, shortcuts.commandList(), tr("tip.rest.see_actions")),
  (shortcuts) => tr("tip.preferred_name", { command: commandText(tr, "/preferred-name", shortcuts.preferredName()) }),
  tr("tip.connect"),
  (shortcuts) => tr("tip.leader_key", { shortcut: shortcutText(shortcuts.leader()) }),
  (shortcuts) => press(tr, shortcuts.modelCycleRecent(), tr("tip.rest.switch_recent_models")),
  (shortcuts) => press(tr, shortcuts.sessionSidebarToggle(), tr("tip.rest.toggle_sidebar")),
  (shortcuts) =>
    shortcuts.messagesPageUp() && shortcuts.messagesPageDown()
      ? tr("tip.history_nav", {
          prev: shortcutText(shortcuts.messagesPageUp()),
          next: shortcutText(shortcuts.messagesPageDown()),
        })
      : undefined,
  (shortcuts) => press(tr, shortcuts.messagesFirst(), tr("tip.rest.jump_beginning")),
  (shortcuts) => press(tr, shortcuts.messagesLast(), tr("tip.rest.jump_recent")),
  (shortcuts) => press(tr, shortcuts.inputNewline(), tr("tip.rest.newlines")),
  (shortcuts) => press(tr, shortcuts.inputClear(), tr("tip.rest.clear_input")),
  (shortcuts) => press(tr, shortcuts.sessionInterrupt(), tr("tip.rest.stop_response")),
  tr("tip.plan_agent"),
  tr("tip.subagents"),
  (shortcuts) => {
    const items = [
      shortcuts.sessionParent(),
      shortcuts.childFirst(),
      shortcuts.childPrevious(),
      shortcuts.childNext(),
    ].filter(Boolean)
    if (!items.length) return undefined
    return tr("tip.parent_child", { items: items.map(shortcutText).join(" / ") })
  },
  tr("tip.config_files"),
  tr("tip.global_config"),
  tr("tip.schema"),
  tr("tip.default_model"),
  tr("tip.keybind_override"),
  tr("tip.keybind_none"),
  tr("tip.mcp_servers"),
  tr("tip.custom_commands"),
  tr("tip.command_arguments"),
  tr("tip.command_backticks"),
  tr("tip.agents"),
  tr("tip.permissions"),
  tr("tip.bash_patterns"),
  tr("tip.bash_deny"),
  tr("tip.bash_ask"),
  tr("tip.formatter_enable"),
  tr("tip.formatter_disable"),
  tr("tip.formatter_custom"),
  tr("tip.lsp"),
  tr("tip.tools"),
  tr("tip.tools_scripts"),
  tr("tip.plugins_events"),
  tr("tip.plugins_notifications"),
  tr("tip.plugins_sensitive"),
  tr("tip.cli_run"),
  tr("tip.cli_continue"),
  tr("tip.cli_attach"),
  tr("tip.cli_json"),
  tr("tip.cli_serve"),
  tr("tip.cli_attach_server"),
  tr("tip.cli_upgrade"),
  tr("tip.cli_auth"),
  tr("tip.cli_agent"),
  tr("tip.github_actions"),
  tr("tip.github_install"),
  tr("tip.github_fix"),
  tr("tip.github_review"),
  tr("tip.theme_system"),
  tr("tip.theme_files"),
  tr("tip.theme_variants"),
  tr("tip.theme_xterm"),
  tr("tip.env_var"),
  tr("tip.file_var"),
  tr("tip.instructions"),
  tr("tip.temperature"),
  tr("tip.steps"),
  tr("tip.tools_disable"),
  tr("tip.tools_mcp_disable"),
  tr("tip.tools_override"),
  tr("tip.share_auto"),
  tr("tip.share_disabled"),
  tr("tip.unshare"),
  tr("tip.doom_loop"),
  tr("tip.external_directory"),
  tr("tip.debug_config"),
  tr("tip.print_logs"),
  (shortcuts) => tr("tip.timeline_jump", { command: commandText(tr, "/timeline", shortcuts.sessionTimeline()) }),
  (shortcuts) => press(tr, shortcuts.messagesToggleConceal(), tr("tip.rest.toggle_code_blocks")),
  (shortcuts) => tr("tip.status_info", { command: commandText(tr, "/status", shortcuts.statusView()) }),
  tr("tip.scroll_acceleration"),
  (shortcuts) =>
    shortcuts.commandList()
      ? tr("tip.username_toggle", { shortcut: shortcutText(shortcuts.commandList()) })
      : tr("tip.username_toggle_no_shortcut"),
  tr("tip.docker"),
  tr("tip.marks_free"),
  tr("tip.agents_md"),
  tr("tip.review"),
  (shortcuts) => tr("tip.help_dialog", { command: commandText(tr, "/help", shortcuts.helpShow()) }),
  tr("tip.rename"),
  ...(process.platform === "win32"
    ? ([(shortcuts) => press(tr, shortcuts.inputUndo(), tr("tip.rest.undo_prompt"))] satisfies Tip[])
    : ([
        (shortcuts) => press(tr, shortcuts.terminalSuspend(), tr("tip.rest.suspend_terminal")),
      ] satisfies Tip[])),
]
