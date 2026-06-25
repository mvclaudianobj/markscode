# Funcionalidades Exclusivas do MarksCode

# Este arquivo contém as funcionalidades únicas do MarksCode que devem ser preservadas

# em novas versões criadas a partir da dev do OpenCode

## Funcionalidades Exclusivas:

### 1. Sistema de Memories

- **Arquivo**: `packages/markscode/src/cli/cmd/memory.ts`
- **Função**: Sistema para salvar e recuperar informações importantes
- **Comandos**: `markscode memory create/list/search`

### 2. Import File/Image

- **Integração**: Funcionalidade de importar arquivos e imagens
- **Localização**: Integrado na interface TUI

### 3. Branding Personalizado

- **Logo ASCII CLI**: Arquivo `ascii-text-art.txt`
- **Logo TUI**: Componente `logo.tsx` com design personalizado
- **Nomenclatura**: opencode → markscode em todos os lugares

### 4. Menu Personalizado

- **Comandos exclusivos**: Memory, import tools
- **Interface customizada**: Diferente do OpenCode padrão

## Como Preservar em Novas Versões:

1. Rode `./automator.sh create <branch>` para criar a branch da versão
2. Rode `./automator.sh customize` para renomear `opencode` -> `markscode` e criar o tema do TUI se faltar
3. Rode `./automator.sh features` para aplicar patches OpenTUI e correcoes de crash conhecidas
4. Rode `./automator.sh check` e entao compile/teste antes de publicar

## Arquivos de Backup:

- `markscode-exclusive-memory.patch`: Patch do sistema de memories
- `markscode-exclusive-features.patch`: Patch geral das funcionalidades (gerado dinamicamente)

## Estratégia de Merge:

- Evite carregar customizacoes dentro da `dev`, ela deve ser um mirror do upstream
- Use `./automator.sh features` para reaplicar compatibilidade OpenTUI quando o upstream mudar
