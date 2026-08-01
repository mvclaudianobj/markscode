import {
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
  useContext,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import path from "path"
import { Effect, Option } from "effect"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useEditorContext } from "@tui/context/editor"
import { reasoningSummary, nextThinkingMode, type ThinkingMode, useThinkingMode } from "@tui/context/thinking"
import { SplitBorder } from "@tui/component/border"
import { Spinner } from "@tui/component/spinner"
import { selectedForeground, useTheme } from "@tui/context/theme"
import { BoxRenderable, ScrollBoxRenderable, TextAttributes, RGBA } from "@opentui/core"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import type { AssistantMessage, Part, Provider, ReasoningPart, TextPart, ToolPart, UserMessage } from "@opencode-ai/sdk/v2"
import { useLocal } from "@tui/context/local"
import * as Locale from "@/util/locale"
import type * as Tool from "@/tool/tool"
import type { ReadTool } from "@/tool/read"
import type { WriteTool } from "@/tool/write"
import type { GlobTool } from "@/tool/glob"
import type { GrepTool } from "@/tool/grep"
import type { EditTool } from "@/tool/edit"
import type { ApplyPatchTool } from "@/tool/apply_patch"
import type { WebFetchTool } from "@/tool/webfetch"
import type { TaskTool } from "@/tool/task"
import type { QuestionTool } from "@/tool/question"
import type { SkillTool } from "@/tool/skill"
import type { WebSearchTool } from "@/tool/websearch"
import { webSearchProviderLabel } from "@/tool/websearch"
import type { TodoWriteTool } from "@/tool/todo"
import { ShellTool } from "@/tool/shell"
import { ShellID } from "@/tool/shell/id"
import { useKeyboard, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import { useSDK } from "@tui/context/sdk"
import { parsePatch } from "diff"
import { useDialog, type DialogContext } from "../../ui/dialog"
import { DialogAlert } from "../../ui/dialog-alert"
import { TodoItem } from "../../component/todo-item"
import { DialogMessage } from "./dialog-message"
import type { PromptInfo } from "../../component/prompt/history"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogTimeline } from "./dialog-timeline"
import { DialogForkFromTimeline } from "./dialog-fork-from-timeline"
import { DialogRetryAction } from "../../component/dialog-retry-action"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { Sidebar } from "./sidebar"
import { SubagentFooter } from "./subagent-footer"
import { Flag } from "@opencode-ai/core/flag/flag"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import * as Clipboard from "../../util/clipboard"
import { Toast, useToast } from "../../ui/toast"
import { useKV } from "../../context/kv.tsx"
import * as Editor from "../../util/editor"
import stripAnsi from "strip-ansi"
import { Footer } from "./footer.tsx"
import { usePromptRef } from "../../context/prompt"
import { useExit } from "../../context/exit"
import * as Filesystem from "@/util/filesystem"
import { Global } from "@opencode-ai/core/global"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import * as Model from "../../util/model"
import { formatTranscript } from "../../util/transcript"
import { UI } from "@/cli/ui.ts"
import {
  listMapProjects,
  listMapModules,
  listMapTasks,
  getMapBootstrap,
  upsertMapTask,
  startMapSession,
  progressMapSession,
  endMapSession,
} from "@/map-api"
import type { MapProjectItem } from "@/map-api"
import {
  canChooseMapModuleOrTask,
  clearMapModuleTaskInKV,
  getMapBindingFromKV,
  mapAutoCheckpointKeyFor,
  mapContextOptions,
  mapKeyFor,
  mapLifecycleBindingPatch,
  mapSuggestionSeenKeyFor,
  setMapBindingInKV,
} from "@/map-tui-kv"
import {
  getHumanContext,
  getSessionCompactContext,
  saveHumanMemory,
  getSessionContextSafety,
  createSessionHandoff,
  continueSessionFromHandoff,
  getGlobalContext,
  searchAdvancedMemories,
  ensureHumanMemoryLayers,
} from "@/memories-api"
import { useEvent } from "../../context/event"
import { useProject } from "../../context/project"
import { useTuiConfig } from "../../context/tui-config"
import { getScrollAcceleration } from "../../util/scroll"
import { TuiPluginRuntime } from "../../plugin/runtime"
import { SessionRetry } from "@/session/retry"
import { Account } from "@/account/account"
import { AppRuntime } from "@/effect/app-runtime"
import { loadMemory } from "@/memory"
import { ensureMemvidCapsule, hybridMemoryStatus, ingestHybridMemories, listHybridRecentTopics, recallHybridMemories } from "@/memory-hybrid"
import { listRemoteSSHProfiles, replaceRemoteSSHProfiles } from "@/remote/profile-repo"
import { diagnoseBrainSystem } from "@/memory-diagnose"
import { runBrainIngestor } from "@/brain-ingestor"
import { isBrainEnabled } from "@/brain-config"
import { brainStatus, brainRecall, brainGraphQuery, brainGraphArtifact } from "@/brain-client"
import { resolveMemoryIdentity } from "@/memory-identity"
import { getGraphfyStatus, graphfyAutoSetup, graphfyExtract } from "@/graphfy"
import { Database } from "@/storage/db"
import { DialogRecentTopics } from "../../component/dialog-recent-topics"
import { DialogAllSessionList } from "../../component/dialog-all-session-list"
import { getRevertDiffFiles } from "../../util/revert-diff"
import { errorMessage } from "@/util/error"
import { PathFormatterProvider, usePathFormatter } from "../../context/path-format"
import { collapseToolOutput } from "../../util/collapse-tool-output"
import { MarksTTS } from "@/tts/marks"
import { MarksSTT } from "@/stt/marks"
import {
  OPENCODE_BASE_MODE,
  useBindings,
  useCommandShortcut,
  useOpencodeKeymap,
} from "../../keymap"

const GO_UPSELL_FREE_TIER_LAST_SEEN_AT = "go_upsell_last_seen_at"
const GO_UPSELL_FREE_TIER_DONT_SHOW = "go_upsell_dont_show"
const GO_UPSELL_ACCOUNT_RATE_LIMIT_LAST_SEEN_AT = "go_upsell_account_rate_limit_last_seen_at"
const GO_UPSELL_ACCOUNT_RATE_LIMIT_DONT_SHOW = "go_upsell_account_rate_limit_dont_show"
const GO_UPSELL_WINDOW = 86_400_000 // 24 hrs
const GO_UPSELL_PROVIDERS = new Set(["opencode", "opencode-go"])
const MARKSCODE_DEBUG_UI = process.env.MARKSCODE_DEBUG_UI === "1"
const MARKSCODE_TTS_VOICE_MODE = "markscode_tts_voice_mode"

function goUpsellKeys(action: SessionRetry.Retryable["action"]) {
  if (!action) return
  if (!GO_UPSELL_PROVIDERS.has(action.provider)) return
  if (action.reason === "free_tier_limit") {
    return {
      lastSeenAt: GO_UPSELL_FREE_TIER_LAST_SEEN_AT,
      dontShow: GO_UPSELL_FREE_TIER_DONT_SHOW,
    }
  }
  if (action.reason === "account_rate_limit") {
    return {
      lastSeenAt: GO_UPSELL_ACCOUNT_RATE_LIMIT_LAST_SEEN_AT,
      dontShow: GO_UPSELL_ACCOUNT_RATE_LIMIT_DONT_SHOW,
    }
  }
}

const sessionBindingCommands = [
  "session.share",
  "session.rename",
  "session.timeline",
  "session.fork",
  "session.compact",
  "session.unshare",
  "session.undo",
  "session.redo",
  "session.sidebar.toggle",
  "session.toggle.conceal",
  "session.toggle.timestamps",
  "session.toggle.thinking",
  "session.toggle.actions",
  "session.toggle.scrollbar",
  "session.toggle.generic_tool_output",
  "session.first",
  "session.last",
  "session.messages_last_user",
  "session.message.next",
  "session.message.previous",
  "messages.copy",
  "session.copy",
  "session.export",
  "session.child.first",
  "session.parent",
  "session.child.next",
  "session.child.previous",
] as const

const sessionGlobalBindingCommands = [
  "session.page.up",
  "session.page.down",
  "session.line.up",
  "session.line.down",
  "session.half.page.up",
  "session.half.page.down",
] as const

const sessionGlobalUnfocusedBindingCommands = ["session.first", "session.last"] as const

