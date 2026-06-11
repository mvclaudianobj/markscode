import { cmd } from "./cmd"
import { Duration, Effect, Match, Option } from "effect"
import { UI } from "../ui"
import { Account } from "@/account/account"
import { AccountID, OrgID, PollExpired, PollSuccess, type PollResult, type AccountError } from "@/account/schema"
import { effectCmd } from "../effect-cmd"
import * as Prompt from "../effect/prompt"
import open from "open"

const openBrowser = Effect.fnUntraced(function* (url: string) {
  const opened = yield* Effect.promise(async () => {
    try {
      await open(url)
      return true
    } catch {
      return false
    }
  })
  if (!opened) {
    yield* println("Não foi possível abrir o navegador automaticamente.")
    yield* println("Abra manualmente: " + url)
  }
  return opened
})

const println = (msg: string) => Effect.sync(() => UI.println(msg))

const dim = (value: string) => UI.Style.TEXT_DIM + value + UI.Style.TEXT_NORMAL

const activeSuffix = (isActive: boolean) => (isActive ? dim(" (active)") : "")

export const defaultConsoleUrl = "https://console.opencode.ai"
export const defaultMarkspanelUrl = "https://marks.ia.br"

export const formatAccountLabel = (account: { email: string; url: string }, isActive: boolean) =>
  `${account.email} ${dim(account.url)}${activeSuffix(isActive)}`

const formatOrgChoiceLabel = (account: { email: string }, org: { name: string }, isActive: boolean) =>
  `${org.name} (${account.email})${activeSuffix(isActive)}`

export const formatOrgLine = (
  account: { email: string; url: string },
  org: { id: string; name: string },
  isActive: boolean,
) => {
  const dot = isActive ? UI.Style.TEXT_SUCCESS + "●" + UI.Style.TEXT_NORMAL : " "
  const name = isActive ? UI.Style.TEXT_HIGHLIGHT_BOLD + org.name + UI.Style.TEXT_NORMAL : org.name
  return `  ${dot} ${name}  ${dim(account.email)}  ${dim(account.url)}  ${dim(org.id)}`
}

const isActiveOrgChoice = (
  active: Option.Option<{ id: AccountID; active_org_id: OrgID | null }>,
  choice: { accountID: AccountID; orgID: OrgID },
) => Option.isSome(active) && active.value.id === choice.accountID && active.value.active_org_id === choice.orgID

const loginEffect = Effect.fn("login")(function* (url: string) {
  const service = yield* Account.Service

  yield* Prompt.intro("Log in")
  const login = yield* service.login(url)

  yield* Prompt.log.info("Go to: " + login.url)
  yield* Prompt.log.info("Enter code: " + login.user)
  yield* openBrowser(login.url)

  const s = Prompt.spinner()
  yield* s.start("Waiting for authorization...")

  const poll = (wait: Duration.Duration): Effect.Effect<PollResult, AccountError> =>
    Effect.gen(function* () {
      yield* Effect.sleep(wait)
      const result = yield* service.poll(login)
      if (result._tag === "PollPending") return yield* poll(wait)
      if (result._tag === "PollSlow") return yield* poll(Duration.sum(wait, Duration.seconds(5)))
      return result
    })

  const result = yield* poll(login.interval).pipe(
    Effect.timeout(login.expiry),
    Effect.catchTag("TimeoutError", () => Effect.succeed(new PollExpired())),
  )

  yield* Match.valueTags(result, {
    PollSuccess: (r) =>
      Effect.gen(function* () {
        yield* s.stop("Logged in as " + r.email)
        yield* Prompt.outro("Done")
      }),
    PollExpired: () => s.stop("Device code expired", 1),
    PollDenied: () => s.stop("Authorization denied", 1),
    PollError: (r) => s.stop("Error: " + String(r.cause), 1),
    PollPending: () => s.stop("Unexpected state", 1),
    PollSlow: () => s.stop("Unexpected state", 1),
  })
})

const verifyMarkspanelConfig = Effect.fn("markspanel.config.verify")(function* (
  service: Account.Interface,
  accountID: AccountID,
  orgID: OrgID,
) {
  const config = yield* service.config(accountID, orgID).pipe(
    Effect.catch(() =>
      Effect.gen(function* () {
        yield* println("/api/config Markspanel não retornou configuração")
        return Option.none<Record<string, unknown>>()
      }),
    ),
  )
  if (Option.isSome(config)) {
    yield* println("/api/config Markspanel carregado")
    return
  }
  yield* println("/api/config Markspanel não retornou configuração")
})

