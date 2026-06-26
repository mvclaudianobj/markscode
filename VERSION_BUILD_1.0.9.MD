# Plano de Build e Release — MarksCode 1.0.9

Este documento descreve o fluxo prático para preparar, validar, compilar e empacotar a release **MarksCode 1.0.9**, baseada no **OpenCode 1.15.10**, usando a branch/canal **11510**.

- **Release MarksCode:** `1.0.9`
- **Base OpenCode:** `1.15.10`
- **Branch/canal:** `11510`
- **Artefato versionado:** `1.0.9-11510`
- **Diretório esperado:** `/media/marcos/Arquivos/projetos/marks`

> **Objetivo:** aplicar as customizações e patches do MarksCode via `automator.sh`, validar patches críticos, selecionar providers, executar build/testes básicos e gerar artefatos empacotados com versionamento consistente.


---

## Onda 1 — Consolidação 1.0.9-11510

A Onda 1 prepara a primeira tentativa consolidada do MarksCode com base na comunidade OpenCode atual, alinhada ao canal **11510**. Quando algum ajuste histórico não existir na base atual, a referência funcional deve ser recuperada da versão anterior **1420** e portada de forma explícita, sem sobrescrever WIP do subprojeto.

- **Identidade da release:** `MarksCode 1.0.9` / artefato `1.0.9-11510`.
- **Base comunitária:** OpenCode `1.15.10`.
- **Layout alvo:** `packages/markscode/src/session/llm/request.ts` para patches de LLM/request; prompt runtime em `session/prompt.ts`; instruções em `session/instruction.ts`.
- **Bun requerido:** `^1.3.14`, lido de `markscode/package.json` (`packageManager: bun@1.3.14`). O automator deve falhar cedo quando o Bun local for menor, sugerindo `./automator.sh bun-update --version 1.3.14` ou `AUTOMATOR_AUTO_BUN_UPDATE=1`.
- **Patches adaptados ao 11510:** dialogs de importação, provider dialog com `useBindings`, updater/installation em `AppProcess`, comandos de memórias/browser antes de `sessionCommands`, seleção/cópia TUI com `keymap.intercept` e Hybrid Memory no novo array `system`.
- **Hybrid Memory/Memvid:** documentação de referência criada em `docs/reference/` para arquitetura, runtime, Memvid, runbook operacional e mapa de ingestão; o Memvid nativo inicializa cápsula local automaticamente quando o sidecar oficial estiver disponível.
- **RTK/Brain nativos:** comandos `markscode rtk <action>` e `markscode brain <action>` cobrem funcionalidades críticas sem depender dos plugins externos `openrtk` e `opencode-brain`; saídas longas usam RTK automático mantendo o output completo salvo em arquivo.

### Guardrails da Onda 1

- Não executar `customize`, `features` ou `build` nesta onda.
- Não alterar arquivos dentro de `markscode/`; validar patches em cópias temporárias.
- Não contornar a versão do Bun alterando `package.json`, `packages/script/src/index.ts` ou `script/build.ts`.
- Não versionar `.env`, chaves, bancos SQLite, logs sensíveis, dumps ou artefatos `dist/`.

### Referências criadas

- `docs/reference/MARKSCODE_1.0.9_11510_MEMORY_REFERENCE.md`
- `docs/reference/HYBRID_MEMORY_RUNTIME_REFERENCE.md`
- `docs/reference/MEMVID_MARKSCODE_REFERENCE.md`
- `docs/reference/MEMORY_OPERATIONS_RUNBOOK.md`
- `docs/reference/MEMORY_INGESTION_MAP.md`

---

## Pré-requisitos

Antes de iniciar, confirme que o ambiente local está pronto:

- [ ] Estar no diretório raiz do projeto `marks`.
- [ ] Submódulo `markscode` disponível.
- [ ] Branch do submódulo `markscode` posicionável em `11510`.
- [ ] `bun` funcional no ambiente, atendendo `packageManager: bun@1.3.14` (`^1.3.14`).
- [ ] `git` funcional e sem operações pendentes inesperadas.
- [ ] Acesso aos remotes necessários para `pull`, `push` ou tags, quando aplicável.
- [ ] Variáveis e chaves sensíveis protegidas fora do versionamento.

```bash
cd /media/marcos/Arquivos/projetos/marks
```

---

## Cautelas antes de começar

> **Atenção — secrets e arquivos não rastreados**
>
> Antes de qualquer commit, tag ou push, revise cuidadosamente o estado do Git. Não inclua arquivos como `.env`, tokens, chaves privadas, credenciais, dumps, logs sensíveis ou arquivos temporários.

Comandos recomendados para inspeção inicial:

