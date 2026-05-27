import type { Argv } from "yargs"
import { EOL } from "os"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { getMemoryForAssunto, loadMemory, updateMemory } from "../../memory"

export const MemoryCommand = cmd({
  command: "memory <action> [assunto]",
  describe: "manage local memories (stored in .markscode/memories.json)",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        describe: "action to perform",
        type: "string",
        choices: ["list", "show", "set", "add"],
      })
      .positional("assunto", {
        describe: "memory topic (assunto)",
        type: "string",
      })
      .option("resumo", {
        describe: "set summary text",
        type: "string",
      })
      .option("palavra", {
        describe: "add keyword(s)",
        type: "string",
        array: true,
      })
      .option("avanco", {
        describe: "add progress note(s)",
        type: "string",
        array: true,
      }),
  handler: async (args) => {
    const action = String(args.action)
    const assunto = args.assunto ? String(args.assunto) : ""

    if (action === "list") {
      const memory = await loadMemory()
      const keys = Object.keys(memory).sort((a, b) => a.localeCompare(b))
      if (keys.length === 0) {
        UI.println("No memories saved" + EOL)
        return
      }
      for (const key of keys) UI.println(key + EOL)
      return
    }

    if (!assunto) {
      UI.error("Missing assunto")
      return
    }

    if (action === "show") {
      const entry = await getMemoryForAssunto(assunto)
      if (!entry) {
        UI.error(`Memory not found: ${assunto}`)
        return
      }
      UI.println(JSON.stringify(entry, null, 2) + EOL)
      return
    }

    if (action === "set") {
      const resumo = args.resumo ? String(args.resumo) : ""
      if (!resumo) {
        UI.error("Missing --resumo")
        return
      }
      await updateMemory(assunto, { resumo })
      UI.println("Saved" + EOL)
      return
    }

    if (action === "add") {
      const entry = (await getMemoryForAssunto(assunto)) ?? {
        palavras: [],
        avancos: [],
        resumo: "",
        updated: new Date().toISOString(),
      }

      const palavras = Array.isArray(args.palavra) ? args.palavra.map(String) : []
      const avancos = Array.isArray(args.avanco) ? args.avanco.map(String) : []
      const resumo = args.resumo ? String(args.resumo) : undefined

      await updateMemory(assunto, {
        palavras: Array.from(new Set([...entry.palavras, ...palavras].filter(Boolean))),
        avancos: [...entry.avancos, ...avancos].filter(Boolean),
        resumo: resumo ?? entry.resumo,
      })

      UI.println("Updated" + EOL)
      return
    }

    UI.error(`Unknown action: ${action}`)
  },
})
