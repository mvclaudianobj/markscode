import { render, TimeToFirstDraw, useKeyboard, useRenderer, useSelectionHandler, useTerminalDimensions } from "@opentui/solid"
import { AppRuntime } from "@/effect/app-runtime"
import { MessageV2 } from "@/session/message-v2"
import path from "path"
import { readdir } from "fs/promises"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { getSessionContext, searchSessionMemories } from "@/memories-api"
import { DialogPrompt } from "./ui/dialog-prompt"
import { DialogSelect, type DialogSelectOption } from "./ui/dialog-select"
import { createResource } from "solid-js"
import * as Clipboard from "@tui/util/clipboard"
import * as Selection from "@tui/util/selection"
import { createCliRenderer, MouseButton, type CliRendererConfig } from "@opentui/core"
import { RouteProvider, useRoute } from "@tui/context/route"
import {
  Switch,
  Match,
  createEffect,
  createMemo,
  ErrorBoundary,
  createSignal,
  onMount,
  batch,
  Show,
  on,
} from "solid-js"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { Flag } from "@opencode-ai/core/flag/flag"
import semver from "semver"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { DialogProvider as DialogProviderList } from "@tui/component/dialog-provider"
import { ErrorComponent } from "@tui/component/error-component"
import { PluginRouteMissing } from "@tui/component/plugin-route-missing"
import { ProjectProvider } from "@tui/context/project"
import { EditorContextProvider } from "@tui/context/editor"
import { useEvent } from "@tui/context/event"
import { SDKProvider, useSDK } from "@tui/context/sdk"
import { StartupLoading } from "@tui/component/startup-loading"
import { SyncProvider, useSync } from "@tui/context/sync"
import { LocalProvider, useLocal } from "@tui/context/local"
import { DialogModel } from "@tui/component/dialog-model"
import { useConnected } from "@tui/component/use-connected"
import { DialogMcp } from "@tui/component/dialog-mcp"
import { DialogStatus } from "@tui/component/dialog-status"
import { DialogThemeList } from "@tui/component/dialog-theme-list"
import { DialogHelp } from "./ui/dialog-help"
import { CommandProvider, useCommandDialog } from "@tui/component/dialog-command"
import { DialogAgent } from "@tui/component/dialog-agent"
import { DialogSessionList } from "@tui/component/dialog-session-list"
import { DialogConsoleOrg } from "@tui/component/dialog-console-org"
import { KeybindProvider, useKeybind } from "@tui/context/keybind"
import { ThemeProvider, useTheme } from "@tui/context/theme"
import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
import { PromptHistoryProvider } from "./component/prompt/history"
import { FrecencyProvider } from "./component/prompt/frecency"
import { PromptStashProvider } from "./component/prompt/stash"
import { DialogAlert } from "./ui/dialog-alert"
import { DialogConfirm } from "./ui/dialog-confirm"
import { ToastProvider, useToast } from "./ui/toast"
import { ExitProvider, useExit } from "./context/exit"
import { Session as SessionApi } from "@/session/session"
import { TuiEvent } from "./event"
import { KVProvider, useKV } from "./context/kv"
import { Provider } from "@/provider/provider"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import open from "open"
import { PromptRefProvider, usePromptRef } from "./context/prompt"
import { TuiConfigProvider, useTuiConfig } from "./context/tui-config"
import { TuiConfig } from "@/cli/cmd/tui/config/tui"
import { createTuiApi } from "@/cli/cmd/tui/plugin/api"
import { TuiPluginRuntime } from "@/cli/cmd/tui/plugin/runtime"
import type { RouteMap } from "@/cli/cmd/tui/plugin/api"
import { FormatError, FormatUnknownError } from "@/cli/error"

import type { EventSource } from "./context/sdk"
import { DialogVariant } from "./component/dialog-variant"

function rendererConfig(_config: TuiConfig.Info): CliRendererConfig {
  const mouseEnabled = !Flag.OPENCODE_DISABLE_MOUSE && (_config.mouse ?? true)

  return {
    externalOutputMode: "passthrough",
    targetFps: 60,
    gatherStats: false,
    exitOnCtrlC: false,
    useKittyKeyboard: {},
    autoFocus: false,
    openConsoleOnError: false,
    useMouse: mouseEnabled,
    consoleOptions: {
      keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
    },
  }
}

