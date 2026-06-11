import { Account } from "@/account/account"
import type { Info } from "@/account/schema"
import { defaultMarkspanelUrl, markspanelLoginEffect } from "@/cli/cmd/account"
import * as Prompt from "@/cli/effect/prompt"
import { InstanceStore } from "@/project/instance-store"
import { Provider } from "@/provider/provider"
import { Effect, Option } from "effect"

const failure = (message: string) =>
  Effect.fail(new Error(`MarkspanelStartupGate: ${message}`))

const countRemoteModels = (value: unknown): number => {
  if (!value || typeof value !== "object") return 0
  if (Array.isArray(value)) return value.length
  return Object.values(value as Record<string, unknown>).filter((item) => item && typeof item === "object").length
}

const remoteConfigStats = (config: Record<string, unknown>) => {
  const providerEntries = Object.entries((config.provider ?? config.providers ?? {}) as Record<string, unknown>).filter(
    ([, value]) => value && typeof value === "object",
  )
  const providerModels = providerEntries.reduce((total, [, provider]) => {
    const record = provider as Record<string, unknown>
    return total + countRemoteModels(record.models ?? record.model)
  }, 0)
  return {
    providers: providerEntries.length,
    models: providerModels + countRemoteModels(config.models ?? config.model),
  }
}

const activeAccountWithOrg = Effect.fn("markspanel.startup.active")(function* () {
  const service = yield* Account.Service
  const active = yield* service.active().pipe(Effect.catch(() => Effect.succeed(Option.none())))
  if (Option.isNone(active) || !active.value.active_org_id) return Option.none<Info>()
  return active
})

export const ensureParentGate = Effect.fn("markspanel.startup.ensure")(function* () {
  const service = yield* Account.Service
  const beforeLogin = yield* activeAccountWithOrg()

  if (Option.isNone(beforeLogin)) {
    yield* markspanelLoginEffect(defaultMarkspanelUrl)
  }

  const active = yield* activeAccountWithOrg()
  if (Option.isNone(active)) {
    return yield* failure(
      "Login obrigatório: nenhuma conta Markspanel ativa com organização ativa. A TUI não será aberta sem autenticação e active_org_id.",
    )
  }

  const email = active.value.email ?? active.value.id
  yield* Prompt.log.success(`Logado como ${email}`)

  const spin = Prompt.spinner()
  yield* spin.start("Carregando perfil Markspanel...")

  const config = yield* service.config(active.value.id, active.value.active_org_id!).pipe(
    Effect.catch(() =>
      Effect.gen(function* () {
        yield* spin.stop("Erro ao carregar perfil Markspanel.", 1)
        return yield* failure(
          "Conta Markspanel restrita ou sem permissão para /api/config. A TUI foi bloqueada antes da inicialização.",
        )
      }),
    ),
  )
  if (Option.isNone(config)) {
    yield* spin.stop("Perfil não encontrado.", 1)
    return yield* failure(
      "Markspanel não retornou /api/config para a organização ativa. A TUI não será aberta sem configuração autorizada.",
    )
  }

  const stats = remoteConfigStats(config.value)
  if (stats.providers < 1) {
    yield* spin.stop("Nenhum provider autorizado.", 1)
    return yield* failure("Nenhum provider autorizado foi retornado pelo Markspanel para esta organização.")
  }
  if (stats.models < 1) {
    yield* spin.stop("Nenhum modelo autorizado.", 1)
    return yield* failure("Nenhum modelo autorizado foi retornado pelo Markspanel para esta organização.")
  }

  yield* spin.stop(
    `Perfil carregado: ${stats.providers} provider${stats.providers !== 1 ? "s" : ""}, ${stats.models} modelo${stats.models !== 1 ? "s" : ""}`,
  )

  // Verificar quota disponível (fire-and-forget — não bloqueia startup)
  yield* Effect.gen(function* () {
    const quotaResult = yield* service.quota(active.value.id).pipe(Effect.catch(() => Effect.succeed(null)))
    if (!quotaResult) return
    if (quotaResult.monthly?.exhausted && quotaResult.hard_limit) {
      yield* Prompt.log.warn(
        `⚠️  Limite mensal de tokens Markspanel atingido. O uso pode estar bloqueado pelo servidor.`,
      )
      yield* Prompt.log.warn(
        `   Tier: ${quotaResult.tier} | Usado: ${quotaResult.monthly.used.toLocaleString()} / ${quotaResult.monthly.limit.toLocaleString()} tokens`,
      )
    } else if (quotaResult.monthly?.warning) {
      yield* Prompt.log.warn(
        `⚠️  Atenção: ${quotaResult.monthly.pct.toFixed(0)}% da quota mensal Markspanel utilizada.`,
      )
    }
  }).pipe(Effect.ignore)
})

export const ensureWorkerGate = Effect.fn("markspanel.startup.providers")(function* (input: {
  directory: string
  model?: string
}) {
  const store = yield* InstanceStore.Service
  return yield* store.provide(
    { directory: input.directory },
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      const providers = yield* provider.list()
      const providerEntries = Object.values(providers)
      if (providerEntries.length < 1) {
        return yield* failure("Nenhum provider efetivo carregado após aplicar a configuração Markspanel.")
      }

      const modelCount = providerEntries.reduce((total, item) => total + Object.keys(item.models).length, 0)
      if (modelCount < 1) {
        return yield* failure("Nenhum modelo efetivo carregado após aplicar a configuração Markspanel.")
      }

      yield* provider.defaultModel().pipe(
        Effect.catch(() => failure("Não foi possível selecionar um modelo padrão autorizado para iniciar a TUI.")),
      )
      if (!input.model) return

      const parsed = Provider.parseModel(input.model)
      const selectedProvider = providers[parsed.providerID]
      if (!selectedProvider || !selectedProvider.models[parsed.modelID]) {
        return yield* failure(`Modelo solicitado não autorizado ou indisponível: ${input.model}`)
      }
    }),
  )
})

export * as MarkspanelStartupGate from "./startup-gate"
