import {
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onMount,
  Show,
  Switch,
  useContext,
  onCleanup
} from "solid-js"
import { Dynamic } from "solid-js/web"
import path from "path"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { SplitBorder } from "@tui/component/border"
import { Spinner } from "@tui/component/spinner"
import { selectedForeground, useTheme } from "@tui/context/theme"
import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextAttributes,
  RGBA,
} from "@opentui/core"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import type { AssistantMessage, Part, ToolPart, UserMessage, TextPart, ReasoningPart } from "@opencode-ai/sdk/v2"
import { useLocal } from "@tui/context/local"
import { Locale } from "@/util/locale"
import type { Tool } from "@/tool/tool"
import type { ReadTool } from "@/tool/read"
import type { WriteTool } from "@/tool/write"
import { BashTool } from "@/tool/bash"
import type { GlobTool } from "@/tool/glob"
import { TodoWriteTool } from "@/tool/todo"
import type { GrepTool } from "@/tool/grep"
import type { ListTool } from "@/tool/ls"
import type { EditTool } from "@/tool/edit"
import type { ApplyPatchTool } from "@/tool/apply_patch"
import type { WebFetchTool } from "@/tool/webfetch"
import type { TaskTool } from "@/tool/task"
import type { QuestionTool } from "@/tool/question"
import type { SkillTool } from "@/tool/skill"
import { useKeyboard, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import { useSDK } from "@tui/context/sdk"
import { useCommandDialog } from "@tui/component/dialog-command"
import type { DialogContext } from "@tui/ui/dialog"
import { useKeybind } from "@tui/context/keybind"
import { Header } from "./header"
import { parsePatch } from "diff"
import { useDialog } from "../../ui/dialog"
import { TodoItem } from "../../component/todo-item"
import { DialogMessage } from "./dialog-message"
import type { PromptInfo } from "../../component/prompt/history"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogTimeline } from "./dialog-timeline"
import { DialogForkFromTimeline } from "./dialog-fork-from-timeline"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { Sidebar } from "./sidebar"
import { Flag } from "@/flag/flag"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import { Clipboard } from "../../util/clipboard"
import { Toast, useToast } from "../../ui/toast"
import { useKV } from "../../context/kv.tsx"
import { Editor } from "../../util/editor"
import stripAnsi from "strip-ansi"
import { Footer } from "./footer.tsx"
import { usePromptRef } from "../../context/prompt"
import { useExit } from "../../context/exit"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@/global"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { DialogExportOptions } from "../../ui/dialog-export-options"
// MARKSCODE_REMOTE_SSH_IMPORT
import { DialogPrompt } from "../../ui/dialog-prompt"
import { formatTranscript } from "../../util/transcript"
import { UI } from "@/cli/ui.ts"
import { getHumanContext, getSessionCompactContext, saveHumanMemory } from "@/memories-api"
import { useTuiConfig } from "../../context/tui-config"
class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

const context = createContext<{
  width: number
  sessionID: string
  conceal: () => boolean
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
  showGenericToolOutput: () => boolean
  diffWrapMode: () => "word" | "none"
  sync: ReturnType<typeof useSync>
  tui: ReturnType<typeof useTuiConfig>
}>()

function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}