function errorMessage(error: unknown) {
  const formatted = FormatError(error)
  if (formatted !== undefined) return formatted
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "message" in error.data &&
    typeof error.data.message === "string"
  ) {
    return error.data.message
  }
  return FormatUnknownError(error)
}

export function tui(input: {
  url: string
  args: Args
  config: TuiConfig.Info
  onSnapshot?: () => Promise<string[]>
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  events?: EventSource
}) {
  // promise to prevent immediate exit
  // oxlint-disable-next-line no-async-promise-executor -- intentional: async executor used for sequential setup before resolve
  return new Promise<void>(async (resolve) => {
    const unguard = win32InstallCtrlCGuard()
    win32DisableProcessedInput()

    const onExit = async () => {
      unguard?.()
      resolve()
    }

    const onBeforeExit = async () => {
      await TuiPluginRuntime.dispose()
    }

    const renderer = await createCliRenderer(rendererConfig(input.config))
    const mode = (await renderer.waitForThemeMode(1000)) ?? "dark"

    await render(() => {
      return (
        <ErrorBoundary
          fallback={(error, reset) => (
            <ErrorComponent error={error} reset={reset} onBeforeExit={onBeforeExit} onExit={onExit} mode={mode} />
          )}
        >
          <ArgsProvider {...input.args}>
            <ExitProvider onBeforeExit={onBeforeExit} onExit={onExit}>
              <KVProvider>
                <ToastProvider>
                  <RouteProvider
                    initialRoute={
                      input.args.continue
                        ? {
                            type: "session",
                            sessionID: "dummy",
                          }
                        : undefined
                    }
                  >
                    <TuiConfigProvider config={input.config}>
                      <SDKProvider
                        url={input.url}
                        directory={input.directory}
                        fetch={input.fetch}
                        headers={input.headers}
                        events={input.events}
                      >
                        <ProjectProvider>
                          <SyncProvider>
                            <ThemeProvider mode={mode}>
                              <LocalProvider>
                                <KeybindProvider>
                                  <PromptStashProvider>
                                    <DialogProvider>
                                      <CommandProvider>
                                        <FrecencyProvider>
                                          <PromptHistoryProvider>
                                            <PromptRefProvider>
                                              <EditorContextProvider>
                                                <App onSnapshot={input.onSnapshot} />
                                              </EditorContextProvider>
                                            </PromptRefProvider>
                                          </PromptHistoryProvider>
                                        </FrecencyProvider>
                                      </CommandProvider>
                                    </DialogProvider>
                                  </PromptStashProvider>
                                </KeybindProvider>
                              </LocalProvider>
                            </ThemeProvider>
                          </SyncProvider>
                        </ProjectProvider>
                      </SDKProvider>
                    </TuiConfigProvider>
                  </RouteProvider>
                </ToastProvider>
              </KVProvider>
            </ExitProvider>
          </ArgsProvider>
        </ErrorBoundary>
      )
    }, renderer)
  })
}




// MARKSCODE_FILE_PICKER_START
type PickerMode = "any" | "text" | "image"

function pathAllowed(p: string, mode: PickerMode) {
  if (mode === "any") return true
  const ext = path.extname(p).toLowerCase()
  if (mode === "text") {
    return [".txt", ".md", ".json", ".yaml", ".yml", ".log", ".csv", ".ts", ".tsx", ".js", ".py"].includes(ext)
  }
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"].includes(ext)
}

