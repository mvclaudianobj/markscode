import type { Argv } from "yargs"
import { EOL } from "os"
import { Effect, Option } from "effect"
import { Account } from "@/account/account"
import { AppRuntime } from "@/effect/app-runtime"
import { Database } from "@/storage/db"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { 
  saveHumanMemory, 
  getHumanContext, 
  getSessionCompactContext,
  rebuildCompactMemories,
  recallHumanMemories, 
  importMemories,
  type MemoryMode,
  type MemoryType,
} from "../../memories-api"
import {
  hybridMemoryStatus,
  doctorHybridMemory,
  recallHybridMemories,
  formatMemoryContext,
  listHybridSources,
  previewHybridIngest,
  ingestHybridMemories,
  listHybridRecentTopics,
  type MemoryProvider,
} from "../../memory-hybrid"
import { diagnoseBrainSystem, formatDiagnosisForDisplay } from "../../memory-diagnose"

const DEFAULT_USER = "marks-local"

const hasEnvMemoryAPIKey = () => Boolean(process.env.MARKSCODE_MEMORIES_API_KEY?.trim() || process.env.MEMORIES_API_KEY?.trim())

async function hydrateRemoteMemoryConfigFromActiveAccount() {
  if (hasEnvMemoryAPIKey()) return

  await AppRuntime.runPromise(
    Effect.gen(function* () {
      const service = yield* Account.Service
      const active = yield* service.active()
      if (Option.isNone(active)) return
      if (!active.value.active_org_id) return
      yield* service.config(active.value.id, active.value.active_org_id)
    }).pipe(Effect.catch(() => Effect.void)),
  ).catch(() => undefined)
}

