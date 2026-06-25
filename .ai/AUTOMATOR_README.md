# Workflow

Fluxo atual do automator, flags e troubleshooting.

## 📋 Estrutura

```
/media/marcos/Arquivos/projetos/marks/
├── automator.sh          # Script principal de automação
├── build_and_run.sh      # Script de build e execução
├── merge_markscode_updates.sh  # Script original (deprecado)
├── customize_markscode.sh      # Script original (deprecado)
└── markscode/            # Repositório do projeto
```

## 🚀 Scripts Disponíveis

### 1. `automator.sh` - Script Principal

Automatiza todo o processo de criação de versões MarksCode.

#### Comandos Disponíveis

```bash
./automator.sh [comando] [opções]
```

| Comando                  | Descrição                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `update`                 | Atualizar `dev` como mirror do upstream (reset --hard + backup se divergir)                  |
| `create [branch]`        | Criar nova versão markscode                                                                  |
| `customize`              | Aplicar personalizações opencode → markscode                                                 |
| `features`               | Aplicar patches OpenTUI + crash fixes + TUI imports + modo remoto SSH + memories persistente |
| `memories-persistent`    | Aplicar integração de memories human (API) no runtime                                        |
| `memories-save`          | Gravar memória human (`/memories/human`)                                                     |
| `memories-context`       | Recuperar contexto human (`/memories/human/context`)                                         |
| `memories-recall`        | Recall por pista (`/memories/human/recall`)                                                  |
| `updater-fenix`          | Aplicar updater de versão via `marks.fenixsol.com.br`                                        |
| `rollback`               | Habilitar fluxo de rollback seguro no runtime                                                |
| `fenix`                  | Configurar provider Fenix                                                                    |
| `provider-auth-fallback` | Forçar plugin oficial OAuth da Anthropic (`opencode-anthropic-auth@0.0.13`)                  |
| `provider-dialog-ui`     | Aplicar patch de UX no dialog de provider (Anthropic + atalhos de cópia no OAuth)            |
| `build [flags]`          | Build (auto/opencode/markscode)                                                              |
| `test`                   | Testar binário                                                                               |
| `install [flags]`        | Instalar binário localmente (prefix/force/activate/prune)                                    |
| `commit [version]`       | Commit e tag da versão                                                                       |
| `clean`                  | Limpar caches                                                                                |
| `check`                  | Smoke-check (sem install/build)                                                              |
| `sync [version]`         | Rebase em `dev` atualizada + push da branch atual                                            |
| `full [version]`         | Executar fluxo completo                                                                      |
| `dev`                    | Modo desenvolvimento                                                                         |
| `run`                    | Executar binário existente                                                                   |

#### Fluxo Completo (Recomendado)

```bash
# Criar versão completa do MarksCode 1.0.71
./automator.sh full 1.0.71
```

Este comando executa:

1. ✅ Verificação de dependências
2. ✅ Atualização do upstream opencode/dev (dev vira mirror exato)
3. ✅ Criação da branch `markscode-1.0.71`
4. ✅ Renomeamento opencode → markscode
5. ✅ Atualização de logos e branding
6. ✅ Compatibilidade OpenTUI + correções de crash (via `features`)
7. ✅ Configuração do provider Fenix
8. ✅ Build multiplataforma
9. ✅ Teste do binário
10. ✅ Commit e tag da versão

#### Exemplos de Uso