function pickFile(dialog: ReturnType<typeof useDialog>, start: string, mode: PickerMode) {
  return new Promise<string | null>((resolve) => {
    const root = path.resolve(start)

    function Browser() {
      const [cwd, setCwd] = createSignal(root)
      const [rows] = createResource(cwd, async (dir) => {
        const list = await readdir(dir, { withFileTypes: true }).catch(() => [])
        const out = [] as DialogSelectOption<string>[]
        const parent = path.dirname(dir)
        if (parent !== dir) {
          out.push({
            title: "../",
            value: parent,
            description: parent,
            category: "Directories",
            onSelect: () => setCwd(parent),
          })
        }

        const dirs = list
          .filter((x) => x.isDirectory())
          .map((x) => x.name)
          .sort((a, b) => a.localeCompare(b))
        dirs.forEach((name) => {
          const full = path.join(dir, name)
          out.push({
            title: name + "/",
            value: full,
            description: full,
            category: "Directories",
            onSelect: () => setCwd(full),
          })
        })

        const files = list
          .filter((x) => x.isFile())
          .map((x) => x.name)
          .sort((a, b) => a.localeCompare(b))
        files.forEach((name) => {
          const full = path.join(dir, name)
          if (!pathAllowed(full, mode)) return
          out.push({
            title: name,
            value: full,
            description: full,
            category: "Files",
            onSelect: () => {
              resolve(full)
              dialog.clear()
            },
          })
        })

        return out
      })

      return <DialogSelect title={"Selecionar arquivo: " + cwd()} options={rows() ?? []} placeholder="Filtrar..." />
    }

    setTimeout(() => {
      dialog.setSize("large")
      dialog.replace(
        () => <Browser />,
        () => resolve(null),
      )
    }, 0)
  })
}
// MARKSCODE_FILE_PICKER_END

