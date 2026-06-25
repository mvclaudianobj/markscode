# MarksCode 1.0.9-11510 — Memory Reference

## Identidade

- Release: MarksCode `1.0.9`.
- Artefato: `1.0.9-11510`.
- Base comunitária: OpenCode `1.15.10`.
- Canal/branch operacional: `11510`.

## Componentes

- **Memories API**: backend HTTP usado para busca avançada, contexto global, compactação de sessão e handoff.
- **Hybrid Memory**: camada runtime que combina cloud (`memories-api.ts`) e memória local/Memvid (`memory-hybrid.ts`).
- **Memvid**: armazenamento/consulta local opcional para contexto visual/textual persistente.

## Arquivos-chave

- `packages/markscode/src/memories-api.ts`
- `packages/markscode/src/memory-hybrid.ts`
- `packages/markscode/src/session/prompt.ts`
- `packages/markscode/src/session/instruction.ts`
- `packages/markscode/src/cli/cmd/memories.ts`

## Variáveis

- `MEMORIES_API_KEY`: chave obrigatória para endpoints protegidos.
- `MEMORIES_USER_ID`: identidade lógica do usuário, default seguro `marks-local`.
- `MARKSCODE_HYBRID_MEMORY`: habilita contexto híbrido quando `1`, `true` ou `on`.
- `MARKSCODE_*`: prefixo reservado para URLs, providers, runtime e fallback MarksCode.

## Endpoints de referência

- `GET /memories/search/advanced?q=<termo>&cross_session=1&fuzzy=1`
- `GET /sessions/{session_id}/compact`
- `GET /memories/global/context`

## Segurança

Nunca ingerir ou versionar `.env`, chaves privadas, tokens, SQLite bruto, logs sensíveis, dumps, `dist/` ou binários.
