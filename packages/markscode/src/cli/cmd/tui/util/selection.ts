import * as Clipboard from "./clipboard"

type Toast = {
  show: (input: { message: string; variant: "info" | "success" | "warning" | "error"; duration?: number }) => void
  error: (err: unknown) => void
}

type FocusableSelectionTarget = {
  hasSelection: () => boolean
  getClipboardText?: (text: string) => string
}

type Renderer = {
  getSelection: () => { getSelectedText: () => string; selectedRenderables: FocusableSelectionTarget[] } | null
  clearSelection: () => void
  currentFocusedRenderable?: FocusableSelectionTarget | null
}

type SelectionKeyEvent = {
  ctrl?: boolean
  name: string
  preventDefault: () => void
  stopPropagation: () => void
}

export function copy(renderer: Renderer, toast: Toast): boolean {
  const text = renderer.getSelection()?.getSelectedText()
  if (!text) return false

  Clipboard.copy(text)
    .then(() => {
      renderer.clearSelection()
      toast.show({ message: "Copied to clipboard", variant: "info", duration: 3000 })
    })
    .catch(toast.error)

  return true
}

export function handleSelectionKey(renderer: Renderer, toast: Toast, event: SelectionKeyEvent) {
  const selection = renderer.getSelection()
  if (!selection) return

  if (event.ctrl && event.name === "c") {
    if (!copy(renderer, toast)) {
      renderer.clearSelection()
      return
    }

    event.preventDefault()
    event.stopPropagation()
    return
  }

  if (event.name === "escape") {
    renderer.clearSelection()
    event.preventDefault()
    event.stopPropagation()
    return
  }

  const focus = renderer.currentFocusedRenderable
  if (focus?.hasSelection() && selection.selectedRenderables.includes(focus)) return

  renderer.clearSelection()
}

export * as Selection from "./selection"

export function copyWithRetry(renderer: Renderer, toast: Toast, attempts = 6, delayMs = 12): void {
  const run = (remaining: number) => {
    if (copy(renderer, toast)) return
    if (remaining <= 1) return
    setTimeout(() => run(remaining - 1), delayMs)
  }

  queueMicrotask(() => run(attempts))
}
