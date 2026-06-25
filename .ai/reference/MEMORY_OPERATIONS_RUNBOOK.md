# Memory Operations Runbook

## Modo público da Memories API

```bash
./automator.sh memories-api-mode --public
```

Use este modo para apontar para `http://api.marks.ia.br:8689` ou URL pública equivalente. Requer `MEMORIES_API_KEY`.

## Persistência

```bash
./automator.sh memories-persistent
```

Habilita comandos/integrações de memória persistente no MarksCode.

## Busca avançada

```bash
curl 'http://api.marks.ia.br:8689/memories/search/advanced?q=TERMO&cross_session=1&fuzzy=1' \
  -H "X-API-Key: $MEMORIES_API_KEY"
```

## Compactação de sessão

```bash
curl 'http://api.marks.ia.br:8689/sessions/SESSION_ID/compact' \
  -H "X-API-Key: $MEMORIES_API_KEY"
```

## Contexto global

```bash
curl 'http://api.marks.ia.br:8689/memories/global/context?query=TERMO' \
  -H "X-API-Key: $MEMORIES_API_KEY"
```

## Procedimento seguro

1. Rodar preview/dry-run para ingestão.
2. Revisar exclusões de secrets.
3. Validar contagem e fontes.
4. Gravar cloud/local apenas com escopo correto (`user_id`, `session_id`).
5. Registrar resumo operacional sem dados sensíveis.