```bash
# Apenas atualizar do upstream
./automator.sh update

# Criar nova versão manual
./automator.sh create markscode-1.0.72
./automator.sh customize
./automator.sh features
./automator.sh fenix
./automator.sh build
./automator.sh test

# Build apenas para plataforma atual (mais rápido)
./automator.sh build --single

# Build puro do OpenCode (sem customize)
./automator.sh build --opencode --single

# Forçar build do MarksCode (requer customize)
./automator.sh build --markscode --single

# Smoke-check antes de buildar
./automator.sh check

# Habilitar integração persistent memories no runtime MarksCode
./automator.sh memories-persistent

# Gravar memória human (requer MEMORIES_API_KEY)
./automator.sh memories-save \
  --user-id user:marcos \
  --session-id sessao-20260224-1 \
  --content "Usuário prefere respostas objetivas" \
  --importance 0.8 \
  --tags preferencia,estilo

# Recuperar contexto human da sessão
./automator.sh memories-context \
  --user-id user:marcos \
  --session-id sessao-20260224-1 \
  --limit 8

# Recall por gatilho/pista
./automator.sh memories-recall \
  --user-id user:marcos \
  --session-id sessao-20260224-1 \
  --cue "respostas curtas com exemplo" \
  --limit 8

# Instalar no PATH (e evitar shadowing)
./automator.sh install --prefix ~/.local/bin --prune

# Executar em modo dev
./automator.sh dev
```

#### Persistent Memories API (variáveis)

```bash
export MEMORIES_URL="http://api.marks.ia.br:8689"
export MEMORIES_API_KEY="SUA_API_KEY"
export MEMORIES_USER_ID="user:marcos"
export MEMORIES_SESSION_ID="sessao-20260224-1"
```

Notas:

- `features` já aplica automaticamente `tui-imports` + modo remoto SSH + `memories-persistent` para novas versões.
- Defaults no MarksCode: `user_id=marks-local` e API key padrão embutida (sobrescreva com `MEMORIES_API_KEY`).
- O fluxo human usa identidade estável (`user_id` + `session_id`) para deduplicação/atualização de memória.
- O save de sessão no TUI usa `memory_mode=short_term` e envia `source_name=<provider:model>` quando disponível.
- Autosave no TUI: dispara com `>= 2 minutos` e `>= 5000 caracteres` de delta; também salva ao trocar sessão e ao sair.
- `memories-persistent` injeta comandos no TUI (`save/context/recall`) e bloco `Memories` na sidebar.
- Endpoints usados pelo runtime: `/memories/human`, `/memories/human/context`, `/memories/human/recall`, `/memories/import`.
- Startup memories no binário: padrão é público; use `markscode --mem-local` (ou `markscode -mem-local`) para forçar API local.

#### Modo remoto SSH (TUI)

O comando `./automator.sh features` também aplica o patch de modo remoto SSH no diálogo de comandos da sessão (`Session`), adicionando:

- `Modo remoto (conectar sessão SSH)`
- `Modo remoto (pré-check SSH)`
- `Modo remoto (executar comando SSH)`
- `Modo remoto (status SSH)`
- `Modo remoto (desativar SSH)`

Esse patch persiste `remote_ssh_mode` e `remote_ssh_config` no KV do TUI, executa pre-check local de `ssh/sshpass`, roda comando remoto direto via menu e injeta resultados no prompt para continuidade da análise.

#### Ecosistema Marks (MVP)

Comandos adicionados para operacao local com sincronizacao opcional no `memories`:

```bash
# Inicializa estrutura local em ~/.marks/ecosystem
./automator.sh ecosystem-init

# Registra node localmente e tenta sincronizar no memories
./automator.sh ecosystem-node-register --id node-control --role control

# Registra evento localmente e tenta sincronizar no memories
./automator.sh ecosystem-event --type task.start --node node-control --task job-1 --payload '{"queue":"main"}'

# Mostra status local e consulta nodes remotos (quando houver API key)
./automator.sh ecosystem-status
```

Variaveis de ambiente do MVP:

```bash
export MARKS_ECOSYSTEM_MEMORIES_URL="http://127.0.0.1:8000"
export MARKS_ECOSYSTEM_API_KEY="SUA_API_KEY"
```

Notas:

- Sem `MARKS_ECOSYSTEM_API_KEY`, os comandos continuam funcionando localmente (com warning), sem falhar.
- Arquivos locais criados: `config.json`, `nodes.json`, `queue.jsonl`, `events.jsonl`.

#### Provider Anthropic (Claude Max)

Configura o provider Anthropic sem precisar recompilar binario (apenas `markscode.json`).

```bash
# modo manual (usa ANTHROPIC_API_KEY)
./automator.sh providers-anthropic --mode manual --enable

# modo create (mostra instrucoes para criar key)
./automator.sh providers-anthropic --mode create --enable
```

