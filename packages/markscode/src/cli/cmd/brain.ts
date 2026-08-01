import type { Argv } from "yargs"
import { EOL } from "os"
import { Effect, Option } from "effect"
import { Account } from "@/account/account"
import { Database } from "@/storage/db"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { diagnoseBrainSystem, formatDiagnosisForDisplay } from "../../memory-diagnose"
import { doctorHybridMemory, hybridMemoryStatus, listHybridSources, recallHybridMemories, type MemoryProvider } from "../../memory-hybrid"
import { AppRuntime } from "@/effect/app-runtime"
import { fallbackMemoryIdentity, resolveMemoryIdentityEffect } from "@/memory-identity"

async function hydrateRemoteBrainConfigFromActiveAccount() {
  await AppRuntime.runPromise(
    Effect.gen(function* () {
      const service = yield* Account.Service
      const active = yield* service.activeOrg()
      if (Option.isNone(active)) return
      yield* service.configActive(active.value)
    }).pipe(Effect.catch(() => Effect.void)),
  ).catch(() => undefined)
}

export const BrainCommand = cmd({
  command: "brain <action>",
  describe: "native BrainSystem commands",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        describe: "action to perform",
        type: "string",
        choices: ["diagnose", "status", "doctor", "recall", "sources"],
      })
      .option("cue", {
        describe: "retrieval cue for recall",
        type: "string",
      })
      .option("limit", {
        describe: "max memories in recall response",
        type: "number",
        default: 8,
      })
      .option("provider", {
        describe: "memory provider for recall",
        type: "string",
        choices: ["cloud", "local", "hybrid"],
      })
      .option("capsule", {
        describe: "Path to default Memvid capsule",
        type: "string",
      })
      .option("user-id", {
        describe: "memory user id",
        type: "string",
      })
      .option("session-id", {
        describe: "session id",
        type: "string",
      })
      .option("path", {
        describe: "project root for diagnose",
        type: "string",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const action = String(args.action)
      const sessionID = String(args.sessionId || process.env.MEMORIES_SESSION_ID || process.env.MARKSCODE_SESSION_ID || process.env.OPENCODE_SESSION_ID || "")
      const memoryIdentity = await AppRuntime.runPromise(resolveMemoryIdentityEffect(sessionID || undefined)).catch(() => fallbackMemoryIdentity(sessionID || undefined))
      const userID = String(args.userId || memoryIdentity.user_id)

      if (action === "diagnose") {
        UI.println(formatDiagnosisForDisplay(diagnoseBrainSystem({
          projectRoot: args.path ? String(args.path) : process.cwd(),
          sessionDbPath: Database.getPath(),
        })) + EOL)
        return
      }

      if (action === "status") {
        await hydrateRemoteBrainConfigFromActiveAccount()
        UI.println(JSON.stringify(await hybridMemoryStatus({ capsule: args.capsule ? String(args.capsule) : undefined }), null, 2) + EOL)
        return
      }

      if (action === "doctor") {
        await hydrateRemoteBrainConfigFromActiveAccount()
        UI.println(JSON.stringify(await doctorHybridMemory({ capsule: args.capsule ? String(args.capsule) : undefined }), null, 2) + EOL)
        return
      }

      if (action === "sources") {
        UI.println(JSON.stringify(await listHybridSources(), null, 2) + EOL)
        return
      }

      if (action === "recall") {
        await hydrateRemoteBrainConfigFromActiveAccount()
        const cue = args.cue ? String(args.cue).trim() : ""
        if (!cue) {
          UI.error("Missing --cue argument for brain recall")
          return
        }
        UI.println(JSON.stringify(await recallHybridMemories({
          user_id: userID,
          session_id: sessionID || undefined,
          cue,
          limit: Number(args.limit ?? 8),
          provider: args.provider ? (String(args.provider) as MemoryProvider) : undefined,
          capsule: args.capsule ? String(args.capsule) : undefined,
        }), null, 2) + EOL)
        return
      }

      UI.error(`Unknown action: ${action}`)
    })
  },
})
