import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { Spinner } from "./spinner"

const brainSystemStartupStages = [
  "Inicializando BrainSystem",
  "Inicializando módulos",
  "Inicializando plugins",
  "Inicializando autenticação",
  "Inicializando licença",
  "Inicializando modelos",
] as const

export function StartupLoading(props: { ready: () => boolean }) {
  const theme = useTheme().theme
  const [show, setShow] = createSignal(false)
  const [tick, setTick] = createSignal(0)
  const activeStage = createMemo(() =>
    props.ready() ? brainSystemStartupStages.length : Math.min(brainSystemStartupStages.length - 1, tick()),
  )
  const text = createMemo(() =>
    props.ready() ? "Finalizando inicialização..." : brainSystemStartupStages[activeStage()] ?? "Inicializando BrainSystem",
  )
  let wait: NodeJS.Timeout | undefined
  let hold: NodeJS.Timeout | undefined
  let cycle: NodeJS.Timeout | undefined
  let stamp = 0

  createEffect(() => {
    if (props.ready()) {
      if (cycle) {
        clearInterval(cycle)
        cycle = undefined
      }
      if (wait) {
        clearTimeout(wait)
        wait = undefined
      }
      if (!show()) return
      if (hold) return

      const left = 3000 - (Date.now() - stamp)
      if (left <= 0) {
        setShow(false)
        return
      }

      hold = setTimeout(() => {
        hold = undefined
        setShow(false)
      }, left).unref()
      return
    }

    if (hold) {
      clearTimeout(hold)
      hold = undefined
    }
    if (show()) return
    if (wait) return

    wait = setTimeout(() => {
      wait = undefined
      stamp = Date.now()
      setTick(0)
      setShow(true)
    }, 500).unref()
  })

  createEffect(() => {
    if (!show() || props.ready()) return
    if (cycle) return
    cycle = setInterval(() => {
      setTick((value) => Math.min(value + 1, brainSystemStartupStages.length - 1))
    }, 700).unref()
  })

  onCleanup(() => {
    if (wait) clearTimeout(wait)
    if (hold) clearTimeout(hold)
    if (cycle) clearInterval(cycle)
  })

  return (
    <Show when={show()}>
      <box position="absolute" zIndex={5000} left={0} right={0} bottom={1} justifyContent="center" alignItems="center">
        <box backgroundColor={theme.backgroundPanel} paddingLeft={1} paddingRight={1} flexDirection="column">
          <Spinner color={theme.textMuted}>{text()}</Spinner>
          <box flexDirection="column">
            {brainSystemStartupStages.map((stage, index) => (
              <text fg={index <= activeStage() ? theme.text : theme.textMuted}>
                {index < activeStage() || props.ready() ? "✓" : index === activeStage() ? "•" : "○"} {stage}
              </text>
            ))}
          </box>
        </box>
      </box>
    </Show>
  )
}
