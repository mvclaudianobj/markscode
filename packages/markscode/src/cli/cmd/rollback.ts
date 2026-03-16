import type { Argv } from "yargs"
import { EOL } from "os"
import { cmd } from "./cmd"
import { UI } from "../ui"

export const RollbackCommand = cmd({
  command: "rollback",
  describe: "Rollback MarksCode to the latest backup",
  builder: (yargs: Argv) =>
    yargs
      .option("force", {
        describe: "Force rollback without confirmation",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    const force = args.force as boolean

    if (!force) {
      UI.println("Rollback will restore the previous version from backup." + EOL)
      const answer = await UI.input("Continue? (y/N): ")
      if (!answer || !answer.toLowerCase().startsWith("y")) {
        UI.println("Rollback cancelled" + EOL)
        return
      }
    }

    UI.println("Rolling back to latest backup..." + EOL)

    try {
      const { rollback } = await import("../upgrade")
      const result = await rollback()
      if (result.success) {
        UI.println(`✅ Rollback completed successfully` + EOL)
        if (result.backupPath) {
          UI.println(`Backup: ${result.backupPath}` + EOL)
        }
      } else {
        UI.error(`Rollback failed: ${result.error}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      UI.error(`Rollback error: ${message}`)
    }
  },
})
