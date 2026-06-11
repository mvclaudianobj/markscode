import { listHybridRecentTopics, type HybridRecentTopic } from "@/memory-hybrid"
import { createMemo, createResource } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"

export type DialogRecentTopicsProps = { userID?: string; sessionID?: string; onSelect: (topic: HybridRecentTopic) => void }

export function DialogRecentTopics(props: DialogRecentTopicsProps) {
  const dialog = useDialog()
  dialog.setSize("large")
  const [result] = createResource(() => listHybridRecentTopics({ user_id: props.userID, session_id: props.sessionID, limit: 12, provider: "hybrid" }))
  const options = createMemo<DialogSelectOption<HybridRecentTopic>[]>(() => {
    const topics = result()?.topics || []
    if (!topics.length) return [{ title: result.loading ? "Carregando assuntos recentes..." : "Nenhum assunto recente encontrado", value: { topic: "", source: "local", content_preview: "" }, disabled: true }]
    return topics.map((topic) => ({ title: "[" + topic.source + "] " + topic.topic, description: topic.content_preview, value: topic, category: topic.source, onSelect: () => { props.onSelect(topic); dialog.clear() } }))
  })
  return <DialogSelect title="Assuntos recentes" placeholder="Buscar assunto recente..." options={options()} />
}
