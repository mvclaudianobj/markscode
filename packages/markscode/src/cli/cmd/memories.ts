import { cmd } from "./cmd"
import { UI } from "../ui"
import { doctorHybridMemory, hybridMemoryStatus } from "../../memory-hybrid"

export const MemoriesCommand = cmd({
  command: "memories <action>",
  describe: "inspect memories integrations",
  builder: (yargs) =>
    yargs.positional("action", {
      describe: "memories action to run",
      type: "string",
      choices: ["hybrid-status", "hybrid-doctor"],
      demandOption: true,
    }),
  handler: async (args) => {
    const result = args.action === "hybrid-status" ? await hybridMemoryStatus() : await doctorHybridMemory()
    UI.println(JSON.stringify(result, null, 2))
  },
})