const context = createContext<{
  width: number
  sessionID: string
  conceal: () => boolean
  thinkingMode: () => ThinkingMode
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
  showGenericToolOutput: () => boolean
  diffWrapMode: () => "word" | "none"
  providers: () => ReadonlyMap<string, Provider>
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
  const event = useEvent()
  const project = useProject()
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
  const visible = createMemo(() => !session()?.parentID && permissions().length === 0 && questions().length === 0)
  const disabled = createMemo(() => permissions().length > 0 || questions().length > 0)

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
  const thinking = useThinkingMode()
  const thinkingMode = thinking.mode
  const showThinking = createMemo(() => true)
  const [timestamps, setTimestamps] = kv.signal<"hide" | "show">("timestamps", "hide")
  const [showDetails, setShowDetails] = kv.signal("tool_details_visibility", true)
  const [showAssistantMetadata, _setShowAssistantMetadata] = kv.signal("assistant_metadata_visibility", true)
  const [showScrollbar, setShowScrollbar] = kv.signal("scrollbar_visible", true)
  const [diffWrapMode] = kv.signal<"word" | "none">("diff_wrap_mode", "word")
  const [_animationsEnabled, _setAnimationsEnabled] = kv.signal("animations_enabled", true)
  const [showGenericToolOutput, setShowGenericToolOutput] = kv.signal("generic_tool_output_visibility", false)
  // MARKSCODE_MEMORIES_HELPERS_START
  const memoriesUserID = process.env.MEMORIES_USER_ID || "marks-local"
  const [lastMemorySaveAt, setLastMemorySaveAt] = createSignal(0)
  const [lastMemoryChars, setLastMemoryChars] = createSignal(0)
  const [lastMemoryHash, setLastMemoryHash] = createSignal("")
  const [lastBrainIngestAt, setLastBrainIngestAt] = createSignal(0)
  const [activeMemorySessionID, setActiveMemorySessionID] = createSignal<string | undefined>(undefined)
  const [overflowRecovering, setOverflowRecovering] = createSignal(false)
  const [autoSubmitDone, setAutoSubmitDone] = createSignal<string | undefined>(undefined)
  const [lastOverflowRecoveredMessageID, setLastOverflowRecoveredMessageID] = createSignal<string | number | undefined>(undefined)
  const snapshotCache = new Map<string, string>()
  const autoHandoffEnabled = /^(1|true|yes|on)$/i.test(String(process.env.MEMORIES_AUTO_HANDOFF_ENABLED || "1"))
  const autoHandoffDryRun = /^(1|true|yes|on)$/i.test(String(process.env.MEMORIES_AUTO_HANDOFF_DRY_RUN || "0"))
  const autoHandoffProjectKey = String(process.env.MEMORIES_PROJECT_KEY || process.env.MARKSCODE_PROJECT_KEY || "markscode")

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

  const safeSessionSnapshotFor = (sessionID: string) => {
    const title = (sync.session.get(sessionID)?.title || "").trim()
    const rows = (sync.data.message[sessionID] ?? [])
      .map((msg) => {
        const parts = (sync.data.part[msg.id] ?? [])
          .flatMap((x) => x.type === "text" && "text" in x ? [x.text.replace(/password|secret|token|api[_-]?key|bearer/gi, "[redacted]").trim().slice(0, 500)] : [])
          .filter(Boolean)
        if (!parts.length) return ""
        return (msg.role === "user" ? "User" : "AI") + ": " + parts.join("\n")
      })
      .filter(Boolean)
      .slice(-20)
    return [title ? "Title: " + title : "", "Session: " + sessionID, ...rows].filter(Boolean).join("\n\n").trim()
  }

  const cachedMemorySnapshotFor = (sessionID: string) => {
    const text = memorySnapshotFor(sessionID)
    if (text) {
      snapshotCache.set(sessionID, text)
      return text
    }
    const cached = snapshotCache.get(sessionID) || ""
    if (cached) return cached
    const safe = safeSessionSnapshotFor(sessionID)
    if (safe) snapshotCache.set(sessionID, safe)
    return safe
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

  const shortHandoffPromptFrom = (handoff: any, sourceSessionID: string) => {
    const asArray = (...values: any[]) => {
      const out: string[] = []
      const push = (value: any) => {
        if (Array.isArray(value)) return value.forEach(push)
        if (!value) return
        if (typeof value === "object") {
          push(value.content || value.text || value.summary || value.title || value.path || value.file || value.command || value.name)
          return
        }
        const cleaned = normalizeMemoryText(String(value))
          .replace(/^(?:[-*•]\s*)+/g, "")
          .replace(/^(?:\d+[.)]\s*)+/g, "")
          .replace(/^[-\s]+/, "")
          .trim()
        if (!cleaned) return
        const key = cleaned.toLowerCase().replace(/\s+/g, " ")
        if (out.some((x) => x.toLowerCase().replace(/\s+/g, " ") === key)) return
        out.push(cleaned)
      }
      values.forEach(push)
      return out
    }

    const firstText = (...values: any[]) => asArray(...values)[0] || ""
    const clip = (value: string, max = 420) => (value.length > max ? value.slice(0, max).trimEnd() + "…" : value)

    const title = firstText(handoff?.title, handoff?.session_title, handoff?.name) || "Continuação de contexto"
    const whereStopped = firstText(
      handoff?.where_stopped,
      handoff?.stopped_at,
      handoff?.current_state,
      handoff?.last_state,
      handoff?.status,
    )
    const summary = firstText(handoff?.summary, handoff?.compact_summary, handoff?.resume, handoff?.overview)
    const done = asArray(
      handoff?.what_was_done,
      handoff?.completed,
      handoff?.done,
      handoff?.accomplishments,
      handoff?.changes,
      handoff?.work_completed,
    ).slice(0, 5)
    const decisions = asArray(handoff?.key_decisions, handoff?.decisions, handoff?.technical_decisions).slice(0, 5)
    const files = asArray(handoff?.files, handoff?.affected_files, handoff?.paths, handoff?.artifacts).slice(0, 8)
    const validations = asArray(handoff?.validations, handoff?.checks, handoff?.tests, handoff?.commands, handoff?.evidence).slice(0, 6)
    const nextActions = asArray(handoff?.next_actions, handoff?.next_steps, handoff?.todo, handoff?.todos).slice(0, 6)
    const openIssues = asArray(handoff?.open_issues, handoff?.pending, handoff?.risks, handoff?.blockers, handoff?.warnings).slice(0, 6)

    const lines = [
      "[AUTO-HANDOFF RESUMO]",
      "- sessão_origem: " + sourceSessionID,
      "- título: " + clip(title, 160),
    ]

    if (whereStopped) lines.push("- onde_parou: " + clip(whereStopped, 360))
    if (summary) lines.push("- resumo_operacional: " + clip(summary, 520))

    const section = (label: string, items: string[]) => {
      if (!items.length) return
      lines.push("- " + label + ":")
      items.forEach((item) => lines.push("  - " + clip(item, 260)))
    }

    section("o_que_foi_feito", done)
    section("decisões", decisions)
    section("arquivos_ou_áreas", files)
    section("validações", validations)
    section("próximos_passos", nextActions)
    section("pendências_ou_riscos", openIssues)

    lines.push("", "Use este resumo para continuar exatamente de onde parou, preservando decisões, validações e pendências sem depender do histórico anterior completo.")
    return lines.join("\n").trim()
  }

  const loadHumanContextRows = async (sessionID: string) => {
    const ctx = await getHumanContext({ user_id: memoriesUserID, session_id: sessionID })
    return [...(ctx.short_term || []), ...(ctx.long_term || []), ...(ctx.visual || [])]
      .filter((m) => m.session_id === sessionID)
      .map((m) => normalizeMemoryText(m.content))
      .filter(Boolean)
      .slice(0, 8)
  }

  const marksTtsTextFromMessage = (messageID: string) =>
    MarksTTS.textFromParts(sync.data.part[messageID] ?? [], { kv })

  const marksTtsStreamableTextFromMessage = (messageID: string) =>
    MarksTTS.streamableTextFromParts(sync.data.part[messageID] ?? [], { kv })

  const marksTtsStreamingEnabled = () =>
    /^(1|true|yes|on)$/i.test(String(kv.get("markscode_tts_streaming", process.env.MARKSCODE_TTS_STREAMING ?? "0")))

  const runMarksTts = (messageID: string, text: string) => {
    MarksTTS.speak(text, { kv, messageID }).catch((error: unknown) =>
      toast.show({ message: error instanceof Error ? error.message : "Marks TTS failed", variant: "error", duration: 9000 }),
    )
  }

  const insertPromptText = (text: string) => {
    if (!prompt || !text.trim()) return
    const cur = prompt.current
    prompt.set({
      input: cur.input ? cur.input + "\n" + text.trim() : text.trim(),
      parts: cur.parts,
    })
    prompt.focus()
  }

  function showSpeechInsertDialog() {
    dialog.replace(() => {
      const [preview, setPreview] = createSignal("")
      const [capturing, setCapturing] = createSignal(false)
      const [busy, setBusy] = createSignal(false)
      const [status, setStatus] = createSignal("Pronto para capturar")
      const [capture, setCapture] = createSignal<Awaited<ReturnType<typeof MarksSTT.startCapture>>>()
      const [increment, setIncrement] = createSignal(false)
      const warn = (message: string) => {
        setStatus(message)
        toast.show({ message, variant: "warning", duration: 3000 })
      }
      const finishCapture = async () => {
        const current = capture()
        if (busy()) return warn("Aguarde a operação atual terminar")
        if (!current) return warn("Nenhuma captura em andamento")
        setBusy(true)
        setStatus("Transcrevendo...")
        try {
          const text = await current.stop()
          setPreview(increment() && preview().trim() ? (text.trim() ? preview().trimEnd() + "\n" + text.trim() : preview().trimEnd()) : text.trim())
          setStatus(text.trim() ? "Captura concluída" : "Nada capturado")
        } catch (error) {
          const message = error instanceof Error ? error.message : "Marks STT failed"
          if (/not found|no such file|ENOENT/i.test(message)) {
            setStatus("Nada capturado")
            return
          }
          toast.show({ message, variant: "error", duration: 9000 })
          setStatus("Falha na captura")
        } finally {
          setCapture(undefined)
          setCapturing(false)
          setBusy(false)
          setIncrement(false)
        }
      }
      const startCapture = async (append: boolean) => {
        if (busy()) return warn("Aguarde a operação atual terminar")
        if (capturing()) return finishCapture()
        setBusy(true)
        setStatus("Iniciando captura...")
        if (!append) setPreview("")
        setIncrement(append)
        try {
          setCapture(await MarksSTT.startCapture({ kv }))
          setCapturing(true)
          setStatus("Capturando...")
        } catch (error) {
          toast.show({ message: error instanceof Error ? error.message : "Marks STT failed", variant: "error", duration: 9000 })
          setStatus("Falha ao iniciar captura")
        } finally {
          setBusy(false)
        }
      }
      const send = () => {
        if (busy()) return warn("Aguarde a operação atual terminar")
        if (capturing()) return warn("Pare a captura antes de enviar")
        if (!preview().trim()) return warn("Nada capturado")
        insertPromptText(preview())
        dialog.clear()
      }
      return (
        <DialogSelect
          title="Inserir Fala"
          renderFilter={false}
          skipFilter
          flat
          options={[
            {
              title: capturing() ? "Parar captura" : "Iniciar captura",
              value: "capture",
              description: status(),
              details: preview().trim() ? ["Prévia:", preview()] : [],
              onSelect: () => void startCapture(false),
            },
            {
              title: "Incrementar fala",
              value: "increment",
              description: busy()
                ? "Aguarde a operação atual terminar"
                : capturing()
                  ? "Pare a captura atual antes de incrementar"
                  : preview().trim()
                    ? "Adiciona nova captura abaixo da prévia"
                    : "Captura nova fala para anexar quando houver prévia",
              onSelect: () => void startCapture(true),
            },
            {
              title: "Enviar para sessão",
              value: "send",
              description: busy()
                ? "Aguarde a operação atual terminar"
                : capturing()
                  ? "Pare a captura antes de enviar"
                  : preview().trim()
                    ? "Insere a prévia no prompt atual e fecha"
                    : "Nada capturado para enviar",
              onSelect: send,
            },
          ]}
        />
      )
    })
  }

  const loadCompactContextRows = async (sessionID: string, limit = 5) => {
    const compact = await getSessionCompactContext({
      user_id: memoriesUserID,
      session_id: sessionID,
      limit,
      include_content: true,
      content_preview: 500,
    })
    return compactRowsFrom(compact).slice(0, limit)
  }

  const injectContext = (title: string, rows: string[]) => {
    if (!prompt) return
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

  const isMarkspanelQuotaError = (value: string) =>
    /(markspanel|marks\.ia\.br|markscode\/ai\/quota|billing-quota-status|Limite de tokens Markspanel)/i.test(
      value,
    ) && /(insufficient_quota|quota|limite|limit|exceeded|excedida|token)/i.test(value)

  const debugMemoryLog = async (label: string, payload?: unknown) => {
    try {
      const fs = await import("node:fs/promises")
      const line = [
        new Date().toISOString(),
        label,
        payload === undefined ? "" : JSON.stringify(payload),
      ].join(" | ") + "\n"
      await fs.appendFile("/tmp/markscode-memories-debug.log", line)
    } catch {}
  }

  const errorTextFromMessage = (message: any) => {
    const error = message?.error
    if (!error) return ""
    const current =
      typeof error === "string"
        ? error
        : typeof error?.data?.message === "string"
          ? error.data.message
          : typeof error?.message === "string"
            ? error.message
            : ""
    return [current, error?.data?.responseBody, error?.responseBody]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join("\n")
  }



  const showMarkspanelLoginDialog = async () => {
    const sanitizeMarkspanelLoginUrl = (rawUrl: string) => {
      try {
        const parsed = new URL(rawUrl)
        parsed.username = ""
        parsed.password = ""
        parsed.search = ""
        parsed.hash = ""
        return parsed.toString()
      } catch {
        return "https://marks.ia.br/"
      }
    }
    const rawUrl = ((await DialogPrompt.show(dialog, [
      "Login Markspanel — dois métodos disponíveis:",
      "1) Código de dispositivo: abre navegador, informe código exibido no terminal.",
      "2) Usuário/senha: execute com flag --password (ou selecione no prompt interativo).",
      "e-mail/senha somente na página de verificação do Markspanel; o CLI não solicita nem salva credenciais em modo device.",
      "Execute no terminal local/integrado: markscode markspanel-login <url>.",
      "Após concluir, use a opção de atualizar abaixo para recarregar providers/modelos da conta.",
      "Aviso: /api/config só carrega modelos quando a conta possui organização ativa.",
    ].join("\n"), {
      placeholder: "https://marks.ia.br",
      value: String(kv.get("markspanel_login_url") || "https://marks.ia.br"),
    })) || "").trim()
    if (!rawUrl) { dialog.clear(); return }
    const safeUrl = sanitizeMarkspanelLoginUrl(rawUrl)
    kv.set("markspanel_login_url", safeUrl)
    const refresh = await DialogPrompt.show(dialog, [
      "Login Markspanel preparado sem inserir texto no chat.",
      "1) Execute: markscode markspanel-login " + safeUrl,
      "2) Escolha o método: código de dispositivo (abre navegador) ou usuário/senha (digitado no terminal).",
      "3) Confirme abaixo para recarregar providers/modelos nesta TUI.",
      "Se nenhum modelo aparecer, rode /console orgs ou /console switch para ativar uma organização.",
    ].join("\n"), { placeholder: "digite atualizar para recarregar", value: "" })
    if (String(refresh || "").trim().toLowerCase() === "atualizar") {
      await sdk.client.instance.dispose()
      await sync.bootstrap()
      toast.show({ message: "Providers/modelos recarregados; verifique organização ativa se Markspanel não aparecer", variant: "success" })
      dialog.clear()
      return
    }
    toast.show({ message: "Login Markspanel orientado por diálogo; nenhuma credencial foi salva", variant: "success" })
    dialog.clear()
  }

  // --- MARKSCODE REMOTE SSH PROFILES INFRASTRUCTURE (auto-generated) ---
  type RemoteProfileType = "ssh" | "winrm" | "powershell" | "whm"

  type RemoteSSHConfig = {
    type?: RemoteProfileType
    host: string
    user: string
    port: number
    transport?: "http" | "https"
    identity_file?: string
    key_name?: string
    host_alias?: string
    credential_ref?: string
    auth_method?: string
    protocol?: string
    master_key_ref?: string
    encrypted_password?: string
    pki_enabled?: number
  }

  const MARKSCODE_MASTER_KEY_NAME = "marks-key-mestra"
  const MARKSCODE_MASTER_IDENTITY_FILE = "~/.ssh/marks-key-mestra"

  const expandRemoteHomePath = (value: string) => {
    if (!value.startsWith("~/")) return value
    const home = process.env.HOME || ""
    return home ? home + "/" + value.slice(2) : value
  }

  const runMasterKeyCommand = async (cmd: string[]) => {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    if (exitCode !== 0) throw new Error((stderr || stdout || cmd[0] + " falhou").trim())
    return stdout.trim()
  }

  const ensureMarksMasterKey = async () => {
    const privateKey = expandRemoteHomePath(MARKSCODE_MASTER_IDENTITY_FILE)
    const publicKey = privateKey + ".pub"
    const sshDir = privateKey.slice(0, privateKey.lastIndexOf("/"))
    await runMasterKeyCommand(["mkdir", "-p", sshDir])
    await runMasterKeyCommand(["chmod", "700", sshDir])
    const existed = await Bun.file(privateKey).exists()
    if (!existed) await runMasterKeyCommand(["ssh-keygen", "-t", "ed25519", "-N", "", "-C", MARKSCODE_MASTER_KEY_NAME, "-f", privateKey])
    await runMasterKeyCommand(["chmod", "600", privateKey])
    if (!(await Bun.file(publicKey).exists())) await Bun.write(publicKey, (await runMasterKeyCommand(["ssh-keygen", "-y", "-f", privateKey])) + "\n")
    await runMasterKeyCommand(["chmod", "644", publicKey])
    const fingerprint = await runMasterKeyCommand(["ssh-keygen", "-lf", publicKey])
    kv.set("remote_ssh_master_key_name", MARKSCODE_MASTER_KEY_NAME)
    kv.set("remote_ssh_master_identity_file", MARKSCODE_MASTER_IDENTITY_FILE)
    return [
      existed ? "Chave privada existente validada; não foi sobrescrita." : "Chave mestra criada com sucesso.",
      "Nome: " + MARKSCODE_MASTER_KEY_NAME,
      "Privada: " + MARKSCODE_MASTER_IDENTITY_FILE,
      "Pública: " + MARKSCODE_MASTER_IDENTITY_FILE + ".pub",
      "Fingerprint: " + fingerprint,
    ].join("\n")
  }

  const normalizeRemotePort = (value: string) => {
    const raw = Number.parseInt(value.trim(), 10)
    if (!Number.isFinite(raw) || raw <= 0 || raw > 65535) return 22
    return raw
  }

  type RemoteSSHProfile = {
    id: string
    name: string
    type?: RemoteProfileType
    host: string
    user: string
    port: number
    transport?: "http" | "https"
    identity_file?: string
    key_name?: string
    host_alias?: string
    credential_ref?: string
    auth_method?: string | null
    metadata?: string | null
    created_at: string
    updated_at: string
    protocol?: string
    master_key_ref?: string
    encrypted_password?: string
    pki_enabled?: number
  }

  type RemoteSSHProfileAction = "list" | "use" | "save" | "master" | "assign-master" | "deploy-command" | "registry" | "edit" | "delete" | "import"

  const normalizeRemoteType = (value: unknown): RemoteProfileType => value === "winrm" || value === "powershell" || value === "whm" ? value : "ssh"
  const normalizeRemoteTransport = (value: unknown): "http" | "https" | undefined => value === "http" ? "http" : value === "https" ? "https" : undefined
  const defaultRemotePort = (type: RemoteProfileType) => type === "whm" ? 2087 : type === "winrm" || type === "powershell" ? 5986 : 22
  const defaultRemoteTransport = (type: RemoteProfileType) => type === "whm" || type === "winrm" || type === "powershell" ? "https" : undefined
  const isWindowsRemoteType = (type?: RemoteProfileType) => type === "winrm" || type === "powershell"
  const encodeRemoteCredential = (plaintext: string) => `encrypted:${Buffer.from(plaintext, "utf-8").toString("base64")}`
  const normalizeRemoteProfile = (profile: Partial<RemoteSSHProfile> & { name: string; host: string; user: string }): RemoteSSHProfile => {
    const now = new Date().toISOString()
    const type = normalizeRemoteType(profile.type)
    return {
      id: profile.id || profile.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || String(Date.now()),
      name: profile.name,
      type,
      host: profile.host,
      user: profile.user,
      port: normalizeRemotePort(String(profile.port || defaultRemotePort(type))),
      transport: normalizeRemoteTransport(profile.transport) || defaultRemoteTransport(type),
      identity_file: profile.identity_file || undefined,
      key_name: profile.key_name || undefined,
      host_alias: profile.host_alias || undefined,
      credential_ref: profile.credential_ref || undefined,
      auth_method: profile.auth_method || (profile.credential_ref ? "password_ref" : profile.identity_file || profile.key_name ? "key" : undefined),
      protocol: profile.protocol || type,
      master_key_ref: profile.master_key_ref || undefined,
      encrypted_password: profile.encrypted_password || undefined,
      pki_enabled: profile.pki_enabled ? 1 : 0,
      metadata: profile.metadata || undefined,
      created_at: profile.created_at || now,
      updated_at: now,
    }
  }

  const readRemoteSSHProfiles = (): RemoteSSHProfile[] => {
    const kvProfiles = () => {
      const raw = kv.get("remote_ssh_profiles")
      if (Array.isArray(raw)) return raw as RemoteSSHProfile[]
      if (typeof raw === "string" && raw.trim()) {
        try {
          const parsed = JSON.parse(raw)
          return Array.isArray(parsed) ? parsed as RemoteSSHProfile[] : [] as RemoteSSHProfile[]
        } catch {
          return [] as RemoteSSHProfile[]
        }
      }
      return [] as RemoteSSHProfile[]
    }
    try {
      const dbProfiles: RemoteSSHProfile[] = listRemoteSSHProfiles().map((profile) => ({
        id: profile.id,
        name: profile.name,
        type: normalizeRemoteType(profile.type),
        host: profile.host,
        user: profile.user,
        port: profile.port,
        transport: profile.transport === "http" ? "http" : profile.transport === "https" ? "https" : undefined,
        identity_file: profile.identity_file || undefined,
        key_name: profile.key_name || undefined,
        host_alias: profile.host_alias || undefined,
        credential_ref: profile.credential_ref || undefined,
        auth_method: profile.auth_method || undefined,
        metadata: profile.metadata || undefined,
        created_at: new Date(profile.time_created).toISOString(),
        updated_at: new Date(profile.time_updated).toISOString(),
        protocol: profile.protocol || undefined,
        master_key_ref: profile.master_key_ref || undefined,
        encrypted_password: profile.encrypted_password || undefined,
        pki_enabled: profile.pki_enabled ? 1 : 0,
      }))
      if (dbProfiles.length) {
        kv.set("remote_ssh_profiles", dbProfiles)
        return dbProfiles
      }
      const legacy = kvProfiles()
      if (legacy.length) replaceRemoteSSHProfiles(legacy.map((profile) => ({ id: profile.id, account_id: null, org_id: null, name: profile.name, type: profile.type || "ssh", host: profile.host, user: profile.user, port: profile.port, transport: profile.transport || null, identity_file: profile.identity_file || null, key_name: profile.key_name || null, host_alias: profile.host_alias || null, credential_ref: profile.credential_ref || null, auth_method: profile.auth_method || (profile.credential_ref ? "password_ref" : profile.identity_file || profile.key_name ? "key" : null), protocol: profile.protocol || null, master_key_ref: profile.master_key_ref || null, encrypted_password: profile.encrypted_password || null, pki_enabled: profile.pki_enabled ? 1 : 0, metadata: profile.metadata || null })))
      return legacy
    } catch {
      return kvProfiles()
    }
  }

  const remoteSSHProfilesDBWarning = (error: unknown) =>
    "remote_ssh_profiles_db_warning: perfil salvo no fallback de sessão; DB indisponível (" + errorMessage(error).replace(/\s+/g, " ").slice(0, 180) + ")"

  const remoteSSHProfileAliases = (profile: RemoteSSHProfile) => [profile.name, profile.host_alias, profile.host]
    .filter((value): value is string => Boolean(value && value.trim()))

  const updateRemoteSSHProfilesRegistry = (profiles = readRemoteSSHProfiles()) => {
    const names = profiles.map((profile) => profile.name).filter(Boolean)
    const aliases = profiles.flatMap(remoteSSHProfileAliases)
    kv.set("remote_ssh_profile_names", names)
    kv.set("remote_ssh_profile_aliases", aliases)
    kv.set("remote_ssh_profiles_registry", profiles.map((profile) => ({ id: profile.id, name: profile.name, type: profile.type || "ssh", protocol: profile.protocol || profile.type || "ssh", host: profile.host, user: profile.user, port: profile.port, transport: profile.transport, host_alias: profile.host_alias, key_name: profile.key_name, credential_ref: profile.credential_ref ? "***ref***" : undefined, auth_method: profile.auth_method, password_saved: profile.encrypted_password ? "yes" : "no", master_key_ref: profile.master_key_ref, pki_enabled: profile.pki_enabled ? "yes" : "no" })))
    return { names, aliases }
  }

  const writeRemoteSSHProfiles = (profiles: RemoteSSHProfile[]) => {
    const sorted = profiles.toSorted((a, b) => a.name.localeCompare(b.name))
    const warning = (() => {
      try {
        replaceRemoteSSHProfiles(sorted.map((profile) => ({
          id: profile.id,
          account_id: null,
          org_id: null,
          name: profile.name,
          type: profile.type || "ssh",
          host: profile.host,
          user: profile.user,
          port: profile.port,
          transport: profile.transport || null,
          identity_file: profile.identity_file || null,
          key_name: profile.key_name || null,
          host_alias: profile.host_alias || null,
          credential_ref: profile.credential_ref || null,
          auth_method: profile.auth_method || (profile.credential_ref ? "password_ref" : profile.identity_file || profile.key_name ? "key" : null),
          protocol: profile.protocol || profile.type || "ssh",
          master_key_ref: profile.master_key_ref || null,
          encrypted_password: profile.encrypted_password || null,
          pki_enabled: profile.pki_enabled ? 1 : 0,
          metadata: profile.metadata || null,
        })))
        return undefined
      } catch (error) {
        return remoteSSHProfilesDBWarning(error)
      }
    })()
    kv.set("remote_ssh_profiles", sorted)
    kv.set("remote_ssh_profiles_db_warning", warning || "")
    updateRemoteSSHProfilesRegistry(sorted)
    return warning
  }

  const buildRemoteSSHConfigFromProfile = (profile: RemoteSSHProfile): RemoteSSHConfig => {
    const profileType = normalizeRemoteType(profile.type)
    return {
      type: profileType,
      host: profile.host,
      user: profile.user,
      port: normalizeRemotePort(String(profile.port || defaultRemotePort(profileType))),
      transport: normalizeRemoteTransport(profile.transport) || defaultRemoteTransport(profileType),
      identity_file: profile.identity_file,
      key_name: profile.key_name,
      host_alias: profile.host_alias,
      credential_ref: profile.credential_ref,
      auth_method: profile.auth_method || undefined,
      protocol: profile.protocol || profileType,
      master_key_ref: profile.master_key_ref,
      encrypted_password: profile.encrypted_password,
      pki_enabled: profile.pki_enabled,
    }
  }

  const remoteProfileContextRows = (profile: RemoteSSHProfile, cfg = buildRemoteSSHConfigFromProfile(profile)) => {
    const profileType = normalizeRemoteType(cfg.type)
    return [
      "Type: " + profileType,
      "Profile: " + profile.name,
      "Host: " + cfg.host,
      "User: " + cfg.user,
      "Port: " + String(cfg.port),
      ...(cfg.transport ? ["Transport: " + cfg.transport] : []),
      ...(cfg.host_alias ? ["Alias: " + cfg.host_alias] : []),
      ...(cfg.identity_file ? ["Identity file: " + cfg.identity_file] : []),
      ...(cfg.key_name ? ["Key name: " + cfg.key_name] : []),
      ...(cfg.master_key_ref ? ["Master key ref: " + cfg.master_key_ref] : []),
      ...(cfg.auth_method ? ["Auth method: " + cfg.auth_method] : []),
      "Saved password available to automation: " + (cfg.encrypted_password ? "yes (secret not exposed)" : "no"),
      ...(cfg.master_key_ref || cfg.pki_enabled ? ["Master key/deploy hint: use " + MARKSCODE_MASTER_IDENTITY_FILE + " or generate the master-key deploy command from Remote profiles."] : []),
      ...(isWindowsRemoteType(profileType) ? [
        "WinRM/PowerShell: use SSH tool normally; MarksCode must route via local pwsh/WinRM/PowerShell.",
        "PowerShell remoto direto: perfil powershell executa comandos Windows via PowerShell/Invoke-Command, não SSH Linux.",
      ] : []),
    ]
  }

  const isMasterKeyDeployProfile = (profile: RemoteSSHProfile) =>
    profile.master_key_ref === MARKSCODE_MASTER_KEY_NAME || profile.key_name === MARKSCODE_MASTER_KEY_NAME || (profile.auth_method === "key_with_password_bootstrap" && Boolean(profile.encrypted_password))

  const injectRemoteProfileContext = (profile: RemoteSSHProfile, cfg = buildRemoteSSHConfigFromProfile(profile), deployRequested = false) => {
    injectContext("[Remote profile active]", remoteProfileContextRows(profile, cfg))
    if (deployRequested || isMasterKeyDeployProfile(profile)) {
      injectContext("[Remote master-key deploy requested]", [
        "AI deployment instruction: deploy/use MarksCode master key " + MARKSCODE_MASTER_KEY_NAME + " to " + profile.user + "@" + profile.host + ":" + String(cfg.port) + ".",
        "Use saved encrypted_password only as bootstrap material when required; never reveal, echo, print, log, or send plaintext password or encoded secret to LLM context.",
        "After deployment, prefer SSH key auth using " + MARKSCODE_MASTER_IDENTITY_FILE + ".",
        "Saved password available to automation: " + (profile.encrypted_password ? "yes (secret not exposed)" : "no"),
      ])
    }
  }

  const activateRemoteProfile = (profile: RemoteSSHProfile, options: { inject?: boolean; deployRequested?: boolean } = {}) => {
    const normalized = normalizeRemoteProfile(profile)
    const cfg = buildRemoteSSHConfigFromProfile(normalized)
    kv.set("remote_ssh_mode", true)
    kv.set("remote_ssh_config", cfg)
    kv.set("remote_ssh_active_profile", normalized.id)
    kv.set("remote_ssh_profile_name", normalized.name)
    updateRemoteSSHProfilesRegistry()
    if (options.inject !== false) injectRemoteProfileContext(normalized, cfg, options.deployRequested)
    return cfg
  }

  const MARKSCODE_VISIBLE_REMOTE_PROFILES_ACTIONS = [
    "Create SSH/Linux profile",
    "Create WinRM/Windows profile",
    "Create PowerShell/Windows profile",
    "Create WHM/cPanel profile",
    "Use profile",
    "Edit profile",
    "Delete profile",
    "Export/copy JSON",
    "Import JSON (advanced)",
    "Close",
  ] as const

  type RemoteProfileWizardKind = RemoteProfileType
  type RemoteProfileAuthChoice = "master" | "identity" | "credential" | "password" | "master_password" | "skip"

  const remoteWizardLabel = (kind: RemoteProfileWizardKind) => kind === "ssh" ? "SSH/Linux" : kind === "winrm" ? "WinRM/Windows" : kind === "powershell" ? "PowerShell/Windows" : "WHM/cPanel"

  const asCleanText = (value: unknown) => String(value ?? "").trim()
  const validateRemoteName = (value: unknown) => {
    const text = asCleanText(value)
    if (!text) throw new Error("Nome do perfil é obrigatório")
    return text
  }
  const validateRemoteHost = (value: unknown) => {
    const text = asCleanText(value)
    if (!text) throw new Error("Host é obrigatório")
    return text
  }
  const validateRemoteUser = (value: unknown, fallback = "root") => {
    const text = asCleanText(value) || fallback
    if (!text) throw new Error("Usuário é obrigatório")
    return text
  }
  const validateRemotePortStrict = (value: unknown, fallback: number) => {
    const text = asCleanText(value) || String(fallback)
    const port = Number.parseInt(text, 10)
    if (!Number.isFinite(port) || port < 1 || port > 65535 || String(port) !== text) throw new Error("Porta deve ser numérica entre 1 e 65535")
    return port
  }
  const rejectPlaintextSecretFields = (data: Record<string, unknown>) => {
    const blocked = ["password", "senha", "plain_password", "plaintext_password"]
    const found = blocked.filter((key) => data[key] !== undefined && data[key] !== null && String(data[key]).trim() !== "")
    if (found.length) throw new Error("Perfil remoto não pode salvar senha em texto puro: " + found.join(", "))
  }
  const validateRemoteCommandTarget = (profile: RemoteSSHProfile) => {
    const user = validateRemoteUser(profile.user)
    const host = validateRemoteHost(profile.host)
    const port = validateRemotePortStrict(profile.port || 22, 22)
    if (!/^[A-Za-z0-9._-]+$/.test(user)) throw new Error("Usuário contém caracteres inválidos para comando copyable")
    if (!/^[A-Za-z0-9._:-]+$/.test(host)) throw new Error("Host contém caracteres inválidos para comando copyable")
    return { user, host, port }
  }
  const masterKeyDeployCommandText = (profile: RemoteSSHProfile) => {
    const target = validateRemoteCommandTarget(profile)
    const destination = target.user + "@" + target.host
    return [
      "ssh-copy-id -i ~/.ssh/marks-key-mestra.pub" + (target.port === 22 ? " " : " -p " + String(target.port) + " ") + destination,
      "Se não tiver ssh-copy-id:",
      "cat ~/.ssh/marks-key-mestra.pub | ssh" + (target.port === 22 ? " " : " -p " + String(target.port) + " ") + destination + " 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys'",
    ].join("\n")
  }
  const safeRemoteProfileJSON = (profile: RemoteSSHProfile) => JSON.stringify({ id: profile.id, name: profile.name, type: profile.type || "ssh", protocol: profile.protocol || profile.type || "ssh", host: profile.host, user: profile.user, port: profile.port, transport: profile.transport, identity_file: profile.identity_file, key_name: profile.key_name, host_alias: profile.host_alias, credential_ref: profile.credential_ref ? "***ref***" : undefined, auth_method: profile.auth_method || undefined, master_key_ref: profile.master_key_ref, password_saved: profile.encrypted_password ? "yes" : "no", pki_enabled: profile.pki_enabled ? "yes" : "no" }, null, 2)
  const reviewRemoteProfileText = (title: string, profile: RemoteSSHProfile, deployMasterKey = false) => [
    title,
    "",
    "Nome: " + String(profile.name),
    "Tipo: " + String(profile.type || "ssh"),
    "Host: " + String(profile.host),
    "Usuário: " + String(profile.user),
    "Porta: " + String(profile.port),
    "Transporte: " + String(profile.transport || "-"),
    "Autenticação: " + String(profile.auth_method || "configurar depois"),
    "Chave mestra: " + (profile.key_name === MARKSCODE_MASTER_KEY_NAME || deployMasterKey ? "sim" : "não"),
    "Identity file: " + String(profile.identity_file || "-"),
    "Credential ref: " + String(profile.credential_ref ? "***ref***" : "-"),
    "Senha inicial capturada: " + (profile.encrypted_password ? "sim (codificada para bootstrap/automação, nunca exibida)" : "não"),
    "Deploy chave mestra: " + (deployMasterKey ? "sim" : "não"),
    "",
    profile.encrypted_password ? "Nenhum campo password/senha em texto puro será salvo; a senha inicial fica codificada apenas para bootstrap/deploy e nunca é exibida em prompt, log ou contexto LLM." : "Nenhum campo password/senha em texto puro será salvo.",
  ].join("\n")

  const promptRemoteRequired = async (title: string, placeholder: string, value = "") => {
    const input = await DialogPrompt.show(dialog, title, { placeholder, value })
    if (input === null) return null
    return asCleanText(input)
  }

  const selectRemoteOption = <T,>(title: string, options: DialogSelectOption<T>[]) => new Promise<T | null>((resolve) => {
    dialog.replace(
      () => <DialogSelect title={title} options={options.map((option) => ({ ...option, onSelect: (ctx: DialogContext) => { resolve(option.value); ctx.clear() } }))} flat />,
      () => resolve(null),
    )
  })

  const confirmRemoteProfileReview = async (title: string, message: string) => {
    const picked = await selectRemoteOption(title, [
      { title: "Salvar perfil agora", value: "save", description: "Pressione Enter aqui para salvar", details: [message] },
      { title: "Back to menu", value: "cancel", description: "Cancelar sem salvar" },
    ])
    return picked === "save"
  }

  const saveRemoteProfile = (profile: RemoteSSHProfile) => {
    rejectPlaintextSecretFields(profile as unknown as Record<string, unknown>)
    const warning = writeRemoteSSHProfiles([...readRemoteSSHProfiles().filter((item) => item.id !== profile.id && item.name !== profile.name), normalizeRemoteProfile(profile)])
    updateRemoteSSHProfilesRegistry()
    return warning
  }

  const runRemoteCreateWizard = async (kind: RemoteProfileWizardKind) => {
    const label = remoteWizardLabel(kind)
    const defaultPort = defaultRemotePort(kind)
    const name = await promptRemoteRequired(label + " profile - name", "ex: production-server")
    if (name === null) { dialog.clear(); return }
    const host = await promptRemoteRequired(label + " profile - host", isWindowsRemoteType(kind) ? "ex: windows.example.com" : "ex: server.example.com")
    if (host === null) { dialog.clear(); return }
    const user = await promptRemoteRequired(label + " profile - user", isWindowsRemoteType(kind) ? "Administrator" : "root", isWindowsRemoteType(kind) ? "Administrator" : "root")
    if (user === null) { dialog.clear(); return }
    const portInput = await promptRemoteRequired(label + " profile - port", String(defaultPort), String(defaultPort))
    if (portInput === null) { dialog.clear(); return }
    const transport = isWindowsRemoteType(kind) ? await selectRemoteOption<"https" | "http">(label + " transport", [
      { title: "HTTPS (5986)", value: "https", description: "Padrão recomendado para WinRM/PowerShell remoto" },
      { title: "HTTP (5985)", value: "http", description: "Somente se seu Windows estiver configurado para HTTP" },
    ]) : defaultRemoteTransport(kind)
    if (!transport && isWindowsRemoteType(kind)) { dialog.clear(); return }
    const auth = await selectRemoteOption<RemoteProfileAuthChoice>(label + " auth method", kind === "ssh" ? [
      { title: "Deploy/use MarksCode master key", value: "master", description: "Usa marks-key-mestra e solicita deploy quando aplicável" },
      { title: "Password saved for SSH bootstrap/deploy", value: "password", description: "Captura senha inicial codificada para bootstrap; nunca será exibida" },
      { title: "Deploy master key using bootstrap password", value: "master_password", description: "Captura senha inicial codificada e marca deploy da chave mestra" },
      { title: "Identity file", value: "identity", description: "Caminho local da chave privada" },
      { title: "Credential ref", value: "credential", description: "Referência segura existente, não senha" },
      { title: "Skip for now", value: "skip", description: "Salvar sem método de autenticação" },
    ] : kind === "whm" ? [
      { title: "API token credential ref", value: "credential", description: "Preferido: referência segura existente do token WHM" },
      { title: "Skip for now", value: "skip", description: "Salvar sem token; configurar depois" },
    ] : [
      { title: "Password saved for Windows remote access", value: "password", description: "Salva senha mascarada/codificada para WinRM/PowerShell; não será exibida" },
      { title: "Credential ref", value: "credential", description: "Referência segura existente, não senha" },
      { title: "Skip for now", value: "skip", description: "Salvar sem método de autenticação" },
    ])
    if (!auth) { dialog.clear(); return }
    const authValue = auth === "identity" ? await promptRemoteRequired("Identity file", "~/.ssh/id_ed25519") : auth === "credential" ? await promptRemoteRequired(kind === "whm" ? "WHM API token credential ref" : label + " credential ref", "ex: cred://remote/prod-root") : auth === "password" || auth === "master_password" ? await promptRemoteRequired(label + " initial bootstrap password (encoded after save; never shown)", "senha inicial para bootstrap/acesso remoto") : ""
    if (authValue === null) { dialog.clear(); return }
    const deployMasterKey = auth === "master" || auth === "master_password"
    const now = new Date().toISOString()
    const profile = normalizeRemoteProfile({
      id: validateRemoteName(name).toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || String(Date.now()),
      name: validateRemoteName(name),
      type: kind,
      host: validateRemoteHost(host),
      user: validateRemoteUser(user),
      port: validateRemotePortStrict(portInput, defaultPort),
      transport: transport || undefined,
      identity_file: deployMasterKey ? MARKSCODE_MASTER_IDENTITY_FILE : auth === "identity" ? asCleanText(authValue) : undefined,
      key_name: deployMasterKey ? MARKSCODE_MASTER_KEY_NAME : undefined,
      credential_ref: auth === "credential" ? asCleanText(authValue) : undefined,
      auth_method: deployMasterKey ? (auth === "master_password" ? "key_with_password_bootstrap" : "key") : auth === "identity" ? "key" : auth === "credential" ? (kind === "whm" ? "api_token_ref" : "credential_ref") : auth === "password" ? "password_saved" : undefined,
      protocol: kind,
      master_key_ref: deployMasterKey ? MARKSCODE_MASTER_KEY_NAME : undefined,
      encrypted_password: auth === "password" || auth === "master_password" ? encodeRemoteCredential(asCleanText(authValue)) : undefined,
      pki_enabled: deployMasterKey ? 1 : 0,
      created_at: now,
    })
    if (!(await confirmRemoteProfileReview("Review " + label + " profile", reviewRemoteProfileText("Review before save", profile, deployMasterKey)))) { dialog.clear(); return }
    const warning = saveRemoteProfile(profile)
    if (deployMasterKey) {
      kv.set("remote_ssh_deploy_key", "1")
      kv.set("remote_ssh_deploy_host", profile.host)
      kv.set("remote_ssh_deploy_user", profile.user)
    }
    activateRemoteProfile(profile, { deployRequested: deployMasterKey })
    await DialogAlert.show(dialog, label + " profile saved", warning ? "Perfil salvo em fallback de sessão e ativado. O DB não recebeu a gravação agora; o perfil aparecerá em Use/sidebar nesta sessão. " + warning : profile.encrypted_password ? "Perfil salvo e ativado. Senha inicial capturada para bootstrap e armazenada codificada apenas para automação; nenhum campo password/senha em texto puro foi salvo ou será exibido." : "Perfil salvo e ativado com sucesso sem campos password/senha em texto puro.")
    dialog.clear()
  }

  const pickRemoteSSHProfileSimple = async () => {
    const list = readRemoteSSHProfiles()
    if (!list.length) {
      await DialogAlert.show(dialog, "Remote profiles", "Nenhum perfil remoto salvo.")
      dialog.clear()
      return undefined
    }
    const currentID = kv.get("remote_ssh_active_profile") as string | undefined
    const picked = await selectRemoteOption<string>("Select remote profile", list.slice(0, 80).map((profile) => ({
      title: (profile.id === currentID ? "* " : "") + String(profile.name),
      value: profile.id,
      description: String(profile.user) + "@" + String(profile.host) + ":" + String(profile.port) + " | " + String(profile.type || "ssh"),
      details: ["auth: " + String(profile.auth_method || "-"), "key: " + String(profile.key_name || profile.identity_file || profile.credential_ref || "-")],
    })))
    return picked ? list.find((profile) => profile.id === picked) : undefined
  }

  const pickMasterKeyDeployProfile = async () => {
    const list = readRemoteSSHProfiles().filter((profile) => normalizeRemoteType(profile.protocol || profile.type) === "ssh")
    if (!list.length) {
      await DialogAlert.show(dialog, "Implantar chave-mestra", "Nenhum perfil SSH cadastrado.")
      dialog.clear()
      return undefined
    }
    const targets = list.map((profile) => ({ profile, target: validateRemoteCommandTarget(profile) }))
    const picked = await selectRemoteOption<string>("Implantar chave-mestra", targets.slice(0, 80).map((item) => ({
      title: String(item.profile.name),
      value: item.profile.id,
      description: item.target.user + "@" + item.target.host + (item.target.port === 22 ? "" : ":" + String(item.target.port)),
    })))
    return picked ? list.find((profile) => profile.id === picked) : undefined
  }

  const showRemoteSSHProfilesDialog = async (presetAction?: RemoteSSHProfileAction) => {
    const action = presetAction || await selectRemoteOption<RemoteSSHProfileAction | "create-ssh" | "create-winrm" | "create-powershell" | "create-whm" | "export" | "close">("Gerenciar Perfis Remotos", [
      { title: "Create SSH/Linux profile", value: "create-ssh", description: "Wizard guiado: nome, host, usuário, porta, autenticação e revisão" },
      { title: "Create WinRM/Windows profile", value: "create-winrm", description: "Wizard guiado para Windows via WinRM" },
      { title: "Create PowerShell/Windows profile", value: "create-powershell", description: "Wizard guiado para PowerShell remoto direto no Windows" },
      { title: "Create WHM/cPanel profile", value: "create-whm", description: "Wizard guiado com credential_ref para token API" },
      { title: "Criar/validar chave mestra Marks", value: "master", description: "Garante ~/.ssh/marks-key-mestra sem sobrescrever chave existente" },
      { title: "Atribuir deploy da chave mestra a perfil SSH", value: "assign-master", description: "Marca perfil SSH para usar marks-key-mestra sem expor senha" },
      { title: "Implantar chave-mestra", value: "deploy-command", description: "Exibe comandos copiáveis sem senha; não executa" },
      { title: "Use profile", value: "use", description: "Ativar um perfil remoto salvo" },
      { title: "Edit profile", value: "edit", description: "Editar JSON seguro de um perfil existente" },
      { title: "Delete profile", value: "delete", description: "Remover perfil salvo" },
      { title: "Export/copy JSON", value: "export", description: "Mostrar JSON seguro para copiar" },
      { title: "Import JSON (advanced)", value: "import", description: "Importar JSON sem senha/senha plaintext" },
      { title: "Close", value: "close", description: "Fechar gerenciador" },
    ])
    if (!action) {
      toast.show({ message: "Ação de perfil remoto não reconhecida", variant: "warning" })
      dialog.clear()
      return
    }
    if (action === "close") { dialog.clear(); return }
    if (action === "create-ssh") { await runRemoteCreateWizard("ssh"); return }
    if (action === "create-winrm") { await runRemoteCreateWizard("winrm"); return }
    if (action === "create-powershell") { await runRemoteCreateWizard("powershell"); return }
    if (action === "create-whm") { await runRemoteCreateWizard("whm"); return }
    if (action === "master") {
      await DialogAlert.show(dialog, "Chave mestra Marks", await ensureMarksMasterKey())
      dialog.clear()
      return
    }
    if (action === "registry") {
      const registry = updateRemoteSSHProfilesRegistry()
      toast.show({ message: "Registry remoto atualizado: " + registry.names.length + " perfis / " + registry.aliases.length + " aliases", variant: "success" })
      dialog.clear()
      return
    }
    if (action === "list") {
      const profiles = readRemoteSSHProfiles()
      await DialogPrompt.show(dialog, profiles.length ? profiles.map((profile, index) => String(index + 1) + ") " + safeRemoteProfileJSON(profile)).join("\n") : "Nenhum perfil salvo. Use Create SSH/Linux profile, Create WHM/cPanel profile ou Import JSON (advanced).", { placeholder: "Enter para fechar", value: "" })
      toast.show({ message: "Lista de perfis exibida em diálogo", variant: "success" })
      dialog.clear()
      return
    }
    if (action === "save") {
      const cfg = kv.get("remote_ssh_config") as RemoteSSHConfig | undefined
      if (!cfg?.host || !cfg?.user) { toast.show({ message: "Ative/crie um perfil pelo gerenciador antes de salvar", variant: "warning" }); dialog.clear(); return }
      const name = ((await DialogPrompt.show(dialog, "Salvar perfil atual", { placeholder: "nome do perfil", value: String(cfg.host_alias || cfg.host || "") })) || "").trim()
      if (!name) { dialog.clear(); return }
      const now = new Date().toISOString()
      writeRemoteSSHProfiles([...readRemoteSSHProfiles().filter((profile) => profile.name !== name), normalizeRemoteProfile({ id: name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || String(Date.now()), name, type: cfg.type, host: cfg.host, user: cfg.user, port: cfg.port, transport: cfg.transport, identity_file: cfg.identity_file, key_name: cfg.key_name, host_alias: cfg.host_alias, credential_ref: cfg.credential_ref, auth_method: cfg.auth_method, protocol: cfg.protocol, master_key_ref: cfg.master_key_ref, encrypted_password: cfg.encrypted_password, pki_enabled: cfg.pki_enabled, created_at: now })])
      toast.show({ message: "Perfil remoto salvo sem campos password/senha em texto puro", variant: "success" })
      dialog.clear()
      return
    }
    if (action === "import") {
      const raw = ((await DialogPrompt.show(dialog, "Importar perfil JSON", { placeholder: '{"name":"server1","host":"...","user":"..."}', value: "" })) || "").trim()
      if (!raw) { dialog.clear(); return }
      const data = JSON.parse(raw) as Partial<RemoteSSHProfile> & { password?: string; senha?: string }
      rejectPlaintextSecretFields(data as Record<string, unknown>)
      if (!data.name || !data.host || !data.user) throw new Error("Perfil JSON requer name, host e user")
      validateRemotePortStrict(data.port || defaultRemotePort(normalizeRemoteType(data.type)), defaultRemotePort(normalizeRemoteType(data.type)))
      const now = new Date().toISOString()
      writeRemoteSSHProfiles([...readRemoteSSHProfiles().filter((profile) => profile.name !== data.name), normalizeRemoteProfile({ ...data, name: data.name, host: data.host, user: data.user, created_at: data.created_at || now })])
      toast.show({ message: "Perfil remoto importado sem campos password/senha em texto puro", variant: "success" })
      dialog.clear()
      return
    }
    if (action === "deploy-command") {
      const profile = await pickMasterKeyDeployProfile()
      if (!profile) { dialog.clear(); return }
      const deployText = masterKeyDeployCommandText(profile)
      Clipboard.copy(deployText)
        .then(() => toast.show({ message: "Comandos de implantação copiados para a área de transferência!", variant: "success" }))
        .catch(() => toast.show({ message: "Não foi possível copiar; selecione manualmente os comandos exibidos", variant: "warning" }))
      await DialogAlert.show(dialog, "Implantar chave-mestra", deployText)
      dialog.clear()
      return
    }
    const profile = await pickRemoteSSHProfileSimple()
    if (!profile) { dialog.clear(); return }
    if (action === "assign-master") {
      if (normalizeRemoteType(profile.type) !== "ssh") { await DialogAlert.show(dialog, "Perfil incompatível", "Selecione um perfil SSH/Linux."); dialog.clear(); return }
      await ensureMarksMasterKey()
      const updated = normalizeRemoteProfile({ ...profile, identity_file: MARKSCODE_MASTER_IDENTITY_FILE, key_name: MARKSCODE_MASTER_KEY_NAME, master_key_ref: MARKSCODE_MASTER_KEY_NAME, pki_enabled: 1, auth_method: profile.encrypted_password ? "key_with_password_bootstrap" : "key" })
      const warning = saveRemoteProfile(updated)
      activateRemoteProfile(updated, { deployRequested: true })
      await DialogAlert.show(dialog, "Chave mestra atribuída", (warning ? warning + "\n\n" : "") + "Perfil SSH atualizado e ativado para deploy. Senha salva disponível internamente: " + (updated.encrypted_password ? "sim (segredo não exibido)." : "não."))
      dialog.clear()
      return
    }
    if (action === "delete") { writeRemoteSSHProfiles(readRemoteSSHProfiles().filter((item) => item.id !== profile.id)); toast.show({ message: "Perfil remoto excluído", variant: "success" }); dialog.clear(); return }
    if (action === "export") { await DialogPrompt.show(dialog, "Export/copy JSON seguro", { placeholder: "Enter para fechar", value: safeRemoteProfileJSON(profile) }); dialog.clear(); return }
    if (action === "edit") {
      const raw = ((await DialogPrompt.show(dialog, "Editar perfil remoto JSON seguro (não inclua password/senha)", { placeholder: JSON.stringify(profile), value: JSON.stringify(profile, null, 2) })) || "").trim()
      if (!raw) { dialog.clear(); return }
      const data = JSON.parse(raw) as Partial<RemoteSSHProfile> & { password?: string; senha?: string }
      rejectPlaintextSecretFields(data as Record<string, unknown>)
      if (!data.name || !data.host || !data.user) throw new Error("Perfil editado requer name, host e user")
      validateRemotePortStrict(data.port || profile.port || defaultRemotePort(normalizeRemoteType(data.type || profile.type)), defaultRemotePort(normalizeRemoteType(data.type || profile.type)))
      const now = new Date().toISOString()
      writeRemoteSSHProfiles([...readRemoteSSHProfiles().filter((item) => item.id !== profile.id && item.name !== data.name), normalizeRemoteProfile({ ...data, id: data.id || profile.id, name: data.name, host: data.host, user: data.user, created_at: data.created_at || profile.created_at || now })])
      toast.show({ message: "Perfil remoto editado e salvo sem campos password/senha em texto puro", variant: "success" })
      dialog.clear()
      return
    }
    activateRemoteProfile(profile)
    toast.show({ message: "Remote profile active in this chat", variant: "success" })
    dialog.clear()
  }
  // --- END REMOTE SSH PROFILES INFRASTRUCTURE ---
  createEffect(() => {
    const initial = route.initialPrompt
    const sid = route.sessionID
    if (!initial || !prompt || !sid) return
    const promptHandle = prompt
    if (!String(initial.input || "").includes("[AUTO-HANDOFF RESUMO]")) return
    if (autoSubmitDone() === sid) return
    setAutoSubmitDone(sid)
    queueMicrotask(async () => {
      try {
        await debugMemoryLog("session:auto-submit:init", { sessionID: sid, prompt_length: String(initial.input || "").length })
        promptHandle.set(initial)
        await new Promise((resolve) => setTimeout(resolve, 350))
        await debugMemoryLog("session:auto-submit:before-submit", { sessionID: sid })
        promptHandle.submit()
        await debugMemoryLog("session:auto-submit:submit-called", { sessionID: sid })
      } catch (error) {
        await debugMemoryLog("session:auto-submit:error", { sessionID: sid, message: error instanceof Error ? error.message : String(error) })
      }
    })
  })

  const recoverFromContextOverflow = async (sessionID: string, options: { force?: boolean } = {}) => {
    if (overflowRecovering()) return
    setOverflowRecovering(true)
    try {
      await debugMemoryLog("recover:start", {
        sessionID,
        autoHandoffEnabled,
        autoHandoffDryRun,
        projectKey: autoHandoffProjectKey,
        force: Boolean(options.force),
      })

      if (!autoHandoffEnabled) {
        toast.show({ message: "Auto-handoff disabled (MEMORIES_AUTO_HANDOFF_ENABLED=0)", variant: "warning", duration: 8000 })
        return
      }

      const memoriesApi = await import("@/memories-api")
      await debugMemoryLog("recover:before-safety", { sessionID, userID: memoriesUserID })
      const safety = await memoriesApi.getSessionContextSafety({
        user_id: memoriesUserID,
        session_id: sessionID,
      })

      await debugMemoryLog("recover:safety", safety)

      if (!options.force && (!safety || (safety.safe && safety.reason !== "context_limit_near"))) {
        const reason = safety?.reason ? " (" + safety.reason + ")" : ""
        toast.show({ message: "Contexto seguro/chat novo; handoff não necessário" + reason, variant: "success", duration: 6500 })
        return
      }

      await debugMemoryLog("recover:before-handoff", { sessionID })
      const handoff = await memoriesApi.createSessionHandoff({
        user_id: memoriesUserID,
        session_id: sessionID,
        project_key: autoHandoffProjectKey,
        target_tokens: 1200,
        store_memory: true,
      })

      await debugMemoryLog("recover:handoff", {
        handoff_id: handoff?.handoff_id,
        has_prompt: Boolean(handoff?.handoff?.bootstrap_prompt || handoff?.handoff?.compact_markdown),
      })

      const handoffPrompt = shortHandoffPromptFrom(handoff?.handoff, sessionID)

      if (!handoffPrompt) {
        throw new Error("Handoff generated without bootstrap prompt")
      }

      if (autoHandoffDryRun) {
        injectContext("[AUTO-HANDOFF DRY-RUN]", [
          "- sessão atual: " + sessionID,
          "- estimated_tokens: " + String(safety.estimated_tokens || 0),
          "- recommendation: " + String(safety.recommendation || "n/a"),
          "- handoff_id: " + String(handoff?.handoff_id || "n/a"),
          "- novo chat NÃO criado (dry-run ativo)",
        ])
        toast.show({ message: "Auto-handoff dry-run executado", variant: "success", duration: 9000 })
        return
      }

      const currentSession = session()
      const sourceTitle = String(currentSession?.title || "").trim()
      const nextTitle = sourceTitle ? "Continuação - " + sourceTitle : "Continuação"

      await debugMemoryLog("recover:before-create-session", {
        parentID: currentSession?.parentID,
        sourceTitle,
        nextTitle,
      })
      const created = await sdk.client.session.create({
        parentID: currentSession?.parentID,
        title: nextTitle,
      })
      await debugMemoryLog("recover:create-session-result", {
        result_type: typeof created,
        has_id: Boolean((created as any)?.id),
        has_data_id: Boolean((created as any)?.data?.id),
        keys: created && typeof created === "object" ? Object.keys(created as Record<string, unknown>) : [],
      })
      const newSessionID = (created as any)?.id || (created as any)?.data?.id
      await debugMemoryLog("recover:new-session-id", { newSessionID: newSessionID || null })
      if (!newSessionID) {
        throw new Error("Failed to create new session for auto-handoff")
      }

      await debugMemoryLog("recover:before-continue", {
        source_session_id: sessionID,
        new_session_id: newSessionID,
      })
      await memoriesApi.continueSessionFromHandoff({
        user_id: memoriesUserID,
        source_session_id: sessionID,
        new_session_id: newSessionID,
        target_tokens: 1200,
        handoff: handoff?.handoff,
      })
      await debugMemoryLog("recover:continue-ok", { newSessionID })

      await debugMemoryLog("recover:before-delay", { newSessionID, delay_ms: 300, prompt_length: handoffPrompt.length })
      await new Promise((resolve) => setTimeout(resolve, 300))
      await debugMemoryLog("recover:after-delay", { newSessionID })
      await debugMemoryLog("recover:before-navigate", { newSessionID })
      navigate({
        type: "session",
        sessionID: newSessionID,
        initialPrompt: {
          input: handoffPrompt,
          parts: [],
        },
      })
      await debugMemoryLog("recover:navigate-called", { newSessionID })
      toast.show({ message: "New session started from compressed handoff", variant: "success", duration: 9000 })
    } catch (error) {
      await debugMemoryLog("recover:error", {
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    } finally {
      setOverflowRecovering(false)
    }
  }

  const triggerAutoIngest = async (input?: { force?: boolean; sessionID?: string }) => {
    if (!isBrainEnabled()) return
    const now = Date.now()
    if (!input?.force && now - lastBrainIngestAt() < 5 * 60 * 1000) return
    setLastBrainIngestAt(now)
    const tokenResult = await resolveBrainValidationToken()
    if (!tokenResult.token) return
    await runBrainIngestor({
      token: tokenResult.token,
      user_id: memoriesUserID,
      session_id: input?.sessionID || route.sessionID || undefined,
      sources: ["md", "sessions", "graphfy"],
    }).catch(() => undefined)
  }

  const saveSessionMemoryFor = async (sessionID: string, origin: "manual" | "auto") => {
    const text = cachedMemorySnapshotFor(sessionID)
    if (!text || !sessionID) return false
    const memoryIdentity = await resolveMemoryIdentity(sessionID)
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
      user_id: memoryIdentity.user_id || memoriesUserID,
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
      identity: memoryIdentity.identity,
      customer_id: memoryIdentity.customer_id,
      org_id: memoryIdentity.org_id,
      metadata: memoryIdentity.metadata,
    })
    setLastMemorySaveAt(Date.now())
    setLastMemoryChars(text.length)
    setLastMemoryHash(memoryHash(text))
    await triggerAutoIngest({ force: origin === "manual", sessionID })
    return true
  }

  const saveSessionMemory = async (origin: "manual" | "auto") => {
    if (!route.sessionID) return false
    return saveSessionMemoryFor(route.sessionID, origin)
  }

  const saveCurrentTopicMemory = async () => {
    const text = memorySnapshot()
    if (!text || !route.sessionID) return false
    const title = (sync.session.get(route.sessionID)?.title || "Assunto atual BrainSystem").trim()
    await saveHumanMemory({
      user_id: memoriesUserID,
      session_id: route.sessionID,
      type: "semantic",
      memory_mode: "long_term",
      title,
      subject: title || "Assunto atual BrainSystem",
      content: text.length > 2400 ? text.slice(-2400).trim() : text,
      importance: 0.85,
      tags: ["brainsystem", "topic", "manual", "markscode"],
      triggers: ["brainsystem", "assunto atual", title].filter(Boolean),
      retrieval_cues: ["brainsystem", "sessão atual", "assunto recente", title].filter(Boolean),
      mnemonic_techniques: ["topic-summary"],
      visual_refs: [],
      source_name: "markscode-tui-topic",
    })
    await triggerAutoIngest({ force: true, sessionID: route.sessionID })
    return true
  }

  const resolveBrainValidationToken = async (): Promise<{ token: string; source: string }> => {
    if (process.env.MARKSCODE_BRAIN_TOKEN?.trim()) return { token: process.env.MARKSCODE_BRAIN_TOKEN.trim(), source: "MARKSCODE_BRAIN_TOKEN" }
    if (process.env.BRAIN_TOKEN?.trim()) return { token: process.env.BRAIN_TOKEN.trim(), source: "BRAIN_TOKEN" }

    return AppRuntime.runPromise(
      Effect.gen(function* () {
        const service = yield* Account.Service
        const active = yield* service.active()
        if (Option.isNone(active)) return { token: "", source: "missing" }
        const token = yield* service.token(active.value.id)
        if (Option.isNone(token)) return { token: "", source: "missing" }
        return { token: String(token.value), source: "account" }
      }).pipe(Effect.catch(() => Effect.succeed({ token: "", source: "missing" }))),
    ).catch(() => ({ token: "", source: "missing" }))
  }

  const recentTopicRows = async () => {
    const result = await listHybridRecentTopics({ user_id: memoriesUserID, session_id: route.sessionID || undefined, limit: 12, provider: "hybrid" })
    const rows = result.topics.map((topic, index) => String(index + 1) + ". [" + topic.source + "] " + topic.topic + (topic.content_preview ? " — " + topic.content_preview : ""))
    return rows.length ? rows : ["Nenhum assunto recente retornado. Status: " + JSON.stringify(result.sources)]
  }

  const hasEnvMemoryAPIKey = () => Boolean(process.env.MARKSCODE_MEMORIES_API_KEY?.trim() || process.env.MEMORIES_API_KEY?.trim())

  async function hydrateRemoteMemoryConfigFromActiveAccount() {
    if (hasEnvMemoryAPIKey()) return

    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const service = yield* Account.Service
        const active = yield* service.activeOrg()
        if (Option.isNone(active)) return
        yield* service.configActive(active.value)
      }).pipe(Effect.catch(() => Effect.void)),
    ).catch(() => undefined)
  }

  const refreshHybridMemoryStatus = async () => {
    await hydrateRemoteMemoryConfigFromActiveAccount()
    const status = (await hybridMemoryStatus()) as Record<string, unknown>
    const local = status.local && typeof status.local === "object" ? status.local as Record<string, unknown> : {}
    kv.set("memories_hybrid_local_available", status.local_available ? "1" : "0")
    kv.set("memories_hybrid_cloud_available", status.cloud_available ? "1" : "0")
    kv.set("memories_hybrid_provider", String(status.provider || "hybrid"))
    kv.set("memories_hybrid_capsule", String(local.capsule || status.capsule || local.path || ""))
    kv.set("memories_hybrid_local_count", Number.isFinite(local.count) ? String(local.count) : "")
    kv.set("memories_hybrid_local_reason", local.reason ? String(local.reason) : "")
    kv.set("brainsystem_brain_plugin_active", "native")
    kv.set("brainsystem_brain_plugin_label", "Brain nativo ativo")
    const brain = status.brain && typeof status.brain === "object" ? status.brain as Record<string, unknown> : {}
    kv.set("brainsystem_brain_enabled", brain.enabled ? "1" : "0")
    kv.set("brainsystem_brain_base_url", String(brain.base_url || ""))
    kv.set("brainsystem_brain_graphfy_enabled", brain.graphfy_enabled ? "1" : "0")

    // BrainSystem diagnose
    try {
      const diag = diagnoseBrainSystem({
        capsulePath: String(local.capsule || status.capsule || ""),
        projectRoot: process.cwd(),
        sessionDbPath: Database.getPath(),
      })
      kv.set("brainsystem_overall", diag.overall)
      kv.set("brainsystem_layers", JSON.stringify(diag.layers.map(l => ({
        name: l.layer,
        status: l.status,
        reason: l.details,
      }))))
      for (const layer of diag.layers) {
        const key = "brainsystem_" + layer.layer.toLowerCase().replace(/[^a-z0-9]/g, "_")
        kv.set(key, layer.status)
      }
    } catch {
      kv.set("brainsystem_overall", "error")
    }
  }

  const refreshCloudMemories = async (sessionID: string) => {
    try {
      const body = await getGlobalContext({
        session_id: sessionID,
        limit: 5,
      })
      const list = Array.isArray(body?.memories) ? body.memories : []
      kv.set("memories_cloud_last_sync_at", new Date().toISOString())
      kv.set("memories_cloud_last_sync_ok", "1")
      kv.set("memories_cloud_last_sync_count", String(list.length))
      kv.set("memories_cloud_last_sync_error", "")
    } catch (err) {
      kv.set("memories_cloud_last_sync_at", new Date().toISOString())
      kv.set("memories_cloud_last_sync_ok", "0")
      kv.set("memories_cloud_last_sync_error", errorMessage(err) || "sync_failed")
    } finally {
      await refreshHybridMemoryStatus().catch(() => undefined)
    }
  }
  // MARKSCODE_MEMORIES_HELPERS_END
  // Initialize BrainSystem/hybrid memory status on mount
  onMount(() => {
    void refreshHybridMemoryStatus()
  })

      
  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => {
    if (session()?.parentID) return false
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })
  const showTimestamps = createMemo(() => timestamps() === "show")
  const contentWidth = createMemo(() => dimensions().width - (sidebarVisible() ? 42 : 0) - 4)
  const providers = createMemo(() => Model.index(sync.data.provider))

  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const toast = useToast()
  const sdk = useSDK()
  const editor = useEditorContext()

  createEffect(() => {
    const sessionID = route.sessionID
    void (async () => {
      const previousWorkspace = untrack(() => project.workspace.current())
      const result = await sdk.client.session.get({ sessionID }, { throwOnError: true })
      if (!result.data) {
        toast.show({
          message: `Session not found: ${sessionID}`,
          variant: "error",
          duration: 5000,
        })
        navigate({ type: "home" })
        return
      }

      if (result.data.workspaceID !== previousWorkspace) {
        project.workspace.set(result.data.workspaceID)

        // Sync all the data for this workspace. Note that this
        // workspace may not exist anymore which is why this is not
        // fatal. If it doesn't we still want to show the session
        // (which will be non-interactive)
        try {
          await sync.bootstrap({ fatal: false })
        } catch {}
      }
      editor.reconnect(result.data.directory)
      await sync.session.sync(sessionID)
      if (route.sessionID === sessionID && scroll) scroll.scrollBy(100_000)
    })().catch((error) => {
      if (route.sessionID !== sessionID) return
      toast.show({
        message: errorMessage(error),
        variant: "error",
        duration: 5000,
      })
      navigate({ type: "home" })
    })
  })

  let lastSwitch: string | undefined = undefined
  event.on("message.part.updated", (evt) => {
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

  let seeded = false
  let scroll: ScrollBoxRenderable
  let prompt: PromptRef | undefined
  const bind = (r: PromptRef | undefined) => {
    prompt = r
    promptRef.set(r)
    if (seeded || !route.prompt || !r) return
    seeded = true
    r.set(route.prompt)
  }
  const keymap = useOpencodeKeymap()
  const dialog = useDialog()
  const renderer = useRenderer()
  // Graphfy auto-setup: aguarda TUI montar completamente antes de abrir dialog
  onMount(() => {
    setTimeout(() => {
      void (async () => {
        const graphfyAsked = kv.get("graphfy_autosetup_asked")
        if (graphfyAsked) return
        const graphfyStatus = getGraphfyStatus({ projectRoot: process.cwd() })
        if (graphfyStatus.available) return
        if (process.env.MARKSCODE_GRAPHFY_ENABLED === "0" || process.env.MARKSCODE_GRAPHIFY_ENABLED === "0") return
        kv.set("graphfy_autosetup_asked", "1")
        const platform = process.platform
        const installerHint = platform === "win32" ? "uv ou pipx (Windows)" : platform === "darwin" ? "uv ou pipx (macOS)" : "uv ou pipx (Linux)"
        const ok = await DialogConfirm.show(
          dialog,
          "Instalar Graphfy (BrainSystem camada 1)?",
          `Graphify não encontrado (${installerHint}).\nInstalar automaticamente e gerar grafo local? Melhora contexto e economiza tokens.`,
        )
        if (!ok) return
        toast.show({ message: "Instalando graphifyy e gerando grafo local… aguarde.", variant: "info", duration: 10000 })
        const result = await graphfyAutoSetup(process.cwd())
        if (result.success) {
          toast.show({ message: "Graphify instalado! BrainSystem camada 1 ativa.", variant: "success", duration: 8000 })
        } else {
          toast.show({ message: `Graphify setup: ${result.message}`, variant: "warning", duration: 12000 })
        }
        await refreshHybridMemoryStatus().catch(() => undefined)
      })()
    }, 3000)
  })
  // MARKSCODE_MAP_HELPERS_START
  const mapHost = String(process.env.MARKSCODE_MAP_HOST || process.env.HOSTNAME || "markscode")
  const mapActor = String(process.env.MARKSCODE_MAP_ACTOR || process.env.USER || "markscode")
  const mapDebugEnabled = /^(1|true|yes|on)$/i.test(String(process.env.MARKSCODE_DEBUG_UI || "0"))

  const debugUiLog = async (label: string, payload?: unknown) => {
    if (!mapDebugEnabled) return
    try {
      const fs = await import("node:fs/promises")
      const line = [
        new Date().toISOString(),
        label,
        payload === undefined ? "" : JSON.stringify(payload),
      ].join(" | ") + "\n"
      await fs.appendFile("/tmp/markscode-debug-ui.log", line)
    } catch {}
  }

  const getMapBinding = (sessionID?: string) => getMapBindingFromKV(kv, sessionID)

  const setMapBinding = (sessionID: string, patch: Record<string, unknown>) => {
    return setMapBindingInKV({ kv, sessionID, patch, host: mapHost, actor: mapActor })
  }

  const normalizeMapSearchText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()

  const mapSuggestionTerms = () => normalizeMapSearchText([
    session()?.title || "",
    route.prompt || "",
    project.instance.path().worktree === "/" ? "" : project.instance.path().worktree,
    project.instance.directory() || "",
  ].join(" ")).split(/[^a-z0-9]+/).filter((term) => term.length > 2).slice(-24)

  const scoreMapProjectSuggestion = (item: MapProjectItem) => {
    const haystack = normalizeMapSearchText([item.name, item.slug, item.description || ""].join(" "))
    const terms = mapSuggestionTerms()
    return terms.reduce((score, term) => score + (haystack.includes(term) ? term.length : 0), 0)
  }

  const maybeStartLinkedMapTaskSession = async (sessionID: string) => {
    const binding = getMapBinding(sessionID) as Record<string, unknown>
    if (!binding.task_id && !binding.task_title) return
    const last = Number(kv.get(mapAutoCheckpointKeyFor(sessionID)) || 0)
    if (Number.isFinite(last) && Date.now() - last < 300_000) return
    kv.set(mapAutoCheckpointKeyFor(sessionID), String(Date.now()))
    await startMapTaskSession().catch((error) => {
      if (!isQuietMapError(error)) void debugUiLog("map:auto-session-start:error", { sessionID, message: error instanceof Error ? error.message : String(error) })
    })
  }

  const isQuietMapError = (error: unknown) => /authentication_required|unauthorized|401|missing.*key|api.*key/i.test(error instanceof Error ? error.message : String(error))

  const autoMapSessionCheckpoint = async (sessionID: string) => {
    if (!canChooseMapModuleOrTask(getMapBinding(sessionID))) return

    await reloadMapContext().catch((error) => {
      if (!isQuietMapError(error)) void debugUiLog("map:auto-context-reload:error", { sessionID, message: error instanceof Error ? error.message : String(error) })
    })

    const binding: any = getMapBinding(sessionID)
    if (!binding.task_id || !binding.task_title) return

    const now = Date.now()
    const last = Number(kv.get(mapAutoCheckpointKeyFor(sessionID)) || 0)
    if (Number.isFinite(last) && now - last < 300_000) return

    kv.set(mapAutoCheckpointKeyFor(sessionID), String(now))
    const note = "Auto checkpoint de sessão MarksCode"
    await progressMapSession({
      project_id: binding.project_id,
      project_slug: binding.project_slug,
      module_id: binding.module_id,
      module_slug: binding.module_slug,
      task_id: binding.task_id,
      title: binding.task_title,
      host: mapHost,
      actor: mapActor,
      note,
      progress: note,
      event_type: "markscode_auto_session_checkpoint",
      task_update: {
        status: binding.task_status || "in_progress",
        assignee: mapActor,
      },
      host_state: {
        state: "busy",
        note,
      },
    }).then((result) => {
      const next = setMapBinding(sessionID, mapLifecycleBindingPatch({ result, binding, fallbackPhase: "progress", note }))
      void debugUiLog("map:auto-session-checkpoint:ok", { sessionID, task_id: next.task_id })
    }).catch((error) => {
      if (!isQuietMapError(error)) void debugUiLog("map:auto-session-checkpoint:error", { sessionID, message: error instanceof Error ? error.message : String(error) })
    })
  }

  const clearMapModuleTask = (sessionID: string, patch: Record<string, unknown>) =>
    clearMapModuleTaskInKV({ kv, sessionID, patch, host: mapHost, actor: mapActor })

  const requireMapSessionID = () => {
    if (!route.sessionID) throw new Error("Abra uma sessão primeiro")
    return route.sessionID
  }

  const selectMapOption = <T,>(
    dialog: any,
    title: string,
    options: DialogSelectOption<T>[],
    placeholder = "Filtrar...",
  ) => {
    return new Promise<T | null>((resolve) => {
      const rows = options.map((option) => ({
        ...option,
        onSelect: (ctx: any) => {
          option.onSelect?.(ctx)
          resolve(option.value)
          ctx.clear()
        },
      }))
      setTimeout(() => {
        dialog.setSize("large")
        dialog.replace(
          () => <DialogSelect title={title} options={rows} placeholder={placeholder} flat />,
          () => resolve(null),
        )
      }, 0)
    })
  }

  const chooseMapProject = async (dialog: any) => {
    const sessionID = requireMapSessionID()
    await debugUiLog("map:choose-project:start", { sessionID })
    const result = await listMapProjects()
    const projects = Array.isArray(result?.projects) ? result.projects : []
    if (!projects.length) throw new Error("Nenhum projeto MAP encontrado")
    const picked = await selectMapOption<MapProjectItem>(
      dialog,
      "Vincular projeto MAP",
      projects.map((item) => ({
        title: String(item.name || item.slug || item.id || "Projeto MAP"),
        value: item,
        description: String(item.slug || item.id || ""),
        category: "Projetos",
      })),
      "Buscar projeto por nome ou slug...",
    )
    if (!picked) return null
    const next = clearMapModuleTask(sessionID, {
      project_id: picked.id,
      project_slug: picked.slug,
      project_name: picked.name,
    })
    await debugUiLog("map:choose-project:ok", { sessionID, project_id: picked.id, project_slug: picked.slug })
    return next
  }

  const chooseMapModule = async (dialog: any) => {
    const sessionID = requireMapSessionID()
    const binding: any = getMapBinding(sessionID)
    await debugUiLog("map:choose-module:start", { sessionID, project_id: binding.project_id, project_slug: binding.project_slug })
    if (!canChooseMapModuleOrTask(binding)) throw new Error("Vincule um projeto MAP primeiro")
    const result = await listMapModules({
      project_id: binding.project_id,
      project_slug: binding.project_slug,
    })
    const modules = Array.isArray(result?.modules) ? result.modules : []
    if (!modules.length) throw new Error("Nenhum módulo MAP encontrado neste projeto")
    const picked = await selectMapOption<any>(
      dialog,
      "Vincular módulo MAP",
      modules.map((item: any) => ({
        title: String(item.name || item.slug || item.id || "Módulo MAP"),
        value: item,
        description: String(item.slug || item.id || ""),
        category: "Módulos",
      })),
      "Buscar módulo por nome ou slug...",
    )
    if (!picked) return null
    const next = setMapBinding(sessionID, {
      module_id: picked.id,
      module_slug: picked.slug,
      module_name: picked.name,
      task_id: undefined,
      task_title: undefined,
      task_status: undefined,
    })
    await debugUiLog("map:choose-module:ok", { sessionID, module_id: picked.id, module_slug: picked.slug })
    return next
  }

  const chooseOrCreateMapTask = async (dialog: any) => {
    const sessionID = requireMapSessionID()
    const binding: any = getMapBinding(sessionID)
    await debugUiLog("map:choose-task:start", { sessionID, project_id: binding.project_id, module_id: binding.module_id })
    if (!canChooseMapModuleOrTask(binding)) throw new Error("Vincule um projeto MAP primeiro")
    const listed = await listMapTasks({
      project_id: binding.project_id,
      project_slug: binding.project_slug,
      module_id: binding.module_id,
      module_slug: binding.module_slug,
    }).catch(() => ({ tasks: [] }))
    const tasks = Array.isArray((listed as any)?.tasks) ? (listed as any).tasks : []
    const selected = await selectMapOption<any>(
      dialog,
      "Vincular task MAP",
      [
        ...tasks.map((item: any) => ({
          title: String(item.title || item.name || item.id || "Task MAP"),
          value: { kind: "existing", task: item },
          description: "#" + String(item.id || "") + " " + String(item.status || "open"),
          category: "Tasks existentes",
        })),
        {
          title: "Criar nova / digitar título ou ID...",
          value: { kind: "manual" },
          description: "abre entrada manual",
          category: "Manual",
        },
      ],
      "Buscar task por título, status ou ID...",
    )
    if (!selected) return null
    if (selected.kind === "existing") {
      const taskResult: any = selected.task
      if (!taskResult?.id) throw new Error("Task MAP não retornada")
      const next = setMapBinding(sessionID, {
        task_id: taskResult.id,
        task_title: taskResult.title,
        task_status: taskResult.status,
      })
      void maybeStartLinkedMapTaskSession(sessionID)
      await debugUiLog("map:choose-task:ok", { sessionID, task_id: taskResult.id, task_title: taskResult.title, mode: "linked" })
      return next
    }
    const answer = await DialogPrompt.show(dialog, "Criar/vincular task MAP", {
      placeholder: binding.task_title || "Digite o título da task",
    })
    if (!answer) return null
    const title = answer.trim()
    if (!title) return null

    const existing = await listMapTasks({
      project_id: binding.project_id,
      project_slug: binding.project_slug,
      module_id: binding.module_id,
      module_slug: binding.module_slug,
      title,
    }).catch(() => ({ tasks: [] }))
    const value = title.toLowerCase()
    const task: any = (existing.tasks || []).find((item: any) => String(item.id || "") === title) ||
      (existing.tasks || []).find((item: any) => String(item.title || "").toLowerCase() === value) ||
      (existing.tasks || []).find((item: any) => String(item.title || "").toLowerCase().includes(value))

    const createdTask = task || (await upsertMapTask({
      project_id: binding.project_id,
      project_slug: binding.project_slug,
      module_id: binding.module_id,
      module_slug: binding.module_slug,
      title,
      status: binding.task_status || "open",
      priority: "normal",
      assignee: mapActor,
      actor: mapActor,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      if (/authentication_required|unauthorized|401/i.test(message)) {
        throw new Error("MAP requer login OAuth/device no Markspanel para criar tasks")
      }
      throw error
    })).task
    const taskResult: any = createdTask
    if (!taskResult?.id) throw new Error("Task MAP não retornada")
    const next = setMapBinding(sessionID, {
      task_id: taskResult.id,
      task_title: taskResult.title,
      task_status: taskResult.status,
    })
    void maybeStartLinkedMapTaskSession(sessionID)
    await debugUiLog("map:choose-task:ok", { sessionID, task_id: taskResult.id, task_title: taskResult.title, mode: task ? "linked" : "created" })
    return next
  }

  const reloadMapContext = async (dialogContext = dialog) => {
    const sessionID = requireMapSessionID()
    const binding: any = getMapBinding(sessionID)
    await debugUiLog("map:context-reload:start", { sessionID, project_id: binding.project_id, module_id: binding.module_id, task_id: binding.task_id })
    if (!canChooseMapModuleOrTask(binding)) throw new Error("Vincule um projeto MAP primeiro")
    const data = await getMapBootstrap({
      project_id: binding.project_id,
      project_slug: binding.project_slug,
      module_id: binding.module_id,
      module_slug: binding.module_slug,
      host: mapHost,
      include_tasks: true,
    })
    const options = mapContextOptions({ data, binding, host: mapHost, actor: mapActor })
    await selectMapOption<string>(
      dialogContext,
      "Contexto MAP vinculado",
      options,
      "Buscar no contexto MAP...",
    )
    await debugUiLog("map:context-reload:ok", { sessionID, tasks: Array.isArray(data?.tasks) ? data.tasks.length : 0 })
    return data
  }

  const ensureMapTaskBinding = (binding: any) => {
    if (!binding?.task_id && !binding?.task_title) throw new Error("Vincule uma task MAP primeiro")
    return binding
  }

  const startMapTaskSession = async () => {
    const sessionID = requireMapSessionID()
    const binding: any = ensureMapTaskBinding(getMapBinding(sessionID))
    await debugUiLog("map:session-start:start", { sessionID, task_id: binding.task_id, task_title: binding.task_title })
    const result = await startMapSession({
      project_id: binding.project_id,
      project_slug: binding.project_slug,
      module_id: binding.module_id,
      module_slug: binding.module_slug,
      task_id: binding.task_id,
      title: binding.task_title,
      host: mapHost,
      actor: mapActor,
      task_status: "in_progress",
      note: "Sessão iniciada pelo MarksCode",
    })
    const next = setMapBinding(sessionID, mapLifecycleBindingPatch({ result, binding, fallbackPhase: "started" }))
    await debugUiLog("map:session-start:ok", { sessionID, task_id: next.task_id, phase: next.last_phase })
    return next
  }

  const progressMapTaskSession = async (dialog: any) => {
    const sessionID = requireMapSessionID()
    const binding: any = ensureMapTaskBinding(getMapBinding(sessionID))
    await debugUiLog("map:session-progress:start", { sessionID, task_id: binding.task_id, task_title: binding.task_title })
    const note = await DialogPrompt.show(dialog, "Registrar progresso MAP", {
      placeholder: "Descreva o progresso/checkpoint",
    })
    if (!note) return null
    const result = await progressMapSession({
      project_id: binding.project_id,
      project_slug: binding.project_slug,
      module_id: binding.module_id,
      module_slug: binding.module_slug,
      task_id: binding.task_id,
      title: binding.task_title,
      host: mapHost,
      actor: mapActor,
      note,
      progress: note,
      event_type: "markscode_manual_progress",
      task_update: {
        status: binding.task_status || "in_progress",
        assignee: mapActor,
      },
      host_state: {
        state: "busy",
        note,
      },
    })
    const next = setMapBinding(sessionID, mapLifecycleBindingPatch({ result, binding, fallbackPhase: "progress", note }))
    await debugUiLog("map:session-progress:ok", { sessionID, task_id: next.task_id, phase: next.last_phase })
    return next
  }

  const endMapTaskSession = async (dialog: any) => {
    const sessionID = requireMapSessionID()
    const binding: any = ensureMapTaskBinding(getMapBinding(sessionID))
    await debugUiLog("map:session-end:start", { sessionID, task_id: binding.task_id, task_title: binding.task_title })
    const note = await DialogPrompt.show(dialog, "Encerrar sessão MAP", {
      placeholder: "Resumo final / checkout",
    })
    if (!note) return null
    const result = await endMapSession({
      project_id: binding.project_id,
      project_slug: binding.project_slug,
      module_id: binding.module_id,
      module_slug: binding.module_slug,
      task_id: binding.task_id,
      title: binding.task_title,
      host: mapHost,
      actor: mapActor,
      note,
      task_status: "done",
      host_state: {
        state: "idle",
        note,
      },
    })
    const next = setMapBinding(sessionID, mapLifecycleBindingPatch({ result, binding, fallbackPhase: "ended", note }))
    await debugUiLog("map:session-end:ok", { sessionID, task_id: next.task_id, phase: next.last_phase })
    return next
  }

  const bindSuggestedMapProject = async (projectItem: MapProjectItem) => {
    const sessionID = requireMapSessionID()
    const next = clearMapModuleTask(sessionID, {
      project_id: projectItem.id,
      project_slug: projectItem.slug,
      project_name: projectItem.name,
    })
    await reloadMapContext().catch((error) => {
      if (!isQuietMapError(error)) void debugUiLog("map:auto-suggestion-context:error", { sessionID, message: error instanceof Error ? error.message : String(error) })
    })
    const pickModule = await DialogConfirm.show(dialog, "Vincular módulo MAP?", "Deseja escolher módulo e tarefa MAP agora?")
    if (!pickModule) return next
    const moduleBinding = await chooseMapModule(dialog).catch((error) => {
      if (!isQuietMapError(error)) toast.show({ message: error instanceof Error ? error.message : "Erro ao vincular módulo MAP", variant: "warning", duration: 7000 })
      return null
    })
    if (!moduleBinding) return next
    await chooseOrCreateMapTask(dialog).catch((error) => {
      if (!isQuietMapError(error)) toast.show({ message: error instanceof Error ? error.message : "Erro ao vincular task MAP", variant: "warning", duration: 7000 })
      return null
    })
    return getMapBinding(sessionID)
  }

  const maybeSuggestMapBinding = async () => {
    const sessionID = route.sessionID
    if (!sessionID) return
    if (kv.get(mapKeyFor(sessionID))) return
    if (kv.get(mapSuggestionSeenKeyFor(sessionID))) return
    if (dialog.stack.length > 0) return
    const result = await listMapProjects().catch((error) => {
      if (!isQuietMapError(error)) void debugUiLog("map:auto-suggestion:list:error", { sessionID, message: error instanceof Error ? error.message : String(error) })
      return null
    })
    const projects = result?.projects || []
    if (!projects.length) return
    const ranked = projects.map((item) => ({ item, score: scoreMapProjectSuggestion(item) })).toSorted((a, b) => b.score - a.score)
    const candidate = ranked[0]
    if (!candidate) return
    if (ranked.length > 1 && candidate.score < 6) return
    kv.set(mapSuggestionSeenKeyFor(sessionID), "1")
    const choice = await selectMapOption<"bind" | "choose" | "ignore">(
      dialog,
      "Encontrei o projeto MAP '" + String(candidate.item.name || candidate.item.slug) + "'. Deseja vincular esta sessão?",
      [
        { title: "Vincular projeto", value: "bind", description: String(candidate.item.slug || candidate.item.id || ""), category: "MAP" },
        { title: "Escolher outro", value: "choose", description: "selecionar projeto/módulo/tarefa", category: "MAP" },
        { title: "Ignorar por esta sessão", value: "ignore", description: "não perguntar novamente nesta sessão", category: "MAP" },
      ],
      "Escolha uma ação...",
    )
    if (choice === "bind") {
      const binding = await bindSuggestedMapProject(candidate.item)
      if ((binding as Record<string, unknown>)?.project_name || (binding as Record<string, unknown>)?.project_slug) toast.show({ message: "Projeto MAP vinculado: " + String((binding as Record<string, unknown>).project_name || (binding as Record<string, unknown>).project_slug), variant: "success", duration: 6500 })
      return
    }
    if (choice === "choose") {
      const binding = await chooseMapProject(dialog)
      if (!binding) return
      await reloadMapContext().catch((error) => {
        if (!isQuietMapError(error)) void debugUiLog("map:auto-suggestion-context:error", { sessionID, message: error instanceof Error ? error.message : String(error) })
      })
      const pickModule = await DialogConfirm.show(dialog, "Vincular módulo MAP?", "Deseja escolher módulo e tarefa MAP agora?")
      if (!pickModule) return
      await chooseMapModule(dialog).catch(() => null)
      await chooseOrCreateMapTask(dialog).catch(() => null)
    }
  }

  onMount(() => {
    setTimeout(() => void maybeSuggestMapBinding(), 1200)
  })
  // MARKSCODE_MAP_HELPERS_END
      
  event.on("session.status", (evt) => {
    if (evt.properties.sessionID !== route.sessionID) return
    if (evt.properties.status.type !== "retry") return
    if (!evt.properties.status.action) return
    if (dialog.stack.length > 0) return

    const keys = goUpsellKeys(evt.properties.status.action)
    if (!keys) return

    const seen = kv.get(keys.lastSeenAt)
    if (typeof seen === "number" && Date.now() - seen < GO_UPSELL_WINDOW) return

    if (kv.get(keys.dontShow)) return

    void DialogRetryAction.show(dialog, evt.properties.status.action).then((dontShowAgain) => {
      if (dontShowAgain) kv.set(keys.dontShow, true)
      kv.set(keys.lastSeenAt, Date.now())
    })
  })

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

  function enterChild(sessionID: string) {
    navigate({
      type: "session",
      sessionID,
    })
    const status = sync.data.session_status[sessionID]
    if (status?.type === "retry") void DialogAlert.show(dialog, "Retry Error", status.message)
  }

  function moveFirstChild() {
    if (children().length === 1) return
    const next = children().find((x) => !!x.parentID)
    if (next) enterChild(next.id)
  }

  function moveChild(direction: number) {
    if (children().length === 1) return

    const sessions = children().filter((x) => !!x.parentID)
    let next = sessions.findIndex((x) => x.id === session()?.id) - direction

    if (next >= sessions.length) next = 0
    if (next < 0) next = sessions.length - 1
    if (sessions[next]) enterChild(sessions[next].id)
  }

  function childSessionHandler(func: () => void) {
    return () => {
      if (!session()?.parentID || dialog.stack.length > 0) return
      func()
    }
  }

  const sessionCommandList = createMemo(() => [
    {
      title: "Ativar TTS modo de voz",
      value: "marks.tts.voice.toggle",
      category: "Marks",
      slash: {
        name: "marks-tts-voice",
      },
      run: () => {
        const enabled = !kv.get(MARKSCODE_TTS_VOICE_MODE, false)
        kv.set(MARKSCODE_TTS_VOICE_MODE, enabled)
        toast.show({ message: `Marks TTS voice mode ${enabled ? "enabled" : "disabled"}`, variant: "success" })
        dialog.clear()
      },
    },
    {
      title: "Inserir Fala",
      value: "marks.stt.record.prompt",
      category: "Marks",
      slash: {
        name: "marks-stt",
      },
      run: () => {
        showSpeechInsertDialog()
      },
    },
    {
      title: "Parar áudio TTS",
      value: "marks.tts.stop",
      category: "Marks",
      slash: {
        name: "marks-tts-stop",
      },
      run: () => {
        MarksTTS.stop()
        toast.show({ message: "Áudio TTS interrompido", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: "Ouvir última interação",
      value: "marks.tts.listen.last",
      category: "Marks",
      slash: {
        name: "marks-tts-last",
      },
      run: () => {
        const message = messages().findLast((item) => item.role === "assistant" && item.time.completed)
        if (!message) {
          toast.show({ message: "Nenhuma resposta concluída para ouvir", variant: "warning" })
          dialog.clear()
          return
        }
        const text = marksTtsTextFromMessage(message.id)
        if (!text) {
          toast.show({ message: "Nenhum texto encontrado na última resposta", variant: "warning" })
          dialog.clear()
          return
        }
        runMarksTts(`${message.id}-manual-${Date.now()}`, text)
        dialog.clear()
      },
    },
    {
      title: "All Sessions",
      value: "all-sessions",
      category: "Session",
      slash: {
        name: "all-sessions",
      },
      run: () => {
        dialog.replace(() => <DialogAllSessionList />)
      },
    },
    {
      title: session()?.share?.url ? "Copy share link" : "Share session",
      value: "session.share",
      suggested: route.type === "session",
      category: "Session",
      enabled: sync.data.config.share !== "disabled",
      slash: {
        name: "share",
      },
      run: async () => {
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
        if (!kv.get("share_consent", false)) {
          const ok = await DialogConfirm.show(dialog, "Share Session", "Are you sure you want to share it?")
          if (ok !== true) return
          kv.set("share_consent", true)
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
      category: "Session",
      slash: {
        name: "rename",
      },
      run: () => {
        dialog.replace(() => <DialogSessionRename session={route.sessionID} />)
      },
    },
    {
      title: "Jump to message",
      value: "session.timeline",
      category: "Session",
      slash: {
        name: "timeline",
      },
      run: () => {
        dialog.replace(() => (
          <DialogTimeline
            onMove={(messageID) => {
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
            setPrompt={(promptInfo) => prompt?.set(promptInfo)}
          />
        ))
      },
    },
    {
      title: "Fork session",
      value: "session.fork",
      category: "Session",
      slash: {
        name: "fork",
      },
      run: () => {
        dialog.replace(() => (
          <DialogForkFromTimeline
            onMove={(messageID) => {
              if (!messageID) return
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
      category: "Session",
      slash: {
        name: "compact",
        aliases: ["summarize"],
      },
      run: () => {
        const selectedModel = local.model.current()
        if (!selectedModel) {
          toast.show({
            variant: "warning",
            message: "Connect a provider to summarize this session",
            duration: 3000,
          })
          return
        }
        void sdk.client.session.summarize({
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
      category: "Session",
      enabled: !!session()?.share?.url,
      slash: {
        name: "unshare",
      },
      run: async () => {
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
      category: "Session",
      slash: {
        name: "undo",
      },
      run: async () => {
        const status = sync.data.session_status?.[route.sessionID]
        if (status?.type !== "idle") await sdk.client.session.abort({ sessionID: route.sessionID }).catch(() => {})
        const revert = session()?.revert?.messageID
        const message = messages().findLast((x) => (!revert || x.id < revert) && x.role === "user")
        if (!message) return
        void sdk.client.session
          .revert({
            sessionID: route.sessionID,
            messageID: message.id,
          })
          .then(() => {
            toBottom()
          })
        const parts = sync.data.part[message.id]
        prompt?.set(
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
      category: "Session",
      enabled: !!session()?.revert?.messageID,
      slash: {
        name: "redo",
      },
      run: () => {
        dialog.clear()
        const messageID = session()?.revert?.messageID
        if (!messageID) return
        const message = messages().find((x) => x.role === "user" && x.id > messageID)
        if (!message) {
          void sdk.client.session.unrevert({
            sessionID: route.sessionID,
          })
          prompt?.set({ input: "", parts: [] })
          return
        }
        void sdk.client.session.revert({
          sessionID: route.sessionID,
          messageID: message.id,
        })
      },
    },
{
      title: "MarksCode: Vincular sessão a tarefa MAP",
      value: "session.map.start",
      category: "MarksCode",
      description: "Inicia vínculo MAP fail-open para a sessão atual.",
      slash: {
        name: "map-start-task",
      },
      run: async () => {
        await startMapTaskSession()
        dialog.clear()
      },
    },
    {
      title: sidebarVisible() ? "Hide MarksCode sidebar" : "Show MarksCode sidebar",
      value: "session.sidebar.toggle",
      category: "Session",
      run: () => {
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
      category: "Session",
      run: () => {
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
      run: () => {
        setTimestamps((prev) => (prev === "show" ? "hide" : "show"))
        dialog.clear()
      },
    },
    {
      title: (() => {
        const next = nextThinkingMode(thinkingMode())
        if (next === "hide") return "Collapse thinking"
        return "Expand thinking"
      })(),
      value: "session.toggle.thinking",
      category: "Session",
      slash: {
        name: "thinking",
        aliases: ["toggle-thinking"],
      },
      run: () => {
        thinking.set(nextThinkingMode(thinkingMode()))
        dialog.clear()
      },
    },
    {
      title: showDetails() ? "Hide tool details" : "Show tool details",
      value: "session.toggle.actions",
      category: "Session",
      run: () => {
        setShowDetails((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "Toggle session scrollbar",
      value: "session.toggle.scrollbar",
      category: "Session",
      run: () => {
        setShowScrollbar((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: showGenericToolOutput() ? "Hide generic tool output" : "Show generic tool output",
      value: "session.toggle.generic_tool_output",
      category: "Session",
      run: () => {
        setShowGenericToolOutput((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "Page up",
      value: "session.page.up",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(-scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Page down",
      value: "session.page.down",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Line up",
      value: "session.line.up",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(-1)
        dialog.clear()
      },
    },
    {
      title: "Line down",
      value: "session.line.down",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(1)
        dialog.clear()
      },
    },
    {
      title: "Half page up",
      value: "session.half.page.up",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(-scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "Half page down",
      value: "session.half.page.down",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "First message",
      value: "session.first",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollTo(0)
        dialog.clear()
      },
    },
    {
      title: "Last message",
      value: "session.last",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollTo(scroll.scrollHeight)
        dialog.clear()
      },
    },
    {
      title: "Jump to last user message",
      value: "session.messages_last_user",
      category: "Session",
      hidden: true,
      run: () => {
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
      category: "Session",
      hidden: true,
      run: () => scrollToMessage("next", dialog),
    },
    {
      title: "Previous message",
      value: "session.message.previous",
      category: "Session",
      hidden: true,
      run: () => scrollToMessage("prev", dialog),
    },
    {
      title: "Copy last assistant message",
      value: "messages.copy",
      category: "Session",
      run: () => {
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
      run: async () => {
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
              providers: sync.data.provider,
            },
          )
          await Clipboard.copy(transcript)
          toast.show({ message: "Session transcript copied to clipboard!", variant: "success" })
        } catch {
          toast.show({ message: "Failed to copy session transcript", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Export session transcript",
      value: "session.export",
      category: "Session",
      slash: {
        name: "export",
      },
      run: async () => {
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
              providers: sync.data.provider,
            },
          )

          if (options.openWithoutSaving) {
            // Just open in editor without saving
            await Editor.open({
              value: transcript,
              renderer,
              cwd:
                (project.instance.path().worktree === "/" ? undefined : project.instance.path().worktree) ||
                project.instance.directory() ||
                process.cwd(),
            })
          } else {
            const exportDir = process.cwd()
            const filename = options.filename.trim()
            const filepath = path.join(exportDir, filename)

            await Filesystem.write(filepath, transcript)

            // Open with EDITOR if available
            const result = await Editor.open({
              value: transcript,
              renderer,
              cwd:
                (project.instance.path().worktree === "/" ? undefined : project.instance.path().worktree) ||
                project.instance.directory() ||
                process.cwd(),
            })
            if (result !== undefined) {
              await Filesystem.write(filepath, result)
            }

            toast.show({ message: `Session exported to ${filename}`, variant: "success" })
          }
        } catch {
          toast.show({ message: "Failed to export session", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Go to child session",
      value: "session.child.first",
      category: "Session",
      hidden: true,
      run: () => {
        dialog.clear()
        moveFirstChild()
      },
    },
    {
      title: "Go to parent session",
      value: "session.parent",
      category: "Session",
      hidden: true,
      enabled: !!session()?.parentID,
      run: childSessionHandler(() => {
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
      category: "Session",
      hidden: true,
      enabled: !!session()?.parentID,
      run: childSessionHandler(() => {
        dialog.clear()
        moveChild(1)
      }),
    },
    {
      title: "Previous child session",
      value: "session.child.previous",
      category: "Session",
      hidden: true,
      enabled: !!session()?.parentID,
      run: childSessionHandler(() => {
        dialog.clear()
        moveChild(-1)
      }),
    },
    {
      title: "MarksCode: Buscar na Memória Local (Memvid)",
      name: "markscode.memories.search-local",
      category: "MarksCode",
      slashName: "memory-search-local",
      run: async () => {
        const searchQuery = await DialogPrompt.show(dialog, "Buscar na Memória Local (Memvid)", { placeholder: "Digite o contexto/prompt de busca local..." })
        if (!searchQuery) { dialog.clear(); return }
        try {
          const result = await recallHybridMemories({ user_id: memoriesUserID, session_id: route.sessionID || undefined, cue: searchQuery, provider: "local", limit: 10 })
          const rows = result.memories.map((memory) => "- " + (memory.title || memory.subject || "local") + ": " + memory.content.replace(/\s+/g, " ").trim().slice(0, 180))
          injectContext("[Memórias locais - Memvid]", ["- query: " + searchQuery, "- local_available: " + String(result.local_available), "", ...(rows.length ? rows : result.errors.map((error) => "- erro: " + error))])
          toast.show({ message: rows.length ? String(rows.length) + " memórias locais carregadas" : "Nenhuma memória local encontrada", variant: rows.length ? "success" : "warning" })
        } catch (err) {
          toast.show({ message: err instanceof Error ? err.message : "Erro ao buscar memória local", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Buscar na Memória Global",
      name: "markscode.memories.search-global",
      category: "MarksCode",
      slashName: "memory-search-global",
      run: async () => {
        const searchQuery = await DialogPrompt.show(dialog, "Buscar na Memória Global", { placeholder: "Digite o contexto/prompt de busca global..." })
        if (!searchQuery) { dialog.clear(); return }
        try {
          const global = await getGlobalContext({ user_id: memoriesUserID, session_id: route.sessionID || undefined, query: searchQuery, limit: 10 })
          const memories = Array.isArray(global?.memories) ? global.memories : []
          const rows = memories.map((memory) => "- " + (memory.title || memory.subject || "global") + ": " + String(memory.content || "").replace(/\s+/g, " ").trim().slice(0, 180))
          injectContext("[Memórias globais]", ["- query: " + searchQuery, "", ...(rows.length ? rows : ["Nenhuma memória global encontrada"])])
          toast.show({ message: rows.length ? String(rows.length) + " memórias globais carregadas" : "Nenhuma memória global encontrada", variant: rows.length ? "success" : "warning" })
        } catch (err) {
          toast.show({ message: err instanceof Error ? err.message : "Erro ao buscar memória global", variant: "error" })
        }
        dialog.clear()
      },
    },
{
      title: "MarksCode: Diagnóstico de memória (Memory Doctor)",
      name: "markscode.memories.doctor",
      category: "MarksCode",
      slashName: "memory-doctor",
      run: async () => {
        const lines: string[] = ["[Memory Doctor] - Diagnóstico BrainSystem"]

        await hydrateRemoteMemoryConfigFromActiveAccount()
        const status = (await hybridMemoryStatus().catch(() => ({}))) as Record<string, unknown>
        const localStatus = status.local && typeof status.local === "object" ? status.local as Record<string, unknown> : {}
        const sidecarPath = String(localStatus.cli || "")
        const sidecarOk = Boolean(status.local_available)
        const capsulePath = String(localStatus.capsule || status.capsule || "")
        const capsuleCount = Number.isFinite(localStatus.count) ? String(localStatus.count) : ""
        const sidecarReason = String(localStatus.reason || "")

        lines.push(
          sidecarOk
            ? "✅ Sidecar Memvid: " + sidecarPath + " (contract v1)"
            : "❌ Sidecar Memvid: " + (sidecarReason || "não encontrado"),
        )

        const capsuleExists = capsulePath && typeof Bun !== "undefined"
          ? await (async () => { try { const f = Bun.file(capsulePath); return (await f.exists()); } catch { return false } })()
          : false
        lines.push(
          capsuleExists
            ? "✅ Cápsula .mv2: " + capsulePath + (capsuleCount ? " (" + capsuleCount + " itens)" : "")
            : "❌ Cápsula .mv2: " + (capsulePath || "caminho desconhecido") + " (não encontrada)",
        )

        const memJson = await loadMemory().catch(() => ({}))
        const memJsonCount = Object.keys(memJson).length
        lines.push(
          memJsonCount > 0
            ? "✅ memories.json: " + memJsonCount + " assuntos"
            : "⚠️ memories.json: vazio ou ausente",
        )

        const cloudOk = Boolean(status.cloud_available)
        if (!cloudOk) {
          lines.push("❌ API remota: sem sessão/configuração Markspanel; faça login pelo fluxo OAuth/device")
        } else {
          const cloudTest = await recallHybridMemories({ cue: "test", provider: "cloud", limit: 1 }).catch(() => null)
          lines.push(
            cloudTest && !cloudTest.errors.some((e) => e.startsWith("cloud:"))
              ? "✅ API remota: acessível"
              : "⚠️ API remota: sessão/configuração Markspanel não respondeu",
          )
        }

        const memoryMdPath = process.cwd() + "/MEMORY.md"
        const memoryMdExists = await (async () => { try { return await Bun.file(memoryMdPath).exists(); } catch { return false } })()
        lines.push(
          memoryMdExists
            ? "✅ MEMORY.md: encontrado em " + memoryMdPath
            : "❌ MEMORY.md: não encontrado no projeto",
        )

        const kvLocal = kv.get("memories_hybrid_local_available")
        lines.push(
          String(kvLocal) === "1"
            ? "✅ KV Plugin: local=ok"
            : "⚠️ KV Plugin: local=" + String(kvLocal || "não definido"),
        )

        const sessionID = route.sessionID
        lines.push(
          sessionID
            ? "✅ Session ID: " + sessionID
            : "❌ Session ID: não encontrado",
        )

        lines.push(
          autoHandoffEnabled
            ? "✅ Auto-handoff: ativo"
            : "⚠️ Auto-handoff: inativo (MEMORIES_AUTO_HANDOFF_ENABLED=0)",
        )

        lines.push(
          isBrainEnabled()
            ? "✅ BrainSystem: ativo"
            : "⚠️ BrainSystem: não configurado (requer conta Markspanel)",
        )

        kv.set("memories_hybrid_local_available", sidecarOk ? "1" : "0")
        kv.set("memories_hybrid_local_count", capsuleCount)
        kv.set("memories_hybrid_local_reason", sidecarReason)
        kv.set("memories_hybrid_capsule", capsulePath)

        injectContext("[Memory Doctor]", lines)
        toast.show({ message: "Memory Doctor executado — diagnóstico injetado no prompt", variant: "success", duration: 8000 })
        dialog.clear()
      },
    },
    // MARKSCODE_MAP_COMMANDS_START
    {
      title: "MarksCode: Vincular projeto MAP",
      name: "markscode.map.bind-project",
      category: "MarksCode",
      slashName: "map-bind-project",
      run: async () => {
        await debugUiLog("map:command", { command: "map-bind-project", sessionID: route.sessionID })
        try {
          const binding: any = await chooseMapProject(dialog)
          if (binding?.project_name || binding?.project_slug) {
            toast.show({ message: "Projeto MAP vinculado: " + String(binding.project_name || binding.project_slug), variant: "success", duration: 6500 })
          }
        } catch (err) {
          await debugUiLog("map:choose-project:error", { sessionID: route.sessionID, message: err instanceof Error ? err.message : String(err) })
          toast.show({ message: err instanceof Error ? err.message : "Erro ao vincular projeto MAP", variant: "error", duration: 9000 })
        }
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Vincular módulo MAP",
      name: "markscode.map.bind-module",
      category: "MarksCode",
      slashName: "map-bind-module",
      run: async () => {
        await debugUiLog("map:command", { command: "map-bind-module", sessionID: route.sessionID })
        try {
          const binding: any = await chooseMapModule(dialog)
          if (binding?.module_name || binding?.module_slug) {
            toast.show({ message: "Módulo MAP vinculado: " + String(binding.module_name || binding.module_slug), variant: "success", duration: 6500 })
          }
        } catch (err) {
          await debugUiLog("map:choose-module:error", { sessionID: route.sessionID, message: err instanceof Error ? err.message : String(err) })
          toast.show({ message: err instanceof Error ? err.message : "Erro ao vincular módulo MAP", variant: "error", duration: 9000 })
        }
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Criar/vincular task MAP",
      name: "markscode.map.bind-task",
      category: "MarksCode",
      slashName: "map-bind-task",
      run: async () => {
        await debugUiLog("map:command", { command: "map-bind-task", sessionID: route.sessionID })
        try {
          const binding: any = await chooseOrCreateMapTask(dialog)
          if (binding?.task_title || binding?.task_id) {
            toast.show({ message: "Task MAP vinculada: " + String(binding.task_title || binding.task_id), variant: "success", duration: 6500 })
          }
        } catch (err) {
          await debugUiLog("map:choose-task:error", { sessionID: route.sessionID, message: err instanceof Error ? err.message : String(err) })
          toast.show({ message: err instanceof Error ? err.message : "Erro ao vincular task MAP", variant: "error", duration: 9000 })
        }
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Recarregar contexto MAP",
      name: "markscode.map.reload-context",
      category: "MarksCode",
      slashName: "map-context-reload",
      run: async () => {
        await debugUiLog("map:command", { command: "map-context-reload", sessionID: route.sessionID })
        try {
          await reloadMapContext()
          toast.show({ message: "Contexto MAP carregado", variant: "success", duration: 6500 })
        } catch (err) {
          await debugUiLog("map:context-reload:error", { sessionID: route.sessionID, message: err instanceof Error ? err.message : String(err) })
          toast.show({ message: err instanceof Error ? err.message : "Erro ao carregar contexto MAP", variant: "error", duration: 9000 })
        }
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Iniciar sessão MAP",
      name: "markscode.map.session-start",
      category: "MarksCode",
      slashName: "map-session-start",
      run: async () => {
        await debugUiLog("map:command", { command: "map-session-start", sessionID: route.sessionID })
        try {
          const binding: any = await startMapTaskSession()
          if (binding?.task_title || binding?.task_id) {
            toast.show({ message: "Sessão MAP iniciada: " + String(binding.task_title || binding.task_id), variant: "success", duration: 7000 })
          }
        } catch (err) {
          await debugUiLog("map:session-start:error", { sessionID: route.sessionID, message: err instanceof Error ? err.message : String(err) })
          toast.show({ message: err instanceof Error ? err.message : "Erro ao iniciar sessão MAP", variant: "error", duration: 9000 })
        }
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Registrar progresso MAP",
      name: "markscode.map.session-progress",
      category: "MarksCode",
      slashName: "map-session-progress",
      run: async () => {
        await debugUiLog("map:command", { command: "map-session-progress", sessionID: route.sessionID })
        try {
          const binding: any = await progressMapTaskSession(dialog)
          if (binding?.task_title || binding?.task_id) {
            toast.show({ message: "Progresso MAP registrado", variant: "success", duration: 7000 })
          }
        } catch (err) {
          await debugUiLog("map:session-progress:error", { sessionID: route.sessionID, message: err instanceof Error ? err.message : String(err) })
          toast.show({ message: err instanceof Error ? err.message : "Erro ao registrar progresso MAP", variant: "error", duration: 9000 })
        }
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Encerrar sessão MAP",
      name: "markscode.map.session-end",
      category: "MarksCode",
      slashName: "map-session-end",
      run: async () => {
        await debugUiLog("map:command", { command: "map-session-end", sessionID: route.sessionID })
        try {
          const binding: any = await endMapTaskSession(dialog)
          if (binding?.task_title || binding?.task_id) {
            toast.show({ message: "Sessão MAP encerrada", variant: "success", duration: 7000 })
          }
        } catch (err) {
          await debugUiLog("map:session-end:error", { sessionID: route.sessionID, message: err instanceof Error ? err.message : String(err) })
          toast.show({ message: err instanceof Error ? err.message : "Erro ao encerrar sessão MAP", variant: "error", duration: 9000 })
        }
        dialog.clear()
      },
    },
    // MARKSCODE_MAP_COMMANDS_END
{
      title: "MarksCode: Assuntos recentes (Memvid/BrainSystem)",
      name: "markscode.memories.recent-topics",
      category: "MarksCode",
      slashName: "memory-recent-topics",
      run: () => {
        dialog.replace(() => (
          <DialogRecentTopics
            userID={memoriesUserID}
            sessionID={route.sessionID || undefined}
            onSelect={(topic) => {
              const detail = [topic.topic, topic.content_preview].filter(Boolean).join(" — ")
              injectContext("[Assunto recente - Memvid/BrainSystem]", ["[" + topic.source + "] " + detail])
              toast.show({ message: "Assunto recente inserido no prompt", variant: "success", duration: 6500 })
            }}
          />
        ))
      },
    },
{
      title: "MarksCode: Salvar Human Memory manual",
      name: "markscode.memories.save-human",
      category: "MarksCode",
      slashName: "memory-save-human",
      run: async () => {
        await saveSessionMemory("manual")
          .then((ok) => {
            if (!ok) {
              toast.show({ message: "Sem conversa para salvar", variant: "warning", duration: 6500 })
              return
            }
            toast.show({ message: "Human Memory salva", variant: "success", duration: 6000 })
          })
          .catch((err) => {
            toast.show({ message: err instanceof Error ? err.message : "Erro ao salvar Human Memory", variant: "error", duration: 9000 })
          })
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Testar auto-handoff de contexto",
      name: "markscode.memories.test-auto-handoff",
      category: "MarksCode",
      slashName: "memory-test-auto-handoff",
      run: async () => {
        const targetSessionID = route.sessionID
        if (!targetSessionID) {
          toast.show({ message: "Abra uma sessão primeiro", variant: "warning" })
          dialog.clear()
          return
        }
        try {
          await recoverFromContextOverflow(targetSessionID, { force: true })
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to test auto-handoff"
          await debugMemoryLog("recover:test-command:error", { sessionID: targetSessionID, message })
          toast.show({ message: "Auto-handoff falhou: " + message, variant: "error", duration: 15000 })
        }
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Buscar na Memória (todos os endpoints)",
      name: "markscode.memories.search",
      category: "MarksCode",
      slashName: "memory-search",
      run: async () => {
        const searchQuery = await DialogPrompt.show(dialog, "Buscar na Memória", {
          placeholder: "Digite o contexto/prompt de busca...",
        })
        if (!searchQuery) {
          dialog.clear()
          return
        }
        try {
          const targetSessionID = route.sessionID
          const user = memoriesUserID
          const search = await searchAdvancedMemories({
            user_id: user,
            session_id: targetSessionID || undefined,
            query: searchQuery,
            fuzzy: true,
            limit: 10,
          })
          const fromSearch = Array.isArray(search?.memories) ? search.memories : []

          let ctxRows = fromSearch
          if (!ctxRows.length) {
            const global = await getGlobalContext({
              user_id: user,
              session_id: targetSessionID || undefined,
              query: searchQuery,
              limit: 10,
            })
            ctxRows = Array.isArray(global?.memories) ? global.memories : []
          }

          if (!ctxRows.length) {
            toast.show({ message: "Nenhuma memória encontrada", variant: "warning" })
            dialog.clear()
            return
          }

          const rows = ctxRows
            .slice(0, 10)
            .map((x) => {
              const head = x.title || x.subject || "sem titulo"
              const body = String(x.content || "").replace(/\s+/g, " ").trim().slice(0, 180)
              return "- " + head + ": " + body
            })

          injectContext(
            "[Memórias - Contexto de busca API]",
            [
              "- query: " + searchQuery,
              "- user_id: " + user,
              "- session_id: " + (targetSessionID || "(global)"),
              "- total: " + String(rows.length),
              "",
              ...rows,
            ],
          )
          toast.show({ message: String(rows.length) + " memórias carregadas no contexto", variant: "success" })
        } catch (err) {
          toast.show({ message: err instanceof Error ? err.message : "Erro ao buscar memórias", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Repair BrainSystem",
      name: "markscode.memories.repair",
      category: "MarksCode",
      slashName: "memory-repair",
      run: async () => {
        const projectRoot = process.cwd()
        await hydrateRemoteMemoryConfigFromActiveAccount()
        const status = (await hybridMemoryStatus().catch(() => ({}))) as Record<string, unknown>
        const local = status.local && typeof status.local === "object" ? status.local as Record<string, unknown> : {}
        const capsulePath = String(local.capsule || status.capsule || process.env.MARKSCODE_MEMVID_CAPSULE || "")
        const diagnosis = diagnoseBrainSystem({
          capsulePath: capsulePath || undefined,
          projectRoot,
          sessionDbPath: Database.getPath(),
        })
        const memoryLayer = diagnosis.layers.find((layer) => layer.layer === "Memory MD")
        const projectTasksLayer = diagnosis.layers.find((layer) => layer.layer === "Project Tasks")
        const memvidLayer = diagnosis.layers.find((layer) => layer.layer === "Cápsula Memvid")
        const memoryMissing = memoryLayer?.status !== "ok"
        const projectTasksMissing = projectTasksLayer?.status !== "ok"
        const memvidNeedsRepair = memvidLayer?.status !== "ok"
        const options: DialogSelectOption<string>[] = [
          {
            title: memoryMissing ? "Gerar MEMORY.md template" : "MEMORY.md já presente",
            value: "memory-md",
            description: memoryLayer?.details || "Verificar MEMORY.md do projeto",
            disabled: !memoryMissing,
          },
          {
            title: projectTasksMissing ? "Criar estrutura .tasks" : "Reparar estrutura .tasks",
            value: "project-tasks",
            description: projectTasksLayer?.details || "Criar/validar .tasks/index.md, template.md e README.md",
          },
          {
            title: memvidNeedsRepair ? "Inicializar/buildar cápsula Memvid" : "Cápsula Memvid ok",
            value: "memvid",
            description: memvidLayer?.details || "Verificar capsule Memvid local",
            disabled: !memvidNeedsRepair,
          },
          {
            title: "Inserir plano/diagnóstico no prompt",
            value: "inject-report",
            description: "Adiciona relatório BrainSystem e próximos passos ao prompt atual",
          },
          {
            title: "Atualizar status da sidebar",
            value: "refresh",
            description: "Reexecuta status híbrido e diagnóstico BrainSystem",
          },
        ]
        const choose = await new Promise<string | undefined>((resolve) => {
          dialog.replace(
            () => (
              <DialogSelect
                title="Repair BrainSystem"
                placeholder="Escolha uma ação segura..."
                options={options}
                onSelect={(option) => resolve(option.value)}
              />
            ),
            () => resolve(undefined),
          )
        })
        if (!choose) {
          dialog.clear()
          return
        }
        if (choose === "memory-md") {
          const fs = await import("fs")
          const pathMod = await import("path")
          const ensureProjectTasks = () => {
            const tasksDir = pathMod.join(projectRoot, ".tasks")
            const projectName = pathMod.basename(projectRoot)
            fs.mkdirSync(tasksDir, { recursive: true })
            const files = [
              { path: pathMod.join(tasksDir, "README.md"), content: ["# .tasks — Local execution ledger", "", "This directory stores local summaries of orchestrator and subagent task executions for this project.", "", "## Purpose", "- Keep sequential task execution notes and summaries.", "- Reduce token repetition by referencing prior prompts, results, validations, and follow-ups.", "- Organize complex project execution across orchestrator/subagent waves.", "", "## Safety", "- Do not store secrets, credentials, private keys, tokens, or sensitive customer data.", "- Summarize prompts/results instead of copying full confidential content.", ""].join("\n") },
              { path: pathMod.join(tasksDir, "index.md"), content: ["# Tasks Index — " + projectName, "", "Generated: " + new Date().toISOString(), "", "## Active", "- ", "", "## Recent Executions", "- ", "", "## Decisions", "- ", "", "## Backlog", "- ", "", "## Done", "- ", ""].join("\n") },
              { path: pathMod.join(tasksDir, "template.md"), content: ["# Task: <title>", "", "## Goal", "- ", "", "## Context", "- ", "", "## Subagent/Wave", "- ", "", "## Steps", "1. ", "", "## Validation", "- ", "", "## Summary", "- ", "", "## Follow-ups", "- ", ""].join("\n") },
            ]
            const created = files.filter((file) => !fs.existsSync(file.path)).map((file) => {
              fs.writeFileSync(file.path, file.content, { encoding: "utf8", flag: "wx" })
              return file.path
            })
            return { tasksDir, created }
          }
          const target = pathMod.join(projectRoot, "MEMORY.md")
          const exists = fs.existsSync(target)
          if (exists) {
            const force = await DialogConfirm.show(dialog, "MEMORY.md já existe", "O arquivo já existe. Sobrescrever template? Esta ação pode substituir contexto do projeto.")
            if (!force) {
              dialog.clear()
              return
            }
          } else {
            const ok = await DialogConfirm.show(dialog, "Gerar MEMORY.md", "Criar template em " + target + "?")
            if (!ok) {
              dialog.clear()
              return
            }
          }
          const projectName = pathMod.basename(projectRoot)
          const template = [
            "# MEMORY.md — " + projectName,
            "",
            "Generated: " + new Date().toISOString(),
            "",
            "## Overview",
            "- Descreva o objetivo do projeto e o contexto persistente essencial.",
            "",
            "## Architecture",
            "- Registre módulos, integrações e decisões arquiteturais importantes.",
            "",
            "## Commands",
            "- Typecheck: bun typecheck",
            "- Tests: descreva os testes relevantes do projeto.",
            "- Build: descreva o comando de build/deploy aplicável.",
            "",
            "## Memory Notes",
            "- Adicione fatos persistentes que devem sobreviver entre sessões.",
            "",
            "## Project Tasks Ledger",
            "- Use '.tasks/' como ledger local de execuções do orquestrador/subagentes, resumos de prompts/resultados, validações e follow-ups.",
            "- Não armazene segredos em '.tasks/'.",
            "",
            "## Open Questions",
            "- Liste dúvidas, riscos ou decisões pendentes.",
            "",
          ].join("\n")
          fs.writeFileSync(target, template, { encoding: "utf8", flag: "w" })
          const tasksResult = ensureProjectTasks()
          await refreshHybridMemoryStatus().catch(() => undefined)
          await DialogAlert.show(dialog, "MEMORY.md gerado", "Arquivo criado/atualizado em " + target + "\n.tasks: " + tasksResult.tasksDir + "\nArquivos .tasks criados: " + (tasksResult.created.length ? tasksResult.created.join(", ") : "nenhum; existentes preservados"))
          dialog.clear()
          return
        }
        if (choose === "project-tasks") {
          const fs = await import("fs")
          const pathMod = await import("path")
          const ok = await DialogConfirm.show(dialog, "Criar estrutura .tasks", "Criar/reparar .tasks em " + pathMod.join(projectRoot, ".tasks") + " sem sobrescrever arquivos existentes?")
          if (!ok) {
            dialog.clear()
            return
          }
          const tasksDir = pathMod.join(projectRoot, ".tasks")
          const projectName = pathMod.basename(projectRoot)
          fs.mkdirSync(tasksDir, { recursive: true })
          const files = [
            { path: pathMod.join(tasksDir, "README.md"), content: ["# .tasks — Local execution ledger", "", "This directory stores local summaries of orchestrator and subagent task executions for this project.", "", "## Purpose", "- Keep sequential task execution notes and summaries.", "- Reduce token repetition by referencing prior prompts, results, validations, and follow-ups.", "- Organize complex project execution across orchestrator/subagent waves.", "", "## Safety", "- Do not store secrets, credentials, private keys, tokens, or sensitive customer data.", "- Summarize prompts/results instead of copying full confidential content.", ""].join("\n") },
            { path: pathMod.join(tasksDir, "index.md"), content: ["# Tasks Index — " + projectName, "", "Generated: " + new Date().toISOString(), "", "## Active", "- ", "", "## Recent Executions", "- ", "", "## Decisions", "- ", "", "## Backlog", "- ", "", "## Done", "- ", ""].join("\n") },
            { path: pathMod.join(tasksDir, "template.md"), content: ["# Task: <title>", "", "## Goal", "- ", "", "## Context", "- ", "", "## Subagent/Wave", "- ", "", "## Steps", "1. ", "", "## Validation", "- ", "", "## Summary", "- ", "", "## Follow-ups", "- ", ""].join("\n") },
          ]
          const created = files.filter((file) => !fs.existsSync(file.path)).map((file) => {
            fs.writeFileSync(file.path, file.content, { encoding: "utf8", flag: "wx" })
            return file.path
          })
          await refreshHybridMemoryStatus().catch(() => undefined)
          await DialogAlert.show(dialog, ".tasks verificado", "Diretório: " + tasksDir + "\nArquivos criados: " + (created.length ? created.join(", ") : "nenhum; existentes preservados"))
          dialog.clear()
          return
        }
        if (choose === "memvid") {
          const ok = await DialogConfirm.show(dialog, "Build Memvid", "Gerar/atualizar cápsula Memvid local" + (capsulePath ? " em " + capsulePath : "") + "? A operação escreve arquivos locais de memória, sem segredos em texto puro.")
          if (!ok) {
            dialog.clear()
            return
          }
          try {
            const ensure = ensureMemvidCapsule({
              capsule: capsulePath || undefined,
              projectRoot,
            })
            const result = await ingestHybridMemories({
              user_id: memoriesUserID,
              session_id: route.sessionID || undefined,
              source: "all",
              limit: 500,
              write_memvid: true,
              capsule: capsulePath || undefined,
            })
            await refreshHybridMemoryStatus().catch(() => undefined)
            const memvid = result.memvid && typeof result.memvid === "object" ? result.memvid as Record<string, unknown> : {}
            const partial = ensure.status === "fallback" || memvid.method === "jsonl-export"
            await DialogAlert.show(dialog, partial ? "Memvid repair parcial concluído" : "Memvid repair concluído", "Ensure status: " + ensure.status + "\nEnsure aviso: " + String(ensure.warning || "nenhum") + "\nEnsure export_path: " + String(ensure.export_path || "nenhum") + "\nEnsure reason: " + String(ensure.reason || "nenhum") + "\nItens analisados: " + String(result.count || 0) + "\nEscritos: " + String(memvid.written ?? memvid.item_count ?? 0) + "\nFallback export_path: " + String(memvid.export_path || "nenhum") + "\nAvisos: " + String((result.warnings || []).join("; ") || "nenhum") + "\nErros: " + String((result.errors || []).join("; ") || "nenhum"))
          } catch (err) {
            await DialogAlert.show(dialog, "Memvid repair falhou", err instanceof Error ? err.message : String(err))
          }
          dialog.clear()
          return
        }
        if (choose === "inject-report") {
          injectContext("[BrainSystem repair plan]", [
            "overall: " + diagnosis.overall,
            ...diagnosis.layers.flatMap((layer) => ["- " + layer.layer + ": " + layer.status + " — " + layer.details, layer.recommendation ? "  recomendação: " + layer.recommendation : ""].filter(Boolean)),
            "",
            "Plano seguro:",
            "1. Criar MEMORY.md se ausente e preparar .tasks/ como ledger local, sem sobrescrever sem confirmação.",
            "2. Criar/reparar .tasks/index.md, .tasks/template.md e .tasks/README.md preservando arquivos existentes.",
            "3. Buildar capsule Memvid com write_memvid via API híbrida após confirmação.",
            "4. Atualizar status BrainSystem/sidebar e revisar avisos restantes.",
          ])
          toast.show({ message: "Plano BrainSystem inserido no prompt", variant: "success" })
          dialog.clear()
          return
        }
        await refreshHybridMemoryStatus().catch(() => undefined)
        await DialogAlert.show(dialog, "BrainSystem atualizado", "Status híbrido e diagnóstico BrainSystem foram atualizados.")
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Inserir assuntos recentes no prompt",
      name: "markscode.memories.recent-topics-insert",
      category: "MarksCode",
      slashName: "memory-recent-topics-insert",
      run: async () => {
        try {
          const result = await listHybridRecentTopics({ user_id: memoriesUserID, session_id: route.sessionID || undefined, limit: 12, provider: "hybrid" })
          const rows = result.topics.map((topic, index) => String(index + 1) + ". [" + topic.source + "] " + topic.topic + (topic.content_preview ? " — " + topic.content_preview : ""))
          injectContext("[Assuntos recentes - Memvid/BrainSystem]", rows.length ? rows : ["Nenhum assunto recente retornado. Status: " + JSON.stringify(result.sources)])
          toast.show({ message: "Assuntos recentes carregados no prompt", variant: "success" })
        } catch (err) {
          toast.show({ message: err instanceof Error ? err.message : "Erro ao listar assuntos recentes", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Validar BrainSystem",
      name: "markscode.brain.validate",
      category: "MarksCode",
      slashName: "brain-validate",
      run: async () => {
        toast.show({ message: "Validando BrainSystem...", variant: "info" })
        try {
          await hydrateRemoteMemoryConfigFromActiveAccount()
          const status = (await hybridMemoryStatus().catch(() => ({}))) as Record<string, unknown>
          const localStatus = status.local && typeof status.local === "object" ? status.local as Record<string, unknown> : {}
          const capsulePath = String(localStatus.capsule || status.capsule || "")
          const diagnosis = diagnoseBrainSystem({ capsulePath, projectRoot: process.cwd(), sessionDbPath: Database.getPath() })
          const tokenResult = await resolveBrainValidationToken()
          const sessionID = route.sessionID || undefined
          const lines: string[] = [
            "[Brain Validate Report]",
            "timestamp: " + new Date().toISOString(),
            "project_root: " + process.cwd(),
            "session_id: " + String(sessionID || ""),
            "user_id: " + memoriesUserID,
            "brain_enabled: " + String(isBrainEnabled()),
            "token_source: " + tokenResult.source,
            "",
            "layers:",
          ]
          const layerOrder = [
            ["Graphfy", /graphfy/i],
            ["Cápsula", /cápsula|capsula|memvid/i],
            ["Memory MD", /memory md/i],
            ["Project Tasks", /project tasks/i],
            ["Session DB", /session db/i],
            ["Memória Remota/Remote", /memória remota|remote/i],
            ["Compactação", /compactação|compactacao/i],
            ["Hand-off", /hand-off|handoff/i],
          ] as const
          layerOrder.forEach((entry, index) => {
            const layer = diagnosis.layers.find((item) => entry[1].test(item.layer))
            lines.push("Camada " + String(index + 1) + ": " + entry[0] + ": " + String(layer?.status || "unavailable") + " — " + String(layer?.details || "não retornado"))
          })
          lines.push("", "checks:")

          const dryRun = await runBrainIngestor({
            token: tokenResult.token,
            user_id: memoriesUserID,
            session_id: sessionID,
            sources: ["md", "sessions", "graphfy"],
            dry_run: true,
          }).catch((err) => ({ ok: false, sources_collected: [], total_items: 0, errors: [err instanceof Error ? err.message : String(err)] }))
          lines.push("brain_ingest_dry_run: " + (dryRun.ok ? "ok" : "fail") + " — total_items=" + String(dryRun.total_items) + "; sources=" + dryRun.sources_collected.join(",") + "; errors=" + dryRun.errors.join(" | "))

          if (!isBrainEnabled() || !tokenResult.token) {
            const reason = !isBrainEnabled() ? "brain disabled" : "missing token"
            lines.push("brain_status: skipped — " + reason)
            lines.push("brain_recall: skipped — " + reason)
            lines.push("brain_graph_query: skipped — " + reason)
            lines.push("brain_graph_artifact: skipped — " + reason)
          } else {
            const statusCheck = await brainStatus(tokenResult.token).catch((err) => ({ ok: false, brain: null, error: err instanceof Error ? err.message : String(err) }))
            lines.push("brain_status: " + (statusCheck.ok ? "ok" : "fail") + " — " + (statusCheck.error || "status retornado"))
            const recallCheck = await brainRecall(tokenResult.token, { q: "BrainSystem", user_id: memoriesUserID, session_id: sessionID, limit: 3 }).catch((err) => ({ ok: false, items: [], sources: {}, error: err instanceof Error ? err.message : String(err) }))
            lines.push("brain_recall: " + (recallCheck.ok ? "ok" : "fail") + " — items=" + String(recallCheck.items?.length || 0) + (recallCheck.error ? "; error=" + recallCheck.error : ""))
            const graphCheck = await brainGraphQuery(tokenResult.token, { q: "BrainSystem", user_id: memoriesUserID, session_id: sessionID, limit: 3 }).catch((err) => ({ ok: false, items: [], error: err instanceof Error ? err.message : String(err) }))
            lines.push("brain_graph_query: " + (graphCheck.ok ? "ok" : "fail") + " — items=" + String(graphCheck.items?.length || 0) + (graphCheck.error ? "; error=" + graphCheck.error : ""))
            const artifactCheck = await brainGraphArtifact(tokenResult.token).catch((err) => ({ ok: false, artifact: null, error: err instanceof Error ? err.message : String(err) }))
            const artifactItems = Array.isArray(artifactCheck.artifact?.items) ? artifactCheck.artifact.items.length : Array.isArray(artifactCheck.artifact?.nodes) ? artifactCheck.artifact.nodes.length : 0
            lines.push("brain_graph_artifact: " + (artifactCheck.ok ? "ok" : "fail") + " — items=" + String(artifactItems) + (artifactCheck.error ? "; error=" + artifactCheck.error : ""))
          }

          injectContext("[Brain Validate Report]", lines)
          toast.show({ message: "BrainSystem validado", variant: "success", duration: 8000 })
        } catch (err) {
          toast.show({ message: err instanceof Error ? err.message : "Erro ao validar BrainSystem", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Graphfy: Gerar grafo do diretório atual",
      name: "markscode.graphfy.extract",
      category: "MarksCode",
      slashName: "graphfy-extract",
      run: async () => {
        const root = process.cwd()
        toast.show({ message: "Graphfy: gerando grafo em " + root + "...", variant: "info", duration: 600000 })
        try {
          const result = await graphfyExtract(root)
          if (result.success) {
            toast.show({ message: "Graphfy gerado com sucesso em " + root, variant: "success", duration: 8000 })
            await refreshHybridMemoryStatus().catch(() => undefined)
          } else {
            toast.show({ message: result.step === "detect_cli" ? result.message + " Tente /brain-validate." : result.message, variant: result.step === "detect_cli" ? "warning" : "error", duration: 10000 })
          }
        } catch (err) {
          toast.show({ message: err instanceof Error ? err.message : "Erro ao gerar Graphfy", variant: "error", duration: 10000 })
        }
        dialog.clear()
      },
    },
    {
      title: "MarksCode: Ingestão BrainSystem",
      name: "markscode.brain.ingest",
      category: "MarksCode",
      slashName: "brain-ingest",
      run: async () => {
        toast.show({ message: "Iniciando ingestão BrainSystem...", variant: "info" })
        try {
          const token = String(process.env.MARKSCODE_BRAIN_TOKEN || process.env.BRAIN_TOKEN || "")
          const result = await runBrainIngestor({
            token,
            user_id: memoriesUserID,
            session_id: route.sessionID || undefined,
          })
          if (result.ok) {
            toast.show({ message: "BrainSystem: " + String(result.ingested ?? result.total_items) + " itens ingeridos de " + result.sources_collected.join(", "), variant: "success", duration: 8000 })
          } else {
            toast.show({ message: "BrainSystem erro: " + (result.errors[0] || "falha desconhecida"), variant: "error", duration: 8000 })
          }
        } catch (err) {
          toast.show({ message: err instanceof Error ? err.message : "Erro ao executar brain-ingest", variant: "error" })
        }
        dialog.clear()
      },
    },
// MARKSCODE_MEMORIES_COMMANDS_END
    {
      title: "MarksCode: Login Markspanel",
      name: "markscode.markspanel.login",
      category: "MarksCode",
      slashName: "markspanel-login",
      run: async () => {
        await showMarkspanelLoginDialog()
      },
    },
    // MARKSCODE_REMOTE_SSH_COMMANDS_START
    {
      title: "Modo remoto: gerenciar perfis",
      name: "markscode.remote-ssh.profile.manage",
      category: "MarksCode",
      slashName: "remote-ssh-profiles",
      run: async () => {
        await showRemoteSSHProfilesDialog()
      },
    },
    // MARKSCODE_REMOTE_SSH_COMMANDS_END
  ])

  const sessionCommands = createMemo(() =>
    sessionCommandList().map((command) => ({
      namespace: "palette",
      name: command.value,
      desc: "description" in command ? command.description : undefined,
      slashName: "slash" in command ? command.slash?.name : undefined,
      slashAliases: "slash" in command ? command.slash?.aliases : undefined,
      ...command,
    })),
  )

  useBindings(() => ({
    commands: sessionCommands(),
  }))

  useBindings(() => ({
    bindings: tuiConfig.keybinds.gather("session.global", sessionGlobalBindingCommands),
  }))

  useBindings(() => ({
    enabled: () => renderer.currentFocusedEditor === null,
    bindings: tuiConfig.keybinds.gather("session.global.unfocused", sessionGlobalUnfocusedBindingCommands),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    bindings: tuiConfig.keybinds.gather("session", sessionBindingCommands),
  }))

  const revertInfo = createMemo(() => session()?.revert)
  const revertMessageID = createMemo(() => revertInfo()?.messageID)

  const revertDiffFiles = createMemo(() => getRevertDiffFiles(revertInfo()?.diff ?? ""))

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

  const marksTtsSpokenMessageIDs = new Set<string>()
  const marksTtsStreamedTextByMessageID = new Map<string, string>()
  const marksTtsStreamIndexByMessageID = new Map<string, number>()
  const marksTtsStreamLastSpokenAtByMessageID = new Map<string, number>()

  // snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))
  createEffect(
    on(
      () => {
        const list = messages()
        const last = list.at(-1)
        return [route.sessionID, list.length, last?.id, last?.time && "completed" in last.time ? last.time.completed : undefined] as const
      },
      () => toBottom(),
    ),
  )
  createEffect(
    on(
      () => {
        const list = messages()
        const last = list.at(-1)
        const messageID = last?.role === "assistant" && !last.time.completed ? last.id : undefined
        return [route.sessionID, messageID, messageID ? marksTtsStreamableTextFromMessage(messageID) : ""] as const
      },
      ([, messageID, text]) => {
        if (!kv.get(MARKSCODE_TTS_VOICE_MODE, false)) return
        if (!marksTtsStreamingEnabled()) return
        if (!messageID || !text) return
        const spoken = marksTtsStreamedTextByMessageID.get(messageID) || ""
        if (spoken && !text.startsWith(spoken)) return
        if (text.length <= spoken.length) return
        const next = text.slice(spoken.length).trim()
        if (!next) return
        const now = Date.now()
        const interval = Math.max(1, Number(kv.get("markscode_tts_stream_interval_ms", process.env.MARKSCODE_TTS_STREAM_INTERVAL_MS ?? 15000)) || 15000)
        if (now - (marksTtsStreamLastSpokenAtByMessageID.get(messageID) || 0) < interval) return
        const index = (marksTtsStreamIndexByMessageID.get(messageID) || 0) + 1
        marksTtsStreamIndexByMessageID.set(messageID, index)
        marksTtsStreamedTextByMessageID.set(messageID, text)
        marksTtsStreamLastSpokenAtByMessageID.set(messageID, now)
        runMarksTts(`${messageID}-stream-${index}`, next)
      },
    ),
  )
  createEffect(
    on(
      () => {
        const list = messages()
        const last = list.at(-1)
        return [route.sessionID, last?.id, last?.role, last?.time && "completed" in last.time ? last.time.completed : undefined] as const
      },
      ([, messageID, role, completed]) => {
        if (!kv.get(MARKSCODE_TTS_VOICE_MODE, false)) return
        if (!messageID || role !== "assistant" || !completed) return
        if (marksTtsSpokenMessageIDs.has(messageID)) return
        const text = marksTtsTextFromMessage(messageID)
        if (!text) return
        const streamed = marksTtsStreamedTextByMessageID.get(messageID) || ""
        const remaining = streamed && text.startsWith(streamed) ? text.slice(streamed.length).trim() : text
        if (!remaining) {
          marksTtsSpokenMessageIDs.add(messageID)
          return
        }
        marksTtsSpokenMessageIDs.add(messageID)
        runMarksTts(messageID, remaining)
      },
    ),
  )
  createEffect(
    on(
      () => route.sessionID,
      (sessionID) => {
        if (!sessionID) return
        void autoMapSessionCheckpoint(sessionID)
      },
    ),
  )
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
        void ensureHumanMemoryLayers({ user_id: memoriesUserID, session_id: sessionID, source_name: "markscode" }).catch((error) => {
          if (MARKSCODE_DEBUG_UI) console.error("memory layer bootstrap failed", error instanceof Error ? error.message : String(error))
        })
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
              if (ok) toast.show({ message: "Human memory auto-saved", variant: "success", duration: 6000 })
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
      toast.show({ message: "Failed to recover from context overflow", variant: "error", duration: 9000 })
    })
  })
  // MARKSCODE_MEMORIES_OVERFLOW_END

  // MARKSCODE_QUOTA_WARNING_START
  const markspanelQuotaWarningMessageIDs = new Set<string>()

  createEffect(() => {
    const list = messages()
    const candidate = [...list].reverse().find((item) => item.role === "assistant" && item.error)
    if (!candidate) return
    if (markspanelQuotaWarningMessageIDs.has(candidate.id)) return

    const errorText = errorTextFromMessage(candidate)
    if (!errorText) return

    if (!isMarkspanelQuotaError(errorText)) return

    markspanelQuotaWarningMessageIDs.add(candidate.id)
    toast.show({
      message:
        "⚠️ Limite de tokens Markspanel atingido ou quota excedida. Aguarde a renovação mensal ou faça upgrade do plano.",
      variant: "warning",
      duration: 12000,
    })
  })
  // MARKSCODE_QUOTA_WARNING_END

  return (
    <PathFormatterProvider path={session()?.directory}>
      <context.Provider
        value={{
          get width() {
            return contentWidth()
          },
          sessionID: route.sessionID,
          conceal,
          thinkingMode,
          showThinking,
          showTimestamps,
          showDetails,
          showGenericToolOutput,
          diffWrapMode,
          providers,
          sync,
          tui: tuiConfig,
        }}
      >
        <box flexDirection="row" flexGrow={1} minHeight={0}>
          <box flexGrow={1} minHeight={0} paddingBottom={1} paddingLeft={2} paddingRight={2} gap={1}>
            <Show when={session()}>
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
                <box height={1} />
                <For each={messages()}>
                  {(message, index) => (
                    <Switch>
                      <Match when={message.id === revert()?.messageID}>
                        {(function () {
                          const redoShortcut = useCommandShortcut("session.redo")
                          const [hover, setHover] = createSignal(false)
                          const dialog = useDialog()

                          const handleUnrevert = async () => {
                            const confirmed = await DialogConfirm.show(
                              dialog,
                              "Confirm Redo",
                              "Are you sure you want to restore the reverted messages?",
                            )
                            if (confirmed) {
                              keymap.dispatchCommand("session.redo")
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
                                  <span style={{ fg: theme.text }}>{redoShortcut()}</span> or /redo to restore
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
                                setPrompt={(promptInfo) => prompt?.set(promptInfo)}
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
                <Show when={session()?.parentID}>
                  <SubagentFooter />
                </Show>
                <Show when={visible()}>
                  <TuiPluginRuntime.Slot
                    name="session_prompt"
                    mode="replace"
                    session_id={route.sessionID}
                    visible={visible()}
                    disabled={disabled()}
                    on_submit={toBottom}
                    ref={bind}
                  >
                    <Prompt
                      visible={visible()}
                      ref={bind}
                      disabled={disabled()}
                      onSubmit={() => {
                        toBottom()
                      }}
                      sessionID={route.sessionID}
                      right={<TuiPluginRuntime.Slot name="session_prompt_right" session_id={route.sessionID} />}
                    />
                  </TuiPluginRuntime.Slot>
                </Show>
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
    </PathFormatterProvider>
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
  const text = createMemo(() => {
    const texts = props.parts
      .map((x) => {
        if (x.type === "text" && !x.synthetic) {
          return x.text
        }
        return null
      })
      .filter(Boolean)
    return texts.join("\n\n")
  })
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
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
            <text fg={theme.text}>{text()}</text>
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
  const ctx = use()
  const local = useLocal()
  const { theme } = useTheme()
  const sync = useSync()
  const messages = createMemo(() => sync.data.message[props.message.sessionID] ?? [])
  const model = createMemo(() => Model.name(ctx.providers(), props.message.providerID, props.message.modelID))

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

  const childShortcut = useCommandShortcut("session.child.first")

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
            {childShortcut()}
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
              <span style={{ fg: theme.textMuted }}> · {model()}</span>
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
  // Collapsed by default in hide mode: a single line throughout, so the
  // layout never shifts. Click to open the full markdown block, click to close.
  const [expanded, setExpanded] = createSignal(false)

  const content = createMemo(() => {
    // OpenRouter encrypts some reasoning blocks; drop the placeholder.
    return props.part.text.replace("[REDACTED]", "").trim()
  })
  // Reasoning is finalized when the server sets `time.end` (see processor.ts).
  // Flips independently of the parent message completing.
  const isDone = createMemo(() => props.part.time.end !== undefined)
  const inMinimal = createMemo(() => ctx.thinkingMode() === "hide")
  const duration = createMemo(() => {
    const end = props.part.time.end
    return end === undefined ? 0 : Math.max(0, end - props.part.time.start)
  })
  const summary = createMemo(() => reasoningSummary(content()))
  const syntax = createMemo(() => subtleSyntax())

  const toggle = () => {
    if (!inMinimal()) return
    setExpanded((prev) => !prev)
  }

  return (
    <Show when={content()}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexDirection="column" flexShrink={0}>
        <box onMouseUp={toggle}>
          <ReasoningHeader
            toggleable={inMinimal()}
            open={!inMinimal() || expanded()}
            done={isDone()}
            title={summary()?.title ?? null}
            duration={isDone() ? Locale.duration(duration()) : undefined}
          />
        </box>
        <Show when={(!inMinimal() || expanded()) && summary()?.body}>
          <box paddingLeft={inMinimal() ? 2 : 0} marginTop={1}>
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={true}
              syntaxStyle={syntax()}
              content={summary()?.body}
              conceal={ctx.conceal()}
              fg={theme.textMuted}
            />
          </box>
        </Show>
      </box>
    </Show>
  )
}

function ReasoningHeader(props: {
  toggleable: boolean
  open: boolean
  done: boolean
  title: string | null
  duration?: string
}) {
  const { theme } = useTheme()
  const fg = () =>
    props.open
      ? RGBA.fromValues(theme.warning.r, theme.warning.g, theme.warning.b, theme.thinkingOpacity)
      : theme.warning

  return (
    <Switch>
      <Match when={!props.done}>
        <box flexDirection="row">
          <Spinner color={fg()}>{props.title ? "Thinking: " + props.title : "Thinking"}</Spinner>
        </box>
      </Match>
      <Match when={true}>
        <text fg={fg()} wrapMode="none">
          <Show when={props.toggleable}>
            <span>{props.open ? "- " : "+ "}</span>
          </Show>
          <span>Thought</span>
          <Show when={props.title || props.duration}>
            <span>: </span>
          </Show>
          <Show when={props.title}>
            <span>{props.title}</span>
          </Show>
          <Show when={props.duration}>
            <span>
              {props.title ? " · " : ""}
              {props.duration}
            </span>
          </Show>
        </text>
      </Match>
    </Switch>
  )
}

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0}>
        <markdown
          syntaxStyle={syntax()}
          streaming={true}
          internalBlockMode="top-level"
          content={props.part.text.trim()}
          tableOptions={{ style: "grid" }}
          conceal={ctx.conceal()}
          fg={theme.markdownText}
          bg={theme.background}
        />
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
        <Match when={props.part.tool === ShellID.ToolID}>
          <Shell {...toolprops} />
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
        <Match when={props.part.tool === "webfetch"}>
          <WebFetch {...toolprops} />
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

type ToolProps<T> = {
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
  const maxLines = 3
  const maxChars = createMemo(() => maxLines * Math.max(20, ctx.width - 6))
  const collapsed = createMemo(() => collapseToolOutput(output(), maxLines, maxChars()))
  const limited = createMemo(() => {
    if (expanded() || !collapsed().overflow) return output()
    return collapsed().output
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
        onClick={collapsed().overflow ? () => setExpanded((prev) => !prev) : undefined}
      >
        <box gap={1}>
          <text fg={theme.text}>{limited()}</text>
          <Show when={collapsed().overflow}>
            <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
          </Show>
        </box>
      </BlockTool>
    </Show>
  )
}

function InlineTool(props: {
  icon: string
  iconColor?: RGBA
  color?: RGBA
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
    if (props.color) return props.color
    if (permission()) return theme.warning
    if (hover() && props.onClick) return theme.text
    if (props.complete) return theme.textMuted
    return theme.text
  })

  const error = createMemo(() => (props.part.state.status === "error" ? props.part.state.error : undefined))

  const denied = createMemo(
    () =>
      error()?.includes("QuestionRejectedError") ||
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
        <Spinner color={theme.textMuted}>{String(props.title || "").replace(/^# /, "")}</Spinner>
      </Show>
      {props.children}
      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
}

function Shell(props: ToolProps<typeof ShellTool>) {
  const { theme } = useTheme()
  const pathFormatter = usePathFormatter()
  const ctx = use()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
  const [expanded, setExpanded] = createSignal(false)
  const maxLines = 10
  const maxChars = createMemo(() => maxLines * Math.max(20, ctx.width - 6))
  const collapsed = createMemo(() => collapseToolOutput(output(), maxLines, maxChars()))
  const limited = createMemo(() => {
    if (expanded() || !collapsed().overflow) return output()
    return collapsed().output
  })

  const workdirDisplay = createMemo(() => {
    const workdir = props.input.workdir
    if (!workdir || workdir === ".") return undefined
    return pathFormatter.format(workdir)
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
          onClick={collapsed().overflow ? () => setExpanded((prev) => !prev) : undefined}
        >
          <box gap={1}>
            <text fg={theme.text}>$ {props.input.command}</text>
            <Show when={output()}>
              <text fg={theme.text}>{limited()}</text>
            </Show>
            <Show when={collapsed().overflow}>
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
  const pathFormatter = usePathFormatter()
  const code = createMemo(() => {
    if (!props.input.content) return ""
    return props.input.content
  })

  return (
    <Switch>
      <Match when={props.metadata.diagnostics !== undefined}>
        <BlockTool title={"# Wrote " + pathFormatter.format(props.input.filePath)} part={props.part}>
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
          Write {pathFormatter.format(props.input.filePath)}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Glob(props: ToolProps<typeof GlobTool>) {
  const pathFormatter = usePathFormatter()
  return (
    <InlineTool icon="✱" pending="Finding files..." complete={props.input.pattern} part={props.part}>
      Glob "{props.input.pattern}" <Show when={props.input.path}>in {pathFormatter.format(props.input.path)} </Show>
      <Show when={props.metadata.count}>
        ({props.metadata.count} {props.metadata.count === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

function Read(props: ToolProps<typeof ReadTool>) {
  const { theme } = useTheme()
  const pathFormatter = usePathFormatter()
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
        Read {pathFormatter.format(props.input.filePath)} {input(props.input, ["filePath"])}
      </InlineTool>
      <For each={loaded()}>
        {(filepath) => (
          <box paddingLeft={3}>
            <text paddingLeft={3} fg={theme.textMuted}>
              ↳ Loaded {pathFormatter.format(filepath)}
            </text>
          </box>
        )}
      </For>
    </>
  )
}

function Grep(props: ToolProps<typeof GrepTool>) {
  const pathFormatter = usePathFormatter()
  return (
    <InlineTool icon="✱" pending="Searching content..." complete={props.input.pattern} part={props.part}>
      Grep "{props.input.pattern}" <Show when={props.input.path}>in {pathFormatter.format(props.input.path)} </Show>
      <Show when={props.metadata.matches}>
        ({props.metadata.matches} {props.metadata.matches === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

function WebFetch(props: ToolProps<typeof WebFetchTool>) {
  return (
    <InlineTool icon="%" pending="Fetching from the web..." complete={props.input.url} part={props.part}>
      WebFetch {props.input.url}
    </InlineTool>
  )
}

function WebSearch(props: ToolProps<typeof WebSearchTool>) {
  const metadata = () => props.metadata as { numResults?: number; provider?: unknown }
  return (
    <InlineTool icon="◈" pending="Searching web..." complete={props.input.query} part={props.part}>
      {webSearchProviderLabel(metadata().provider)} "{props.input.query}"{" "}
      <Show when={metadata().numResults}>({metadata().numResults} results)</Show>
    </InlineTool>
  )
}

function Task(props: ToolProps<typeof TaskTool>) {
  const { theme } = useTheme()
  const { navigate } = useRoute()
  const sync = useSync()
  const dialog = useDialog()

  onMount(() => {
    if (props.metadata.sessionId && !sync.data.message[props.metadata.sessionId]?.length)
      void sync.session.sync(props.metadata.sessionId)
  })

  const messages = createMemo(() => sync.data.message[props.metadata.sessionId ?? ""] ?? [])

  const tools = createMemo(() => {
    return messages().flatMap((msg) =>
      (sync.data.part[msg.id] ?? [])
        .filter((part): part is ToolPart => part.type === "tool")
        .map((part) => ({ tool: part.tool, state: part.state })),
    )
  })

  const current = createMemo(() =>
    tools().findLast((x) => (x.state.status === "running" || x.state.status === "completed") && x.state.title),
  )

  const isRunning = createMemo(() => props.part.state.status === "running")
  const retry = createMemo(() => {
    const status = sync.data.session_status[props.metadata.sessionId ?? ""]
    if (status?.type !== "retry") return
    return status
  })

  const duration = createMemo(() => {
    const first = messages().find((x) => x.role === "user")?.time.created
    const assistant = messages().findLast((x) => x.role === "assistant")?.time.completed
    if (!first || !assistant) return 0
    return assistant - first
  })

  const content = createMemo(() => {
    if (!props.input.description) return ""
    const description =
      props.metadata.background === true ? `${props.input.description} (background)` : props.input.description
    let content = [`${Locale.titlecase(props.input.subagent_type ?? "General")} Task — ${description}`]

    const retrying = retry()
    if (isRunning() && retrying) {
      content.push(`↳ ${Locale.truncate(retrying.message, 80)} [retrying attempt #${retrying.attempt}]`)
    } else if (isRunning() && tools().length > 0) {
      // content[0] += ` · ${tools().length} toolcalls`
      if (current()) {
        const state = current()!.state
        const title = state.status === "running" || state.status === "completed" ? state.title : undefined
        content.push(`↳ ${Locale.titlecase(current()!.tool)} ${title}`)
      } else content.push(`↳ ${tools().length} toolcalls`)
    }

    if (props.part.state.status === "completed") {
      content.push(
        props.metadata.background === true
          ? `└ ${tools().length} toolcalls`
          : `└ ${tools().length} toolcalls · ${Locale.duration(duration())}`,
      )
    }

    return content.join("\n")
  })

  return (
    <InlineTool
      icon="│"
      color={retry() ? theme.error : undefined}
      spinner={isRunning()}
      complete={props.input.description}
      pending="Delegating..."
      part={props.part}
      onClick={() => {
        if (props.metadata.sessionId) {
          navigate({ type: "session", sessionID: props.metadata.sessionId })
        }
        const status = retry()
        if (status) void DialogAlert.show(dialog, "Retry Error", status.message)
      }}
    >
      {content()}
    </InlineTool>
  )
}

function Edit(props: ToolProps<typeof EditTool>) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const pathFormatter = usePathFormatter()

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
        <BlockTool title={"← Edit " + pathFormatter.format(props.input.filePath)} part={props.part}>
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
          Edit {pathFormatter.format(props.input.filePath)} {input({ replaceAll: props.input.replaceAll })}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function ApplyPatch(props: ToolProps<typeof ApplyPatchTool>) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const pathFormatter = usePathFormatter()

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
    if (file.type === "move") return "# Moved " + pathFormatter.format(file.filePath) + " → " + file.relativePath
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
                <Diff diff={file.patch} filePath={file.filePath} />
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

  function format(answer?: ReadonlyArray<string>) {
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
