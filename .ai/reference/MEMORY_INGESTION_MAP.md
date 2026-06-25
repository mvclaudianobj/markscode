# Memory Ingestion Map

## Entradas permitidas

- Markdown técnico versionável.
- Resumos de sessão sanitizados.
- Tarefas MAP/Planning sem credenciais.
- Conteúdo de documentação interna aprovado.

## Entradas proibidas

- `.env` e variantes.
- Chaves SSH/PEM/P12, tokens e credenciais.
- SQLite bruto, dumps e backups.
- Logs com cabeçalhos, cookies, Authorization ou payload privado.
- `dist/`, binários, `node_modules`, caches e artefatos temporários.

## Campos sugeridos

- `user_id`
- `session_id`
- `source`
- `source_path`
- `subject`
- `content`
- `type`: `episodic`, `semantic` ou `procedural`
- `memory_mode`: `short_term`, `long_term` ou `visual`
- `importance`
- `tags`

## Destinos

- Memories API cloud para busca global/cross-session.
- Memvid local para recall offline/privado.
- Compactação de sessão para handoff e continuidade.

## Validação

Antes de gravar, confirmar exclusões, tamanho máximo por item, ausência de secrets e rastreabilidade da fonte.
