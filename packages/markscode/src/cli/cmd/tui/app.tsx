import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import path from "path"
import { readdir } from "fs/promises"
import { Identifier } from "@/id/id"
import { getSessionContext, searchSessionMemories } from "@/memories-api"
import { DialogPrompt } from "./ui/dialog-prompt"
import { DialogSelect, type DialogSelectOption } from "./ui/dialog-select"
import { createMemo, createResource } from "solid-js"
import { Clipboard } from "@tui/util/clipboard"
import { Selection } from "@tui/util/selection"
import { MouseButton, TextAttributes } from "@opentui/core"
import { RouteProvider, useRoute } from "@tui/context/route"
import { Switch, Match, createEffect, untrack, ErrorBoundary, createSignal, onMount, batch, Show, on } from "solid-js"
import { win32DisableProcessedInput, win32FlushInputBuffer, win32InstallCtrlCGuard } from "./win32"
import { Installation } from "@/installation"
import { Flag } from "@/flag/flag"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { DialogProvider as DialogProviderList } from "@tui/component/dialog-provider"
import { SDKProvider, useSDK } from "@tui/context/sdk"
import { SyncProvider, useSync } from "@tui/context/sync"
import { LocalProvider, useLocal } from "@tui/context/local"
import { DialogModel, useConnected } from "@tui/component/dialog-model"
import { DialogMcp } from "@tui/component/dialog-mcp"
import { DialogStatus } from "@tui/component/dialog-status"
import { DialogThemeList } from "@tui/component/dialog-theme-list"
import { DialogHelp } from "./ui/dialog-help"
import { CommandProvider, useCommandDialog } from "@tui/component/dialog-command"
import { DialogAgent } from "@tui/component/dialog-agent"
import { DialogSessionList } from "@tui/component/dialog-session-list"
import { DialogWorkspaceList } from "@tui/component/dialog-workspace-list"
import { KeybindProvider } from "@tui/context/keybind"
import { ThemeProvider, useTheme } from "@tui/context/theme"
import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
import { PromptHistoryProvider } from "./component/prompt/history"
import { FrecencyProvider } from "./component/prompt/frecency"
import { PromptStashProvider } from "./component/prompt/stash"
import { DialogAlert } from "./ui/dialog-alert"
import { ToastProvider, useToast } from "./ui/toast"
import { ExitProvider, useExit } from "./context/exit"
import { Session as SessionApi } from "@/session"
import { TuiEvent } from "./event"
import { KVProvider, useKV } from "./context/kv"
import { Provider } from "@/provider/provider"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import open from "open"
import { writeHeapSnapshot } from "v8"
import { PromptRefProvider, usePromptRef } from "./context/prompt"
import { TuiConfigProvider } from "./context/tui-config"
import { TuiConfig } from "@/config/tui"









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

    dialog.replace(
      () => <Browser />,
      () => resolve(null),
    )
  })
}
// MARKSCODE_FILE_PICKER_END

async function getTerminalBackgroundColor(): Promise<"dark" | "light"> {
  // can't set raw mode if not a TTY
  if (!process.stdin.isTTY) return "dark"

  return new Promise((resolve) => {
    let timeout: NodeJS.Timeout

    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.removeListener("data", handler)
      clearTimeout(timeout)
    }

    const handler = (data: Buffer) => {
      const str = data.toString()
      const match = str.match(/\x1b]11;([^\x07\x1b]+)/)
      if (match) {
        cleanup()
        const color = match[1]
        // Parse RGB values from color string
        // Formats: rgb:RR/GG/BB or #RRGGBB or rgb(R,G,B)
        let r = 0,
          g = 0,
          b = 0

        if (color.startsWith("rgb:")) {
          const parts = color.substring(4).split("/")
          r = parseInt(parts[0], 16) >> 8 // Convert 16-bit to 8-bit
          g = parseInt(parts[1], 16) >> 8 // Convert 16-bit to 8-bit
          b = parseInt(parts[2], 16) >> 8 // Convert 16-bit to 8-bit
        } else if (color.startsWith("#")) {
          r = parseInt(color.substring(1, 3), 16)
          g = parseInt(color.substring(3, 5), 16)
          b = parseInt(color.substring(5, 7), 16)
        } else if (color.startsWith("rgb(")) {
          const parts = color.substring(4, color.length - 1).split(",")
          r = parseInt(parts[0])
          g = parseInt(parts[1])
          b = parseInt(parts[2])
        }

        // Calculate luminance using relative luminance formula
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

        // Determine if dark or light based on luminance threshold
        resolve(luminance > 0.5 ? "light" : "dark")
      }
    }

    process.stdin.setRawMode(true)
    process.stdin.on("data", handler)
    process.stdout.write("\x1b]11;?\x07")

    timeout = setTimeout(() => {
      cleanup()
      resolve("dark")
    }, 1000)
  })
}