```bash
git status -sb
git branch --show-current
git -C markscode status -sb
git -C markscode branch --show-current
```

Se houver arquivos não rastreados ou alterações inesperadas, interrompa o fluxo e revise antes de continuar.

---

## Caminho rápido — build local sem release

Use este caminho para validar rapidamente o fluxo local sem marcar build como release:

```bash
cd /media/marcos/Arquivos/projetos/marks

./automator.sh update && \
./automator.sh create 11510 && \
./automator.sh validate-patches --strict
./automator.sh customize
./automator.sh features
./automator.sh web-fix
./automator.sh provider-auth-fallback
./automator.sh provider-dialog-ui
./automator.sh memories-api-mode --public
./automator.sh memories-persistent
./automator.sh providers-select --ids marks,zen,kil,local-proxy --free
./automator.sh validate-patches --strict

./automator.sh build --markscode --single --version 1.0.9-11510 --channel 11510
./automator.sh run --version
./automator.sh run
```

Use o caminho rápido para checar se a base, os patches e os providers continuam compatíveis antes de gerar artefatos finais.


### Plugins globais + skill sessão-inteligente

A release 1.0.9 deve instalar, junto com a skill `sessao-inteligente`, a lista padrão de plugins em `automator_files/plugins_and_skills/plugins.list` via:

```bash
./plugins_and_skills.sh
```

Plugins externos padrão esperados:

- `@tarquinen/opencode-dcp@latest`
- `@mohak34/opencode-notifier@latest`
- `opencode-supermemory@latest`

No primeiro load de config, o build do MarksCode deve garantir esses plugins externos em `${XDG_CONFIG_HOME:-~/.config}/markscode/markscode.json`, preservando configs existentes e sem migrar/remover `~/.config/opencode`.

RTK e Brain são nativos no binário Markscode via `markscode rtk` e `markscode brain`; não instale `openrtk@latest` nem `opencode-brain@latest` como plugins padrão. Se já existirem em config local do usuário, remova apenas com autorização explícita.

O RTK nativo comprime automaticamente saídas longas de ferramentas e reduz consumo de tokens, preservando a saída completa em `${XDG_DATA_HOME:-~/.local/share}/markscode/tool-output`. Pré-requisito operacional apenas quando usado em modo externo/legado:

```bash
cargo install rtk
```

O Brain nativo usa Hybrid Memory local-first, auto-inicializa a cápsula Memvid local no primeiro status/startup quando o sidecar oficial está disponível, e só deve chamar cloud quando houver chave/config explícita.

---

## Fluxo completo da release 1.0.9

### 1. Gate inicial

Confirme branch, estado do repositório e validade dos patches antes de aplicar mudanças:

```bash
cd /media/marcos/Arquivos/projetos/marks

git branch --show-current
git status -sb
git -C markscode branch --show-current
git -C markscode status -sb

./automator.sh validate-patches --strict
```

Checklist do gate:

- [ ] Repositório raiz em branch esperada.
- [ ] Submódulo `markscode` em estado conhecido.
- [ ] Sem secrets ou arquivos temporários prestes a entrar em commit.
- [ ] `validate-patches --strict` executado antes das alterações.

---

### 2. Atualizar base OpenCode 1.15.10 / branch 11510

Posicione o submódulo `markscode` na branch/canal `11510`:

```bash
./automator.sh update

git -C markscode checkout 11510
git -C markscode pull --ff-only origin 11510
git -C markscode status -sb
```

> **Nota:** o canal `11510` representa a base OpenCode `1.15.10` usada para esta release MarksCode.

---

### 3. Aplicar customizações MarksCode

Aplique as customizações principais e os patches de features usando o automator:

```bash
./automator.sh customize
./automator.sh features
```

Essas etapas devem manter a identidade do MarksCode e reaplicar os ajustes funcionais esperados sobre a base OpenCode `1.15.10`.

---

### 4. Aplicar patches de runtime, web, memória e providers

Aplique os patches operacionais necessários para runtime, prompt, providers e memória híbrida:

```bash
./automator.sh web-fix
./automator.sh provider-auth-fallback
./automator.sh provider-dialog-ui
./automator.sh memories-api-mode --public
./automator.sh memories-persistent
```

Valide especialmente os seguintes pontos após a aplicação:

- [ ] Patches de runtime do prompt aplicados sem conflito.
- [ ] Integração de **Hybrid Memory** mantida.
- [ ] Integração/compatibilidade com **Memvid** preservada quando aplicável.
- [ ] Modo público da Memories API aplicado.
- [ ] Persistência de memória habilitada.
- [ ] Correções de UI/dialog de providers aplicadas.
- [ ] Fallback de autenticação dos providers aplicado.

