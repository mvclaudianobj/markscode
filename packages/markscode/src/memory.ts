import path from "path"
import { mkdir } from "fs/promises"

export interface MemoryEntry {
  palavras: string[]
  avancos: string[]
  resumo: string
  updated: string
}

export interface MemoryData {
  [assunto: string]: MemoryEntry
}

const MEMORY_FILE = ".markscode/memories.json"

export async function loadMemory(): Promise<MemoryData> {
  try {
    const content = await Bun.file(MEMORY_FILE).text()
    return JSON.parse(content)
  } catch {
    return {}
  }
}

export async function saveMemory(memory: MemoryData): Promise<void> {
  const dir = path.dirname(MEMORY_FILE)
  await mkdir(dir, { recursive: true })
  await Bun.write(path.join(dir, "memories.json"), JSON.stringify(memory, null, 2))
}

export async function getMemoryForAssunto(assunto: string): Promise<MemoryEntry | null> {
  const memory = await loadMemory()
  return memory[assunto] || null
}

export async function updateMemory(assunto: string, updates: Partial<MemoryEntry>): Promise<void> {
  const memory = await loadMemory()
  if (!memory[assunto]) {
    memory[assunto] = { palavras: [], avancos: [], resumo: "", updated: new Date().toISOString() }
  }
  Object.assign(memory[assunto], updates, { updated: new Date().toISOString() })
  await saveMemory(memory)
}
