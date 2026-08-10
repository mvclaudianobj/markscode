import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000
const AUTO_COMPACTION_CONTEXT_THRESHOLD = 190_000

function tokenCount(tokens: MessageV2.Assistant["tokens"]) {
  return tokens.total ?? tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

export function exceedsAutoCompactionThreshold(tokens: number) {
  return tokens > AUTO_COMPACTION_CONTEXT_THRESHOLD
}

export function usable(input: { cfg: Config.Info; model: Provider.Model; outputTokenMax?: number }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const reserved =
    input.cfg.compaction?.reserved ??
    Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
  return input.model.limit.input
    ? Math.max(0, input.model.limit.input - reserved)
    : Math.max(0, context - ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
}

export function isOverflow(input: {
  cfg: Config.Info
  tokens: MessageV2.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  const count = tokenCount(input.tokens)
  if (exceedsAutoCompactionThreshold(count)) return true
  if (["marks", "local-proxy", "local-proxy2"].includes(input.model.providerID)) return false
  const list = input.cfg.compaction?.models
  if (Array.isArray(list)) {
    const id = input.model.id
    const full = `${input.model.providerID}/${input.model.id}`
    if (list.includes(id) || list.includes(full)) return false
  }
  if (input.model.limit.context === 0) return false

  return count >= usable(input)
}