import type { EventSource } from "./context/sdk"

export function tui(input: {
  url: string
  args: Args
  config: TuiConfig.Info
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  events?: EventSource
}) {
  // promise to prevent immediate exit
  return new Promise<void>(async (resolve) => {
    const unguard = win32InstallCtrlCGuard()
    win32DisableProcessedInput()

    const mode = await getTerminalBackgroundColor()

    // Re-clear after getTerminalBackgroundColor() — setRawMode(false) restores
    // the original console mode which re-enables ENABLE_PROCESSED_INPUT.
    win32DisableProcessedInput()

    const onExit = async () => {
      unguard?.()
      resolve()
    }

    render(
      () => {
        return (
          <ErrorBoundary
            fallback={(error, reset) => <ErrorComponent error={error} reset={reset} onExit={onExit} mode={mode} />}
          >
            <ArgsProvider {...input.args}>
              <ExitProvider onExit={onExit}>
                <KVProvider>
                  <ToastProvider>
                    <RouteProvider>
                      <TuiConfigProvider config={input.config}>
                        <SDKProvider
                          url={input.url}
                          directory={input.directory}
                          fetch={input.fetch}
                          headers={input.headers}
                          events={input.events}
                        >
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
                                              <App />
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
                        </SDKProvider>
                      </TuiConfigProvider>
                    </RouteProvider>
                  </ToastProvider>
                </KVProvider>
              </ExitProvider>
            </ArgsProvider>
          </ErrorBoundary>
        )
      },
      {
        targetFps: 60,
        gatherStats: false,
        exitOnCtrlC: false,
        useKittyKeyboard: {},
        autoFocus: false,
        openConsoleOnError: false,
        consoleOptions: {
          keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
          onCopySelection: (text) => {
            Clipboard.copy(text).catch((error) => {
              console.error(`Failed to copy console selection to clipboard: ${error}`)
            })
          },
        },
      },
    )
  })
}

