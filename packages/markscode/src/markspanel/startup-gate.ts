import { Account } from "@/account/account"
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
  return yield* service.activeOrg().pipe(Effect.catch(() => Effect.succeed(Option.none())))
})

const loadConfig = Effect.fn("markspanel.startup.config")(function* (input: { active: Account.ActiveOrg; warningPrefix?: string }) {
  const service = yield* Account.Service
  const spin = Prompt.spinner()
  yield* spin.start("Carregando perfil Markspanel...")
  const config = yield* service.configActive(input.active).pipe(
    Effect.catch(() =>
      Effect.gen(function* () {
        yield* spin.stop(`${input.warningPrefix ?? "Aviso"}: erro ao carregar perfil Markspanel (rede/auth).`, 2)
        return Option.none<Record<string, unknown>>()
      }),
    ),
  )
  if (Option.isSome(config)) {
    yield* spin.stop("Perfil Markspanel recebido.")
    return config
  }
  return config
})

const continueFreeMode = Effect.fn("markspanel.startup.free")(function* (message: string) {
  yield* Prompt.log.warn(message)
  yield* Prompt.log.warn("Continuando em modo livre — verifique conexão, token ou perfil Markspanel.")
})

const configFailureChoice = Effect.fn("markspanel.startup.config.choice")(function* (active: Account.ActiveOrg) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    yield* continueFreeMode("Markspanel não carregou /api/config — usando providers locais/free.")
    return Option.none<Record<string, unknown>>()
  }

  const choice = yield* Prompt.select({
    message: "Não foi possível carregar o perfil Markspanel. O que deseja fazer?",
    options: [
      { value: "relogin" as const, label: "Resetar token / fazer login novamente (recomendado)" },
      { value: "free" as const, label: "Continuar em modo livre" },
      { value: "exit" as const, label: "Sair" },
    ],
  })

  if (Option.isNone(choice) || choice.value === "exit") {
    return yield* failure("Inicialização cancelada: perfil Markspanel não carregado e modo livre não selecionado.")
  }
  if (choice.value === "free") {
    yield* continueFreeMode("Markspanel não retornou /api/config — usando providers locais/free.")
    return Option.none<Record<string, unknown>>()
  }

  yield* markspanelLoginEffect(active.account.url || defaultMarkspanelUrl)
  const refreshed = yield* activeAccountWithOrg()
  if (Option.isNone(refreshed)) {
    return yield* failure(
      "Login Markspanel concluído sem conta/organização ativa. A TUI não será aberta sem active_org_id.",
    )
  }

  const retry = yield* loadConfig({ active: refreshed.value, warningPrefix: "Aviso após novo login" })
  if (Option.isSome(retry)) return retry

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    yield* continueFreeMode("Markspanel ainda não carregou /api/config após novo login — usando providers locais/free.")
    return Option.none<Record<string, unknown>>()
  }

  const fallback = yield* Prompt.select({
    message: "O perfil Markspanel ainda não carregou após novo login. Como deseja continuar?",
    options: [
      { value: "free" as const, label: "Continuar em modo livre" },
      { value: "exit" as const, label: "Sair" },
    ],
  })
  if (Option.isSome(fallback) && fallback.value === "free") {
    yield* continueFreeMode("Markspanel não retornou /api/config após novo login — usando providers locais/free.")
    return Option.none<Record<string, unknown>>()
  }
  return yield* failure("Inicialização cancelada: perfil Markspanel não carregado após novo login.")
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

  const email = active.value.account.email ?? active.value.account.id
  yield* Prompt.log.success(`Logado como ${email}`)

  const initialConfig = yield* loadConfig({ active: active.value })
  const config = Option.isSome(initialConfig) ? initialConfig : yield* configFailureChoice(active.value)
  if (Option.isNone(config)) {
    return
  }

  const stats = remoteConfigStats(config.value)
  if (stats.providers < 1) {
    yield* Prompt.log.warn("Aviso: nenhum provider autorizado. Continuando em modo livre.")
    yield* Prompt.log.warn("Markspanel não retornou providers — usando providers locais/free.")
    return
  }
  if (stats.models < 1) {
    yield* Prompt.log.warn("Aviso: nenhum modelo autorizado. Continuando em modo livre.")
    yield* Prompt.log.warn("Markspanel não retornou modelos — usando modelos locais/free.")
    return
  }

  yield* Prompt.log.success(
    `Perfil carregado: ${stats.providers} provider${stats.providers !== 1 ? "s" : ""}, ${stats.models} modelo${stats.models !== 1 ? "s" : ""}`,
  )
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
    }).pipe(
      Effect.timeout(5000),
      Effect.catch((error) =>
        Prompt.log.warn(
          `Aviso: validação de providers/modelos não concluída no boot; abrindo TUI sem bloquear. ${error instanceof Error ? error.message : String(error)}`,
        ),
      ),
    ),
  )
})

export * as MarkspanelStartupGate from "./startup-gate"
