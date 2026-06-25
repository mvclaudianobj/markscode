# Memvid + MarksCode Reference

## Papel do Memvid

Memvid funciona como camada local opcional para memória persistente, útil quando a Memories API pública estiver lenta, indisponível ou quando o contexto precise permanecer local.

## Fontes candidatas

- Resumos de sessões MarksCode.
- Memórias humanas de longo prazo.
- Documentos técnicos aprovados.
- Conteúdo MAP/Planning sem segredos.

## Exclusões obrigatórias

Não ingerir `.env`, chaves SSH, tokens, credenciais JSON, bancos SQLite completos, logs com payload sensível, dumps, `node_modules`, `dist`, binários e artefatos de release.

## Integração

- `memory-hybrid.ts` deve expor recall e ingestão de forma segura.
- A ingestão para Memvid deve permitir `dry_run`/preview antes de gravar.
- A busca deve retornar trechos resumidos, fonte e score quando disponível.

## Fallback

Se Memvid não estiver instalado/configurado, o runtime deve continuar com cloud ou sem memória adicional, nunca bloquear o chat básico.