const passwordLoginAttempt = (
  service: Account.Interface,
  url: string,
  email: string,
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const passwordResult = yield* Prompt.password({
      message: "Digite sua senha:",
      validate: (v) => (!v ? "A senha não pode ser vazia." : undefined),
    })
    if (Option.isNone(passwordResult)) {
      yield* println("Login cancelado.")
      return
    }
    const password = passwordResult.value

    const s = Prompt.spinner()
    yield* s.start("Autenticando...")

    const loginOk = yield* service.loginWithPassword({ url, email, password }).pipe(
      Effect.map((r) => Option.some(r)),
      Effect.catch((err) =>
        Effect.gen(function* () {
          yield* s.stop("Falha na autenticação.", 1)
          yield* println(
            "Erro: " + (err instanceof Error ? err.message : String((err as { message?: string }).message ?? err)),
          )
          yield* println("Verifique seu e-mail e senha.")
          return Option.none<PollSuccess>()
        }),
      ),
    )

    if (Option.isSome(loginOk)) {
      yield* s.stop("Autenticado como " + loginOk.value.email)
      yield* Prompt.outro("Login concluído")
      return
    }

    const retryResult = yield* Prompt.select({
      message: "O que deseja fazer?",
      options: [
        { value: "retry" as const, label: "Tentar novamente com outra senha" },
        { value: "exit" as const, label: "Cancelar e sair" },
      ],
    })
    if (Option.isNone(retryResult) || retryResult.value === "exit") {
      yield* println("Login cancelado.")
      return
    }
    return yield* passwordLoginAttempt(service, url, email)
  }).pipe(Effect.orDie)

const loginEffectWithPassword = Effect.fn("markspanel.login.password")(function* (url: string) {
  const service = yield* Account.Service

  yield* Prompt.intro("Login Markspanel")

  const emailResult = yield* Prompt.text({
    message: "Digite seu e-mail:",
    placeholder: "usuario@exemplo.com",
    validate: (v) => (!v || !v.includes("@") ? "Informe um e-mail válido." : undefined),
  })
  if (Option.isNone(emailResult)) {
    yield* println("Login cancelado.")
    return
  }

  yield* passwordLoginAttempt(service, url, emailResult.value)
})

export const markspanelLoginEffect = Effect.fn("markspanel.login")(function* (url = defaultMarkspanelUrl) {
  const authMethodResult = yield* Prompt.select({
    message: "Escolha o método de autenticação Markspanel:",
    options: [
      { value: "device" as const, label: "Entrar com código de dispositivo (abre navegador)" },
      { value: "password" as const, label: "Entrar com usuário e senha" },
    ],
  })

  if (Option.isNone(authMethodResult)) {
    yield* println("Autenticação cancelada.")
    return
  }

  if (authMethodResult.value === "password") {
    yield* loginEffectWithPassword(url)
  } else {
    yield* loginEffect(url)
  }

  const service = yield* Account.Service
  const groups = yield* service.orgsByAccount()
  const active = yield* service.active()
  const choices = groups.flatMap((group) => group.orgs.map((org) => ({ accountID: group.account.id, orgID: org.id, label: formatOrgChoiceLabel(group.account, org, false) })))
  if (choices.length === 0) {
    yield* println("Aviso: nenhuma organização ativa/encontrada no Markspanel; /api/config não carregará modelos sem active_org_id.")
    return
  }
  if (Option.isSome(active) && active.value.active_org_id) {
    yield* println("Organização ativa detectada; /api/config poderá carregar modelos Markspanel.")
    yield* verifyMarkspanelConfig(service, active.value.id, active.value.active_org_id)
    return
  }
  if (choices.length === 1) {
    const choice = choices[0]!
    yield* service.use(choice.accountID, Option.some(choice.orgID))
    yield* println("Organização Markspanel ativada automaticamente: " + choice.label)
    yield* verifyMarkspanelConfig(service, choice.accountID, choice.orgID)
    return
  }
  const selected = yield* Prompt.select({ message: "Selecione a organização Markspanel para carregar modelos", options: choices.map((choice) => ({ value: choice, label: choice.label })) })
  if (Option.isNone(selected)) {
    yield* println("Aviso: nenhuma organização Markspanel selecionada; /api/config não carregará modelos sem active_org_id.")
    return
  }
  yield* service.use(selected.value.accountID, Option.some(selected.value.orgID))
  yield* println("Organização Markspanel ativada: " + selected.value.label)
  yield* verifyMarkspanelConfig(service, selected.value.accountID, selected.value.orgID)
})

