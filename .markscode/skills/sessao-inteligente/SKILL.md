---
name: sessao-inteligente
description: Orquestra o uso automatico e eficiente dos plugins dcp, notifier e supermemory no inicio, durante execucao e encerramento da sessao.
---

# Sessao Inteligente (Plugins)

Use esta skill como padrao no inicio de toda sessao de trabalho.

## Objetivo

Padronizar um fluxo unico e repetivel com os plugins ativos:

- `@tarquinen/opencode-dcp`
- `@mohak34/opencode-notifier`
- `opencode-supermemory`

## Fluxo Padrao

### 1) Inicio da sessao (contexto)

- Buscar contexto anterior na memoria global e local do projeto.
- Identificar decisoes tecnicas, pendencias e riscos abertos.
- Resumir em 3-6 bullets antes de iniciar implementacao.

### 2) Execucao (operacao)

- Priorizar comandos/rotinas do plugin DCP para tarefas repetitivas.
- Usar notifier para jobs longos (build, testes, scripts demorados) e continuar o trabalho sem bloqueio.
- Registrar pontos importantes em memoria durante marcos relevantes da tarefa.
- Para BrainSystem, combinar memória híbrida local/cloud (`saveHumanMemory`, `getHumanContext`, Memvid quando disponível) com consultas (`/memory-search-local` e `/memory-search-global`) antes de responder.

### 3) Encerramento (persistencia)

- Salvar resumo final na memoria com:
  - o que foi concluido,
  - decisoes tomadas,
  - proximos passos objetivos,
  - riscos pendentes.

## Regras de Efetividade

- Evitar uso manual disperso dos plugins: seguir sempre o fluxo inicio -> execucao -> encerramento.
- Em tarefas longas, acionar notifier cedo para evitar espera passiva.
- Sempre fechar sessao com memoria consolidada para reduzir retrabalho na proxima abertura.

## Checklist Rapido

- Memoria inicial carregada
- DCP usado para operacoes padronizadas
- Notifier ativo para tarefas longas
- Memoria final salva com proximos passos