Opcional: incluir no preset principal

```bash
./automator.sh providers-select --preset main --with-anthropic
./automator.sh providers-select --preset main --with-anthropic --with-copilot
./automator.sh providers-select --ids markscode,kilo,nvidia,openai --with-anthropic --with-copilot
./automator.sh providers-select --ids markscode,kilo,nvidia,openai --without-anthropic --without-copilot
```

Script remoto `providers` (curl) com inclusao/remocao de Anthropic/Copilot:

```bash
curl -fsSL https://marks.fenixsol.com.br/providers | bash -s -- --ids markscode,kilo,nvidia,openai --with-anthropic --with-copilot
curl -fsSL https://marks.fenixsol.com.br/providers | bash -s -- --ids markscode,kilo,nvidia,openai --without-anthropic --without-copilot
```

Garantir OAuth oficial (Pro/Max) e UX do dialog:

```bash
# fixa plugin oficial que gera URL OAuth2 no Pro/Max
./automator.sh provider-auth-fallback

# aplica UI/atalhos de cópia no fluxo de autenticação
./automator.sh provider-dialog-ui
```

Atalhos no fluxo OAuth da Anthropic (telas Pro/Max e Authorization code):

- `c`
- `Ctrl+C`
- `Ctrl+Y`

#### Plugins Inovations

Comando para registrar o preset de plugins relevantes do ecossistema OpenCode no control plane local/remoto:

```bash
# Gera catálogo local em ~/.marks/ecosystem/plugins e sincroniza no memories (quando houver API key)
./automator.sh plugins-inovations
```

Saídas locais:

- `~/.marks/ecosystem/plugins/plugins-inovations.json`
- `~/.marks/ecosystem/plugins/plugins-inovations.md`

Notas:

- Sem `MARKS_ECOSYSTEM_API_KEY`, a operação permanece local (com warning).
- Com API key, o automator faz upsert em `/ecosystem/configs` com `category=plugin`.

### 2. `automator-git.sh` - Git/Submodules

Script enxuto para operar o repositório pai (`marks`) com submodules locais.

```bash
./automator-git.sh [comando]
```

| Comando                  | Descrição                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `doctor`                 | Mostra status do repo pai + submodules, detectando `dirty` e `detached HEAD`        |
| `submodule-sync`         | Executa `git submodule sync --recursive && git submodule update --init --recursive` |
| `parent-status`          | Mostra status do repo pai e lista submodules com commit atual                       |
| `commit-parent -m "msg"` | Comita no repo pai e bloqueia quando algum submodule estiver sujo                   |
| `pr-parent`              | Cria PR do repo pai com `gh pr create` (quando `gh` existir)                        |
| `deploy-check`           | Executa checklist de pré-implantação (repo pai, submodules e artefatos)             |
| `help`                   | Mostra ajuda rápida                                                                 |

#### Exemplos (Git/Submodules)

```bash
# Diagnóstico completo do pai + submodules
./automator-git.sh doctor

# Reconciliar URLs e inicialização recursiva
./automator-git.sh submodule-sync

# Ver apenas status do pai e commit atual de cada submodule
./automator-git.sh parent-status

# Commit somente no repo pai (falha se submodule estiver dirty)
./automator-git.sh commit-parent -m "chore: atualiza ponteiros de submodule"

# Criar PR no GitHub (requer gh instalado)
./automator-git.sh pr-parent

# Checklist de pré-implantação
./automator-git.sh deploy-check
```

Guia de deploy completo com submodules + ecosystem:

- `GUIA_DEPLOY_ECOSSISTEMA_SUBMODULES.md`

### 3. `build_and_run.sh` - Script de Build e Execução

Script melhorado para compilar e executar o MarksCode/OpenCode.
Ele força limpeza do `dist` antes do build para evitar "Directory not empty" quando um binário antigo ainda está em execução.

```bash
./build_and_run.sh [opções]
```

#### Opções Disponíveis