---

### 5. Selecionar providers padrão

Selecione os providers padrão do MarksCode para a release:

```bash
./automator.sh providers-select --ids marks,zen,kil --with-anthropic --with-copilot
```

Providers esperados no preset principal:

- `marks`
- `zen`
- `kil`

Quando necessário, valide o preset em ambiente temporário:

```bash
tmp=$(mktemp -d) && HOME="$tmp" XDG_CONFIG_HOME="$tmp/.config" bash ./providers --preset main --no-fenix-top50
```

---

### 6. Validar patches após customizações

Rode a validação estrita novamente após todas as customizações e patches:

```bash
./automator.sh validate-patches --strict
```

Não prossiga para build se a validação falhar. Corrija o conflito ou ajuste o patch antes de continuar.

---

### 7. Build da release

Comando recomendado para a release oficial `1.0.9-11510`:

```bash
./automator.sh build --markscode --single --version 1.0.9-11510 --channel 11510 --release
```

Variante local para teste, sem flag de release:

```bash
./automator.sh build --markscode --single --version 1.0.9-11510 --channel 11510
```

Depois do build, confira a versão e faça uma execução básica:

```bash
./automator.sh run --version
./automator.sh run
```

---

### 8. Empacotar artefatos

Gere os binários/artefatos versionados:

```bash
./automator.sh pack-bin --markscode --version 1.0.9-11510 --all
```

Confirme que os artefatos produzidos usam o versionamento `1.0.9-11510` de forma consistente.

---

## Pacotes por distro/plataforma

Esta seção descreve o fluxo objetivo para gerar os artefatos do **MarksCode 1.0.9** usando o script atual `packages/markscode/script/build.ts`.

### Pré-requisitos

- Bun `1.3.14+`.
- `npm`/Node.js para empacotar plugins.
- `gh` opcional para upload de release no GitHub.

### Build single nativo

Gera o artefato nativo da plataforma atual:

```bash
cd markscode && OPENCODE_VERSION=1.0.9 OPENCODE_CHANNEL=release-1.0.9 bun --cwd packages/markscode run build --single
```

### Build all targets/release

Gera todos os targets configurados e, com `OPENCODE_RELEASE=1`, cria/upload da release `v1.0.9` no GitHub conforme `GH_REPO`:

```bash
cd markscode && OPENCODE_VERSION=1.0.9 OPENCODE_CHANNEL=release-1.0.9 OPENCODE_RELEASE=1 GH_REPO=mvclaudianobj/markscode bun --cwd packages/markscode run build
```

### Targets atuais e nomes esperados

- `linux-arm64.tar.gz`
- `linux-x64.tar.gz`
- `linux-x64-baseline.tar.gz`
- `linux-arm64-musl.tar.gz`
- `linux-x64-musl.tar.gz`
- `linux-x64-musl-baseline.tar.gz`
- `darwin-arm64.zip`
- `darwin-x64.zip`
- `darwin-x64-baseline.zip`
- `windows-arm64.zip`
- `windows-x64.zip`
- `windows-x64-baseline.zip`

### Mapa por distro/plataforma

- Ubuntu/Debian/Fedora/Arch/openSUSE/RHEL: `linux-x64.tar.gz`; use `linux-x64-baseline.tar.gz` em CPUs antigas.
- Alpine: `linux-x64-musl.tar.gz`; use `linux-x64-musl-baseline.tar.gz` em CPUs antigas.
- Raspberry/ARM server: `linux-arm64.tar.gz`.
- macOS Apple Silicon: `darwin-arm64.zip`.
- macOS Intel: `darwin-x64.zip`; use `darwin-x64-baseline.zip` em Macs Intel antigos quando necessário.
- Windows x64: `windows-x64.zip`; use `windows-x64-baseline.zip` em CPUs antigas.
- Windows ARM: `windows-arm64.zip`.

### Plugins

VS Code:

```bash
npm install && npm run package && vsce package --allow-missing-repository
```

Sublime Text: gere o `.sublime-package` criando um zip a partir da raiz do plugin.

### Validações

```bash
bun typecheck
dist/<target>/bin/markscode --version
markscode models --free
markscode markspanel quota
markscode memories diagnose
```

### Notas

- Linux usa `tar.gz`; macOS e Windows usam `zip`, conforme `packages/markscode/script/build.ts`.
- A release GitHub cria/upload de `v1.0.9` quando `OPENCODE_RELEASE=1`.

---

## Validações funcionais recomendadas

### Auth diário e Memories API