export function Session() {
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const tuiConfig = useTuiConfig()
  const kv = useKV()
  const { theme } = useTheme()
  const promptRef = usePromptRef()
  const session = createMemo(() => sync.session.get(route.sessionID))
  const children = createMemo(() => {
    const parentID = session()?.parentID ?? session()?.id
    return sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  })
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const permissions = createMemo(() => {
    if (session()?.parentID) return []
    return children().flatMap((x) => sync.data.permission[x.id] ?? [])
  })
  const questions = createMemo(() => {
    if (session()?.parentID) return []
    return children().flatMap((x) => sync.data.question[x.id] ?? [])
  })

  const pending = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant" && !x.time.completed)?.id
  })

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant")
  })

  const dimensions = useTerminalDimensions()
  const [sidebar, setSidebar] = kv.signal<"auto" | "hide">("sidebar", "auto")
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [conceal, setConceal] = createSignal(true)
  const [showThinking, setShowThinking] = kv.signal("thinking_visibility", true)
  const [timestamps, setTimestamps] = kv.signal<"hide" | "show">("timestamps", "hide")
  const [showDetails, setShowDetails] = kv.signal("tool_details_visibility", true)
  const [showAssistantMetadata, setShowAssistantMetadata] = kv.signal("assistant_metadata_visibility", true)
  const [showScrollbar, setShowScrollbar] = kv.signal("scrollbar_visible", true)
  const [showHeader, setShowHeader] = kv.signal("header_visible", true)
  const [diffWrapMode] = kv.signal<"word" | "none">("diff_wrap_mode", "word")
  const [animationsEnabled, setAnimationsEnabled] = kv.signal("animations_enabled", true)
  const [showGenericToolOutput, setShowGenericToolOutput] = kv.signal("generic_tool_output_visibility", false)

  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => {
    if (session()?.parentID) return false
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })
  const showTimestamps = createMemo(() => timestamps() === "show")
  const contentWidth = createMemo(() => dimensions().width - (sidebarVisible() ? 42 : 0) - 4)

  const scrollAcceleration = createMemo(() => {
    const tui = tuiConfig
    if (tui?.scroll_speed) {
      return new CustomSpeedScroll(tui.scroll_speed)
    }

    return new CustomSpeedScroll(3)
  })

  createEffect(() => {
    if (session()?.workspaceID) {
      sdk.setWorkspace(session()?.workspaceID)
    }
  })

  createEffect(async () => {
    await sync.session
      .sync(route.sessionID)
      .then(() => {
        if (scroll) scroll.scrollBy(100_000)
      })
      .catch((e) => {
        console.error(e)
        toast.show({
          message: `Session not found: ${route.sessionID}`,
          variant: "error",
        })
        return navigate({ type: "home" })
      })
  })

  const toast = useToast()
  const sdk = useSDK()

  // Handle initial prompt from fork
  createEffect(() => {
    if (route.initialPrompt && prompt) {
      prompt.set(route.initialPrompt)
    }
  })

  let lastSwitch: string | undefined = undefined
  sdk.event.on("message.part.updated", (evt) => {
    const part = evt.properties.part
    if (part.type !== "tool") return
    if (part.sessionID !== route.sessionID) return
    if (part.state.status !== "completed") return
    if (part.id === lastSwitch) return

    if (part.tool === "plan_exit") {
      local.agent.set("build")
      lastSwitch = part.id
    } else if (part.tool === "plan_enter") {
      local.agent.set("plan")
      lastSwitch = part.id
    }
  })

  let scroll: ScrollBoxRenderable
  let prompt: PromptRef
  const keybind = useKeybind()
  // MARKSCODE_REMOTE_SSH_HELPERS_START
  type RemoteSSHConfig = {
    type?: "ssh" | "winrm"
    host: string
    user: string
    port: number
    transport?: "http" | "https"
    password?: string
    identity_file?: string
    key_name?: string
    host_alias?: string
  }

  type RemoteExecResult = {
    ok: boolean
    cmd: string
    code: number
    out: string
    err: string
  }

  const normalizeRemotePort = (value: string) => {
    const raw = Number.parseInt(value.trim(), 10)
    if (!Number.isFinite(raw) || raw <= 0 || raw > 65535) return 22
    return raw
  }

  const shellQuoteSingle = (value: string) => value.replace(/'/g, "'\\''")

  const maskRemoteSSHCommand = (cfg: RemoteSSHConfig) => {
    if ((cfg.type || "ssh") === "winrm") {
      const scheme = (cfg.transport || "https") === "http" ? "http" : "https"
      const base = [
        "pwsh -NoProfile -Command",
        "\"Invoke-Command -ComputerName " + cfg.host +
          " -Port " + String(cfg.port) +
          (scheme === "https" ? " -UseSSL" : "") +
          " -ScriptBlock { <CMD> }\"",
      ].join(" ")
      if (!cfg.password) return base
      return base + " (credential via senha salva)"
    }
    const identity = resolveIdentityFile(cfg)
    const alias = cfg.host_alias && !looksPath(cfg.host_alias) ? cfg.host_alias.trim() : ""
    const target = alias || (cfg.user + "@" + cfg.host)
    const base = [
      "ssh",
      "-o",
      "StrictHostKeyChecking=accept-new",
      ...(identity ? ["-i", identity, "-o", "IdentitiesOnly=yes"] : []),
      ...(alias ? [] : ["-p", String(cfg.port)]),
      target,
    ].join(" ")
    if (!cfg.password) return base
    return "sshpass -p '***' " + base
  }

  const hasBin = (name: string) => {
    try {
      const run = Bun.spawnSync({
        cmd: ["sh", "-lc", "command -v " + name + " >/dev/null 2>&1"],
        stdout: "pipe",
        stderr: "pipe",
      })
      return run.exitCode === 0
    } catch {
      return false
    }
  }

  const sshDeps = () => ({
    ssh: hasBin("ssh"),
    sshpass: hasBin("sshpass"),
    pwsh: hasBin("pwsh") || hasBin("powershell"),
  })

  const findIdentityFile = () => {
    const home = process.env.HOME || ""
    if (!home) return ""
    const known = ["id_ed25519", "id_rsa", "id_ecdsa"].map((x) => home + "/.ssh/" + x)
    for (const item of known) {
      const test = Bun.spawnSync({ cmd: ["sh", "-lc", "test -f '" + shellQuoteSingle(item) + "'"], stdout: "pipe", stderr: "pipe" })
      if (test.exitCode === 0) return item
    }
    return ""
  }

  const expandHomePath = (value?: string) => {
    if (!value) return ""
    const text = value.trim()
    if (!text) return ""
    if (!text.startsWith("~/")) return text
    const home = process.env.HOME || ""
    if (!home) return text
    return home + "/" + text.slice(2)
  }

  const normalizeKeyName = (value?: string) => {
    if (!value) return ""
    const text = value.trim()
    const base = text.startsWith("~/.ssh/") ? text.slice(7) : text
    return base.endsWith(".pub") ? base.slice(0, -4) : base
  }

  const looksPath = (value?: string) => {
    if (!value) return false
    const text = value.trim()
    if (!text) return false
    if (text.startsWith("~/") || text.startsWith("/") || text.startsWith("./") || text.startsWith("../")) return true
    return text.includes("/")
  }

  const identityFromKeyName = (value?: string) => {
    const name = normalizeKeyName(value)
    if (!name) return ""
    if (name.includes("/")) return expandHomePath(name)
    return expandHomePath("~/.ssh/" + name)
  }

  const hasFile = (path: string) => {
    if (!path) return false
    const test = Bun.spawnSync({ cmd: ["sh", "-lc", "test -f '" + shellQuoteSingle(path) + "'"], stdout: "pipe", stderr: "pipe" })
    return test.exitCode === 0
  }

  const resolveIdentityFile = (cfg: RemoteSSHConfig) => {
    const direct = expandHomePath(cfg.identity_file)
    if (direct && hasFile(direct)) return direct
    const named = identityFromKeyName(cfg.key_name)
    if (named && hasFile(named)) return named
    return ""
  }

  const REMOTE_SSH_SSHPASS_MISSING_MESSAGE =
    "Dependência ausente: sshpass. Opções: (1) reconectar com chave SSH, (2) instalar sshpass, (3) limpar senha salva."

  const remoteAuthMode = (cfg: RemoteSSHConfig) => {
    if ((cfg.type || "ssh") === "winrm") {
      if (cfg.password) return "winrm-password"
      return "winrm-credential"
    }
    if (cfg.password) return "password"
    if (cfg.identity_file || cfg.key_name) return "key"
    if (cfg.host_alias) return "alias"
    return "ssh-default"
  }

  const ensureRemoteSSHAuth = (cfg: RemoteSSHConfig) => {
    const deps = sshDeps()
    const mode = remoteAuthMode(cfg)
    if ((cfg.type || "ssh") === "winrm") {
      if (!deps.pwsh) {
        kv.set("remote_ssh_auth_mode", mode)
        kv.set("remote_ssh_auth_ready", "0")
        kv.set("remote_ssh_auth_hint", "Dependência ausente: pwsh/powershell para WinRM")
        return { cfg, ok: false, deps }
      }
      kv.set("remote_ssh_auth_mode", mode)
      kv.set("remote_ssh_auth_ready", cfg.password ? "1" : "0")
      kv.set("remote_ssh_auth_hint", cfg.password ? "ok" : "WinRM sem senha salva; poderá exigir credencial interativa")
      return { cfg, ok: Boolean(cfg.password), deps }
    }
    if (!cfg.password) {
      kv.set("remote_ssh_auth_mode", mode)
      kv.set("remote_ssh_auth_ready", "1")
      kv.set("remote_ssh_auth_hint", "ok")
      return { cfg, ok: true, deps }
    }
    if (deps.sshpass) {
      kv.set("remote_ssh_auth_mode", mode)
      kv.set("remote_ssh_auth_ready", "1")
      kv.set("remote_ssh_auth_hint", "ok")
      return { cfg, ok: true, deps }
    }
    const fallback = {
      type: "ssh",
      host: cfg.host,
      user: cfg.user,
      port: cfg.port,
      transport: "https",
      host_alias: cfg.host_alias,
      key_name: cfg.key_name,
      identity_file: resolveIdentityFile(cfg) || findIdentityFile() || undefined,
      password: undefined,
    } satisfies RemoteSSHConfig
    kv.set("remote_ssh_config", fallback)
    kv.set("remote_ssh_auth_mode", remoteAuthMode(fallback))
    kv.set("remote_ssh_auth_ready", "0")
    kv.set("remote_ssh_auth_hint", REMOTE_SSH_SSHPASS_MISSING_MESSAGE)
    return { cfg: fallback, ok: false, deps }
  }

  type RemoteSSHProfile = {
    id: string
    name: string
    type?: "ssh" | "winrm"
    host: string
    user: string
    port: number
    transport?: "http" | "https"
    password?: string
    identity_file?: string
    key_name?: string
    host_alias?: string
    created_at: string
    updated_at: string
  }

  const readRemoteSSHProfiles = () => {
    const raw = kv.get("remote_ssh_profiles")
    if (!Array.isArray(raw)) return [] as RemoteSSHProfile[]
    return raw.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const id = typeof item.id === "string" ? item.id.trim() : ""
      const name = typeof item.name === "string" ? item.name.trim() : ""
      const host = typeof item.host === "string" ? item.host.trim() : ""
      const user = typeof item.user === "string" ? item.user.trim() : ""
      const portRaw = typeof item.port === "number" ? String(item.port) : typeof item.port === "string" ? item.port : "22"
      const typeRaw = typeof item.type === "string" ? item.type.trim().toLowerCase() : "ssh"
      const type = typeRaw === "winrm" ? "winrm" : "ssh"
      const transportRaw = typeof item.transport === "string" ? item.transport.trim().toLowerCase() : "https"
      const transport = transportRaw === "http" ? "http" : "https"
      if (!id || !name || !host || !user) return []
      const password = typeof item.password === "string" ? item.password : ""
      const identity_file = typeof item.identity_file === "string" ? item.identity_file.trim() : ""
      const key_name = typeof item.key_name === "string" ? item.key_name.trim() : ""
      const host_alias = typeof item.host_alias === "string" ? item.host_alias.trim() : ""
      const created_at = typeof item.created_at === "string" && item.created_at ? item.created_at : new Date().toISOString()
      const updated_at = typeof item.updated_at === "string" && item.updated_at ? item.updated_at : new Date().toISOString()
      return [{
        id,
        name,
        type,
        host,
        user,
        port: normalizeRemotePort(portRaw),
        transport,
        password: password || undefined,
        identity_file: identity_file || undefined,
        key_name: key_name || undefined,
        host_alias: host_alias || undefined,
        created_at,
        updated_at,
      } satisfies RemoteSSHProfile]
    })
  }

  const writeRemoteSSHProfiles = (profiles: RemoteSSHProfile[]) => {
    kv.set("remote_ssh_profiles", profiles)
  }

  const readRemoteSSHProfileSessionMap = () => {
    const raw = kv.get("remote_ssh_profile_session_map")
    if (!raw || typeof raw !== "object") return {} as Record<string, string>
    return Object.entries(raw).reduce((acc, [sid, pid]) => {
      if (typeof pid === "string" && pid.trim()) acc[sid] = pid.trim()
      return acc
    }, {} as Record<string, string>)
  }

  const writeRemoteSSHProfileSessionMap = (value: Record<string, string>) => {
    kv.set("remote_ssh_profile_session_map", value)
  }

  const sessionRemoteSSHProfileID = () => {
    return readRemoteSSHProfileSessionMap()[route.sessionID]
  }

  const bindRemoteSSHProfileToSession = (profileID: string) => {
    const next = { ...readRemoteSSHProfileSessionMap(), [route.sessionID]: profileID }
    writeRemoteSSHProfileSessionMap(next)
    kv.set("remote_ssh_active_profile", profileID)
  }

  const unbindRemoteSSHProfileFromSession = () => {
    const next = { ...readRemoteSSHProfileSessionMap() }
    delete next[route.sessionID]
    writeRemoteSSHProfileSessionMap(next)
  }

  const applyRemoteSSHConfig = (cfg: RemoteSSHConfig) => {
    kv.set("remote_ssh_mode", true)
    kv.set("remote_ssh_config", cfg)
    kv.set("remote_ssh_auth_mode", remoteAuthMode(cfg))
    kv.set("remote_ssh_auth_ready", "1")
    kv.set("remote_ssh_auth_hint", "ok")
  }

  const createRemoteSSHProfile = (cfg: RemoteSSHConfig, name: string, existingID?: string) => {
    const now = new Date().toISOString()
    const id = existingID || [cfg.user, cfg.host, String(cfg.port)].join("@").replace(/s+/g, "-") + "-" + String(Date.now())
    const list = readRemoteSSHProfiles()
    const found = list.find((x) => x.id === id)
    const profile = {
      id,
      name,
      type: cfg.type || "ssh",
      host: cfg.host,
      user: cfg.user,
      port: cfg.port,
      transport: cfg.transport || "https",
      password: cfg.password,
      identity_file: cfg.identity_file,
      key_name: cfg.key_name,
      host_alias: looksPath(cfg.host_alias) ? undefined : cfg.host_alias,
      created_at: found?.created_at || now,
      updated_at: now,
    } satisfies RemoteSSHProfile
    const next = [...list.filter((x) => x.id !== id), profile].sort((a, b) => a.name.localeCompare(b.name))
    writeRemoteSSHProfiles(next)
    return profile
  }

  const findRemoteSSHProfile = (pick: string) => {
    const key = pick.trim().toLowerCase()
    if (!key) return undefined
    const list = readRemoteSSHProfiles()
    return list.find((x) => x.id === pick.trim()) || list.find((x) => x.name.toLowerCase() === key)
  }

  const deleteRemoteSSHProfile = (profileID: string) => {
    writeRemoteSSHProfiles(readRemoteSSHProfiles().filter((x) => x.id !== profileID))
    const map = readRemoteSSHProfileSessionMap()
    const next = Object.entries(map).reduce((acc, [sid, pid]) => {
      if (pid !== profileID) acc[sid] = pid
      return acc
    }, {} as Record<string, string>)
    writeRemoteSSHProfileSessionMap(next)
    if (sessionRemoteSSHProfileID() === profileID) unbindRemoteSSHProfileFromSession()
  }

  const buildRemoteExecCommand = (cfg: RemoteSSHConfig, command?: string) => {
    if ((cfg.type || "ssh") === "winrm") {
      const deps = sshDeps()
      const raw = command && command.trim() ? command.trim() : "hostname"
      const scheme = (cfg.transport || "https") === "http" ? "http" : "https"
      const script = raw.replace(/\r?\n/g, "; ").replace(/"/g, "'")
      const core = [
        "Invoke-Command",
        "-ComputerName", cfg.host,
        "-Port", String(cfg.port),
        ...(scheme === "https" ? ["-UseSSL"] : []),
        "-Authentication", "Basic",
        "-SessionOption", "(New-PSSessionOption -SkipCACheck -SkipCNCheck)",
        ...(cfg.password
          ? [
              "-Credential",
              "(New-Object System.Management.Automation.PSCredential('" + cfg.user.replace(/'/g, "''") + "',(ConvertTo-SecureString '" + cfg.password.replace(/'/g, "''") + "' -AsPlainText -Force)))",
            ]
          : []),
        "-ScriptBlock",
        "{ " + script + " }",
      ].join(" ")
      const cmd = "pwsh -NoProfile -Command \"" + core + "\""
      return { cmd, base: cmd, requiresSshpass: false, deps }
    }

    const deps = sshDeps()
    const identity = resolveIdentityFile(cfg)
    const alias = cfg.host_alias && !looksPath(cfg.host_alias) ? cfg.host_alias.trim() : ""
    const target = alias || (cfg.user + "@" + cfg.host)
    const remote = [
      "ssh",
      "-o",
      "StrictHostKeyChecking=accept-new",
      ...(identity ? ["-i", identity, "-o", "IdentitiesOnly=yes"] : []),
      ...(alias ? [] : ["-p", String(cfg.port)]),
      target,
    ]
    if (command && command.trim()) {
      remote.push("'" + shellQuoteSingle(command.trim()) + "'")
    }

    const base = remote.join(" ")
    if (!cfg.password) {
      return { cmd: base, base, requiresSshpass: false, deps }
    }
    if (!deps.sshpass) {
      return { cmd: base, base, requiresSshpass: true, deps }
    }
    return {
      cmd: "sshpass -p '" + shellQuoteSingle(cfg.password) + "' " + base,
      base,
      requiresSshpass: false,
      deps,
    }
  }

  const buildRemoteSCPUploadCommand = (cfg: RemoteSSHConfig, localPath?: string, remotePath?: string) => {
    if ((cfg.type || "ssh") === "winrm") {
      const src = localPath && localPath.trim() ? localPath.trim() : "<LOCAL_PATH>"
      const dst = remotePath && remotePath.trim() ? remotePath.trim() : "<REMOTE_PATH>"
      const scheme = (cfg.transport || "https") === "http" ? "http" : "https"
      const useSSL = scheme === "https" ? "-UseSSL " : ""
      const cred = cfg.password
        ? "(New-Object System.Management.Automation.PSCredential('" + cfg.user.replace(/'/g, "''") + "',(ConvertTo-SecureString '***' -AsPlainText -Force)))"
        : "(Get-Credential)"
      const cmd =
        "pwsh -NoProfile -Command \"\$o=New-PSSessionOption -SkipCACheck -SkipCNCheck; \$s=New-PSSession -ComputerName " +
        cfg.host +
        " -Port " +
        String(cfg.port) +
        " " +
        useSSL +
        "-Authentication Basic " +
        "-Credential " +
        cred +
        " -SessionOption \$o" +
        "; Copy-Item -Path '" +
        src.replace(/'/g, "''") +
        "' -Destination '" +
        dst.replace(/'/g, "''") +
        "' -ToSession \$s; Remove-PSSession \$s\""
      return { cmd, masked: cmd }
    }

    const deps = sshDeps()
    const identity = resolveIdentityFile(cfg)
    const alias = cfg.host_alias && !looksPath(cfg.host_alias) ? cfg.host_alias.trim() : ""
    const target = alias || (cfg.user + "@" + cfg.host)
    const src = localPath && localPath.trim() ? localPath.trim() : "<LOCAL_PATH>"
    const dst = remotePath && remotePath.trim() ? remotePath.trim() : "<REMOTE_PATH>"
    const base = [
      "scp",
      "-o",
      "StrictHostKeyChecking=accept-new",
      ...(identity ? ["-i", identity, "-o", "IdentitiesOnly=yes"] : []),
      ...(alias ? [] : ["-P", String(cfg.port)]),
      "'" + shellQuoteSingle(src) + "'",
      "'" + shellQuoteSingle(target + ":" + dst) + "'",
    ].join(" ")
    if (!cfg.password || !deps.sshpass) return { cmd: base, masked: base }
    return {
      cmd: "sshpass -p '" + shellQuoteSingle(cfg.password) + "' " + base,
      masked: "sshpass -p '***' " + base,
    }
  }

  const remoteSCPDirective = (cfg: RemoteSSHConfig) => {
    const scp = buildRemoteSCPUploadCommand(cfg)
    if ((cfg.type || "ssh") === "winrm") {
      return [
        "- SCP policy: em alvo Windows/WinRM, usar sessão remota com Copy-Item -ToSession/-FromSession.",
        "- File template: " + scp.masked,
        "- File note: criar diretório remoto antes do envio quando necessário (New-Item -ItemType Directory -Force).",
      ]
    }
    return [
      "- SCP policy: quando o Senhor Marcos pedir envio de arquivo ao host remoto, use scp com este perfil ativo.",
      "- SCP template: " + scp.masked,
      "- SCP note: preserve nomes de arquivos e crie diretório remoto antes do envio quando necessário (mkdir -p).",
    ]
  }

  const runRemoteSSH = (cfg: RemoteSSHConfig, command?: string): RemoteExecResult => {
    const built = buildRemoteExecCommand(cfg, command)
    if (!built.deps.ssh) {
      return {
        ok: false,
        cmd: built.cmd,
        code: 127,
        out: "",
        err: "ssh não encontrado no host local",
      }
    }
    if (built.requiresSshpass) {
      const fallback = Bun.spawnSync({
        cmd: ["sh", "-lc", built.base],
        stdout: "pipe",
        stderr: "pipe",
      })
      const outFallback = new TextDecoder().decode(fallback.stdout || new Uint8Array())
      const errFallback = new TextDecoder().decode(fallback.stderr || new Uint8Array())
      if (fallback.exitCode === 0) {
        return {
          ok: true,
          cmd: built.base,
          code: 0,
          out: outFallback,
          err: "",
        }
      }
      return {
        ok: false,
        cmd: built.base,
        code: fallback.exitCode || 127,
        out: outFallback,
        err: [REMOTE_SSH_SSHPASS_MISSING_MESSAGE, errFallback].filter(Boolean).join("\n"),
      }
    }

    const run = Bun.spawnSync({
      cmd: ["sh", "-lc", built.cmd],
      stdout: "pipe",
      stderr: "pipe",
    })
    const out = new TextDecoder().decode(run.stdout || new Uint8Array())
    const err = new TextDecoder().decode(run.stderr || new Uint8Array())
    return {
      ok: run.exitCode === 0,
      cmd: built.cmd,
      code: run.exitCode,
      out,
      err,
    }
  }

  const runRemoteExec = (cfg: RemoteSSHConfig, command?: string): RemoteExecResult => {
    if ((cfg.type || "ssh") === "winrm") {
      const deps = sshDeps()
      if (!deps.pwsh) {
        return {
          ok: false,
          cmd: "pwsh",
          code: 127,
          out: "",
          err: "pwsh/powershell não encontrado no host local",
        }
      }
      const built = buildRemoteExecCommand(cfg, command)
      const run = Bun.spawnSync({
        cmd: ["sh", "-lc", built.cmd],
        stdout: "pipe",
        stderr: "pipe",
      })
      const out = new TextDecoder().decode(run.stdout || new Uint8Array())
      const err = new TextDecoder().decode(run.stderr || new Uint8Array())
      return {
        ok: run.exitCode === 0,
        cmd: built.cmd,
        code: run.exitCode,
        out,
        err,
      }
    }
    return runRemoteSSH(cfg, command)
  }

  const readRemoteSSHConfig = () => {
    const profileID = sessionRemoteSSHProfileID()
    if (profileID) {
      const profile = readRemoteSSHProfiles().find((x) => x.id === profileID)
      if (profile) {
        return {
          type: profile.type || "ssh",
          host: profile.host,
          user: profile.user,
          port: profile.port,
          transport: profile.transport || "https",
          password: profile.password,
          identity_file: profile.identity_file,
          key_name: profile.key_name,
          host_alias: looksPath(profile.host_alias) ? undefined : profile.host_alias,
        } satisfies RemoteSSHConfig
      }
    }
    const raw = kv.get("remote_ssh_config")
    if (!raw || typeof raw !== "object") return undefined
    const host = typeof raw.host === "string" ? raw.host.trim() : ""
    const user = typeof raw.user === "string" ? raw.user.trim() : ""
    const typeRaw = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : "ssh"
    const type = typeRaw === "winrm" ? "winrm" : "ssh"
    const transportRaw = typeof raw.transport === "string" ? raw.transport.trim().toLowerCase() : "https"
    const transport = transportRaw === "http" ? "http" : "https"
    if (!host || !user) return undefined
    const portValue =
      typeof raw.port === "number"
        ? String(raw.port)
        : typeof raw.port === "string"
          ? raw.port
          : "22"
    const password = typeof raw.password === "string" ? raw.password : ""
    const identity_file = typeof raw.identity_file === "string" ? raw.identity_file.trim() : ""
    const key_name = typeof raw.key_name === "string" ? raw.key_name.trim() : ""
    const host_alias = typeof raw.host_alias === "string" ? raw.host_alias.trim() : ""
    return {
      type,
      host,
      user,
      port: normalizeRemotePort(portValue),
      transport,
      password: password || undefined,
      identity_file: identity_file || undefined,
      key_name: key_name || undefined,
      host_alias: looksPath(host_alias) ? undefined : (host_alias || undefined),
    } satisfies RemoteSSHConfig
  }

  const ensureRemoteSSHProfileSeed = () => {
    const list = readRemoteSSHProfiles()
    if (list.length) return list
    const cfg = readRemoteSSHConfig()
    if (!cfg) return list
    const seed = createRemoteSSHProfile(cfg, cfg.user + "@" + cfg.host)
    bindRemoteSSHProfileToSession(seed.id)
    return [seed]
  }

  const injectRemoteSSHPrompt = (title: string, cfg: RemoteSSHConfig, extra?: string[]) => {
    const cur = prompt.current
    const lines = [
      "[" + title + "]",
      "- Type: " + (cfg.type || "ssh"),
      "- Host: " + cfg.host,
      "- User: " + cfg.user,
      "- Port: " + String(cfg.port),
      ...((cfg.type || "ssh") === "winrm" ? ["- Transport: " + (cfg.transport || "https")] : []),
      ...(cfg.host_alias ? ["- Alias: " + cfg.host_alias] : []),
      ...(cfg.identity_file ? ["- Identity: " + cfg.identity_file] : []),
      ...(cfg.key_name ? ["- Key name: " + cfg.key_name] : []),
      "- Command: " + maskRemoteSSHCommand(cfg),
      ...remoteSCPDirective(cfg),
      ...(extra || []),
      "",
    ]
    prompt.set({
      input: (cur.input ? cur.input + "\n\n" : "") + lines.join("\n"),
      parts: cur.parts,
    })
  }

  const remotePrompt = async (dialog: DialogContext, title: string, options: any) => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    return DialogPrompt.show(dialog, title, options)
  }

  const showRemoteSSHProfilesDialog = async (dialog: DialogContext, title?: string) => {
    const list = ensureRemoteSSHProfileSeed()
    if (!list.length) {
      toast.show({ message: "Nenhum perfil remoto salvo", variant: "warning" })
      dialog.clear()
      return
    }
    const currentID = sessionRemoteSSHProfileID()
    const rows = list
      .slice(0, 80)
      .map((x) => "- " + (x.id === currentID ? "* " : "") + x.name + " | " + (x.type || "ssh") + " | " + x.user + "@" + x.host + ":" + String(x.port) + " | key=" + (x.key_name || "-") + " | id=" + x.id)
    await remotePrompt(
      dialog,
      [title || "Perfis remotos salvos", ...rows, "", "Pressione ENTER para fechar."].join("\n"),
      {
        placeholder: "",
        value: "",
      },
    )
    dialog.clear()
  }

  const pickRemoteSSHProfile = async (dialog: DialogContext, title: string) => {
    const list = ensureRemoteSSHProfileSeed()
    if (!list.length) {
      toast.show({ message: "Nenhum perfil remoto salvo", variant: "warning" })
      dialog.clear()
      return undefined
    }
    const currentID = sessionRemoteSSHProfileID()
    const rows = list
      .slice(0, 80)
      .map((x, i) => String(i + 1) + ") " + (x.id === currentID ? "* " : "") + x.name + " | " + (x.type || "ssh") + " | " + x.user + "@" + x.host + ":" + String(x.port) + " | key=" + (x.key_name || "-") + " | id=" + x.id)
    const pick = ((await remotePrompt(
      dialog,
      [title + " (indice|nome|id)", ...rows, "", "Digite o indice, nome ou id e pressione ENTER."].join("\n"),
      {
        placeholder: "1",
        value: "",
      },
    )) || "").trim()
    if (!pick) return list.find((x) => x.id === currentID) || list[0]
    const key = pick.toLowerCase()
    const idPos = key.indexOf("id=")
    if (idPos >= 0) {
      const tail = pick.slice(idPos + 3).trim()
      const id = tail.split("|")[0]?.split(" ")[0]?.trim() || ""
      const hit = id ? list.find((x) => x.id === id) : undefined
      if (hit) return hit
    }
    let idxRaw = ""
    for (const ch of pick.trim()) {
      if (ch >= "0" && ch <= "9") {
        idxRaw += ch
        continue
      }
      if (idxRaw) break
    }
    if (idxRaw) {
      const idx = Number.parseInt(idxRaw, 10) - 1
      if (idx >= 0 && idx < list.length) return list[idx]
    }
    const found = findRemoteSSHProfile(pick) || list.find((x) => x.name.toLowerCase().includes(pick.toLowerCase()))
    if (found) return found
    const fallback = list.find((x) => x.id === currentID) || list[0]
    if (fallback) {
      toast.show({ message: "Perfil não localizado com exatidão; usando perfil padrão da sessão", variant: "warning" })
      return fallback
    }
    return undefined
  }

  const routeRemoteSSHProfileByText = (text: string) => {
    const list = ensureRemoteSSHProfileSeed()
    const clean = text.trim().toLowerCase()
    if (!clean) return [] as RemoteSSHProfile[]
    return list.filter((x) => {
      const names = [x.name, x.host_alias || "", x.host]
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean)
      return names.some((n) => {
        const escaped = n.replace(/[-/\^$*+?.()|[]{}]/g, "\  const keybind = useKeybind()")
        const re = new RegExp("(^|[^a-zA-Z0-9_-])" + escaped + "([^a-zA-Z0-9_-]|$)", "i")
        return re.test(clean)
      })
    })
  }

  const REMOTE_AGENT_SCRIPT = [
    "#!/bin/sh",
    "set -eu",
    "cmd=${1:-snapshot}",
    "run() { sh -lc $1 2>/dev/null || true; }",
    "if [ $cmd = snapshot ]; then",
    "  echo [agent] host=$(hostname 2>/dev/null || echo unknown)",
    "  echo [agent] os=$(uname -s 2>/dev/null || echo unknown) arch=$(uname -m 2>/dev/null || echo unknown)",
    "  echo [agent] uptime",
    "  run 'uptime'",
    "  echo [agent] disk",
    "  run 'df -h'",
    "  echo [agent] net",
    "  run 'ifconfig || ip a'",
    "  echo [agent] process",
    "  run 'ps aux | head -n 40 || ps -axo pid,ppid,pcpu,pmem,command | head -n 40'",
    "  exit 0",
    "fi",
    "echo unknown_command:$cmd",
  ].join("\n")

  const runRemoteAgentSnapshot = (cfg: RemoteSSHConfig) => {
    const command = [
      "sh -s -- snapshot <<'__MARKS_AGENT__'",
      REMOTE_AGENT_SCRIPT,
      "__MARKS_AGENT__",
    ].join("\n")
    return runRemoteSSH(cfg, command)
  }

  const injectRemoteExecResult = (title: string, result: RemoteExecResult) => {
    const cur = prompt.current
    const chunk = (value: string) =>
      value
        .trim()
        .split(/\r?\n/)
        .slice(0, 80)
        .join("\n")

    const lines = [
      "[" + title + "]",
      "- Exit code: " + String(result.code),
      "- Command: " + result.cmd.replace(/sshpass -p '\S+'/g, "sshpass -p '***'"),
      "",
    ]
    if (result.out.trim()) {
      lines.push("[stdout]")
      lines.push(chunk(result.out))
      lines.push("")
    }
    if (result.err.trim()) {
      lines.push("[stderr]")
      lines.push(chunk(result.err))
      lines.push("")
    }
    prompt.set({
      input: (cur.input ? cur.input + "\n\n" : "") + lines.join("\n"),
      parts: cur.parts,
    })
  }

  const updateRemoteExecState = (title: string, result: RemoteExecResult) => {
    const pick = (value: string) =>
      value
        .trim()
        .split(/\r?\n/)
        .slice(0, 1)
        .join("\n")
        .slice(0, 180)
    kv.set("remote_ssh_last_title", title)
    kv.set("remote_ssh_last_cmd", result.cmd.replace(/sshpass -p '\S+'/g, "sshpass -p '***'"))
    kv.set("remote_ssh_last_ok", result.ok ? "1" : "0")
    kv.set("remote_ssh_last_code", String(result.code))
    kv.set("remote_ssh_last_at", new Date().toISOString())
    kv.set("remote_ssh_last_out", pick(result.ok ? result.out : (result.err || result.out)))
    kv.set("remote_ssh_last_target", result.cmd.includes(" remote-ssh-") ? "remote" : "remote")
  }
  // MARKSCODE_REMOTE_SSH_HELPERS_END
  // MARKSCODE_MEMORIES_HELPERS_START
  const [lastMemorySaveAt, setLastMemorySaveAt] = createSignal(0)
  const [lastMemoryChars, setLastMemoryChars] = createSignal(0)
  const [lastMemoryHash, setLastMemoryHash] = createSignal("")
  const [activeMemorySessionID, setActiveMemorySessionID] = createSignal<string | undefined>(undefined)
  const [overflowRecovering, setOverflowRecovering] = createSignal(false)
  const [lastOverflowRecoveredMessageID, setLastOverflowRecoveredMessageID] = createSignal<string | number | undefined>(undefined)
  const snapshotCache = new Map<string, string>()

  const memorySnapshotFor = (sessionID: string) =>
    (sync.data.message[sessionID] ?? [])
      .map((msg) => {
        const role = msg.role === "user" ? "User" : "AI"
        const parts = (sync.data.part[msg.id] ?? [])
          .flatMap((x) => {
            if (x.type !== "text" || !("text" in x)) return []
            return [x.text.trim()]
          })
          .filter((x): x is string => Boolean(x))
        if (!parts.length) return ""
        return role + ": " + parts.join("\n")
      })
      .filter(Boolean)
      .join("\n\n")
      .trim()

  const cachedMemorySnapshotFor = (sessionID: string) => {
    const text = memorySnapshotFor(sessionID)
    if (text) {
      snapshotCache.set(sessionID, text)
      return text
    }
    return snapshotCache.get(sessionID) || ""
  }

  const memorySnapshot = () => {
    if (!route.sessionID) return ""
    return cachedMemorySnapshotFor(route.sessionID)
  }

  const memoryHash = (value: string) => value.length + ":" + value.slice(0, 256)

  const normalizeMemoryText = (value: unknown) =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""

  const compactRowsFrom = (body: any): string[] => {
    const rows: string[] = []
    const push = (value: unknown) => {
      const normalized = normalizeMemoryText(value)
      if (normalized) rows.push(normalized)
    }
    const fromArray = (list: any[]) => {
      list.forEach((item) => {
        if (typeof item === "string") {
          push(item)
          return
        }
        if (!item || typeof item !== "object") return
        push(item.content)
        push(item.text)
        push(item.summary)
        push(item.compact)
      })
    }

    if (!body || typeof body !== "object") return rows
    push(body.compact)
    push(body.summary)
    push(body.text)
    if (Array.isArray(body.items)) fromArray(body.items)
    if (Array.isArray(body.memories)) fromArray(body.memories)
    if (Array.isArray(body.chunks)) fromArray(body.chunks)
    return [...new Set(rows)]
  }

  const loadHumanContextRows = async (sessionID: string) => {
    const ctx = await getHumanContext({ user_id: memoriesUserID, session_id: sessionID })
    return [...(ctx.short_term || []), ...(ctx.long_term || []), ...(ctx.visual || [])]
      .filter((m) => m.session_id === sessionID)
      .map((m) => normalizeMemoryText(m.content))
      .filter(Boolean)
      .slice(0, 8)
  }

  const loadCompactContextRows = async (sessionID: string, limit = 5) => {
    const compact = await getSessionCompactContext({
      user_id: memoriesUserID,
      session_id: sessionID,
      limit,
    })
    return compactRowsFrom(compact).slice(0, limit)
  }

  const injectContext = (title: string, rows: string[]) => {
    const cur = prompt.current
    prompt.set({
      input:
        (cur.input ? cur.input + "\n\n" : "") +
        [title, ...rows.map((x) => "- " + x), ""].join("\n"),
      parts: cur.parts,
    })
  }

  const isContextOverflowError = (value: string) =>
    /(context length|maximum context|context window|token limit|too many tokens|prompt is too long|input is too long|max context)/i.test(
      value,
    )

  const errorTextFromMessage = (message: any) => {
    const error = message?.error
    if (!error) return ""
    if (typeof error === "string") return error
    if (typeof error?.data?.message === "string") return error.data.message
    if (typeof error?.message === "string") return error.message
    return ""
  }

  const recoverFromContextOverflow = async (sessionID: string) => {
    if (overflowRecovering()) return
    setOverflowRecovering(true)
    try {
      const rows = await loadCompactContextRows(sessionID, 5)
      if (!rows.length) {
        toast.show({ message: "No compact memories found", variant: "warning" })
        return
      }

      const status = sync.data.session_status?.[sessionID]
      if (status?.type !== "idle") {
        await sdk.client.session.abort({ sessionID }).catch(() => {})
      }

      const firstUser = messages().find((x) => x.role === "user")
      if (firstUser) {
        await sdk.client.session.revert({ sessionID, messageID: firstUser.id }).catch(() => {})
      }

      prompt.set({
        input: ["[Human memories compacted context]", ...rows.map((x) => "- " + x), ""].join("\n"),
        parts: [],
      })
      toast.show({ message: "Context overflow recovered with compact memory", variant: "success" })
    } finally {
      setOverflowRecovering(false)
    }
  }

  const saveSessionMemoryFor = async (sessionID: string, origin: "manual" | "auto") => {
    const text = cachedMemorySnapshotFor(sessionID)
    if (!text || !sessionID) return false
    const title = (sync.session.get(sessionID)?.title || "").trim()
    const selected = local.model.current()
    const lastAssistant = [...messages()].reverse().find((x) => x.role === "assistant") as
      | { modelID?: string; providerID?: string }
      | undefined
    const sourceName = [selected?.providerID || lastAssistant?.providerID, selected?.modelID || lastAssistant?.modelID]
      .filter(Boolean)
      .join(":")
    const words = text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 8)
    await saveHumanMemory({
      user_id: memoriesUserID,
      session_id: sessionID,
      type: "episodic",
      memory_mode: "short_term",
      title: title || undefined,
      subject: "Session " + sessionID,
      content: text,
      importance: 0.7,
      tags: ["tui", "conversation", "short_term", origin],
      triggers: words,
      retrieval_cues: words,
      mnemonic_techniques: ["association"],
      visual_refs: [],
      source_name: sourceName || undefined,
    })
    setLastMemorySaveAt(Date.now())
    setLastMemoryChars(text.length)
    setLastMemoryHash(memoryHash(text))
    return true
  }

  const saveSessionMemory = async (origin: "manual" | "auto") => {
    if (!route.sessionID) return false
    return saveSessionMemoryFor(route.sessionID, origin)
  }
  // MARKSCODE_MEMORIES_HELPERS_END
                                              const dialog = useDialog()
  const renderer = useRenderer()

  // Allow exit when in child session (prompt is hidden)
  const exit = useExit()

  createEffect(() => {
    const title = Locale.truncate(session()?.title ?? "", 50)
    const pad = (text: string) => text.padEnd(10, " ")
    const weak = (text: string) => UI.Style.TEXT_DIM + pad(text) + UI.Style.TEXT_NORMAL
    const logo = UI.logo("  ").split(/\r?\n/)
    return exit.message.set(
      [
        `${logo[0] ?? ""}`,
        `${logo[1] ?? ""}`,
        `${logo[2] ?? ""}`,
        `${logo[3] ?? ""}`,
        ``,
        `  ${weak("Session")}${UI.Style.TEXT_NORMAL_BOLD}${title}${UI.Style.TEXT_NORMAL}`,
        `  ${weak("Continue")}${UI.Style.TEXT_NORMAL_BOLD}markscode -s ${session()?.id}${UI.Style.TEXT_NORMAL}`,
        ``,
      ].join("\n"),
    )
  })

  useKeyboard((evt) => {
    if (!session()?.parentID) return
    if (keybind.match("app_exit", evt)) {
      exit()
    }
  })

  // Helper: Find next visible message boundary in direction
  const findNextVisibleMessage = (direction: "next" | "prev"): string | null => {
    const children = scroll.getChildren()
    const messagesList = messages()
    const scrollTop = scroll.y

    // Get visible messages sorted by position, filtering for valid non-synthetic, non-ignored content
    const visibleMessages = children
      .filter((c) => {
        if (!c.id) return false
        const message = messagesList.find((m) => m.id === c.id)
        if (!message) return false

        // Check if message has valid non-synthetic, non-ignored text parts
        const parts = sync.data.part[message.id]
        if (!parts || !Array.isArray(parts)) return false

        return parts.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored)
      })
      .sort((a, b) => a.y - b.y)

    if (visibleMessages.length === 0) return null

    if (direction === "next") {
      // Find first message below current position
      return visibleMessages.find((c) => c.y > scrollTop + 10)?.id ?? null
    }
    // Find last message above current position
    return [...visibleMessages].reverse().find((c) => c.y < scrollTop - 10)?.id ?? null
  }

  // Helper: Scroll to message in direction or fallback to page scroll
  const scrollToMessage = (direction: "next" | "prev", dialog: ReturnType<typeof useDialog>) => {
    const targetID = findNextVisibleMessage(direction)

    if (!targetID) {
      scroll.scrollBy(direction === "next" ? scroll.height : -scroll.height)
      dialog.clear()
      return
    }

    const child = scroll.getChildren().find((c) => c.id === targetID)
    if (child) scroll.scrollBy(child.y - scroll.y - 1)
    dialog.clear()
  }

  function toBottom() {
    setTimeout(() => {
      if (!scroll || scroll.isDestroyed) return
      scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  const local = useLocal()

  function moveFirstChild() {
    if (children().length === 1) return
    const next = children().find((x) => !!x.parentID)
    if (next) {
      navigate({
        type: "session",
        sessionID: next.id,
      })
    }
  }

  function moveChild(direction: number) {
    if (children().length === 1) return

    const sessions = children().filter((x) => !!x.parentID)
    let next = sessions.findIndex((x) => x.id === session()?.id) + direction

    if (next >= sessions.length) next = 0
    if (next < 0) next = sessions.length - 1
    if (sessions[next]) {
      navigate({
        type: "session",
        sessionID: sessions[next].id,
      })
    }
  }

  function childSessionHandler(func: (dialog: DialogContext) => void) {
    return (dialog: DialogContext) => {
      if (!session()?.parentID || dialog.stack.length > 0) return
      func(dialog)
    }
  }

  const command = useCommandDialog()
  const memoriesUserID = process.env.MEMORIES_USER_ID || "marks-local"
  command.register(() => [
    {
      title: session()?.share?.url ? "Copy share link" : "Share session",
      value: "session.share",
      suggested: route.type === "session",
      keybind: "session_share",
      category: "Session",
      enabled: sync.data.config.share !== "disabled",
      slash: {
        name: "share",
      },
      onSelect: async (dialog) => {
        const copy = (url: string) =>
          Clipboard.copy(url)
            .then(() => toast.show({ message: "Share URL copied to clipboard!", variant: "success" }))
            .catch(() => toast.show({ message: "Failed to copy URL to clipboard", variant: "error" }))
        const url = session()?.share?.url
        if (url) {
          await copy(url)
          dialog.clear()
          return
        }
        await sdk.client.session
          .share({
            sessionID: route.sessionID,
          })
          .then((res) => copy(res.data!.share!.url))
          .catch((error) => {
            toast.show({
              message: error instanceof Error ? error.message : "Failed to share session",
              variant: "error",
            })
          })
        dialog.clear()
      },
    },
    {
      title: "Rename session",
      value: "session.rename",
      keybind: "session_rename",
      category: "Session",
      slash: {
        name: "rename",
      },
      onSelect: (dialog) => {
        dialog.replace(() => <DialogSessionRename session={route.sessionID} />)
      },
    },
    {
      title: "Jump to message",
      value: "session.timeline",
      keybind: "session_timeline",
      category: "Session",
      slash: {
        name: "timeline",
      },
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogTimeline
            onMove={(messageID) => {
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
            setPrompt={(promptInfo) => prompt.set(promptInfo)}
          />
        ))
      },
    },
    {
      title: "Fork from message",
      value: "session.fork",
      keybind: "session_fork",
      category: "Session",
      slash: {
        name: "fork",
      },
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogForkFromTimeline
            onMove={(messageID) => {
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
          />
        ))
      },
    },
    {
      title: "Compact session",
      value: "session.compact",
      keybind: "session_compact",
      category: "Session",
      slash: {
        name: "compact",
        aliases: ["summarize"],
      },
      onSelect: (dialog) => {
        const selectedModel = local.model.current()
        if (!selectedModel) {
          toast.show({
            variant: "warning",
            message: "Connect a provider to summarize this session",
            duration: 3000,
          })
          return
        }
        sdk.client.session.summarize({
          sessionID: route.sessionID,
          modelID: selectedModel.modelID,
          providerID: selectedModel.providerID,
        })
        dialog.clear()
      },
    },
    {
      title: "Unshare session",
      value: "session.unshare",
      keybind: "session_unshare",
      category: "Session",
      enabled: !!session()?.share?.url,
      slash: {
        name: "unshare",
      },
      onSelect: async (dialog) => {
        await sdk.client.session
          .unshare({
            sessionID: route.sessionID,
          })
          .then(() => toast.show({ message: "Session unshared successfully", variant: "success" }))
          .catch((error) => {
            toast.show({
              message: error instanceof Error ? error.message : "Failed to unshare session",
              variant: "error",
            })
          })
        dialog.clear()
      },
    },
    {
      title: "Undo previous message",
      value: "session.undo",
      keybind: "messages_undo",
      category: "Session",
      slash: {
        name: "undo",
      },
      onSelect: async (dialog) => {
        const status = sync.data.session_status?.[route.sessionID]
        if (status?.type !== "idle") await sdk.client.session.abort({ sessionID: route.sessionID }).catch(() => {})
        const revert = session()?.revert?.messageID
        const message = messages().findLast((x) => (!revert || x.id < revert) && x.role === "user")
        if (!message) return
        sdk.client.session
          .revert({
            sessionID: route.sessionID,
            messageID: message.id,
          })
          .then(() => {
            toBottom()
          })
        const parts = sync.data.part[message.id]
        prompt.set(
          parts.reduce(
            (agg, part) => {
              if (part.type === "text") {
                if (!part.synthetic) agg.input += part.text
              }
              if (part.type === "file") agg.parts.push(part)
              return agg
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          ),
        )
        dialog.clear()
      },
    },
    {
      title: "Redo",
      value: "session.redo",
      keybind: "messages_redo",
      category: "Session",
      enabled: !!session()?.revert?.messageID,
      slash: {
        name: "redo",
      },
      onSelect: (dialog) => {
        dialog.clear()
        const messageID = session()?.revert?.messageID
        if (!messageID) return
        const message = messages().find((x) => x.role === "user" && x.id > messageID)
        if (!message) {
          sdk.client.session.unrevert({
            sessionID: route.sessionID,
          })
          prompt.set({ input: "", parts: [] })
          return
        }
        sdk.client.session.revert({
          sessionID: route.sessionID,
          messageID: message.id,
        })
      },
    },
    {
      title: sidebarVisible() ? "Hide MarksCode sidebar" : "Show MarksCode sidebar",
      value: "session.sidebar.toggle",
      keybind: "sidebar_toggle",
      category: "Session",
      onSelect: (dialog) => {
        batch(() => {
          const isVisible = sidebarVisible()
          setSidebar(() => (isVisible ? "hide" : "auto"))
          setSidebarOpen(!isVisible)
        })
        dialog.clear()
      },
    },
    {
      title: conceal() ? "Disable code concealment" : "Enable code concealment",
      value: "session.toggle.conceal",
      keybind: "messages_toggle_conceal" as any,
      category: "Session",
      onSelect: (dialog) => {
        setConceal((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: showTimestamps() ? "Hide timestamps" : "Show timestamps",
      value: "session.toggle.timestamps",
      category: "Session",
      slash: {
        name: "timestamps",
        aliases: ["toggle-timestamps"],
      },
      onSelect: (dialog) => {
        setTimestamps((prev) => (prev === "show" ? "hide" : "show"))
        dialog.clear()
      },
    },
    {
      title: showThinking() ? "Hide thinking" : "Show thinking",
      value: "session.toggle.thinking",
      keybind: "display_thinking",
      category: "Session",
      slash: {
        name: "thinking",
        aliases: ["toggle-thinking"],
      },
      onSelect: (dialog) => {
        setShowThinking((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: showDetails() ? "Hide tool details" : "Show tool details",
      value: "session.toggle.actions",
      keybind: "tool_details",
      category: "Session",
      onSelect: (dialog) => {
        setShowDetails((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "Toggle session scrollbar",
      value: "session.toggle.scrollbar",
      keybind: "scrollbar_toggle",
      category: "Session",
      onSelect: (dialog) => {
        setShowScrollbar((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: showHeader() ? "Hide header" : "Show header",
      value: "session.toggle.header",
      category: "Session",
      onSelect: (dialog) => {
        setShowHeader((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: showGenericToolOutput() ? "Hide generic tool output" : "Show generic tool output",
      value: "session.toggle.generic_tool_output",
      category: "Session",
      onSelect: (dialog) => {
        setShowGenericToolOutput((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "Page up",
      value: "session.page.up",
      keybind: "messages_page_up",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Page down",
      value: "session.page.down",
      keybind: "messages_page_down",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollBy(scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Line up",
      value: "session.line.up",
      keybind: "messages_line_up",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-1)
        dialog.clear()
      },
    },
    {
      title: "Line down",
      value: "session.line.down",
      keybind: "messages_line_down",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(1)
        dialog.clear()
      },
    },
    {
      title: "Half page up",
      value: "session.half.page.up",
      keybind: "messages_half_page_up",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "Half page down",
      value: "session.half.page.down",
      keybind: "messages_half_page_down",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollBy(scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "First message",
      value: "session.first",
      keybind: "messages_first",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollTo(0)
        dialog.clear()
      },
    },
    {
      title: "Last message",
      value: "session.last",
      keybind: "messages_last",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollTo(scroll.scrollHeight)
        dialog.clear()
      },
    },
    {
      title: "Jump to last user message",
      value: "session.messages_last_user",
      keybind: "messages_last_user",
      category: "Session",
      hidden: true,
      onSelect: () => {
        const messages = sync.data.message[route.sessionID]
        if (!messages || !messages.length) return

        // Find the most recent user message with non-ignored, non-synthetic text parts
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i]
          if (!message || message.role !== "user") continue

          const parts = sync.data.part[message.id]
          if (!parts || !Array.isArray(parts)) continue

          const hasValidTextPart = parts.some(
            (part) => part && part.type === "text" && !part.synthetic && !part.ignored,
          )

          if (hasValidTextPart) {
            const child = scroll.getChildren().find((child) => {
              return child.id === message.id
            })
            if (child) scroll.scrollBy(child.y - scroll.y - 1)
            break
          }
        }
      },
    },
    {
      title: "Next message",
      value: "session.message.next",
      keybind: "messages_next",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => scrollToMessage("next", dialog),
    },
    {
      title: "Previous message",
      value: "session.message.previous",
      keybind: "messages_previous",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => scrollToMessage("prev", dialog),
    },
    {
      title: "Copy last assistant message",
      value: "messages.copy",
      keybind: "messages_copy",
      category: "Session",
      onSelect: (dialog) => {
        const revertID = session()?.revert?.messageID
        const lastAssistantMessage = messages().findLast(
          (msg) => msg.role === "assistant" && (!revertID || msg.id < revertID),
        )
        if (!lastAssistantMessage) {
          toast.show({ message: "No assistant messages found", variant: "error" })
          dialog.clear()
          return
        }

        const parts = sync.data.part[lastAssistantMessage.id] ?? []
        const textParts = parts.filter((part) => part.type === "text")
        if (textParts.length === 0) {
          toast.show({ message: "No text parts found in last assistant message", variant: "error" })
          dialog.clear()
          return
        }

        const text = textParts
          .map((part) => part.text)
          .join("\n")
          .trim()
        if (!text) {
          toast.show({
            message: "No text content found in last assistant message",
            variant: "error",
          })
          dialog.clear()
          return
        }

        Clipboard.copy(text)
          .then(() => toast.show({ message: "Message copied to clipboard!", variant: "success" }))
          .catch(() => toast.show({ message: "Failed to copy to clipboard", variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: "Copy session transcript",
      value: "session.copy",
      category: "Session",
      slash: {
        name: "copy",
      },
      onSelect: async (dialog) => {
        try {
          const sessionData = session()
          if (!sessionData) return
          const sessionMessages = messages()
          const transcript = formatTranscript(
            sessionData,
            sessionMessages.map((msg) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
            {
              thinking: showThinking(),
              toolDetails: showDetails(),
              assistantMetadata: showAssistantMetadata(),
            },
          )
          await Clipboard.copy(transcript)
          toast.show({ message: "Session transcript copied to clipboard!", variant: "success" })
        } catch (error) {
          toast.show({ message: "Failed to copy session transcript", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Export session transcript",
      value: "session.export",
      keybind: "session_export",
      category: "Session",
      slash: {
        name: "export",
      },
      onSelect: async (dialog) => {
        try {
          const sessionData = session()
          if (!sessionData) return
          const sessionMessages = messages()

          const defaultFilename = `session-${sessionData.id.slice(0, 8)}.md`

          const options = await DialogExportOptions.show(
            dialog,
            defaultFilename,
            showThinking(),
            showDetails(),
            showAssistantMetadata(),
            false,
          )

          if (options === null) return

          const transcript = formatTranscript(
            sessionData,
            sessionMessages.map((msg) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
            {
              thinking: options.thinking,
              toolDetails: options.toolDetails,
              assistantMetadata: options.assistantMetadata,
            },
          )

          if (options.openWithoutSaving) {
            // Just open in editor without saving
            await Editor.open({ value: transcript, renderer })
          } else {
            const exportDir = process.cwd()
            const filename = options.filename.trim()
            const filepath = path.join(exportDir, filename)

            await Bun.write(filepath, transcript)

            // Open with EDITOR if available
            const result = await Editor.open({ value: transcript, renderer })
            if (result !== undefined) {
              await Bun.write(filepath, result)
            }

            toast.show({ message: `Session exported to ${filename}`, variant: "success" })
          }
        } catch (error) {
          toast.show({ message: "Failed to export session", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Go to child session",
      value: "session.child.first",
      keybind: "session_child_first",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        moveFirstChild()
        dialog.clear()
      },
    },
    {
      title: "Go to parent session",
      value: "session.parent",
      keybind: "session_parent",
      category: "Session",
      hidden: true,
      enabled: !!session()?.parentID,
      onSelect: childSessionHandler((dialog) => {
        const parentID = session()?.parentID
        if (parentID) {
          navigate({
            type: "session",
            sessionID: parentID,
          })
        }
        dialog.clear()
      }),
    },
    {
      title: "Next child session",
      value: "session.child.next",
      keybind: "session_child_cycle",
      category: "Session",
      hidden: true,
      enabled: !!session()?.parentID,
      onSelect: childSessionHandler((dialog) => {
        moveChild(1)
        dialog.clear()
      }),
    },
    {
      title: "Previous child session",
      value: "session.child.previous",
      keybind: "session_child_cycle_reverse",
      category: "Session",
      hidden: true,
      enabled: !!session()?.parentID,
      onSelect: childSessionHandler((dialog) => {
        moveChild(-1)
        dialog.clear()
      }),
    },
    
    
        
                    
                
        
            
        
        
        // MARKSCODE_REMOTE_SSH_COMMANDS_START
    {
      title: "Modo remoto (conectar sessão SSH)",
      value: "markscode.remote-ssh.connect",
      category: "MarksCode",
      slash: { name: "remote-ssh-connect" },
      onSelect: async (dialog) => {
        try {
          const prev = readRemoteSSHConfig()
          const aliasRaw = (await remotePrompt(dialog, "Modo remoto SSH: alias (~/.ssh/config, opcional)", {
            placeholder: prev?.host_alias || "ex: servidor-prod",
            value: prev?.host_alias || "",
          }))?.trim()
          const aliasPath = looksPath(aliasRaw)
          const alias = aliasPath ? "" : (aliasRaw || "")
          const aliasIdentity = aliasPath ? aliasRaw || "" : ""
          if (aliasPath) {
            toast.show({ message: "Alias parece caminho de chave; usando como identity_file", variant: "warning" })
          }

          const host = (await remotePrompt(dialog, "Modo remoto SSH: host/ip", {
            placeholder: prev?.host || "ex: 192.168.0.10",
            value: prev?.host || "",
          }))?.trim() || ""
          if (!host) {
            toast.show({ message: "Host/IP não informado", variant: "warning" })
            dialog.clear()
            return
          }

          const user = (await remotePrompt(dialog, "Modo remoto SSH: usuário", {
            placeholder: prev?.user || "ex: root",
            value: prev?.user || "",
          }))?.trim() || ""
          if (!user) {
            toast.show({ message: "Usuário SSH não informado", variant: "warning" })
            dialog.clear()
            return
          }

          const portRaw =
            (await remotePrompt(dialog, "Modo remoto SSH: porta", {
              placeholder: "22",
              value: String(prev?.port ?? 22),
            })) || "22"

          const identityFile = (await remotePrompt(dialog, "Modo remoto SSH: chave privada (opcional)", {
            placeholder: prev?.identity_file || "ex: ~/.ssh/id_ed25519",
            value: prev?.identity_file || "",
          }))?.trim()

          const keyName = (await remotePrompt(dialog, "Modo remoto SSH: nome da chave (opcional)", {
            placeholder: prev?.key_name || "ex: marks_bluepex_admin",
            value: prev?.key_name || "",
          }))?.trim()

          const key = normalizeKeyName(keyName) || prev?.key_name || undefined

          const passRaw = await remotePrompt(dialog, "Modo remoto SSH: senha (opcional)", {
            placeholder: "deixe vazio para usar somente chave",
            value: "",
          })

          const cfg = {
            host,
            user,
            port: normalizeRemotePort(portRaw),
            password: (passRaw || "").trim() || undefined,
            host_alias: alias || undefined,
            key_name: key,
            identity_file: identityFile || aliasIdentity || identityFromKeyName(key) || prev?.identity_file || findIdentityFile() || undefined,
          } satisfies RemoteSSHConfig

          const deps = sshDeps()
          if (cfg.password && !deps.sshpass) {
            toast.show({ message: REMOTE_SSH_SSHPASS_MISSING_MESSAGE, variant: "warning" })
          }

          const current = readRemoteSSHProfiles().find((x) => x.id === sessionRemoteSSHProfileID())
          const profileName = (await remotePrompt(dialog, "Modo remoto SSH: nome do perfil para este chat (opcional)", {
            placeholder: current?.name || cfg.user + "@" + cfg.host,
            value: current?.name || "",
          }))?.trim() || ""
          const same = Boolean(
            current && current.host === cfg.host && current.user === cfg.user && Number(current.port) === Number(cfg.port),
          )
          const profileLabel = profileName || (same ? current?.name || "" : "") || (cfg.user + "@" + cfg.host)

          applyRemoteSSHConfig(cfg)
          const profile = createRemoteSSHProfile(cfg, profileLabel)
          bindRemoteSSHProfileToSession(profile.id)
          injectRemoteSSHPrompt("Modo remoto SSH ativo", cfg)
          toast.show({ message: "Modo remoto SSH ativado", variant: "success" })
          dialog.clear()
        } catch (err) {
          const message = err instanceof Error ? err.message : "Falha ao abrir conexão SSH"
          toast.show({ message, variant: "error" })
          dialog.clear()
        }
      },
    },
    {
      title: "Modo remoto (conectar sessão Windows)",
      value: "markscode.remote-ssh.connect-winrm",
      category: "MarksCode",
      slash: { name: "remote-win-connect" },
      onSelect: async (dialog) => {
        try {
          const prev = readRemoteSSHConfig()
          const host = (await remotePrompt(dialog, "Modo remoto Windows: host/ip", {
            placeholder: prev?.host || "ex: 10.0.0.25",
            value: prev?.host || "",
          }))?.trim() || ""
          if (!host) {
            toast.show({ message: "Host/IP não informado", variant: "warning" })
            dialog.clear()
            return
          }

          const user = (await remotePrompt(dialog, "Modo remoto Windows: usuário", {
            placeholder: prev?.user || "ex: Administrator",
            value: prev?.user || "",
          }))?.trim() || ""
          if (!user) {
            toast.show({ message: "Usuário WinRM não informado", variant: "warning" })
            dialog.clear()
            return
          }

          const portRaw =
            (await remotePrompt(dialog, "Modo remoto Windows: porta", {
              placeholder: "5986",
              value: String(prev?.port ?? 5986),
            })) || "5986"

          const trRaw = (await remotePrompt(dialog, "Modo remoto Windows: transporte (https|http)", {
            placeholder: prev?.transport || "https",
            value: prev?.transport || "https",
          }))?.trim().toLowerCase() || "https"

          const passRaw = await remotePrompt(dialog, "Modo remoto Windows: senha", {
            placeholder: "senha do usuário remoto",
            value: "",
          })

          const cfg = {
            type: "winrm",
            host,
            user,
            port: normalizeRemotePort(portRaw),
            transport: trRaw === "http" ? "http" : "https",
            password: (passRaw || "").trim() || undefined,
          } satisfies RemoteSSHConfig

          const profileName = (await remotePrompt(dialog, "Modo remoto Windows: nome do perfil (opcional)", {
            placeholder: "windows-" + host,
            value: "",
          }))?.trim() || ""

          applyRemoteSSHConfig(cfg)
          const profile = createRemoteSSHProfile(cfg, profileName || ("windows-" + host))
          bindRemoteSSHProfileToSession(profile.id)
          injectRemoteSSHPrompt("Modo remoto SSH ativo (Windows)", cfg, ["- Perfil: " + profile.name])
          toast.show({ message: "Modo remoto Windows ativado", variant: "success" })
          dialog.clear()
        } catch (err) {
          const message = err instanceof Error ? err.message : "Falha ao abrir conexão WinRM"
          toast.show({ message, variant: "error" })
          dialog.clear()
        }
      },
    },
    {
      title: "Modo remoto (rotear por alias no texto)",
      value: "markscode.remote-ssh.route",
      category: "MarksCode",
      slash: { name: "remote-ssh-route" },
      onSelect: async (dialog) => {
        const text = (await remotePrompt(dialog, "Roteamento remoto: texto da tarefa (contendo alias)", {
          placeholder: "ex: instalar no windows-teste e validar",
          value: "",
        }))?.trim() || ""
        if (!text) {
          toast.show({ message: "Texto não informado", variant: "warning" })
          dialog.clear()
          return
        }
        const hits = routeRemoteSSHProfileByText(text)
        if (!hits.length) {
          toast.show({ message: "Nenhum alias remoto encontrado no texto", variant: "warning" })
          dialog.clear()
          return
        }
        if (hits.length > 1) {
          const names = hits.slice(0, 8).map((x) => x.name).join(", ")
          toast.show({ message: "Múltiplos aliases detectados: " + names, variant: "warning" })
          dialog.clear()
          return
        }
        const profile = hits[0]
        const cfg = {
          type: profile.type || "ssh",
          host: profile.host,
          user: profile.user,
          port: profile.port,
          transport: profile.transport || "https",
          password: profile.password,
          identity_file: profile.identity_file,
          key_name: profile.key_name,
          host_alias: profile.host_alias,
        } satisfies RemoteSSHConfig
        applyRemoteSSHConfig(cfg)
        bindRemoteSSHProfileToSession(profile.id)
        injectRemoteSSHPrompt("Modo remoto SSH ativo (roteado por alias)", cfg, ["- Perfil: " + profile.name, "- Texto: " + text])
        toast.show({ message: "Roteamento remoto aplicado: " + profile.name, variant: "success" })
        dialog.clear()
      },
    },
    {
      title: "Modo remoto (gerenciar perfis)",
      value: "markscode.remote-ssh.profile.manage",
      category: "MarksCode",
      slash: { name: "remote-ssh-profiles" },
      onSelect: async (dialog) => {
        const action = ((await remotePrompt(dialog, "Perfis remotos: ação (list|use|save|edit|delete|import)", {
          placeholder: "list",
          value: "",
        })) || "").trim().toLowerCase()
        if (!action) {
          dialog.clear()
          return
        }
        if (action === "list") {
          await showRemoteSSHProfilesDialog(dialog)
          return
        }
        if (action === "save") {
          const cfg = readRemoteSSHConfig()
          if (!cfg) {
            toast.show({ message: "Configuração SSH não encontrada", variant: "warning" })
            dialog.clear()
            return
          }
          const current = readRemoteSSHProfiles().find((x) => x.id === sessionRemoteSSHProfileID())
          const name = (await remotePrompt(dialog, "Salvar perfil remoto: nome", {
            placeholder: current?.name || cfg.user + "@" + cfg.host,
            value: current?.name || "",
          }))?.trim()
          if (!name) {
            toast.show({ message: "Nome do perfil não informado", variant: "warning" })
            dialog.clear()
            return
          }
          const profile = createRemoteSSHProfile(cfg, name)
          bindRemoteSSHProfileToSession(profile.id)
          toast.show({ message: "Perfil remoto salvo para este chat", variant: "success" })
          dialog.clear()
          return
        }
        if (action === "use") {
          const profile = await pickRemoteSSHProfile(dialog, "Usar perfil remoto")
          if (!profile) {
            toast.show({ message: "Perfil remoto não encontrado", variant: "warning" })
            dialog.clear()
            return
          }
          const cfg = {
            type: profile.type || "ssh",
            host: profile.host,
            user: profile.user,
            port: profile.port,
            transport: profile.transport || "https",
            password: profile.password,
            identity_file: profile.identity_file,
            key_name: profile.key_name,
            host_alias: profile.host_alias,
          } satisfies RemoteSSHConfig
          applyRemoteSSHConfig(cfg)
          bindRemoteSSHProfileToSession(profile.id)
          injectRemoteSSHPrompt("Modo remoto SSH ativo (perfil)", cfg, ["- Perfil: " + profile.name])
          toast.show({ message: "Perfil remoto aplicado neste chat", variant: "success" })
          dialog.clear()
          return
        }
        if (action === "import") {
          const map = readRemoteSSHProfileSessionMap()
          const from = Object.entries(map).filter(([sid, pid]) => sid !== route.sessionID && Boolean(pid))
          if (!from.length) {
            toast.show({ message: "Nenhum chat com perfil remoto para importar", variant: "warning" })
            dialog.clear()
            return
          }
          const sid = (await remotePrompt(dialog, "Importar perfil: session id de origem", {
            placeholder: from[0]?.[0] || "",
            value: "",
          }))?.trim() || ""
          const profileID = map[sid]
          const profile = profileID ? readRemoteSSHProfiles().find((x) => x.id === profileID) : undefined
          if (!profile) {
            toast.show({ message: "Perfil remoto da origem não encontrado", variant: "warning" })
            dialog.clear()
            return
          }
          const cfg = {
            type: profile.type || "ssh",
            host: profile.host,
            user: profile.user,
            port: profile.port,
            transport: profile.transport || "https",
            password: profile.password,
            identity_file: profile.identity_file,
            key_name: profile.key_name,
            host_alias: profile.host_alias,
          } satisfies RemoteSSHConfig
          applyRemoteSSHConfig(cfg)
          bindRemoteSSHProfileToSession(profile.id)
          injectRemoteSSHPrompt("Modo remoto SSH ativo (importado)", cfg, ["- Perfil: " + profile.name, "- Origem: " + sid])
          toast.show({ message: "Perfil remoto importado para este chat", variant: "success" })
          dialog.clear()
          return
        }
        if (action === "delete") {
          const profile = await pickRemoteSSHProfile(dialog, "Excluir perfil remoto")
          if (!profile) {
            toast.show({ message: "Perfil remoto não encontrado", variant: "warning" })
            dialog.clear()
            return
          }
          deleteRemoteSSHProfile(profile.id)
          toast.show({ message: "Perfil remoto excluído", variant: "success" })
          dialog.clear()
          return
        }
        if (action === "edit") {
          const profile = await pickRemoteSSHProfile(dialog, "Editar perfil remoto")
          if (!profile) {
            toast.show({ message: "Perfil remoto não encontrado", variant: "warning" })
            dialog.clear()
            return
          }
          const name = (await remotePrompt(dialog, "Perfil remoto: nome", { placeholder: profile.name, value: profile.name }))?.trim() || profile.name
          const host = (await remotePrompt(dialog, "Perfil remoto: host/ip", { placeholder: profile.host, value: profile.host }))?.trim() || profile.host
          const user = (await remotePrompt(dialog, "Perfil remoto: usuário", { placeholder: profile.user, value: profile.user }))?.trim() || profile.user
          const portRaw = (await remotePrompt(dialog, "Perfil remoto: porta", { placeholder: String(profile.port), value: String(profile.port) })) || String(profile.port)
          const aliasRaw = (await remotePrompt(dialog, "Perfil remoto: alias ssh config (opcional)", {
            placeholder: profile.host_alias || "",
            value: profile.host_alias || "",
          }))?.trim() || ""
          const keyRaw = (await remotePrompt(dialog, "Perfil remoto: nome da chave (opcional)", {
            placeholder: profile.key_name || "",
            value: profile.key_name || "",
          }))?.trim() || ""
          const idRaw = (await remotePrompt(dialog, "Perfil remoto: identity_file (opcional)", {
            placeholder: profile.identity_file || "",
            value: profile.identity_file || "",
          }))?.trim() || ""
          const passRaw = await remotePrompt(dialog, "Perfil remoto: senha (opcional, vazio remove)", {
            placeholder: "deixe vazio para remover",
            value: "",
          })
          const key = normalizeKeyName(keyRaw) || undefined
          const cfg = {
            type: profile.type || "ssh",
            host,
            user,
            port: normalizeRemotePort(portRaw),
            transport: profile.transport || "https",
            password: (passRaw || "").trim() || undefined,
            host_alias: looksPath(aliasRaw) ? undefined : (aliasRaw || undefined),
            key_name: key,
            identity_file: idRaw || identityFromKeyName(key) || profile.identity_file || undefined,
          } satisfies RemoteSSHConfig
          const next = createRemoteSSHProfile(cfg, name, profile.id)
          bindRemoteSSHProfileToSession(next.id)
          applyRemoteSSHConfig(cfg)
          toast.show({ message: "Perfil remoto atualizado", variant: "success" })
          dialog.clear()
          return
        }
        toast.show({ message: "Ação inválida. Use: list|use|save|edit|delete|import", variant: "warning" })
        dialog.clear()
      },
    },
    {
      title: "Modo remoto (salvar perfil do chat)",
      value: "markscode.remote-ssh.profile.save",
      category: "MarksCode",
      hidden: true,
      slash: { name: "remote-ssh-profile-save" },
      onSelect: async (dialog) => {
        const cfg = readRemoteSSHConfig()
        if (!cfg) {
          toast.show({ message: "Configuração SSH não encontrada", variant: "warning" })
          dialog.clear()
          return
        }
        const current = readRemoteSSHProfiles().find((x) => x.id === sessionRemoteSSHProfileID())
        const name = (await remotePrompt(dialog, "Salvar perfil remoto: nome", {
          placeholder: current?.name || cfg.user + "@" + cfg.host,
          value: current?.name || "",
        }))?.trim()
        if (!name) {
          toast.show({ message: "Nome do perfil não informado", variant: "warning" })
          dialog.clear()
          return
        }
        const profile = createRemoteSSHProfile(cfg, name)
        bindRemoteSSHProfileToSession(profile.id)
        toast.show({ message: "Perfil remoto salvo para este chat", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: "Modo remoto (listar perfis)",
      value: "markscode.remote-ssh.profile.list",
      category: "MarksCode",
      hidden: true,
      slash: { name: "remote-ssh-profile-list" },
      onSelect: async (dialog) => {
        await showRemoteSSHProfilesDialog(dialog)
      },
    },
    {
      title: "Modo remoto (usar perfil salvo)",
      value: "markscode.remote-ssh.profile.use",
      category: "MarksCode",
      hidden: true,
      slash: { name: "remote-ssh-profile-use" },
      onSelect: async (dialog) => {
        const list = readRemoteSSHProfiles()
        if (!list.length) {
          toast.show({ message: "Nenhum perfil remoto salvo", variant: "warning" })
          dialog.clear()
          return
        }
        const pick = (await remotePrompt(dialog, "Usar perfil remoto (nome ou id)", {
          placeholder: list[0]?.name || "",
          value: "",
        }))?.trim() || ""
        if (!pick) {
          toast.show({ message: "Perfil não informado", variant: "warning" })
          dialog.clear()
          return
        }
        const profile = list.find((x) => x.id === pick) || list.find((x) => x.name.toLowerCase() === pick.toLowerCase())
        if (!profile) {
          toast.show({ message: "Perfil remoto não encontrado", variant: "warning" })
          dialog.clear()
          return
        }
        const cfg = {
          type: profile.type || "ssh",
          host: profile.host,
          user: profile.user,
          port: profile.port,
          transport: profile.transport || "https",
          password: profile.password,
          identity_file: profile.identity_file,
          key_name: profile.key_name,
          host_alias: profile.host_alias,
        } satisfies RemoteSSHConfig
        applyRemoteSSHConfig(cfg)
        bindRemoteSSHProfileToSession(profile.id)
        injectRemoteSSHPrompt("Modo remoto SSH ativo (perfil)", cfg, ["- Perfil: " + profile.name])
        toast.show({ message: "Perfil remoto aplicado neste chat", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: "Modo remoto (importar perfil de outro chat)",
      value: "markscode.remote-ssh.profile.import",
      category: "MarksCode",
      hidden: true,
      slash: { name: "remote-ssh-profile-import" },
      onSelect: async (dialog) => {
        const map = readRemoteSSHProfileSessionMap()
        const from = Object.entries(map).filter(([sid, pid]) => sid !== route.sessionID && Boolean(pid))
        if (!from.length) {
          toast.show({ message: "Nenhum chat com perfil remoto para importar", variant: "warning" })
          dialog.clear()
          return
        }
        const sid = (await remotePrompt(dialog, "Importar perfil: session id de origem", {
          placeholder: from[0]?.[0] || "",
          value: "",
        }))?.trim() || ""
        if (!sid) {
          toast.show({ message: "Session id não informado", variant: "warning" })
          dialog.clear()
          return
        }
        const profileID = map[sid]
        if (!profileID) {
          toast.show({ message: "Chat informado não possui perfil remoto", variant: "warning" })
          dialog.clear()
          return
        }
        const profile = readRemoteSSHProfiles().find((x) => x.id === profileID)
        if (!profile) {
          toast.show({ message: "Perfil remoto da origem não encontrado", variant: "warning" })
          dialog.clear()
          return
        }
        const cfg = {
          type: profile.type || "ssh",
          host: profile.host,
          user: profile.user,
          port: profile.port,
          transport: profile.transport || "https",
          password: profile.password,
          identity_file: profile.identity_file,
          key_name: profile.key_name,
          host_alias: profile.host_alias,
        } satisfies RemoteSSHConfig
        applyRemoteSSHConfig(cfg)
        bindRemoteSSHProfileToSession(profile.id)
        injectRemoteSSHPrompt("Modo remoto SSH ativo (importado)", cfg, ["- Perfil: " + profile.name, "- Origem: " + sid])
        toast.show({ message: "Perfil remoto importado para este chat", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: "Modo remoto (pré-check SSH)",
      value: "markscode.remote-ssh.precheck",
      category: "MarksCode",
      slash: { name: "remote-ssh-precheck" },
      onSelect: (dialog) => {
        const active = Boolean(kv.get("remote_ssh_mode", false))
        const cfg = readRemoteSSHConfig()
        if (!active || !cfg) {
          toast.show({ message: "Modo remoto SSH não está ativo", variant: "warning" })
          dialog.clear()
          return
        }
        const auth = ensureRemoteSSHAuth(cfg)
        if (!auth.ok) {
          const hint = String(kv.get("remote_ssh_auth_hint", "") || "") || REMOTE_SSH_SSHPASS_MISSING_MESSAGE
          toast.show({ message: hint, variant: "warning" })
        }
        const probe = (auth.cfg.type || "ssh") === "winrm" ? "hostname" : "echo marks-ssh-ok"
        const result = runRemoteExec(auth.cfg, probe)
        injectRemoteExecResult("Modo remoto SSH (pré-check)", result)
        updateRemoteExecState("pre-check", result)
        toast.show({ message: result.ok ? "Pré-check SSH OK" : "Pré-check SSH falhou", variant: result.ok ? "success" : "error" })
        dialog.clear()
      },
    },
    {
      title: "Modo remoto (executar comando SSH)",
      value: "markscode.remote-ssh.exec",
      category: "MarksCode",
      slash: { name: "remote-ssh-exec" },
      onSelect: async (dialog) => {
        const active = Boolean(kv.get("remote_ssh_mode", false))
        const cfg = readRemoteSSHConfig()
        if (!active || !cfg) {
          toast.show({ message: "Modo remoto SSH não está ativo", variant: "warning" })
          dialog.clear()
          return
        }
        const cmd = (await remotePrompt(dialog, "Modo remoto SSH: comando", {
          placeholder: "ex: uname -a",
          value: "",
        }))?.trim()
        if (!cmd) {
          toast.show({ message: "Comando remoto vazio", variant: "warning" })
          dialog.clear()
          return
        }
        const auth = ensureRemoteSSHAuth(cfg)
        if (!auth.ok) {
          const hint = String(kv.get("remote_ssh_auth_hint", "") || "") || REMOTE_SSH_SSHPASS_MISSING_MESSAGE
          toast.show({ message: hint, variant: "warning" })
        }
        const result = runRemoteExec(auth.cfg, cmd)
        injectRemoteExecResult("Modo remoto SSH (exec)", result)
        updateRemoteExecState("exec", result)
        toast.show({ message: result.ok ? "Comando remoto executado" : "Falha na execução remota", variant: result.ok ? "success" : "error" })
        dialog.clear()
      },
    },
    {
      title: "Modo remoto (diagnóstico SSH)",
      value: "markscode.remote-ssh.diagnose",
      category: "MarksCode",
      slash: { name: "remote-ssh-diagnose" },
      onSelect: (dialog) => {
        const active = Boolean(kv.get("remote_ssh_mode", false))
        const cfg = readRemoteSSHConfig()
        if (!active || !cfg) {
          toast.show({ message: "Modo remoto SSH não está ativo", variant: "warning" })
          dialog.clear()
          return
        }
        const auth = ensureRemoteSSHAuth(cfg)
        const deps = auth.deps
        const mode = remoteAuthMode(auth.cfg)
        const checks = (auth.cfg.type || "ssh") === "winrm"
          ? ["hostname", "Get-ComputerInfo | Select-Object -First 1"]
          : ["echo marks-ssh-ok", "uname -a"]
        const results = checks.map((x) => {
          const r = runRemoteExec(auth.cfg, x)
          return "- " + x + ": " + (r.ok ? "ok" : "erro(" + String(r.code) + ")")
        })
        injectRemoteSSHPrompt("Modo remoto SSH (diagnóstico)", auth.cfg, [
          "- Auth mode: " + mode,
          "- Local ssh: " + (deps.ssh ? "ok" : "missing"),
          "- Local sshpass: " + (deps.sshpass ? "ok" : "missing"),
          ...results,
          ...(cfg.password && !deps.sshpass ? ["- Ação recomendada: " + REMOTE_SSH_SSHPASS_MISSING_MESSAGE] : []),
        ])
        toast.show({ message: "Diagnóstico SSH inserido no prompt", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: "Modo remoto (status SSH)",
      value: "markscode.remote-ssh.status",
      category: "MarksCode",
      slash: { name: "remote-ssh-status" },
      onSelect: (dialog) => {
        const active = Boolean(kv.get("remote_ssh_mode", false))
        const cfg = readRemoteSSHConfig()
        if (!active || !cfg) {
          toast.show({ message: "Modo remoto SSH não está ativo", variant: "warning" })
          dialog.clear()
          return
        }
        const auth = ensureRemoteSSHAuth(cfg)
        const deps = auth.deps
        const mode = remoteAuthMode(auth.cfg)
        injectRemoteSSHPrompt("Modo remoto SSH (status)", auth.cfg, [
          "- Auth mode: " + mode,
          "- Local ssh: " + (deps.ssh ? "ok" : "missing"),
          "- Local sshpass: " + (deps.sshpass ? "ok" : "missing"),
          ...(cfg.password && !deps.sshpass ? ["- Ação recomendada: " + REMOTE_SSH_SSHPASS_MISSING_MESSAGE] : []),
        ])
        toast.show({ message: "Resumo SSH inserido no prompt", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: "Modo remoto (limpar senha SSH)",
      value: "markscode.remote-ssh.clear-password",
      category: "MarksCode",
      slash: { name: "remote-ssh-clear-password" },
      onSelect: (dialog) => {
        const cfg = readRemoteSSHConfig()
        if (!cfg) {
          toast.show({ message: "Configuração SSH não encontrada", variant: "warning" })
          dialog.clear()
          return
        }
        const next = {
          type: cfg.type || "ssh",
          host: cfg.host,
          user: cfg.user,
          port: cfg.port,
          transport: cfg.transport || "https",
          host_alias: cfg.host_alias,
          identity_file: cfg.identity_file,
          key_name: cfg.key_name,
        } satisfies RemoteSSHConfig
        kv.set("remote_ssh_config", next)
        const profileID = sessionRemoteSSHProfileID()
        if (profileID) {
          const profile = readRemoteSSHProfiles().find((x) => x.id === profileID)
          if (profile) createRemoteSSHProfile(next, profile.name, profile.id)
        }
        toast.show({ message: "Senha SSH removida da sessão", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: "Modo remoto (AgentShell snapshot)",
      value: "markscode.remote-ssh.agent.snapshot",
      category: "MarksCode",
      slash: { name: "remote-ssh-agent-snapshot" },
      onSelect: (dialog) => {
        const active = Boolean(kv.get("remote_ssh_mode", false))
        const cfg = readRemoteSSHConfig()
        if (!active || !cfg) {
          toast.show({ message: "Modo remoto SSH não está ativo", variant: "warning" })
          dialog.clear()
          return
        }
        const auth = ensureRemoteSSHAuth(cfg)
        if ((auth.cfg.type || "ssh") === "winrm") {
          toast.show({ message: "AgentShell snapshot disponível apenas para alvo SSH", variant: "warning" })
          dialog.clear()
          return
        }
        if (!auth.ok) {
          const hint = String(kv.get("remote_ssh_auth_hint", "") || "") || REMOTE_SSH_SSHPASS_MISSING_MESSAGE
          toast.show({ message: hint, variant: "warning" })
        }
        const result = runRemoteAgentSnapshot(auth.cfg)
        injectRemoteExecResult("Modo remoto AgentShell (snapshot)", result)
        updateRemoteExecState("agentshell-snapshot", result)
        if (result.ok) kv.set("remote_ssh_snapshot_at", new Date().toISOString())
        toast.show({ message: result.ok ? "AgentShell snapshot coletado" : "AgentShell snapshot falhou", variant: result.ok ? "success" : "error" })
        dialog.clear()
      },
    },
    {
      title: "Modo remoto (desativar SSH)",
      value: "markscode.remote-ssh.disable",
      category: "MarksCode",
      slash: { name: "remote-ssh-disable" },
      onSelect: (dialog) => {
        const cfg = readRemoteSSHConfig()
        kv.set("remote_ssh_mode", false)
        if (cfg) {
          kv.set("remote_ssh_config", {
            type: cfg.type || "ssh",
            host: cfg.host,
            user: cfg.user,
            port: cfg.port,
            transport: cfg.transport || "https",
          })
        }
        kv.set("remote_ssh_auth_mode", "")
        kv.set("remote_ssh_auth_ready", "")
        kv.set("remote_ssh_auth_hint", "")
        toast.show({ message: "Modo remoto SSH desativado", variant: "success" })
        dialog.clear()
      },
    },
    // MARKSCODE_REMOTE_SSH_COMMANDS_END
// MARKSCODE_MEMORIES_COMMANDS_START
    {
      title: "MarksCode: Save memory (human)",
      value: "markscode.memories.save-human",
      category: "MarksCode",
      slash: { name: "memory-save-human" },
      onSelect: async (dialog) => {
        await saveSessionMemory("manual")
          .then((ok) => {
            if (!ok) {
              toast.show({ message: "No conversation to save", variant: "warning" })
              return
            }
            toast.show({ message: "Memory saved", variant: "success" })
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : "Failed to save memory"
            toast.show({ message, variant: "error" })
          })
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Load human context",
      value: "markscode.memories.context-human",
      category: "MarksCode",
      slash: { name: "memory-context-human" },
      onSelect: async (dialog) => {
        const targetSessionID = route.sessionID
        if (!targetSessionID) {
          toast.show({ message: "Set a session first", variant: "warning" })
          dialog.clear()
          return
        }
        try {
          const rows = await loadHumanContextRows(targetSessionID)
          if (!rows.length) {
            toast.show({ message: "No memories found", variant: "warning" })
            dialog.clear()
            return
          }
          injectContext("[Human memories context]", rows)
          toast.show({ message: "Context loaded", variant: "success" })
        } catch (err) {
          toast.show({ message: err instanceof Error ? err.message : "Failed to load context", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Load compacted context",
      value: "markscode.memories.context-compact",
      category: "MarksCode",
      slash: { name: "memory-context-compact" },
      onSelect: async (dialog) => {
        const targetSessionID = route.sessionID
        if (!targetSessionID) {
          toast.show({ message: "Set a session first", variant: "warning" })
          dialog.clear()
          return
        }
        try {
          const rows = await loadCompactContextRows(targetSessionID, 5)
          if (!rows.length) {
            toast.show({ message: "No compact memories found", variant: "warning" })
            dialog.clear()
            return
          }
          injectContext("[Human memories compacted context]", rows)
          toast.show({ message: "Compact context loaded", variant: "success" })
        } catch (err) {
          toast.show({ message: err instanceof Error ? err.message : "Failed to load compact context", variant: "error" })
        }
        dialog.clear()
      },
    },
    // MARKSCODE_MEMORIES_COMMANDS_END

  ])

  const revertInfo = createMemo(() => session()?.revert)
  const revertMessageID = createMemo(() => revertInfo()?.messageID)

  const revertDiffFiles = createMemo(() => {
    const diffText = revertInfo()?.diff ?? ""
    if (!diffText) return []

    try {
      const patches = parsePatch(diffText)
      return patches.map((patch) => {
        const filename = patch.newFileName || patch.oldFileName || "unknown"
        const cleanFilename = filename.replace(/^[ab]\//, "")
        return {
          filename: cleanFilename,
          additions: patch.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("+")).length,
            0,
          ),
          deletions: patch.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("-")).length,
            0,
          ),
        }
      })
    } catch (error) {
      return []
    }
  })

  const revertRevertedMessages = createMemo(() => {
    const messageID = revertMessageID()
    if (!messageID) return []
    return messages().filter((x) => x.id >= messageID && x.role === "user")
  })

  const revert = createMemo(() => {
    const info = revertInfo()
    if (!info) return
    if (!info.messageID) return
    return {
      messageID: info.messageID,
      reverted: revertRevertedMessages(),
      diff: info.diff,
      diffFiles: revertDiffFiles(),
    }
  })

  // snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))
  // MARKSCODE_MEMORIES_AUTOSAVE_START
  createEffect(
    on(
      () => route.sessionID,
      (sessionID) => {
        const previousSessionID = activeMemorySessionID()
        if (previousSessionID && previousSessionID !== sessionID) {
          saveSessionMemoryFor(previousSessionID, "auto").catch((error) => {
            console.error("session switch memory save failed", error)
          })
        }

        if (!sessionID) {
          setActiveMemorySessionID(undefined)
          return
        }

        setActiveMemorySessionID(sessionID)
        const initial = cachedMemorySnapshotFor(sessionID)
        setLastMemorySaveAt(Date.now())
        setLastMemoryChars(initial.length)
        setLastMemoryHash(memoryHash(initial))

        const timer = setInterval(() => {
          const text = memorySnapshot()
          if (!text) return

          const now = Date.now()
          const elapsed = now - lastMemorySaveAt()
          const deltaChars = text.length - lastMemoryChars()
          const hash = memoryHash(text)

          if (elapsed < 120_000) return
          if (deltaChars < 5000) return
          if (hash === lastMemoryHash()) return

          saveSessionMemory("auto")
            .then((ok) => {
              if (ok) toast.show({ message: "Human memory auto-saved", variant: "success" })
            })
            .catch((error) => {
              console.error("auto memory save failed", error)
            })
        }, 15000)

        onCleanup(() => {
          clearInterval(timer)
          saveSessionMemoryFor(sessionID, "auto").catch((error) => {
            console.error("exit memory save failed", error)
          })
        })
      },
    ),
  )
  // MARKSCODE_MEMORIES_AUTOSAVE_END
  // MARKSCODE_MEMORIES_OVERFLOW_START
  createEffect(() => {
    const sessionID = route.sessionID
    if (!sessionID) return
    if (overflowRecovering()) return

    const list = messages()
    const candidate = [...list].reverse().find((item) => item.role === "assistant" && item.error)
    if (!candidate) return
    if (lastOverflowRecoveredMessageID() === candidate.id) return

    const errorText = errorTextFromMessage(candidate)
    if (!isContextOverflowError(errorText)) return

    setLastOverflowRecoveredMessageID(candidate.id)
    recoverFromContextOverflow(sessionID).catch((error) => {
      console.error("compact overflow recovery failed", error)
      toast.show({ message: "Failed to recover from context overflow", variant: "error" })
    })
  })
  // MARKSCODE_MEMORIES_OVERFLOW_END
                                
  return (
    <context.Provider
      value={{
        get width() {
          return contentWidth()
        },
        sessionID: route.sessionID,
        conceal,
        showThinking,
        showTimestamps,
        showDetails,
        showGenericToolOutput,
        diffWrapMode,
        sync,
        tui: tuiConfig,
      }}
    >
      <box flexDirection="row">
        <box flexGrow={1} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
          <Show when={session()}>
            <Show when={showHeader() && (!sidebarVisible() || !wide())}>
              <Header />
            </Show>
            <scrollbox
              ref={(r) => (scroll = r)}
              viewportOptions={{
                paddingRight: showScrollbar() ? 1 : 0,
              }}
              verticalScrollbarOptions={{
                paddingLeft: 1,
                visible: showScrollbar(),
                trackOptions: {
                  backgroundColor: theme.backgroundElement,
                  foregroundColor: theme.border,
                },
              }}
              stickyScroll={true}
              stickyStart="bottom"
              flexGrow={1}
              scrollAcceleration={scrollAcceleration()}
            >
              <For each={messages()}>
                {(message, index) => (
                  <Switch>
                    <Match when={message.id === revert()?.messageID}>
                      {(function () {
                        const command = useCommandDialog()
                        const [hover, setHover] = createSignal(false)
                        const dialog = useDialog()

                        const handleUnrevert = async () => {
                          const confirmed = await DialogConfirm.show(
                            dialog,
                            "Confirm Redo",
                            "Are you sure you want to restore the reverted messages?",
                          )
                          if (confirmed) {
                            command.trigger("session.redo")
                          }
                        }

                        return (
                          <box
                            onMouseOver={() => setHover(true)}
                            onMouseOut={() => setHover(false)}
                            onMouseUp={handleUnrevert}
                            marginTop={1}
                            flexShrink={0}
                            border={["left"]}
                            customBorderChars={SplitBorder.customBorderChars}
                            borderColor={theme.backgroundPanel}
                          >
                            <box
                              paddingTop={1}
                              paddingBottom={1}
                              paddingLeft={2}
                              backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
                            >
                              <text fg={theme.textMuted}>{revert()!.reverted.length} message reverted</text>
                              <text fg={theme.textMuted}>
                                <span style={{ fg: theme.text }}>{keybind.print("messages_redo")}</span> or /redo to
                                restore
                              </text>
                              <Show when={revert()!.diffFiles?.length}>
                                <box marginTop={1}>
                                  <For each={revert()!.diffFiles}>
                                    {(file) => (
                                      <text fg={theme.text}>
                                        {file.filename}
                                        <Show when={file.additions > 0}>
                                          <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                                        </Show>
                                        <Show when={file.deletions > 0}>
                                          <span style={{ fg: theme.diffRemoved }}> -{file.deletions}</span>
                                        </Show>
                                      </text>
                                    )}
                                  </For>
                                </box>
                              </Show>
                            </box>
                          </box>
                        )
                      })()}
                    </Match>
                    <Match when={revert()?.messageID && message.id >= revert()!.messageID}>
                      <></>
                    </Match>
                    <Match when={message.role === "user"}>
                      <UserMessage
                        index={index()}
                        onMouseUp={() => {
                          if (renderer.getSelection()?.getSelectedText()) return
                          dialog.replace(() => (
                            <DialogMessage
                              messageID={message.id}
                              sessionID={route.sessionID}
                              setPrompt={(promptInfo) => prompt.set(promptInfo)}
                            />
                          ))
                        }}
                        message={message as UserMessage}
                        parts={sync.data.part[message.id] ?? []}
                        pending={pending()}
                      />
                    </Match>
                    <Match when={message.role === "assistant"}>
                      <AssistantMessage
                        last={lastAssistant()?.id === message.id}
                        message={message as AssistantMessage}
                        parts={sync.data.part[message.id] ?? []}
                      />
                    </Match>
                  </Switch>
                )}
              </For>
            </scrollbox>
            <box flexShrink={0}>
              <Show when={permissions().length > 0}>
                <PermissionPrompt request={permissions()[0]} />
              </Show>
              <Show when={permissions().length === 0 && questions().length > 0}>
                <QuestionPrompt request={questions()[0]} />
              </Show>
              <Prompt
                visible={!session()?.parentID && permissions().length === 0 && questions().length === 0}
                ref={(r) => {
                  prompt = r
                  promptRef.set(r)
                  // Apply initial prompt when prompt component mounts (e.g., from fork)
                  if (route.initialPrompt) {
                    r.set(route.initialPrompt)
                  }
                }}
                disabled={permissions().length > 0 || questions().length > 0}
                onSubmit={() => {
                  toBottom()
                }}
                sessionID={route.sessionID}
              />
            </box>
          </Show>
          <Toast />
        </box>
        <Show when={sidebarVisible()}>
          <Switch>
            <Match when={wide()}>
              <Sidebar sessionID={route.sessionID} />
            </Match>
            <Match when={!wide()}>
              <box
                position="absolute"
                top={0}
                left={0}
                right={0}
                bottom={0}
                alignItems="flex-end"
                backgroundColor={RGBA.fromInts(0, 0, 0, 70)}
              >
                <Sidebar sessionID={route.sessionID} />
              </box>
            </Match>
          </Switch>
        </Show>
      </box>
    </context.Provider>
  )
}

const MIME_BADGE: Record<string, string> = {
  "text/plain": "txt",
  "image/png": "img",
  "image/jpeg": "img",
  "image/gif": "img",
  "image/webp": "img",
  "application/pdf": "pdf",
  "application/x-directory": "dir",
}

function UserMessage(props: {
  message: UserMessage
  parts: Part[]
  onMouseUp: () => void
  index: number
  pending?: string
}) {
  const ctx = use()
  const local = useLocal()
  const text = createMemo(() => props.parts.flatMap((x) => (x.type === "text" && !x.synthetic ? [x] : []))[0])
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
  const sync = useSync()
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const color = createMemo(() => local.agent.color(props.message.agent))
  const queuedFg = createMemo(() => selectedForeground(theme, color()))
  const metadataVisible = createMemo(() => queued() || ctx.showTimestamps())

  const compaction = createMemo(() => props.parts.find((x) => x.type === "compaction"))

  return (
    <>
      <Show when={text()}>
        <box
          id={props.message.id}
          border={["left"]}
          borderColor={color()}
          customBorderChars={SplitBorder.customBorderChars}
          marginTop={props.index === 0 ? 0 : 1}
        >
          <box
            onMouseOver={() => {
              setHover(true)
            }}
            onMouseOut={() => {
              setHover(false)
            }}
            onMouseUp={props.onMouseUp}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
            flexShrink={0}
          >
            <text fg={theme.text}>{text()?.text}</text>
            <Show when={files().length}>
              <box flexDirection="row" paddingBottom={metadataVisible() ? 1 : 0} paddingTop={1} gap={1} flexWrap="wrap">
                <For each={files()}>
                  {(file) => {
                    const bg = createMemo(() => {
                      if (file.mime.startsWith("image/")) return theme.accent
                      if (file.mime === "application/pdf") return theme.primary
                      return theme.secondary
                    })
                    return (
                      <text fg={theme.text}>
                        <span style={{ bg: bg(), fg: theme.background }}> {MIME_BADGE[file.mime] ?? file.mime} </span>
                        <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> {file.filename} </span>
                      </text>
                    )
                  }}
                </For>
              </box>
            </Show>
            <Show
              when={queued()}
              fallback={
                <Show when={ctx.showTimestamps()}>
                  <text fg={theme.textMuted}>
                    <span style={{ fg: theme.textMuted }}>
                      {Locale.todayTimeOrDateTime(props.message.time.created)}
                    </span>
                  </text>
                </Show>
              }
            >
              <text fg={theme.textMuted}>
                <span style={{ bg: color(), fg: queuedFg(), bold: true }}> QUEUED </span>
              </text>
            </Show>
          </box>
        </box>
      </Show>
      <Show when={compaction()}>
        <box
          marginTop={1}
          border={["top"]}
          title=" Compaction "
          titleAlignment="center"
          borderColor={theme.borderActive}
        />
      </Show>
    </>
  )
}

function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const local = useLocal()
  const { theme } = useTheme()
  const sync = useSync()
  const messages = createMemo(() => sync.data.message[props.message.sessionID] ?? [])

  const final = createMemo(() => {
    return props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)
  })

  const duration = createMemo(() => {
    if (!final()) return 0
    if (!props.message.time.completed) return 0
    const user = messages().find((x) => x.role === "user" && x.id === props.message.parentID)
    if (!user || !user.time) return 0
    return props.message.time.completed - user.time.created
  })

  const keybind = useKeybind()

  return (
    <>
      <For each={props.parts}>
        {(part, index) => {
          const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
          return (
            <Show when={component()}>
              <Dynamic
                last={index() === props.parts.length - 1}
                component={component()}
                part={part as any}
                message={props.message}
              />
            </Show>
          )
        }}
      </For>
      <Show when={props.parts.some((x) => x.type === "tool" && x.tool === "task")}>
        <box paddingTop={1} paddingLeft={3}>
          <text fg={theme.text}>
            {keybind.print("session_child_first")}
            <span style={{ fg: theme.textMuted }}> view subagents</span>
          </text>
        </box>
      </Show>
      <Show when={props.message.error && props.message.error.name !== "MessageAbortedError"}>
        <box
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
        >
          <text fg={theme.textMuted}>{props.message.error?.data.message}</text>
        </box>
      </Show>
      <Switch>
        <Match when={props.last || final() || props.message.error?.name === "MessageAbortedError"}>
          <box paddingLeft={3}>
            <text marginTop={1}>
              <span
                style={{
                  fg:
                    props.message.error?.name === "MessageAbortedError"
                      ? theme.textMuted
                      : local.agent.color(props.message.agent),
                }}
              >
                ▣{" "}
              </span>{" "}
              <span style={{ fg: theme.text }}>{Locale.titlecase(props.message.mode)}</span>
              <span style={{ fg: theme.textMuted }}> · {props.message.modelID}</span>
              <Show when={duration()}>
                <span style={{ fg: theme.textMuted }}> · {Locale.duration(duration())}</span>
              </Show>
              <Show when={props.message.error?.name === "MessageAbortedError"}>
                <span style={{ fg: theme.textMuted }}> · interrupted</span>
              </Show>
            </text>
          </box>
        </Match>
      </Switch>
    </>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
}

function ReasoningPart(props: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
  const { theme, subtleSyntax } = useTheme()
  const ctx = use()
  const content = createMemo(() => {
    // Filter out redacted reasoning chunks from OpenRouter
    // OpenRouter sends encrypted reasoning data that appears as [REDACTED]
    return props.part.text.replace("[REDACTED]", "").trim()
  })
  return (
    <Show when={content() && ctx.showThinking()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={2}
        marginTop={1}
        flexDirection="column"
        border={["left"]}
        customBorderChars={SplitBorder.customBorderChars}
        borderColor={theme.backgroundElement}
      >
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={true}
          syntaxStyle={subtleSyntax()}
          content={"_Thinking:_ " + content()}
          conceal={ctx.conceal()}
          fg={theme.textMuted}
        />
      </box>
    </Show>
  )
}

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0}>
        <Switch>
          <Match when={Flag.OPENCODE_EXPERIMENTAL_MARKDOWN}>
            <markdown
              syntaxStyle={syntax()}
              streaming={true}
              content={props.part.text.trim()}
              conceal={ctx.conceal()}
            />
          </Match>
          <Match when={!Flag.OPENCODE_EXPERIMENTAL_MARKDOWN}>
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={true}
              syntaxStyle={syntax()}
              content={props.part.text.trim()}
              conceal={ctx.conceal()}
              fg={theme.text}
            />
          </Match>
        </Switch>
      </box>
    </Show>
  )
}

// Pending messages moved to individual tool pending functions

function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const ctx = use()
  const sync = useSync()

  // Hide tool if showDetails is false and tool completed successfully
  const shouldHide = createMemo(() => {
    if (ctx.showDetails()) return false
    if (props.part.state.status !== "completed") return false
    return true
  })

  const toolprops = {
    get metadata() {
      return props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    },
    get input() {
      return props.part.state.input ?? {}
    },
    get output() {
      return props.part.state.status === "completed" ? props.part.state.output : undefined
    },
    get permission() {
      const permissions = sync.data.permission[props.message.sessionID] ?? []
      const permissionIndex = permissions.findIndex((x) => x.tool?.callID === props.part.callID)
      return permissions[permissionIndex]
    },
    get tool() {
      return props.part.tool
    },
    get part() {
      return props.part
    },
  }

  return (
    <Show when={!shouldHide()}>
      <Switch>
        <Match when={props.part.tool === "bash"}>
          <Bash {...toolprops} />
        </Match>
        <Match when={props.part.tool === "glob"}>
          <Glob {...toolprops} />
        </Match>
        <Match when={props.part.tool === "read"}>
          <Read {...toolprops} />
        </Match>
        <Match when={props.part.tool === "grep"}>
          <Grep {...toolprops} />
        </Match>
        <Match when={props.part.tool === "list"}>
          <List {...toolprops} />
        </Match>
        <Match when={props.part.tool === "webfetch"}>
          <WebFetch {...toolprops} />
        </Match>
        <Match when={props.part.tool === "codesearch"}>
          <CodeSearch {...toolprops} />
        </Match>
        <Match when={props.part.tool === "websearch"}>
          <WebSearch {...toolprops} />
        </Match>
        <Match when={props.part.tool === "write"}>
          <Write {...toolprops} />
        </Match>
        <Match when={props.part.tool === "edit"}>
          <Edit {...toolprops} />
        </Match>
        <Match when={props.part.tool === "task"}>
          <Task {...toolprops} />
        </Match>
        <Match when={props.part.tool === "apply_patch"}>
          <ApplyPatch {...toolprops} />
        </Match>
        <Match when={props.part.tool === "todowrite"}>
          <TodoWrite {...toolprops} />
        </Match>
        <Match when={props.part.tool === "question"}>
          <Question {...toolprops} />
        </Match>
        <Match when={props.part.tool === "skill"}>
          <Skill {...toolprops} />
        </Match>
        <Match when={true}>
          <GenericTool {...toolprops} />
        </Match>
      </Switch>
    </Show>
  )
}

type ToolProps<T extends Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  permission: Record<string, any>
  tool: string
  output?: string
  part: ToolPart
}
function GenericTool(props: ToolProps<any>) {
  const { theme } = useTheme()
  const ctx = use()
  const output = createMemo(() => props.output?.trim() ?? "")
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => output().split("\n"))
  const maxLines = 3
  const overflow = createMemo(() => lines().length > maxLines)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, maxLines), "…"].join("\n")
  })

  return (
    <Show
      when={props.output && ctx.showGenericToolOutput()}
      fallback={
        <InlineTool icon="⚙" pending="Writing command..." complete={true} part={props.part}>
          {props.tool} {input(props.input)}
        </InlineTool>
      }
    >
      <BlockTool
        title={`# ${props.tool} ${input(props.input)}`}
        part={props.part}
        onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
      >
        <box gap={1}>
          <text fg={theme.text}>{limited()}</text>
          <Show when={overflow()}>
            <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
          </Show>
        </box>
      </BlockTool>
    </Show>
  )
}

function ToolTitle(props: { fallback: string; when: any; icon: string; children: JSX.Element }) {
  const { theme } = useTheme()
  return (
    <text paddingLeft={3} fg={props.when ? theme.textMuted : theme.text}>
      <Show fallback={<>~ {props.fallback}</>} when={props.when}>
        <span style={{ bold: true }}>{props.icon}</span> {props.children}
      </Show>
    </text>
  )
}

function InlineTool(props: {
  icon: string
  iconColor?: RGBA
  complete: any
  pending: string
  spinner?: boolean
  children: JSX.Element
  part: ToolPart
  onClick?: () => void
}) {
  const [margin, setMargin] = createSignal(0)
  const { theme } = useTheme()
  const ctx = use()
  const sync = useSync()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)

  const permission = createMemo(() => {
    const callID = sync.data.permission[ctx.sessionID]?.at(0)?.tool?.callID
    if (!callID) return false
    return callID === props.part.callID
  })

  const fg = createMemo(() => {
    if (permission()) return theme.warning
    if (hover() && props.onClick) return theme.text
    if (props.complete) return theme.textMuted
    return theme.text
  })

  const error = createMemo(() => (props.part.state.status === "error" ? props.part.state.error : undefined))

  const denied = createMemo(
    () =>
      error()?.includes("rejected permission") ||
      error()?.includes("specified a rule") ||
      error()?.includes("user dismissed"),
  )

  return (
    <box
      marginTop={margin()}
      paddingLeft={3}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
      renderBefore={function () {
        const el = this as BoxRenderable
        const parent = el.parent
        if (!parent) {
          return
        }
        if (el.height > 1) {
          setMargin(1)
          return
        }
        const children = parent.getChildren()
        const index = children.indexOf(el)
        const previous = children[index - 1]
        if (!previous) {
          setMargin(0)
          return
        }
        if (previous.height > 1 || previous.id.startsWith("text-")) {
          setMargin(1)
          return
        }
      }}
    >
      <Switch>
        <Match when={props.spinner}>
          <Spinner color={fg()} children={props.children} />
        </Match>
        <Match when={true}>
          <text paddingLeft={3} fg={fg()} attributes={denied() ? TextAttributes.STRIKETHROUGH : undefined}>
            <Show fallback={<>~ {props.pending}</>} when={props.complete}>
              <span style={{ fg: props.iconColor }}>{props.icon}</span> {props.children}
            </Show>
          </text>
        </Match>
      </Switch>
      <Show when={error() && !denied()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
}

function BlockTool(props: {
  title: string
  children: JSX.Element
  onClick?: () => void
  part?: ToolPart
  spinner?: boolean
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const error = createMemo(() => (props.part?.state.status === "error" ? props.part.state.error : undefined))
  return (
    <box
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      gap={1}
      backgroundColor={hover() ? theme.backgroundMenu : theme.backgroundPanel}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.background}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
      <Show
        when={props.spinner}
        fallback={
          <text paddingLeft={3} fg={theme.textMuted}>
            {props.title}
          </text>
        }
      >
        <Spinner color={theme.textMuted}>{props.title.replace(/^# /, "")}</Spinner>
      </Show>
      {props.children}
      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
}

function Bash(props: ToolProps<typeof BashTool>) {
  const { theme } = useTheme()
  const sync = useSync()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => output().split("\n"))
  const overflow = createMemo(() => lines().length > 10)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, 10), "…"].join("\n")
  })

  const workdirDisplay = createMemo(() => {
    const workdir = props.input.workdir
    if (!workdir || workdir === ".") return undefined

    const base = sync.data.path.directory
    if (!base) return undefined

    const absolute = path.resolve(base, workdir)
    if (absolute === base) return undefined

    const home = Global.Path.home
    if (!home) return absolute

    const match = absolute === home || absolute.startsWith(home + path.sep)
    return match ? absolute.replace(home, "~") : absolute
  })

  const title = createMemo(() => {
    const desc = props.input.description ?? "Shell"
    const wd = workdirDisplay()
    if (!wd) return `# ${desc}`
    if (desc.includes(wd)) return `# ${desc}`
    return `# ${desc} in ${wd}`
  })

  return (
    <Switch>
      <Match when={props.metadata.output !== undefined}>
        <BlockTool
          title={title()}
          part={props.part}
          spinner={isRunning()}
          onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
        >
          <box gap={1}>
            <text fg={theme.text}>$ {props.input.command}</text>
            <Show when={output()}>
              <text fg={theme.text}>{limited()}</text>
            </Show>
            <Show when={overflow()}>
              <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="$" pending="Writing command..." complete={props.input.command} part={props.part}>
          {props.input.command}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Write(props: ToolProps<typeof WriteTool>) {
  const { theme, syntax } = useTheme()
  const code = createMemo(() => {
    if (!props.input.content) return ""
    return props.input.content
  })

  return (
    <Switch>
      <Match when={props.metadata.diagnostics !== undefined}>
        <BlockTool title={"# Wrote " + normalizePath(props.input.filePath!)} part={props.part}>
          <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
            <code
              conceal={false}
              fg={theme.text}
              filetype={filetype(props.input.filePath!)}
              syntaxStyle={syntax()}
              content={code()}
            />
          </line_number>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={props.input.filePath ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing write..." complete={props.input.filePath} part={props.part}>
          Write {normalizePath(props.input.filePath!)}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Glob(props: ToolProps<typeof GlobTool>) {
  return (
    <InlineTool icon="✱" pending="Finding files..." complete={props.input.pattern} part={props.part}>
      Glob "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
      <Show when={props.metadata.count}>
        ({props.metadata.count} {props.metadata.count === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

function Read(props: ToolProps<typeof ReadTool>) {
  const { theme } = useTheme()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const loaded = createMemo(() => {
    if (props.part.state.status !== "completed") return []
    if (props.part.state.time.compacted) return []
    const value = props.metadata.loaded
    if (!value || !Array.isArray(value)) return []
    return value.filter((p): p is string => typeof p === "string")
  })
  return (
    <>
      <InlineTool
        icon="→"
        pending="Reading file..."
        complete={props.input.filePath}
        spinner={isRunning()}
        part={props.part}
      >
        Read {normalizePath(props.input.filePath!)} {input(props.input, ["filePath"])}
      </InlineTool>
      <For each={loaded()}>
        {(filepath) => (
          <box paddingLeft={3}>
            <text paddingLeft={3} fg={theme.textMuted}>
              ↳ Loaded {normalizePath(filepath)}
            </text>
          </box>
        )}
      </For>
    </>
  )
}

function Grep(props: ToolProps<typeof GrepTool>) {
  return (
    <InlineTool icon="✱" pending="Searching content..." complete={props.input.pattern} part={props.part}>
      Grep "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
      <Show when={props.metadata.matches}>
        ({props.metadata.matches} {props.metadata.matches === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

function List(props: ToolProps<typeof ListTool>) {
  const dir = createMemo(() => {
    if (props.input.path) {
      return normalizePath(props.input.path)
    }
    return ""
  })
  return (
    <InlineTool icon="→" pending="Listing directory..." complete={props.input.path !== undefined} part={props.part}>
      List {dir()}
    </InlineTool>
  )
}

function WebFetch(props: ToolProps<typeof WebFetchTool>) {
  return (
    <InlineTool icon="%" pending="Fetching from the web..." complete={(props.input as any).url} part={props.part}>
      WebFetch {(props.input as any).url}
    </InlineTool>
  )
}

function CodeSearch(props: ToolProps<any>) {
  const input = props.input as any
  const metadata = props.metadata as any
  return (
    <InlineTool icon="◇" pending="Searching code..." complete={input.query} part={props.part}>
      Exa Code Search "{input.query}" <Show when={metadata.results}>({metadata.results} results)</Show>
    </InlineTool>
  )
}

function WebSearch(props: ToolProps<any>) {
  const input = props.input as any
  const metadata = props.metadata as any
  return (
    <InlineTool icon="◈" pending="Searching web..." complete={input.query} part={props.part}>
      Exa Web Search "{input.query}" <Show when={metadata.numResults}>({metadata.numResults} results)</Show>
    </InlineTool>
  )
}

function Task(props: ToolProps<typeof TaskTool>) {
  const { theme } = useTheme()
  const keybind = useKeybind()
  const { navigate } = useRoute()
  const local = useLocal()
  const sync = useSync()

  onMount(() => {
    if (props.metadata.sessionId && !sync.data.message[props.metadata.sessionId]?.length)
      sync.session.sync(props.metadata.sessionId)
  })

  const messages = createMemo(() => sync.data.message[props.metadata.sessionId ?? ""] ?? [])

  const tools = createMemo(() => {
    return messages().flatMap((msg) =>
      (sync.data.part[msg.id] ?? [])
        .filter((part): part is ToolPart => part.type === "tool")
        .map((part) => ({ tool: part.tool, state: part.state })),
    )
  })

  const current = createMemo(() => tools().findLast((x) => (x.state as any).title))

  const isRunning = createMemo(() => props.part.state.status === "running")

  const duration = createMemo(() => {
    const first = messages().find((x) => x.role === "user")?.time.created
    const assistant = messages().findLast((x) => x.role === "assistant")?.time.completed
    if (!first || !assistant) return 0
    return assistant - first
  })

  const content = createMemo(() => {
    if (!props.input.description) return ""
    let content = [`Task ${props.input.description}`]

    if (isRunning() && tools().length > 0) {
      // content[0] += ` · ${tools().length} toolcalls`
      if (current()) content.push(`↳ ${Locale.titlecase(current()!.tool)} ${(current()!.state as any).title}`)
      else content.push(`↳ ${tools().length} toolcalls`)
    }

    if (props.part.state.status === "completed") {
      content.push(`└ ${tools().length} toolcalls · ${Locale.duration(duration())}`)
    }

    return content.join("\n")
  })

  return (
    <InlineTool
      icon="│"
      spinner={isRunning()}
      complete={props.input.description}
      pending="Delegating..."
      part={props.part}
      onClick={() => {
        if (props.metadata.sessionId) {
          navigate({ type: "session", sessionID: props.metadata.sessionId })
        }
      }}
    >
      {content()}
    </InlineTool>
  )
}

function Edit(props: ToolProps<typeof EditTool>) {
  const ctx = use()
  const { theme, syntax } = useTheme()

  const view = createMemo(() => {
    const diffStyle = ctx.tui.diff_style
    if (diffStyle === "stacked") return "unified"
    // Default to "auto" behavior
    return ctx.width > 120 ? "split" : "unified"
  })

  const ft = createMemo(() => filetype(props.input.filePath))

  const diffContent = createMemo(() => props.metadata.diff)

  return (
    <Switch>
      <Match when={props.metadata.diff !== undefined}>
        <BlockTool title={"← Edit " + normalizePath(props.input.filePath!)} part={props.part}>
          <box paddingLeft={1}>
            <diff
              diff={diffContent()}
              view={view()}
              filetype={ft()}
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              wrapMode={ctx.diffWrapMode()}
              fg={theme.text}
              addedBg={theme.diffAddedBg}
              removedBg={theme.diffRemovedBg}
              contextBg={theme.diffContextBg}
              addedSignColor={theme.diffHighlightAdded}
              removedSignColor={theme.diffHighlightRemoved}
              lineNumberFg={theme.diffLineNumber}
              lineNumberBg={theme.diffContextBg}
              addedLineNumberBg={theme.diffAddedLineNumberBg}
              removedLineNumberBg={theme.diffRemovedLineNumberBg}
            />
          </box>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={props.input.filePath ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing edit..." complete={props.input.filePath} part={props.part}>
          Edit {normalizePath(props.input.filePath!)} {input({ replaceAll: props.input.replaceAll })}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function ApplyPatch(props: ToolProps<typeof ApplyPatchTool>) {
  const ctx = use()
  const { theme, syntax } = useTheme()

  const files = createMemo(() => props.metadata.files ?? [])

  const view = createMemo(() => {
    const diffStyle = ctx.tui.diff_style
    if (diffStyle === "stacked") return "unified"
    return ctx.width > 120 ? "split" : "unified"
  })

  function Diff(p: { diff: string; filePath: string }) {
    return (
      <box paddingLeft={1}>
        <diff
          diff={p.diff}
          view={view()}
          filetype={filetype(p.filePath)}
          syntaxStyle={syntax()}
          showLineNumbers={true}
          width="100%"
          wrapMode={ctx.diffWrapMode()}
          fg={theme.text}
          addedBg={theme.diffAddedBg}
          removedBg={theme.diffRemovedBg}
          contextBg={theme.diffContextBg}
          addedSignColor={theme.diffHighlightAdded}
          removedSignColor={theme.diffHighlightRemoved}
          lineNumberFg={theme.diffLineNumber}
          lineNumberBg={theme.diffContextBg}
          addedLineNumberBg={theme.diffAddedLineNumberBg}
          removedLineNumberBg={theme.diffRemovedLineNumberBg}
        />
      </box>
    )
  }

  function title(file: { type: string; relativePath: string; filePath: string; deletions: number }) {
    if (file.type === "delete") return "# Deleted " + file.relativePath
    if (file.type === "add") return "# Created " + file.relativePath
    if (file.type === "move") return "# Moved " + normalizePath(file.filePath) + " → " + file.relativePath
    return "← Patched " + file.relativePath
  }

  return (
    <Switch>
      <Match when={files().length > 0}>
        <For each={files()}>
          {(file) => (
            <BlockTool title={title(file)} part={props.part}>
              <Show
                when={file.type !== "delete"}
                fallback={
                  <text fg={theme.diffRemoved}>
                    -{file.deletions} line{file.deletions !== 1 ? "s" : ""}
                  </text>
                }
              >
                <Diff diff={file.diff} filePath={file.filePath} />
                <Diagnostics diagnostics={props.metadata.diagnostics} filePath={file.movePath ?? file.filePath} />
              </Show>
            </BlockTool>
          )}
        </For>
      </Match>
      <Match when={true}>
        <InlineTool icon="%" pending="Preparing patch..." complete={false} part={props.part}>
          Patch
        </InlineTool>
      </Match>
    </Switch>
  )
}

function TodoWrite(props: ToolProps<typeof TodoWriteTool>) {
  return (
    <Switch>
      <Match when={props.metadata.todos?.length}>
        <BlockTool title="# Todos" part={props.part}>
          <box>
            <For each={props.input.todos ?? []}>
              {(todo) => <TodoItem status={todo.status} content={todo.content} />}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⚙" pending="Updating todos..." complete={false} part={props.part}>
          Updating todos...
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Question(props: ToolProps<typeof QuestionTool>) {
  const { theme } = useTheme()
  const count = createMemo(() => props.input.questions?.length ?? 0)

  function format(answer?: string[]) {
    if (!answer?.length) return "(no answer)"
    return answer.join(", ")
  }

  return (
    <Switch>
      <Match when={props.metadata.answers}>
        <BlockTool title="# Questions" part={props.part}>
          <box gap={1}>
            <For each={props.input.questions ?? []}>
              {(q, i) => (
                <box flexDirection="column">
                  <text fg={theme.textMuted}>{q.question}</text>
                  <text fg={theme.text}>{format(props.metadata.answers?.[i()])}</text>
                </box>
              )}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="→" pending="Asking questions..." complete={count()} part={props.part}>
          Asked {count()} question{count() !== 1 ? "s" : ""}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Skill(props: ToolProps<typeof SkillTool>) {
  return (
    <InlineTool icon="→" pending="Loading skill..." complete={props.input.name} part={props.part}>
      Skill "{props.input.name}"
    </InlineTool>
  )
}

function Diagnostics(props: { diagnostics?: Record<string, Record<string, any>[]>; filePath: string }) {
  const { theme } = useTheme()
  const errors = createMemo(() => {
    const normalized = Filesystem.normalizePath(props.filePath)
    const arr = props.diagnostics?.[normalized] ?? []
    return arr.filter((x) => x.severity === 1).slice(0, 3)
  })

  return (
    <Show when={errors().length}>
      <box>
        <For each={errors()}>
          {(diagnostic) => (
            <text fg={theme.error}>
              Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}] {diagnostic.message}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

function normalizePath(input?: string) {
  if (!input) return ""

  const cwd = process.cwd()
  const absolute = path.isAbsolute(input) ? input : path.resolve(cwd, input)
  const relative = path.relative(cwd, absolute)

  if (!relative) return "."
  if (!relative.startsWith("..")) return relative

  // outside cwd - use absolute
  return absolute
}

function input(input: Record<string, any>, omit?: string[]): string {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}