function App(props: { onSnapshot?: () => Promise<string[]> }) {
  const tuiConfig = useTuiConfig()
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const dialog = useDialog()
  const local = useLocal()
  const kv = useKV()
  const command = useCommandDialog()
  const keybind = useKeybind()
  const event = useEvent()
  const sdk = useSDK()
  const toast = useToast()
  const themeState = useTheme()
  const { theme, mode, setMode, locked, lock, unlock } = themeState
  const sync = useSync()
  const exit = useExit()
  const promptRef = usePromptRef()
  const routes: RouteMap = new Map()
  const [routeRev, setRouteRev] = createSignal(0)
  const routeView = (name: string) => {
    routeRev()
    return routes.get(name)?.at(-1)?.render
  }

  const api = createTuiApi({
    command,
    tuiConfig,
    dialog,
    keybind,
    kv,
    route,
    routes,
    bump: () => setRouteRev((x) => x + 1),
    event,
    sdk,
    sync,
    theme: themeState,
    toast,
    renderer,
  })
  const [ready, setReady] = createSignal(false)
  const [lastAutoCopiedSelection, setLastAutoCopiedSelection] = createSignal("")
  TuiPluginRuntime.init({
    api,
    config: tuiConfig,
  })
    .catch((error) => {
      console.error("Failed to load TUI plugins", error)
    })
    .finally(() => {
      setReady(true)
    })

  useKeyboard((evt) => {
    const sel = renderer.getSelection()
    if (!sel) return

    // Windows Terminal-like behavior:
    // - Ctrl+C copies and dismisses selection
    // - Esc dismisses selection
    // - Most other key input dismisses selection and is passed through
    if (evt.ctrl && evt.name === "c") {
      if (!Selection.copy(renderer, toast)) {
        renderer.clearSelection()
        return
      }

      evt.preventDefault()
      evt.stopPropagation()
      return
    }

    if (evt.name === "escape") {
      renderer.clearSelection()
      evt.preventDefault()
      evt.stopPropagation()
      return
    }

    const focus = renderer.currentFocusedRenderable
    if (focus?.hasSelection() && sel.selectedRenderables.includes(focus)) {
      return
    }

    renderer.clearSelection()
  })

  // Wire up console copy-to-clipboard via opentui's onCopySelection callback
  renderer.console.onCopySelection = async (text: string) => {
    if (!text || text.length === 0) return

    await Clipboard.copy(text)
      .then(() => toast.show({ message: "Copied to clipboard", variant: "info", duration: 3000 }))
      .catch(toast.error)

    renderer.clearSelection()
  }

  useSelectionHandler(() => {
    if (Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
    const text = renderer.getSelection()?.getSelectedText()?.trim() || ""
    if (!text) return
    if (text === lastAutoCopiedSelection()) return
    setLastAutoCopiedSelection(text)
    Selection.copyWithRetry(renderer, toast)
  })
  const [terminalTitleEnabled, setTerminalTitleEnabled] = createSignal(kv.get("terminal_title_enabled", true))

  // Update terminal window title based on current route and session
  createEffect(() => {
    if (!terminalTitleEnabled() || Flag.OPENCODE_DISABLE_TERMINAL_TITLE) return

    if (route.data.type === "home") {
      renderer.setTerminalTitle("MarksCode")
      return
    }

    if (route.data.type === "session") {
      const session = sync.session.get(route.data.sessionID)
      if (!session || SessionApi.isDefaultTitle(session.title)) {
        renderer.setTerminalTitle("MarksCode")
        return
      }

      const title = session.title.length > 40 ? session.title.slice(0, 37) + "..." : session.title
      renderer.setTerminalTitle(`MarksCode | ${title}`)
      return
    }

    if (route.data.type === "plugin") {
      renderer.setTerminalTitle(`OC | ${route.data.id}`)
    }
  })

  const args = useArgs()
  onMount(() => {
    batch(() => {
      if (args.agent) local.agent.set(args.agent)
      if (args.model) {
        const { providerID, modelID } = Provider.parseModel(args.model)
        if (!providerID || !modelID)
          return toast.show({
            variant: "warning",
            message: `Invalid model format: ${args.model}`,
            duration: 3000,
          })
        local.model.set({ providerID, modelID }, { recent: true })
      }
      if (args.sessionID && !args.fork) {
        route.navigate({
          type: "session",
          sessionID: args.sessionID,
        })
      }
    })
  })

  let continued = false
  createEffect(() => {
    // When using -c, session list is loaded in blocking phase, so we can navigate at "partial"
    if (continued || sync.status === "loading" || !args.continue) return
    const match = sync.data.session
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .find((x) => x.parentID === undefined)?.id
    if (match) {
      continued = true
      if (args.fork) {
        void sdk.client.session.fork({ sessionID: match }).then((result) => {
          if (result.data?.id) {
            route.navigate({ type: "session", sessionID: result.data.id })
          } else {
            toast.show({ message: "Failed to fork session", variant: "error" })
          }
        })
      } else {
        route.navigate({ type: "session", sessionID: match })
      }
    }
  })

  // Handle --session with --fork: wait for sync to be fully complete before forking
  // (session list loads in non-blocking phase for --session, so we must wait for "complete"
  // to avoid a race where reconcile overwrites the newly forked session)
  let forked = false
  createEffect(() => {
    if (forked || sync.status !== "complete" || !args.sessionID || !args.fork) return
    forked = true
    void sdk.client.session.fork({ sessionID: args.sessionID }).then((result) => {
      if (result.data?.id) {
        route.navigate({ type: "session", sessionID: result.data.id })
      } else {
        toast.show({ message: "Failed to fork session", variant: "error" })
      }
    })
  })

  createEffect(
    on(
      () => sync.status === "complete" && sync.data.provider.length === 0,
      (isEmpty, wasEmpty) => {
        // only trigger when we transition into an empty-provider state
        if (!isEmpty || wasEmpty) return
        dialog.replace(() => <DialogProviderList />)
      },
    ),
  )

  const connected = useConnected()
  command.register(() => [
    {
      title: "Switch session",
      value: "session.list",
      keybind: "session_list",
      category: "Session",
      suggested: sync.data.session.length > 0,
      slash: {
        name: "sessions",
        aliases: ["resume", "continue"],
      },
      onSelect: () => {
        dialog.replace(() => <DialogSessionList />)
      },
    },
    {
      title: "New session",
      suggested: route.data.type === "session",
      value: "session.new",
      keybind: "session_new",
      category: "Session",
      slash: {
        name: "new",
        aliases: ["clear"],
      },
      onSelect: () => {
        route.navigate({
          type: "home",
        })
        dialog.clear()
      },
    },
    {
      title: "Switch model",
      value: "model.list",
      keybind: "model_list",
      suggested: true,
      category: "Agent",
      slash: {
        name: "models",
      },
      onSelect: () => {
        dialog.replace(() => <DialogModel />)
      },
    },
    {
      title: "Model cycle",
      value: "model.cycle_recent",
      keybind: "model_cycle_recent",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.model.cycle(1)
      },
    },
    {
      title: "Model cycle reverse",
      value: "model.cycle_recent_reverse",
      keybind: "model_cycle_recent_reverse",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.model.cycle(-1)
      },
    },
    {
      title: "Favorite cycle",
      value: "model.cycle_favorite",
      keybind: "model_cycle_favorite",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.model.cycleFavorite(1)
      },
    },
    {
      title: "Favorite cycle reverse",
      value: "model.cycle_favorite_reverse",
      keybind: "model_cycle_favorite_reverse",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.model.cycleFavorite(-1)
      },
    },
    {
      title: "Switch agent",
      value: "agent.list",
      keybind: "agent_list",
      category: "Agent",
      slash: {
        name: "agents",
      },
      onSelect: () => {
        dialog.replace(() => <DialogAgent />)
      },
    },
    {
      title: "Toggle MCPs",
      value: "mcp.list",
      category: "Agent",
      slash: {
        name: "mcps",
      },
      onSelect: () => {
        dialog.replace(() => <DialogMcp />)
      },
    },
    {
      title: "Agent cycle",
      value: "agent.cycle",
      keybind: "agent_cycle",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.agent.move(1)
      },
    },
    {
      title: "Variant cycle",
      value: "variant.cycle",
      keybind: "variant_cycle",
      category: "Agent",
      onSelect: () => {
        local.model.variant.cycle()
      },
    },
    {
      title: "Switch model variant",
      value: "variant.list",
      keybind: "variant_list",
      category: "Agent",
      hidden: local.model.variant.list().length === 0,
      slash: {
        name: "variants",
      },
      onSelect: () => {
        dialog.replace(() => <DialogVariant />)
      },
    },
    {
      title: "Agent cycle reverse",
      value: "agent.cycle.reverse",
      keybind: "agent_cycle_reverse",
      category: "Agent",
      hidden: true,
      onSelect: () => {
        local.agent.move(-1)
      },
    },
    {
      title: "Connect provider",
      value: "provider.connect",
      suggested: !connected(),
      slash: {
        name: "connect",
      },
      onSelect: () => {
        dialog.replace(() => <DialogProviderList />)
      },
      category: "Provider",
    },
    ...(sync.data.console_state.switchableOrgCount > 1
      ? [
          {
            title: "Switch org",
            value: "console.org.switch",
            suggested: Boolean(sync.data.console_state.activeOrgName),
            slash: {
              name: "org",
              aliases: ["orgs", "switch-org"],
            },
            onSelect: () => {
              dialog.replace(() => <DialogConsoleOrg />)
            },
            category: "Provider",
          },
        ]
      : []),
    {
      title: "View status",
      keybind: "status_view",
      value: "markscode.status",
      slash: {
        name: "status",
      },
      onSelect: () => {
        dialog.replace(() => <DialogStatus />)
      },
      category: "System",
    },
    {
      title: "Switch theme",
      value: "theme.switch",
      keybind: "theme_list",
      slash: {
        name: "themes",
      },
      onSelect: () => {
        dialog.replace(() => <DialogThemeList />)
      },
      category: "System",
    },
    {
      title: mode() === "dark" ? "Switch to light mode" : "Switch to dark mode",
      value: "theme.switch_mode",
      onSelect: (dialog) => {
        setMode(mode() === "dark" ? "light" : "dark")
        dialog.clear()
      },
      category: "System",
    },
    {
      title: locked() ? "Unlock theme mode" : "Lock theme mode",
      value: "theme.mode.lock",
      onSelect: (dialog) => {
        if (locked()) unlock()
        else lock()
        dialog.clear()
      },
      category: "System",
    },
    {
      title: "Help",
      value: "help.show",
      slash: {
        name: "help",
      },
      onSelect: () => {
        dialog.replace(() => <DialogHelp />)
      },
      category: "System",
    },
    {
      title: "Open docs",
      value: "docs.open",
      onSelect: () => {
        open("https://markscode.ai/docs").catch(() => {})
        dialog.clear()
      },
      category: "System",
    },
    
    
    
    // MARKSCODE_IMPORT_COMMANDS_START
    {
      title: "MarksCode: Import memory session",
      value: "markscode.import.memory-session",
      category: "MarksCode",
      slash: {
        name: "memory-session",
      },
      onSelect: async (dialog) => {
        const entered = (await DialogPrompt.show(dialog, "Import memory session", {
          placeholder: "Session ID",
        }))?.trim()
        if (!entered?.trim()) {
          toast.show({ message: "No session ID provided", variant: "warning" })
          dialog.clear()
          return
        }
        const id = entered.trim()
        const userID = process.env.MEMORIES_USER_ID || "marks-local"
        const cwd = process.cwd()
        const hit = sync.data.session.find((x) => x.id === id || x.id.startsWith(id))
        if (hit) {
          route.navigate({ type: "session", sessionID: hit.id })
          toast.show({ message: "Session loaded (local)", variant: "success" })
          dialog.clear()
          return
        }

        try {
          const fromContext = await getSessionContext({ user_id: userID, session_id: id, limit: 100 }).catch(() => ({ messages: [], items: [], memories: [] }))
          const contextSource = [
            ...(Array.isArray(fromContext?.messages) ? fromContext.messages : []),
            ...(Array.isArray(fromContext?.items) ? fromContext.items : []),
            ...(Array.isArray(fromContext?.memories) ? fromContext.memories : []),
          ]
          const contextRows = contextSource
            .map((m) => {
              if (!m || typeof m !== "object") return undefined
              const raw = typeof m.content === "string" ? m.content : typeof m.text === "string" ? m.text : ""
              const content = raw.trim()
              if (!content) return undefined
              const roleText = typeof m.role === "string" ? m.role.toLowerCase() : ""
              const low = content.toLowerCase()
              const role = roleText === "assistant" || low.startsWith("ai:") || low.startsWith("assistant:") ? "assistant" : "user"
              return { role, content: content.replace(/^(user|ai|assistant):\s*/i, "") }
            })
            .filter((x): x is { role: "assistant" | "user"; content: string } => Boolean(x))

          const searchBody = await searchSessionMemories({ user_id: userID, session_id: id, limit: 200 }).catch(() => ({ memories: [], items: [] }))
          const searchSource = [
            ...(Array.isArray(searchBody?.memories) ? searchBody.memories : []),
            ...(Array.isArray(searchBody?.items) ? searchBody.items : []),
          ]
          const fromSearch = searchSource
            .map((m) => {
              if (!m || typeof m !== "object") return undefined
              const text = typeof m.content === "string" ? m.content.trim() : ""
              if (!text) return undefined
              const low = text.toLowerCase()
              const role = low.startsWith("ai:") || low.startsWith("assistant:") ? "assistant" : "user"
              return { role, content: text.replace(/^(user|ai|assistant):\s*/i, "") }
            })
            .filter((x): x is { role: "assistant" | "user"; content: string } => Boolean(x))

          const rows = contextRows.length > 0 ? contextRows : fromSearch
          if (!rows.length) {
            toast.show({ message: "Session not found (local or API)", variant: "warning" })
            dialog.clear()
            return
          }

          const created = await sdk.client.session.create({ title: "Imported " + id }).then((x) => x.data)
          if (!created?.id) {
            toast.show({ message: "Failed to create local session", variant: "error" })
            dialog.clear()
            return
          }

          const selected = local.model.current()
          const sessionID = SessionID.make(created.id)
          const providerID = ProviderID.make(selected?.providerID || "markscode")
          const modelID = ModelID.make(selected?.modelID || "glm-5-free")
          const agent = local.agent.current()?.name || "default"
          const baseTime = Date.now()
          let parentID: ReturnType<typeof MessageID.ascending> | undefined

          for (const [i, item] of rows.entries()) {
            const messageID = MessageID.ascending()
            const createdAt = baseTime + i
            if (item.role === "assistant") {
              await AppRuntime.runPromise(SessionApi.Service.use((svc) => svc.updateMessage({
                id: messageID,
                sessionID,
                role: "assistant",
                time: { created: createdAt, completed: createdAt },
                parentID: parentID || messageID,
                modelID,
                providerID,
                mode: "normal",
                agent,
                path: { cwd, root: cwd },
                cost: 0,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              } as MessageV2.Assistant)))
              await AppRuntime.runPromise(SessionApi.Service.use((svc) => svc.updatePart({
                id: PartID.ascending(),
                sessionID,
                messageID,
                type: "text",
                text: item.content,
                synthetic: false,
              } as MessageV2.TextPart)))
              continue
            }

            await AppRuntime.runPromise(SessionApi.Service.use((svc) => svc.updateMessage({
              id: messageID,
              sessionID,
              role: "user",
              time: { created: createdAt },
              agent,
              model: { providerID, modelID },
              format: { type: "text" },
            } as MessageV2.User)))
            await AppRuntime.runPromise(SessionApi.Service.use((svc) => svc.updatePart({
              id: PartID.ascending(),
              sessionID,
              messageID,
              type: "text",
              text: item.content,
              synthetic: false,
            } as MessageV2.TextPart)))
            parentID = messageID
          }

          route.navigate({ type: "session", sessionID: created.id })
          toast.show({ message: "Session restored from API", variant: "success" })
        } catch {
          toast.show({ message: "Failed to restore session from API", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Import text",
      value: "markscode.import.text",
      category: "MarksCode",
      slash: {
        name: "import-text",
      },
      onSelect: async (dialog) => {
        const file = await pickFile(dialog, process.cwd(), "text")
        if (!file) {
          dialog.clear()
          return
        }
        const ref = promptRef.current
        if (!ref) {
          toast.show({ message: "Prompt indisponivel na tela atual", variant: "warning" })
          dialog.clear()
          return
        }
        await Bun.file(file)
          .text()
          .then((text) => {
            const block = "[Imported text: " + file + "]\n" + text
            const next = ref.current.input ? ref.current.input + "\n\n" + block : block
            ref.set({ input: next, parts: ref.current.parts })
            toast.show({ message: "Texto importado", variant: "success" })
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : "Falha ao importar texto"
            toast.show({ message, variant: "error" })
          })
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Import image",
      value: "markscode.import.image",
      category: "MarksCode",
      slash: {
        name: "import-image",
      },
      onSelect: async (dialog) => {
        const file = await pickFile(dialog, process.cwd(), "image")
        if (!file) {
          dialog.clear()
          return
        }
        const ref = promptRef.current
        if (!ref) {
          toast.show({ message: "Prompt indisponivel na tela atual", variant: "warning" })
          dialog.clear()
          return
        }
        await Bun.file(file)
          .exists()
          .then((ok) => {
            if (!ok) throw new Error("Arquivo nao encontrado: " + file)
            const block = "[Imported image: " + file + "]"
            const next = ref.current.input ? ref.current.input + "\n\n" + block : block
            ref.set({ input: next, parts: ref.current.parts })
            toast.show({ message: "Imagem importada", variant: "success" })
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : "Falha ao importar imagem"
            toast.show({ message, variant: "error" })
          })
        dialog.clear()
      },
    },
    // MARKSCODE_IMPORT_COMMANDS_END

    {
      title: "Exit the app",
      value: "app.exit",
      slash: {
        name: "exit",
        aliases: ["quit", "q"],
      },
      onSelect: () => exit(),
      category: "System",
    },
    {
      title: "Toggle debug panel",
      category: "System",
      value: "app.debug",
      onSelect: (dialog) => {
        renderer.toggleDebugOverlay()
        dialog.clear()
      },
    },
    {
      title: "Toggle console",
      category: "System",
      value: "app.console",
      onSelect: (dialog) => {
        renderer.console.toggle()
        dialog.clear()
      },
    },
    {
      title: "Write heap snapshot",
      category: "System",
      value: "app.heap_snapshot",
      onSelect: async (dialog) => {
        const files = await props.onSnapshot?.()
        toast.show({
          variant: "info",
          message: `Heap snapshot written to ${files?.join(", ")}`,
          duration: 5000,
        })
        dialog.clear()
      },
    },
    {
      title: "Suspend terminal",
      value: "terminal.suspend",
      keybind: "terminal_suspend",
      category: "System",
      hidden: true,
      enabled: tuiConfig.keybinds?.terminal_suspend !== "none",
      onSelect: () => {
        process.once("SIGCONT", () => {
          renderer.resume()
        })

        renderer.suspend()
        // pid=0 means send the signal to all processes in the process group
        process.kill(0, "SIGTSTP")
      },
    },
    {
      title: terminalTitleEnabled() ? "Disable terminal title" : "Enable terminal title",
      value: "terminal.title.toggle",
      keybind: "terminal_title_toggle",
      category: "System",
      onSelect: (dialog) => {
        setTerminalTitleEnabled((prev) => {
          const next = !prev
          kv.set("terminal_title_enabled", next)
          if (!next) renderer.setTerminalTitle("")
          return next
        })
        dialog.clear()
      },
    },
    {
      title: kv.get("animations_enabled", true) ? "Disable animations" : "Enable animations",
      value: "app.toggle.animations",
      category: "System",
      onSelect: (dialog) => {
        kv.set("animations_enabled", !kv.get("animations_enabled", true))
        dialog.clear()
      },
    },
    {
      title: kv.get("file_context_enabled", true) ? "Disable file context" : "Enable file context",
      value: "app.toggle.file_context",
      category: "System",
      onSelect: (dialog) => {
        kv.set("file_context_enabled", !kv.get("file_context_enabled", true))
        dialog.clear()
      },
    },
    {
      title: kv.get("diff_wrap_mode", "word") === "word" ? "Disable diff wrapping" : "Enable diff wrapping",
      value: "app.toggle.diffwrap",
      category: "System",
      onSelect: (dialog) => {
        const current = kv.get("diff_wrap_mode", "word")
        kv.set("diff_wrap_mode", current === "word" ? "none" : "word")
        dialog.clear()
      },
    },
  ])

  event.on(TuiEvent.CommandExecute.type, (evt) => {
    command.trigger(evt.properties.command)
  })

  event.on(TuiEvent.ToastShow.type, (evt) => {
    toast.show({
      title: evt.properties.title,
      message: evt.properties.message,
      variant: evt.properties.variant,
      duration: evt.properties.duration,
    })
  })

  event.on(TuiEvent.SessionSelect.type, (evt) => {
    route.navigate({
      type: "session",
      sessionID: evt.properties.sessionID,
    })
  })

  event.on("session.deleted", (evt) => {
    if (route.data.type === "session" && route.data.sessionID === evt.properties.info.id) {
      route.navigate({ type: "home" })
      toast.show({
        variant: "info",
        message: "The current session was deleted",
      })
    }
  })

  event.on("session.error", (evt) => {
    const error = evt.properties.error
    if (error && typeof error === "object" && error.name === "MessageAbortedError") return
    const message = errorMessage(error)

    toast.show({
      variant: "error",
      message,
      duration: 5000,
    })
  })

  event.on("installation.update-available", async (evt) => {
    const version = evt.properties.version

    const skipped = kv.get("skipped_version")
    if (skipped && !semver.gt(version, skipped)) return

    const choice = await DialogConfirm.show(
      dialog,
      `Update Available`,
      `A new release v${version} is available. Would you like to update now?`,
      "skip",
    )

    if (choice === false) {
      kv.set("skipped_version", version)
      return
    }

    if (choice !== true) return

    toast.show({
      variant: "info",
      message: `Updating to v${version}...`,
      duration: 30000,
    })

    const result = await sdk.client.global.upgrade({ target: version })

    if (result.error || !result.data?.success) {
      toast.show({
        variant: "error",
        title: "Update Failed",
        message: "Update failed",
        duration: 10000,
      })
      return
    }

    await DialogAlert.show(
      dialog,
      "Update Complete",
      `Successfully updated to MarksCode v${result.data.version}. Please restart the application.`,
    )

    void exit()
  })

  const plugin = createMemo(() => {
    if (!ready()) return
    if (route.data.type !== "plugin") return
    const render = routeView(route.data.id)
    if (!render) return <PluginRouteMissing id={route.data.id} onHome={() => route.navigate({ type: "home" })} />
    return render({ params: route.data.data })
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
      onMouseDown={(evt) => {
        if (!Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
        if (evt.button !== MouseButton.RIGHT) return

        if (!Selection.copy(renderer, toast)) return
        evt.preventDefault()
        evt.stopPropagation()
      }}
      onMouseUp={
        Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT
          ? undefined
          : (evt) => {
              if (evt.button !== MouseButton.LEFT) return
              Selection.copyWithRetry(renderer, toast)
            }
      }
    >
      <Show when={Flag.OPENCODE_SHOW_TTFD}>
        <TimeToFirstDraw />
      </Show>
      <Show when={ready()}>
        <Switch>
          <Match when={route.data.type === "home"}>
            <Home />
          </Match>
          <Match when={route.data.type === "session"}>
            <Session />
          </Match>
        </Switch>
      </Show>
      {plugin()}
      <TuiPluginRuntime.Slot name="app" />
      <StartupLoading ready={ready} />
    </box>
  )
}