- [ ] Executar o binário gerado.
- [ ] Confirmar prompt de usuário/senha quando aplicável.
- [ ] Confirmar senha mascarada no terminal/UI.
- [ ] Confirmar resposta `ok` da API de autenticação.
- [ ] Confirmar recebimento e persistência de `api_key`.
- [ ] Confirmar que `MEMORIES_API_KEY` fica disponível para uso posterior.

### Updater com fallback

Verifique se a ordem de fallback do updater continua correta em `packages/markscode/src/installation/index.ts`:

1. `https://code.marks.ia.br/bin/latest.json`
2. `https://code.marks.ia.br/bin/latest.txt`
3. `https://marks.fenixsol.com.br/bin/latest.json`
4. `https://marks.fenixsol.com.br/bin/latest.txt`

### Providers e presets

- [ ] Preset principal aplica `marks`, `zen` e `kil`.
- [ ] Providers adicionais, quando habilitados, não removem os providers principais.
- [ ] Fallback de autenticação funciona quando credenciais primárias não estão disponíveis.
- [ ] Diálogo/UI de provider abre sem erro.

### Runtime, prompt, Hybrid Memory e Memvid

- [ ] Runtime inicia sem erro.
- [ ] Prompt runtime carrega customizações MarksCode.
- [ ] Hybrid Memory inicializa sem quebrar execução básica.
- [ ] Memvid permanece compatível quando habilitado.
- [ ] Memories API opera no modo esperado.
- [ ] Persistência de memória não grava dados sensíveis em local versionado.

---

## Checklist final da release

- [ ] Diretório atual é `/media/marcos/Arquivos/projetos/marks`.
- [ ] Branch/canal do submódulo `markscode` é `11510`.
- [ ] Base OpenCode `1.15.10` atualizada com `pull --ff-only`.
- [ ] `./automator.sh validate-patches --strict` passou antes das customizações.
- [ ] `./automator.sh customize` executado.
- [ ] `./automator.sh features` executado.
- [ ] Patches `web-fix`, `provider-auth-fallback` e `provider-dialog-ui` aplicados.
- [ ] Patches de Hybrid Memory/Memvid/prompt runtime validados.
- [ ] `memories-api-mode --public` aplicado.
- [ ] `memories-persistent` aplicado.
- [ ] Providers `marks`, `zen` e `kil` selecionados.
- [ ] `./automator.sh validate-patches --strict` passou após os patches.
- [ ] Build `1.0.9-11510` concluído.
- [ ] `./automator.sh run --version` retornou a versão esperada.
- [ ] `./automator.sh run` abriu sem erro crítico.
- [ ] `pack-bin --all` gerou artefatos esperados.
- [ ] Artefatos usam versão `1.0.9-11510` e canal `11510`.
- [ ] `git status -sb` revisado antes de qualquer commit/tag/push.
- [ ] Nenhum secret, token, chave, `.env` ou arquivo temporário será versionado.

---

## Comandos consolidados da release

Bloco completo para execução manual e sequencial:

```bash
cd /media/marcos/Arquivos/projetos/marks

git branch --show-current
git status -sb
git -C markscode branch --show-current
git -C markscode status -sb

./automator.sh validate-patches --strict

./automator.sh update
git -C markscode checkout 11510
git -C markscode pull --ff-only origin 11510

./automator.sh customize
./automator.sh features

./automator.sh web-fix
./automator.sh provider-auth-fallback
./automator.sh provider-dialog-ui
./automator.sh memories-api-mode --public
./automator.sh memories-persistent

./automator.sh providers-select --ids marks,zen,kil,openai,local-proxy,local-proxy2 --free --with-anthropic --auto-compaction true

./automator.sh validate-patches --strict

./automator.sh build --markscode --single --version 1.0.9-11510 --channel 11510 --release
./automator.sh run --version
./automator.sh run
./automator.sh pack-bin --markscode --version 1.0.9-11510 --all
```

---

## Commit, tag e publicação

Este documento não executa commit, tag ou push automaticamente. Caso a release seja publicada, revise antes:

```bash
git status -sb
git -C markscode status -sb
```

Somente prossiga se não houver arquivos sensíveis ou alterações inesperadas.

> **Importante:** não faça `push`, criação de tag ou cherry-pick sem confirmar que os artefatos, patches e arquivos versionados estão corretos.

---

## Observações finais

- Use sempre `1.0.9` para a versão da release MarksCode.
- Use sempre `1.0.9-11510` para o artefato versionado.
- Use sempre `11510` como channel desta release.
- Evite misturar referências antigas como `1.09`, `1.09-11510` ou `1.09-1420`.
- Em caso de falha no `validate-patches`, trate o erro antes de continuar para build ou empacotamento.