| Opção                    | Descrição                               |
| ------------------------ | --------------------------------------- |
| `--opencode, --original` | Testar versão OpenCode pura             |
| `--markscode`            | Testar versão MarksCode personalizada   |
| `--config=FILE`          | Usar arquivo de configuração específico |
| `--build`                | Executar build do binário               |
| `--run`                  | Executar binário após build             |
| `--dev`                  | Executar bun run dev                    |
| `--single`               | Build somente para a plataforma atual   |
| `--baseline`             | Build baseline (sem AVX2)               |
| `--platforms=os,os`      | Filtrar plataformas no build            |
| `--skip-install`         | Não executar bun install                |
| `--clean`                | Limpar dist e caches de build           |
| `--full-clean`           | Limpar dist, caches e node_modules      |
| `-h, --help`             | Mostrar ajuda                           |

#### Exemplos de Uso

```bash
# Build e executar (padrão)
./build_and_run.sh --build --run

# Build rápido apenas para plataforma atual
./build_and_run.sh --markscode --single --build --run

# Testar versão OpenCode pura
./build_and_run.sh --opencode --run

# Executar com config customizada
./build_and_run.sh --config=custom.json --run

# Limpeza completa + rebuild
./build_and_run.sh --full-clean --build --run

# Modo desenvolvimento
./build_and_run.sh --dev
```

## 🔄 Fluxo de Trabalho Típico

### Criação de Nova Versão

```bash
# 1. Criar versão completa
cd /media/marcos/Arquivos/projetos/marks
./automator.sh full 1.0.71

# 2. Testar manualmente
./build_and_run.sh --markscode --run

# 3. Push para remote
cd markscode
git push origin markscode-1.0.71 --tags

# 4. Testar em diferentes branches
./build_and_run.sh --opencode --run    # Testar OpenCode
./build_and_run.sh --markscode --run  # Testar MarksCode
```

### Desenvolvimento Iterativo

```bash
# 1. Atualizar do upstream
./automator.sh update

# 2. Modo dev (para testes rápidos)
./build_and_run.sh --dev

# 3. Quando estiver pronto, criar versão
./automator.sh full 1.0.72
```

## 🎯 Funcionalidades Exclusivas do MarksCode

### 1. Sistema de Memories

- Salvar informações importantes para recall futuro
- Comando `memory` disponível no CLI

### 2. Provider Fenix

- Integração com API da Fenix
- Modelos customizados:
  - `gpt-oss-120b`
  - `Qwen/Qwen3-235B-A22B-Instruct-2507`
  - `deepseek-ai/DeepSeek-V3`

### 3. Personalizações de Branding

- Logo ASCII customizado
- Nome "MarksCode" em todo o projeto
- Tema do TUI em `packages/markscode/src/cli/cmd/tui/context/theme/markscode.json` (criado no `customize` se faltar)

## 📦 Estrutura de Versões

```
markscode/
├── dev                          # Branch do upstream opencode
├── markscode-1.0.71            # Nova versão
│   └── packages/
│       └── markscode/           # (não packages/opencode)
│           ├── script/
│           ├── src/
│           │   ├── cli/
│           │   │   ├── cmd/
│           │   │   │   └── memory.ts  # Exclusivo
│           │   │   └── tui/
│           │   │       └── component/
│           │   │           └── logo.tsx  # Customizado
│           │   └── memory.ts            # Exclusivo
│           ├── markscode.json          # Config Fenix
│           └── package.json           # Renomeado
└── dist/
    ├── markscode-linux-arm64/
    ├── markscode-linux-x64/
    ├── markscode-darwin-arm64/
    ├── markscode-darwin-x64/
    └── markscode-win32-x64/
```

## 🔧 Arquivos de Configuração

### markscode.json

Configuração padrão do MarksCode com provider Fenix:

