import path from "path"
import os from "os"
import fs from "fs/promises"

export interface MemoryEntry {
  palavras: string[]
  avancos: string[]
  resumo: string
  updated: string
}

export interface MemoryData {
  [assunto: string]: MemoryEntry
}

const MEMORY_DIR = path.join(os.homedir(), ".markscode")
const MEMORY_FILE = path.join(MEMORY_DIR, "memories.json")

export async function loadMemory(): Promise<MemoryData> {
  try {
    const content = await Bun.file(MEMORY_FILE).text()
    return JSON.parse(content)
  } catch {
    return {}
  }
}

export async function saveMemory(memory: MemoryData): Promise<void> {
  await fs.mkdir(MEMORY_DIR, { recursive: true })
  await Bun.write(MEMORY_FILE, JSON.stringify(memory, null, 2))
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