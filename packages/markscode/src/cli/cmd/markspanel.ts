import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import { defaultMarkspanelUrl, markspanelLoginEffect } from "./account"

export const MarkspanelCommand = effectCmd({
  command: "markspanel-login [url]",
  describe: "Entrar no Markspanel usando código de dispositivo ou usuário/senha",
  instance: false,
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "URL do Markspanel/console compatível com /auth/device/code e /auth/device/login",
      type: "string",
    }),
  handler: Effect.fn("Cli.markspanel.login")(function* (args) {
    UI.empty()
    yield* Effect.sync(() => {
      UI.println("Login Markspanel: disponível via código de dispositivo (navegador) ou usuário/senha diretamente.")
      UI.println("Modo código de dispositivo: o CLI abrirá a página de verificação no navegador.")
      UI.println("Modo usuário/senha: credenciais são enviadas diretamente ao servidor, nunca armazenadas localmente.")
      UI.println("Aviso: os modelos de /api/config só carregam quando há organização ativa.")
    })
    yield* Effect.orDie(markspanelLoginEffect(args.url ?? defaultMarkspanelUrl))
  }),
})
