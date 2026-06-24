import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { Locale } from "@/util/locale"
import { createDebouncedSignal } from "../util/signal"
import { createMemo, createResource, onMount } from "solid-js"
import { useToast } from "../ui/toast"
import { errorMessage } from "@/util/error"

type AllDbSession = {
  id: string
  directory: string
  title: string
  time: {
    updated: number
  }
  source: {
    dbPath: string
    label: string
    active: boolean
  }
}

function shortID(id: string) {
  return id.slice(0, 8)
}

export function DialogAllSessionList() {
  const dialog = useDialog()
  const route = useRoute()
  const sdk = useSDK()
  const toast = useToast()
  const [search, setSearch] = createDebouncedSignal("", 150)

  const [sessions] = createResource(search, async (query) => {
    const url = new URL("/experimental/session/all", sdk.url)
    url.searchParams.set("limit", "50")
    if (query) url.searchParams.set("search", query)
    const result = await sdk
      .fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<AllDbSession[]>
      })
      .catch((error) => {
        toast.show({
          variant: "error",
          title: "Failed to load sessions",
          message: errorMessage(error),
        })
        return []
      })
    return result
  })

  const options = createMemo(() =>
    (sessions() ?? []).map((session) => ({
      title: session.title || session.id,
      value: session,
      description: `${shortID(session.id)} • ${session.directory}`,
      category: session.source.active ? "Active database" : session.source.label,
      footer: `${session.source.label} • ${Locale.time(session.time.updated)}`,
    })),
  )

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="All Sessions"
      options={options()}
      skipFilter={true}
      onFilter={setSearch}
      onSelect={async (option) => {
        if (option.value.source.active) {
          route.navigate({ type: "session", sessionID: option.value.id })
          dialog.clear()
          return
        }
        const url = new URL("/experimental/session/all/import", sdk.url)
        await sdk
          .fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sourceDbPath: option.value.source.dbPath, sessionID: option.value.id }),
          })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json() as Promise<{ sessionID: string; imported: boolean }>
          })
          .then((result) => {
            route.navigate({ type: "session", sessionID: result.sessionID })
            toast.show({
              variant: "success",
              title: result.imported ? "Session imported" : "Session already available",
              message: option.value.title || option.value.id,
            })
            dialog.clear()
          })
          .catch((error) => {
            toast.show({
              variant: "error",
              title: "Failed to import session",
              message: errorMessage(error),
            })
          })
      }}
    />
  )
}
