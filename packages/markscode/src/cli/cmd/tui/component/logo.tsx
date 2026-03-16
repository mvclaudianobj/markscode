import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Installation } from "@/installation"

const LOGO = [
  `███╗░░░███╗░█████╗░██████╗░██╗░░██╗░██████╗░█████╗░░█████╗░██████╗░███████╗`,
  `████╗░████║██╔══██╗██╔══██╗██║░██╔╝██╔════╝██╔══██╗██╔══██╗██╔══██╗██╔════╝`,
  `██╔████╔██║███████║██████╔╝█████═╝░╚█████╗░██║░░╚═╝██║░░██║██║░░██║█████╗░░`,
  `██║╚██╔╝██║██╔══██║██╔══██╗██╔═██╗░░╚═══██╗██║░░██╗██║░░██║██║░░██║██╔══╝░░`,
  `██║░╚═╝░██║██║░░██║██║░░██║██║░╚██╗██████╔╝╚█████╔╝╚█████╔╝██████╔╝███████╗`,
  `╚═╝░░░░░╚═╝╚═╝░░╚═╝╚═╝░░╚═╝╚═╝░░╚═╝╚═════╝░░╚════╝░░╚════╝░╚═════╝░╚══════╝`,
]

export function Logo() {
  const { theme } = useTheme()
  return (
    <box>
      <For each={LOGO}>
        {(line) => (
          <text fg={theme.text} selectable={false}>
            {line}
          </text>
        )}
      </For>
      <box flexDirection="row" justifyContent="flex-end">
        <text fg={theme.textMuted}>{Installation.VERSION}</text>
      </box>
    </box>
  )
}