```json
{
  "$schema": "https://markscode.ai/config.json",
  "provider": {
    "fenix": {
      "name": "Fenix",
      "api": "http://api.marks.ia.br/v1",
      "npm": "@ai-sdk/openai-compatible",
      "env": ["FENIX_API_KEY"],
      "options": {
        "baseURL": "http://api.marks.ia.br/v1",
        "timeout": false
      },
      "models": {
        "gpt-oss-120b": { ... },
        "Qwen/Qwen3-235B-A22B-Instruct-2507": { ... },
        "deepseek-ai/DeepSeek-V3": { ... }
      }
    }
  },
  "model": "fenix/gpt-oss-120b",
  "permission": {
    "read": "allow",
    "list": "allow",
    "glob": "allow",
    "grep": "allow",
    "bash": "allow",
    "external_directory": "allow"
  },
  "experimental": {
    "chatMaxRetries": 0
  }
}
```

## 🌍 Suporte Multiplataforma

O automatizador constrói binários para:

| Plataforma | Arquitetura | Variante                        |
| ---------- | ----------- | ------------------------------- |
| Linux      | arm64       | glibc, musl                     |
| Linux      | x64         | glibc, musl, baseline (no AVX2) |
| macOS      | arm64       | Apple Silicon                   |
| macOS      | x64         | Intel                           |
| Windows    | x64         | x64, baseline                   |

## 🛠️ Troubleshooting

### Erro: Remote 'opencode' não configurado

```bash
cd markscode
git remote add opencode https://github.com/sst/opencode
```

### Conflitos no merge do upstream

O `update` não faz merge: ele mantém `dev` como mirror exato via `git reset --hard opencode/dev`.
Se sua `dev` local divergiu, o automator cria uma branch de backup antes do reset.

```bash
cd markscode
git branch --list "dev-backup-*"
git log --oneline -5 dev
```

### Binário não encontrado após build

```bash
./build_and_run.sh --clean --build
```

### Problemas com dependências

```bash
./build_and_run.sh --full-clean --build
```

### `bash: erro de sintaxe próximo ao token inesperado '&&'`

Isso ocorre quando o `&&` é enviado em linha separada. Rode os comandos na mesma linha, ou use `;` entre linhas.

```bash
# correto (uma linha)
./automator.sh customize && ./automator.sh features && ./automator.sh provider-auth-fallback && ./automator.sh provider-dialog-ui && ./automator.sh build --single --version 1.0.3

# também funciona (sem depender do sucesso do anterior)
./automator.sh customize; ./automator.sh features; ./automator.sh provider-auth-fallback; ./automator.sh provider-dialog-ui; ./automator.sh build --single --version 1.0.3
```

## 📦 Automator 1.0.3

Inclui estabilizações para o provider Anthropic no TUI:

- comando `provider-auth-fallback` agora fixa o plugin oficial `opencode-anthropic-auth@0.0.13` (OAuth Pro/Max)
- comando `provider-dialog-ui` aplica texto/UX de Anthropic e atalhos de cópia em telas OAuth
- fluxo de cópia no OAuth suporta `c`, `Ctrl+C` e `Ctrl+Y`

### PATH shadowing / comando antigo rodando

```bash
type -a markscode
which -a markscode
hash -r
./automator.sh install --prefix ~/.local/bin --prune
```

## 📝 Notas Importantes

1. **Não commite em `dev`**: `update` mantém `dev` como mirror do upstream
2. **Sempre rode `check` antes de build**: pega incompatibilidades OpenTUI e crashes comuns
3. **Use `--single` para iterar**: é o caminho mais rápido e confiável

## 🤝 Integração com Scripts Antigos

Os scripts originais (`merge_markscode_updates.sh`, `customize_markscode.sh`) ainda funcionam, mas são considerados **depreciados** em favor do `automator.sh`.

Migração recomendada:

| Script Antigo                           | Novo Comando                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `./customize_markscode.sh`              | `./automator.sh full <versão>`                                                          |
| `./merge_markscode_updates.sh <branch>` | `./automator.sh create <branch> && ./automator.sh customize && ./automator.sh features` |

## 📚 Referências

- [OpenCode Repository](https://github.com/sst/opencode)
- [MarksCode Documentation](https://markscode.ai/docs)
- [Bun Documentation](https://bun.sh/docs)

---

**Criado para facilitar o gerenciamento de versões do MarksCode** 🚀
