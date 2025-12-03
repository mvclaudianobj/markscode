import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import {
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "@tui/context/keybind"
import type { KeybindsConfig } from "@opencode-ai/sdk"
import { loadMemory, type MemoryData } from "../../../../memory"
import { useDirectory } from "../context/directory"
import path from "path"

import os from "os"

type Context = ReturnType<typeof init>
const ctx = createContext<Context>()

export type CommandOption = DialogSelectOption & {
  keybind?: keyof KeybindsConfig
}

function init() {
  const [registrations, setRegistrations] = createSignal<Accessor<CommandOption[]>[]>([])
  const [suspendCount, setSuspendCount] = createSignal(0)
  const dialog = useDialog()
  const keybind = useKeybind()
  const options = createMemo(() => {
    return registrations().flatMap((x) => x())
  })
  const suspended = () => suspendCount() > 0

  useKeyboard((evt) => {
    if (suspended()) return
    for (const option of options()) {
      if (option.keybind && keybind.match(option.keybind, evt)) {
        evt.preventDefault()
        option.onSelect?.(dialog)
        return
      }
    }
  })

  const result = {
    trigger(name: string, source?: "prompt") {
      for (const option of options()) {
        if (option.value === name) {
          option.onSelect?.(dialog, source)
          return
        }
      }
    },
    keybinds(enabled: boolean) {
      setSuspendCount((count) => count + (enabled ? -1 : 1))
    },
    suspended,
    show() {
      dialog.replace(() => <DialogCommand options={options()} />)
    },
    register(cb: () => CommandOption[]) {
      const results = createMemo(cb)
      setRegistrations((arr) => [results, ...arr])
      onCleanup(() => {
        setRegistrations((arr) => arr.filter((x) => x !== results))
      })
    },
    get options() {
      return options()
    },
  }
  return result
}

export function useCommandDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useCommandDialog must be used within a CommandProvider")
  }
  return value
}

export function CommandProvider(props: ParentProps) {
  const value = init()
  const dialog = useDialog()
  const keybind = useKeybind()

  useKeyboard((evt) => {
    if (value.suspended()) return
    if (dialog.stack.length > 0) return
    if (evt.defaultPrevented) return
    if (keybind.match("command_list", evt)) {
      evt.preventDefault()
      dialog.replace(() => <DialogCommand options={value.options} />)
      return
    }
  })

  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

function DialogCommand(props: { options: CommandOption[] }) {
  const keybind = useKeybind()
  return (
    <DialogSelect
      title="Commands"
      options={props.options.map((x) => ({
        ...x,
        footer: x.keybind ? keybind.print(x.keybind) : undefined,
      }))}
    />
  )
}

export function DialogInsertFile() {
  const dialog = useDialog()
  const command = useCommandDialog()
  const [currentDir, setCurrentDir] = createSignal(os.homedir())
  const [files, setFiles] = createSignal<string[]>([])

  // Load files on mount
  createMemo(async () => {
    try {
      const dir = currentDir()
      const fs = await import("fs/promises")
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const fileList = entries
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(name => !name.startsWith('.'))
      setFiles(fileList)
    } catch {
      setFiles([])
    }
  })

  const options = createMemo(() => {
    const dir = currentDir()
    const fileOpts = files().map(file => ({
      title: file,
      value: path.join(dir, file),
      description: "File",
    }))
    // Add parent directory option
    const parent = path.dirname(dir)
    if (parent !== dir) {
      fileOpts.unshift({
        title: "..",
        value: parent,
        description: "Parent directory",
      })
    }
    return fileOpts
  })

  return (
    <DialogSelect
      title={`Insert File - ${currentDir()}`}
      placeholder="Search files"
      options={options()}
      onSelect={async (option) => {
        try {
          const stat = await Bun.file(option.value).stat()
          if (stat.isDirectory) {
            setCurrentDir(option.value)
          } else {
            const content = await Bun.file(option.value).text()
            command.trigger("append_to_prompt", content)
          }
        } catch (error) {
          // Show error
        }
      }}
    />
  )
}

export function DialogInsertImage() {
  const dialog = useDialog()
  const command = useCommandDialog()
  const [currentDir, setCurrentDir] = createSignal(os.homedir())
  const [files, setFiles] = createSignal<string[]>([])

  // Load image files on mount or dir change
  createMemo(async () => {
    try {
      const dir = currentDir()
      const fs = await import("fs/promises")
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
      const fileList = entries
        .filter(entry => entry.isFile() && imageExtensions.some(ext => entry.name.toLowerCase().endsWith(ext)))
        .map(entry => entry.name)
      setFiles(fileList)
    } catch {
      setFiles([])
    }
  })

  const options = createMemo(() => {
    const dir = currentDir()
    const fileOpts = files().map(file => ({
      title: file,
      value: path.join(dir, file),
      description: "Image file",
    }))
    // Add parent directory option
    const parent = path.dirname(dir)
    if (parent !== dir) {
      fileOpts.unshift({
        title: "..",
        value: parent,
        description: "Parent directory",
      })
    }
    return fileOpts
  })

  return (
    <DialogSelect
      title={`Insert Image File - ${currentDir()}`}
      placeholder="Search images"
      options={options()}
      onSelect={async (option) => {
        try {
          const stat = await Bun.file(option.value).stat()
          if (stat.isDirectory) {
            setCurrentDir(option.value)
          } else {
            // Insert image path for now
            const content = `[Image: ${option.value}]`
            command.trigger("append_to_prompt", content)
          }
        } catch (error) {
          // Show error
        }
      }}
    />
  )
}

export function DialogMemories() {
  const dialog = useDialog()
  const [memories, setMemories] = createSignal<MemoryData>({})

  // Load memories on mount
  createMemo(async () => {
    const data = await loadMemory()
    setMemories(data)
  })

  const options = createMemo(() => {
    const mem = memories()
    return Object.keys(mem).map((assunto) => ({
      title: assunto,
      value: assunto,
      description: mem[assunto].resumo.slice(0, 50) + "...",
    }))
  })

  return (
    <DialogSelect
      title="Memories"
      placeholder="Search memories"
      options={options()}
      onSelect={(option) => {
        // For now, just show the memory details
        // In future, integrate with prompt
        const mem = memories()[option.value]
        dialog.replace(() => (
          <box paddingLeft={2} paddingRight={2} gap={1}>
            <text>{`Memória: ${option.value}`}</text>
            <text>{`Resumo: ${mem.resumo}`}</text>
            <text>{`Palavras: ${mem.palavras.join(", ")}`}</text>
            <text>{`Avanços: ${mem.avancos.join("; ")}`}</text>
            <box paddingTop={1}>
              <text fg="blue">Pressione esc para voltar</text>
            </box>
          </box>
        ))
      }}
    />
  )
}