function App() {
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  renderer.disableStdoutInterception()
  const dialog = useDialog()
  const local = useLocal()
  const kv = useKV()
  const command = useCommandDialog()
  const sdk = useSDK()
  const toast = useToast()
  const { theme, mode, setMode } = useTheme()
  const sync = useSync()
  const exit = useExit()
  const promptRef = usePromptRef()

  useKeyboard((evt) => {
    if (!Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
    if (!renderer.getSelection()) return

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

    renderer.clearSelection()
  })

  // Wire up console copy-to-clipboard via opentui's onCopySelection callback
  renderer.console.onCopySelection = async (text: string) => {
    if (!text || text.length === 0) return

    await Clipboard.copy(text)
      .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
      .catch(toast.error)

    renderer.clearSelection()
  }
  const [terminalTitleEnabled, setTerminalTitleEnabled] = createSignal(kv.get("terminal_title_enabled", true))

  createEffect(() => {
    console.log(JSON.stringify(route.data))
  })

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

      // Truncate title to 40 chars max
      const title = session.title.length > 40 ? session.title.slice(0, 37) + "..." : session.title
      renderer.setTerminalTitle(`MarksCode | ${title}`)
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
      // Handle --session without --fork immediately (fork is handled in createEffect below)
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
        sdk.client.session.fork({ sessionID: match }).then((result) => {
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
    sdk.client.session.fork({ sessionID: args.sessionID }).then((result) => {
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
    ...(Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
      ? [
          {
            title: "Manage workspaces",
            value: "workspace.list",
            category: "Workspace",
            suggested: true,
            slash: {
              name: "workspaces",
            },
            onSelect: () => {
              dialog.replace(() => <DialogWorkspaceList />)
            },
          },
        ]
      : []),
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
        const current = promptRef.current
        // Don't require focus - if there's any text, preserve it
        const currentPrompt = current?.current?.input ? current.current : undefined
        const workspaceID =
          route.data.type === "session" ? sync.session.get(route.data.sessionID)?.workspaceID : undefined
        route.navigate({
          type: "home",
          initialPrompt: currentPrompt,
          workspaceID,
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
      hidden: true,
      onSelect: () => {
        local.model.variant.cycle()
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
      title: "Toggle appearance",
      value: "theme.switch_mode",
      onSelect: (dialog) => {
        setMode(mode() === "dark" ? "light" : "dark")
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
      title: "Open current session in web",
      value: "session.open-web.system",
      slash: {
        name: "open-web",
      },
      onSelect: async (dialog) => {
        if (route.data.type !== "session") {
          toast.show({ message: "Open a session first", variant: "warning" })
          dialog.clear()
          return
        }
        const baseRaw = process.env.MARKSCODE_WEB_URL || "http://127.0.0.1:8989"
        const base = baseRaw.endsWith("/") ? baseRaw.slice(0, -1) : baseRaw
        const localWeb = base.startsWith("http://127.0.0.1:8989") || base.startsWith("http://localhost:8989")
        if (localWeb) {
          const healthy = await fetch(base + "/health")
            .then((res) => res.ok)
            .catch(() => false)
          if (!healthy) {
            Bun.spawn(["sh", "-lc", "markscode web --port 8989 >/tmp/markscode-web.log 2>&1 &"], {
              stdout: "ignore",
              stderr: "ignore",
            })
            await new Promise((resolve) => setTimeout(resolve, 900))
          }
        }
        const dir = sync.session.get(route.data.sessionID)?.directory || sync.data.path.directory
        const slug = Buffer.from(dir || "", "utf8").toString("base64url")
        const url = base + "/" + slug + "/session/" + route.data.sessionID
        const launch = async () => {
          if (process.platform === "linux") {
            const p = Bun.spawn(["xdg-open", url], { stdout: "ignore", stderr: "ignore" })
            return (await p.exited) === 0
          }
          return await open(url)
            .then(() => true)
            .catch(() => false)
        }
        const opened = await launch()
        if (opened) {
          toast.show({ message: "Session opened in browser", variant: "success" })
          dialog.clear()
          return
        }
        await Clipboard.copy(url)
          .then(() => toast.show({ message: "Browser unavailable; URL copied to clipboard", variant: "success" }))
          .catch(() => toast.show({ message: "Failed to open or copy URL", variant: "error" }))
        dialog.clear()
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
        const hit = sync.data.session.find((x) => x.id === id || x.id.startsWith(id))
        if (hit) {
          route.navigate({ type: "session", sessionID: hit.id })
          toast.show({ message: "Session loaded (local)", variant: "success" })
          dialog.clear()
          return
        }

        try {
          const userID = process.env.MEMORIES_USER_ID || "marks-local"
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
          const providerID = selected?.providerID || "markscode"
          const modelID = selected?.modelID || "glm-5-free"
          const agent = local.agent.current()?.name || "default"
          const baseTime = Date.now()
          let parentID = ""

          for (const [i, item] of rows.entries()) {
            const messageID = Identifier.ascending("message")
            const createdAt = baseTime + i
            if (item.role === "assistant") {
              await SessionApi.updateMessage({
                id: messageID,
                sessionID: created.id,
                role: "assistant",
                time: { created: createdAt, completed: createdAt },
                parentID: parentID || messageID,
                modelID,
                providerID,
                mode: "normal",
                agent,
                path: { cwd: sync.data.path.directory, root: sync.data.path.directory },
                cost: 0,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              })
              await SessionApi.updatePart({
                id: Identifier.ascending("part"),
                sessionID: created.id,
                messageID,
                type: "text",
                text: item.content,
                synthetic: false,
              })
              continue
            }

            await SessionApi.updateMessage({
              id: messageID,
              sessionID: created.id,
              role: "user",
              time: { created: createdAt },
              agent,
              model: { providerID, modelID },
              format: { type: "text" },
            })
            await SessionApi.updatePart({
              id: Identifier.ascending("part"),
              sessionID: created.id,
              messageID,
              type: "text",
              text: item.content,
              synthetic: false,
            })
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
        const file = await pickFile(dialog, sync.data.path.directory, "text")
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
        const file = await pickFile(dialog, sync.data.path.directory, "image")
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
      onSelect: (dialog) => {
        const path = writeHeapSnapshot()
        toast.show({
          variant: "info",
          message: `Heap snapshot written to ${path}`,
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

  sdk.event.on(TuiEvent.CommandExecute.type, (evt) => {
    command.trigger(evt.properties.command)
  })

  sdk.event.on(TuiEvent.ToastShow.type, (evt) => {
    toast.show({
      title: evt.properties.title,
      message: evt.properties.message,
      variant: evt.properties.variant,
      duration: evt.properties.duration,
    })
  })

  sdk.event.on(TuiEvent.SessionSelect.type, (evt) => {
    route.navigate({
      type: "session",
      sessionID: evt.properties.sessionID,
    })
  })

  sdk.event.on(SessionApi.Event.Deleted.type, (evt) => {
    if (route.data.type === "session" && route.data.sessionID === evt.properties.info.id) {
      route.navigate({ type: "home" })
      toast.show({
        variant: "info",
        message: "The current session was deleted",
      })
    }
  })

  sdk.event.on(SessionApi.Event.Error.type, (evt) => {
    const error = evt.properties.error
    if (error && typeof error === "object" && error.name === "MessageAbortedError") return
    const message = (() => {
      if (!error) return "An error occurred"

      if (typeof error === "object") {
        const data = error.data
        if ("message" in data && typeof data.message === "string") {
          return data.message
        }
      }
      return String(error)
    })()

    toast.show({
      variant: "error",
      message,
      duration: 5000,
    })
  })

  sdk.event.on(Installation.Event.UpdateAvailable.type, (evt) => {
    toast.show({
      variant: "info",
      title: "Update Available",
      message: `MarksCode v${evt.properties.version} is available. Run 'markscode upgrade' to update manually.`,
      duration: 10000,
    })
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
      onMouseUp={Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT ? undefined : () => Selection.copy(renderer, toast)}
    >
      <Switch>
        <Match when={route.data.type === "home"}>
          <Home />
        </Match>
        <Match when={route.data.type === "session"}>
          <Session />
        </Match>
      </Switch>
    </box>
  )
}

function ErrorComponent(props: {
  error: Error
  reset: () => void
  onExit: () => Promise<void>
  mode?: "dark" | "light"
}) {
  const term = useTerminalDimensions()
  const renderer = useRenderer()

  const handleExit = async () => {
    renderer.setTerminalTitle("")
    renderer.destroy()
    win32FlushInputBuffer()
    await props.onExit()
  }

  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "c") {
      handleExit()
    }
  })
  const [copied, setCopied] = createSignal(false)

  const issueURL = new URL("https://github.com/anomalyco/markscode/issues/new?template=bug-report.yml")

  // Choose safe fallback colors per mode since theme context may not be available
  const isLight = props.mode === "light"
  const colors = {
    bg: isLight ? "#ffffff" : "#0a0a0a",
    text: isLight ? "#1a1a1a" : "#eeeeee",
    muted: isLight ? "#8a8a8a" : "#808080",
    primary: isLight ? "#3b7dd8" : "#fab283",
  }

  if (props.error.message) {
    issueURL.searchParams.set("title", `opentui: fatal: ${props.error.message}`)
  }

  if (props.error.stack) {
    issueURL.searchParams.set(
      "description",
      "```\n" + props.error.stack.substring(0, 6000 - issueURL.toString().length) + "...\n```",
    )
  }

  issueURL.searchParams.set("markscode-version", Installation.VERSION)

  const copyIssueURL = () => {
    Clipboard.copy(issueURL.toString()).then(() => {
      setCopied(true)
    })
  }

  return (
    <box flexDirection="column" gap={1} backgroundColor={colors.bg}>
      <box flexDirection="row" gap={1} alignItems="center">
        <text attributes={TextAttributes.BOLD} fg={colors.text}>
          Please report an issue.
        </text>
        <box onMouseUp={copyIssueURL} backgroundColor={colors.primary} padding={1}>
          <text attributes={TextAttributes.BOLD} fg={colors.bg}>
            Copy issue URL (exception info pre-filled)
          </text>
        </box>
        {copied() && <text fg={colors.muted}>Successfully copied</text>}
      </box>
      <box flexDirection="row" gap={2} alignItems="center">
        <text fg={colors.text}>A fatal error occurred!</text>
        <box onMouseUp={props.reset} backgroundColor={colors.primary} padding={1}>
          <text fg={colors.bg}>Reset TUI</text>
        </box>
        <box onMouseUp={handleExit} backgroundColor={colors.primary} padding={1}>
          <text fg={colors.bg}>Exit</text>
        </box>
      </box>
      <scrollbox height={Math.floor(term().height * 0.7)}>
        <text fg={colors.muted}>{props.error.stack}</text>
      </scrollbox>
      <text fg={colors.text}>{props.error.message}</text>
    </box>
  )
}
