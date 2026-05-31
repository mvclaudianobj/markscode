import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { Locale } from "@/util/locale"
import { createDebouncedSignal } from "../util/signal"
import { createMemo, createResource, onMount } from "solid-js"
import { useToast } from "../ui/toast"
import { errorMessage } from "@/util/error"

type AllDbSession = {
  id: string
  directory: string
  title: string
  time: {
    updated: number
  }
  source: {
    dbPath: string
    label: string
    active: boolean
  }
}

function shortID(id: string) {
  return id.slice(0, 8)
}

function command() {
  return process.execPath.endsWith("bun") ? [process.execPath, "run", process.argv[1] ?? "markscode"] : [process.execPath]
}

function quote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function quotePowerShell(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function sessionCommand(session: AllDbSession) {
  return `cd ${quote(session.directory)} && OPENCODE_DB=${quote(session.source.dbPath)} ${command().map(quote).join(" ")} --session ${quote(session.id)}`
}

function sessionPowerShellCommand(session: AllDbSession) {
  return `$env:OPENCODE_DB=${quotePowerShell(session.source.dbPath)}; Set-Location ${quotePowerShell(session.directory)}; ${command().map(quotePowerShell).join(" ")} --session ${quotePowerShell(session.id)}`
}

function openInNewTerminal(session: AllDbSession) {
  if (process.platform === "darwin") {
    const cmd = sessionCommand(session)
    return Bun.spawn({
      cmd: ["osascript", "-e", `tell application "Terminal" to do script ${JSON.stringify(cmd)}`],
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
  }
  if (process.platform === "win32") {
    const cmd = sessionPowerShellCommand(session)
    return Bun.spawn({
      cmd: ["powershell.exe", "-NoProfile", "-Command", `Start-Process pwsh -ArgumentList '-NoExit','-Command',${JSON.stringify(cmd)}`],
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
  }
  const cmd = sessionCommand(session)
  return Bun.spawn({
    cmd: [
      "sh",
      "-lc",
      `if command -v x-terminal-emulator >/dev/null 2>&1; then exec x-terminal-emulator -e bash -lc ${quote(cmd)}; fi
if command -v gnome-terminal >/dev/null 2>&1; then exec gnome-terminal -- bash -lc ${quote(cmd)}; fi
if command -v konsole >/dev/null 2>&1; then exec konsole -e bash -lc ${quote(cmd)}; fi
if command -v xfce4-terminal >/dev/null 2>&1; then exec xfce4-terminal --command ${quote(`bash -lc ${quote(cmd)}`)}; fi
if command -v alacritty >/dev/null 2>&1; then exec alacritty -e bash -lc ${quote(cmd)}; fi
if command -v kitty >/dev/null 2>&1; then exec kitty bash -lc ${quote(cmd)}; fi
if command -v wezterm >/dev/null 2>&1; then exec wezterm start -- bash -lc ${quote(cmd)}; fi
exit 127`,
    ],
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
}

export function DialogAllSessionList() {
  const dialog = useDialog()
  const route = useRoute()
  const sdk = useSDK()
  const toast = useToast()
  const [search, setSearch] = createDebouncedSignal("", 150)

  const [sessions] = createResource(search, async (query) => {
    const url = new URL("/experimental/session/all", sdk.url)
    url.searchParams.set("limit", "50")
    if (query) url.searchParams.set("search", query)
    const result = await sdk
      .fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<AllDbSession[]>
      })
      .catch((error) => {
        toast.show({
          variant: "error",
          title: "Failed to load sessions",
          message: errorMessage(error),
        })
        return []
      })
    return result
  })

  const options = createMemo(() =>
    (sessions() ?? []).map((session) => ({
      title: session.title || session.id,
      value: session,
      description: `${shortID(session.id)} • ${session.directory}`,
      category: session.source.active ? "Active database" : session.source.label,
      footer: `${session.source.label} • ${Locale.time(session.time.updated)}`,
    })),
  )

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="All Sessions"
      options={options()}
      skipFilter={true}
      onFilter={setSearch}
      onSelect={(option) => {
        if (option.value.source.active) {
          route.navigate({ type: "session", sessionID: option.value.id })
          dialog.clear()
          return
        }
        const child = openInNewTerminal(option.value)
        child.unref()
        toast.show({
          variant: "success",
          title: "Opening session",
          message: `Started Markscode with ${option.value.source.label}`,
        })
        dialog.clear()
      }}
    />
  )
}
