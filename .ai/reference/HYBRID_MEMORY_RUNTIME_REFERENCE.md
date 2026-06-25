# Hybrid Memory Runtime Reference

## Objetivo

O runtime Hybrid Memory injeta contexto relevante no prompt quando a conversa ou workspace não contiver conhecimento suficiente, sem inventar dados se a memória estiver indisponível.

## Fluxo

1. O prompt runtime monta `system` com ambiente, instruções de workspace e skills.
2. Se `MARKSCODE_HYBRID_MEMORY` estiver ativo, `recallHybridMemories()` consulta cloud/local.
3. `formatMemoryContext()` gera bloco textual curto para o sistema.
4. Em falha, registra aviso e continua sem quebrar a sessão.

## Fallback

- Cloud indisponível: usar memória local/Memvid quando disponível.
- Memvid indisponível: usar Memories API.
- Ambos indisponíveis: responder com incerteza explícita e sem inventar histórico.

## Comandos relacionados

```bash
./automator.sh memories-api-mode --public
./automator.sh memories-persistent
```

## Variáveis

- `MEMORIES_API_KEY` para autenticação.
- `MEMORIES_USER_ID` para escopo pessoal.
- `MARKSCODE_HYBRID_MEMORY=1` para habilitar recall híbrido.
- `MARKSCODE_MEMORIES_API_URL` ou equivalente para endpoint customizado quando suportado.

## Observabilidade

Logs devem evitar conteúdo bruto sensível. Grave apenas estado, contadores, erro resumido e IDs não secretos.
