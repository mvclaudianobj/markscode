import * as Clipboard from "./clipboard"

type Toast = {
  show: (input: { message: string; variant: "info" | "success" | "warning" | "error"; duration?: number }) => void
  error: (err: unknown) => void
}

type Renderer = {
  getSelection: () => { getSelectedText: () => string } | null
  clearSelection: () => void
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

export * as Selection from "./selection"

export function copyWithRetry(renderer: Renderer, toast: Toast, attempts = 6, delayMs = 12): void {
  const run = (remaining: number) => {
    if (copy(renderer, toast)) return
    if (remaining <= 1) return
    setTimeout(() => run(remaining - 1), delayMs)
  }

  queueMicrotask(() => run(attempts))
}