export const MemoriesCommand = cmd({
  command: "memories <action>",
  describe: "persistent human memories via API (/memories/human, /memories/human/context, /memories/human/recall)",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        describe: "action to perform",
        type: "string",
        choices: ["login", "status", "config", "save", "context", "compact", "compact-rebuild", "recall", "import", "recent-topics", "topics", "hybrid-status", "hybrid-doctor", "hybrid-recall", "hybrid-sources", "hybrid-ingest-preview", "hybrid-ingest", "diagnose"],
      })
      .option("user-id", {
        describe: "memory user id",
        type: "string",
        default: DEFAULT_USER,
      })
      .option("session-id", {
        describe: "session id",
        type: "string",
      })
      .option("type", {
        describe: "memory type",
        type: "string",
        choices: ["episodic", "semantic", "procedural"],
        default: "episodic",
      })
      .option("memory-mode", {
        describe: "memory mode (short_term, long_term, visual)",
        type: "string",
        choices: ["short_term", "long_term", "visual"],
        default: "long_term",
      })
      .option("content", {
        describe: "memory content (required for save/import)",
        type: "string",
      })
      .option("subject", {
        describe: "memory subject/topic",
        type: "string",
      })
      .option("title", {
        describe: "memory title (ex: session/chat name)",
        type: "string",
      })
      .option("importance", {
        describe: "importance score (0-1)",
        type: "number",
        default: 0.7,
      })
      .option("tag", {
        describe: "tag(s) for memory",
        type: "string",
        array: true,
      })
      .option("trigger", {
        describe: "mental trigger(s)",
        type: "string",
        array: true,
      })
      .option("cue", {
        describe: "retrieval cue(s)",
        type: "string",
        array: true,
      })
      .option("technique", {
        describe: "mnemonic technique(s)",
        type: "string",
        array: true,
      })
      .option("visual-ref", {
        describe: "visual reference(s) (urls/ids)",
        type: "string",
        array: true,
      })
      .option("source-name", {
        describe: "source name for import",
        type: "string",
      })
      .option("source", {
        describe: "hybrid ingest source (all, markscode-legacy-json, marksclaw-sqlite, marksclaw-markdown, memories-api-sqlite)",
        type: "string",
      })
      .option("path", {
        describe: "explicit source path for hybrid ingest",
        type: "string",
      })
      .option("write-cloud", {
        describe: "write hybrid ingest items to cloud Memories API",
        type: "boolean",
      })
      .option("write-memvid", {
        describe: "write hybrid ingest items to local Memvid (safe placeholder in v1)",
        type: "boolean",
      })
      .option("limit", {
        describe: "max memories in context/recall response",
        type: "number",
        default: 8,
      })
      .option("provider", {
        describe: "memory provider for hybrid recall",
        type: "string",
        choices: ["cloud", "local", "hybrid"],
      })
      .option("refresh", {
        describe: "force compact/context refresh before returning",
        type: "boolean",
      })
      .option("force", {
        describe: "force rebuild for compact memories",
        type: "boolean",
      })
      .option("capsule", {
        describe: "Path to default Memvid capsule",
        type: "string",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const action = String(args.action)
      const userID = String(args.userId || process.env.MEMORIES_USER_ID || DEFAULT_USER)
      const sessionID = String(
        args.sessionId ||
          process.env.MEMORIES_SESSION_ID ||
          process.env.MARKSCODE_SESSION_ID ||
          process.env.OPENCODE_SESSION_ID ||
          "",
      )

      try {
        if (action === "recent-topics" || action === "topics") {
          const result = await listHybridRecentTopics({
            user_id: userID,
            session_id: sessionID || undefined,
            limit: Number(args.limit ?? 12),
            provider: args.provider ? (String(args.provider) as MemoryProvider) : undefined,
            query: args.subject ? String(args.subject) : undefined,
          })
          UI.println(JSON.stringify(result, null, 2) + EOL)
          return
        }

        if (action === "hybrid-sources") {
          const result = await listHybridSources()
          UI.println(JSON.stringify(result, null, 2) + EOL)
          return
        }

        if (action === "hybrid-ingest-preview") {
          const result = await previewHybridIngest({
            user_id: userID,
            session_id: sessionID || undefined,
            source: args.source ? String(args.source) : "all",
            path: args.path ? String(args.path) : undefined,
            source_name: args.sourceName ? String(args.sourceName) : undefined,
            subject: args.subject ? String(args.subject) : undefined,
            limit: Number(args.limit ?? 100),
            dry_run: true,
            capsule: args.capsule ? String(args.capsule) : undefined,
          })
          UI.println(JSON.stringify(result, null, 2) + EOL)
          return
        }

        if (action === "hybrid-ingest") {
          const result = await ingestHybridMemories({
            user_id: userID,
            session_id: sessionID || undefined,
            source: args.source ? String(args.source) : "all",
            path: args.path ? String(args.path) : undefined,
            source_name: args.sourceName ? String(args.sourceName) : undefined,
            subject: args.subject ? String(args.subject) : undefined,
            limit: Number(args.limit ?? 100),
            write_cloud: Boolean(args.writeCloud),
            write_memvid: Boolean(args.writeMemvid),
            capsule: args.capsule ? String(args.capsule) : undefined,
          })
          UI.println(JSON.stringify(result, null, 2) + EOL)
          return
        }

        if (action === "hybrid-status") {
          const result = await hybridMemoryStatus({ capsule: args.capsule ? String(args.capsule) : undefined })
          UI.println(JSON.stringify(result, null, 2) + EOL)
          return
        }

        if (action === "hybrid-doctor") {
          const result = await doctorHybridMemory({ capsule: args.capsule ? String(args.capsule) : undefined })
          UI.println(JSON.stringify(result, null, 2) + EOL)
          return
        }

        if (action === "hybrid-recall") {
          const cue = args.cue ? String(args.cue).trim() : ""
          if (!cue) {
            UI.error("Missing --cue argument for hybrid-recall")
            return
          }

          const result = await recallHybridMemories({
            user_id: userID,
            session_id: sessionID || undefined,
            cue,
            limit: Number(args.limit ?? 8),
            provider: args.provider ? (String(args.provider) as MemoryProvider) : undefined,
            capsule: args.capsule ? String(args.capsule) : undefined,
          })
          void formatMemoryContext
          UI.println(JSON.stringify(result, null, 2) + EOL)
          return
        }

        if (action === "save") {
          const content = args.content ? String(args.content).trim() : ""
          if (!content) {
            UI.error("Missing --content")
            return
          }

          const result = await saveHumanMemory({
            user_id: userID,
            session_id: sessionID || `session-${Date.now()}`,
            type: String(args.type || "episodic") as MemoryType,
            memory_mode: String(args.memoryMode || "long_term") as MemoryMode,
            title: args.title,
            subject: args.subject,
            content,
            importance: Number(args.importance ?? 0.7),
            tags: Array.isArray(args.tag) ? args.tag.map(String).filter(Boolean) : undefined,
            triggers: Array.isArray(args.trigger) ? args.trigger.map(String).filter(Boolean) : undefined,
            retrieval_cues: Array.isArray(args.cue) ? args.cue.map(String).filter(Boolean) : undefined,
            mnemonic_techniques: Array.isArray(args.technique) ? args.technique.map(String).filter(Boolean) : undefined,
            visual_refs: Array.isArray(args.visualRef) ? args.visualRef.map(String).filter(Boolean) : undefined,
          })

          UI.println(JSON.stringify(result, null, 2) + EOL)
          return
        }

        if (action === "context") {
          if (!sessionID) {
            UI.error("Missing --session-id for context")
            return
          }

          const result = await getHumanContext({ user_id: userID, session_id: sessionID })
          
          UI.println(JSON.stringify(result, null, 2) + EOL)
          return
        }

        if (action === "compact") {
          if (!sessionID) {
            UI.error("Missing --session-id for compact")
            return
          }

          const result = await getSessionCompactContext({
            user_id: userID,
            session_id: sessionID,
            limit: Number(args.limit ?? 5),
            refresh: Boolean(args.refresh),
          })

          UI.println(JSON.stringify(result, null, 2) + EOL)
          return
        }

        if (action === "compact-rebuild") {
          const result = await rebuildCompactMemories({
            limit: Number(args.limit ?? 2000),
            force: args.force === undefined ? true : Boolean(args.force),
          })

          UI.println(JSON.stringify(result, null, 2) + EOL)
          return
        }

        if (action === "recall") {
          const cue = args.cue ? String(args.cue).trim() : ""
          if (!cue) {
            UI.error("Missing --cue argument for recall")
            return
          }

          const result = await recallHumanMemories({
            user_id: userID,
            session_id: sessionID || undefined,
            cue,
            limit: Number(args.limit ?? 8),
          })

          UI.println(JSON.stringify(result, null, 2) + EOL)
          return
        }

        if (action === "import") {
          const content = args.content ? String(args.content).trim() : ""
          if (!content) {
            UI.error("Missing --content for import")
            return
          }

          let items: any[]
          try {
            items = JSON.parse(content)
            if (!Array.isArray(items)) {
              UI.error("Import content must be a JSON array")
              return
            }
          } catch {
            UI.error("Invalid JSON in --content")
            return
          }

          const result = await importMemories({
            source: "manual",
            source_name: args.sourceName || "manual-import",
            subject: args.subject,
            default_user_id: userID,
            default_session_id: sessionID || `session-${Date.now()}`,
            items: items.map(item => ({
              content: item.content || String(item),
              type: item.type as MemoryType || "semantic",
              memory_mode: item.memory_mode as MemoryMode || "long_term",
              importance: item.importance ?? 0.7,
              tags: item.tags,
              triggers: item.triggers,
              retrieval_cues: item.retrieval_cues,
              mnemonic_techniques: item.mnemonic_techniques,
              visual_refs: item.visual_refs,
            })),
          })

          UI.println(JSON.stringify(result, null, 2) + EOL)
          return
        }

        if (action === "diagnose") {
          await hydrateRemoteMemoryConfigFromActiveAccount()
          const diag = diagnoseBrainSystem({
            projectRoot: args.path ? String(args.path) : process.cwd(),
            sessionDbPath: Database.getPath(),
          })
          UI.println(formatDiagnosisForDisplay(diag) + EOL)
          return
        }

        UI.error(`Unknown action: ${action}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        UI.error(msg)
      }
    })
  },
})