const logoutEffect = Effect.fn("logout")(function* (email?: string) {
  const service = yield* Account.Service
  const accounts = yield* service.list()
  if (accounts.length === 0) return yield* println("Not logged in")

  if (email) {
    const match = accounts.find((a) => a.email === email)
    if (!match) return yield* println("Account not found: " + email)
    yield* service.remove(match.id)
    yield* Prompt.outro("Logged out from " + email)
    return
  }

  const active = yield* service.active()
  const activeID = Option.map(active, (a) => a.id)

  yield* Prompt.intro("Log out")

  const opts = accounts.map((a) => {
    const isActive = Option.isSome(activeID) && activeID.value === a.id
    return {
      value: a,
      label: formatAccountLabel(a, isActive),
    }
  })

  const selected = yield* Prompt.select({ message: "Select account to log out", options: opts })
  if (Option.isNone(selected)) return

  yield* service.remove(selected.value.id)
  yield* Prompt.outro("Logged out from " + selected.value.email)
})

interface OrgChoice {
  orgID: OrgID
  accountID: AccountID
  label: string
}

const switchEffect = Effect.fn("switch")(function* () {
  const service = yield* Account.Service

  const groups = yield* service.orgsByAccount()
  if (groups.length === 0) return yield* println("Not logged in")

  const active = yield* service.active()

  const opts = groups.flatMap((group) =>
    group.orgs.map((org) => {
      const isActive = isActiveOrgChoice(active, { accountID: group.account.id, orgID: org.id })
      return {
        value: { orgID: org.id, accountID: group.account.id, label: org.name },
        label: formatOrgChoiceLabel(group.account, org, isActive),
      }
    }),
  )
  if (opts.length === 0) return yield* println("No orgs found")

  yield* Prompt.intro("Switch org")

  const selected = yield* Prompt.select<OrgChoice>({ message: "Select org", options: opts })
  if (Option.isNone(selected)) return

  const choice = selected.value
  yield* service.use(choice.accountID, Option.some(choice.orgID))
  yield* Prompt.outro("Switched to " + choice.label)
})

const orgsEffect = Effect.fn("orgs")(function* () {
  const service = yield* Account.Service

  const groups = yield* service.orgsByAccount()
  if (groups.length === 0) return yield* println("No accounts found")
  if (!groups.some((group) => group.orgs.length > 0)) return yield* println("No orgs found")

  const active = yield* service.active()

  for (const group of groups) {
    for (const org of group.orgs) {
      const isActive = isActiveOrgChoice(active, { accountID: group.account.id, orgID: org.id })
      yield* println(formatOrgLine(group.account, org, isActive))
    }
  }
})

const openEffect = Effect.fn("open")(function* () {
  const service = yield* Account.Service
  const active = yield* service.active()
  if (Option.isNone(active)) return yield* println("No active account")

  const url = active.value.url
  yield* openBrowser(url)
  yield* Prompt.outro("Opened " + url)
})

export const LoginCommand = effectCmd({
  command: "login [url]",
  describe: false,
  instance: false,
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "server URL",
      type: "string",
    }),
  handler: Effect.fn("Cli.account.login")(function* (args) {
    UI.empty()
    yield* Effect.orDie(loginEffect(args.url ?? defaultConsoleUrl))
  }),
})

export const LogoutCommand = effectCmd({
  command: "logout [email]",
  describe: false,
  instance: false,
  builder: (yargs) =>
    yargs.positional("email", {
      describe: "account email to log out from",
      type: "string",
    }),
  handler: Effect.fn("Cli.account.logout")(function* (args) {
    UI.empty()
    yield* Effect.orDie(logoutEffect(args.email))
  }),
})

export const SwitchCommand = effectCmd({
  command: "switch",
  describe: false,
  instance: false,
  handler: Effect.fn("Cli.account.switch")(function* () {
    UI.empty()
    yield* Effect.orDie(switchEffect())
  }),
})

export const OrgsCommand = effectCmd({
  command: "orgs",
  describe: false,
  instance: false,
  handler: Effect.fn("Cli.account.orgs")(function* () {
    UI.empty()
    yield* Effect.orDie(orgsEffect())
  }),
})

export const OpenCommand = effectCmd({
  command: "open",
  describe: false,
  instance: false,
  handler: Effect.fn("Cli.account.open")(function* () {
    UI.empty()
    yield* Effect.orDie(openEffect())
  }),
})

export const ConsoleCommand = cmd({
  command: "console",
  describe: false,
  builder: (yargs) =>
    yargs
      .command({
        ...LoginCommand,
        describe: "log in to console",
      })
      .command({
        ...LogoutCommand,
        describe: "log out from console",
      })
      .command({
        ...SwitchCommand,
        describe: "switch active org",
      })
      .command({
        ...OrgsCommand,
        describe: "list orgs",
      })
      .command({
        ...OpenCommand,
        describe: "open active console account",
      })
      .demandCommand(),
  async handler() {},
})
