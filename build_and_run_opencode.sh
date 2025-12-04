#!/bin/bash

# Script para build e run do opencode, similar ao build_and_run.sh do markscode
# Deve ser executado do diretório markscode, para acessar ../opencode

# Verificar se é modo teste
if [[ "$1" == "--test" || "$1" == "--dev" ]]; then
    MODE="test"
elif [[ "$1" == "--prod" || "$1" == "--release" ]]; then
    MODE="prod"
else
    read -p "Qual modo? (prod/dev): " MODE
    if [[ "$MODE" == "dev" || "$MODE" == "test" ]]; then
        MODE="test"
    else
        MODE="prod"
    fi
fi

if [[ "$MODE" == "test" ]]; then
    echo "Modo teste ativado: executando diretamente do dist."
else
    echo "Modo produção: instalando e executando do bin."
fi

# Ir para o diretório opencode
cd ../opencode

# Detectar plataforma
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
if [[ "$ARCH" == "x86_64" ]]; then
    ARCH="x64"
elif [[ "$ARCH" == "aarch64" ]]; then
    ARCH="arm64"
fi

BIN_NAME="opencode-${OS}-${ARCH}-baseline"

echo "Verificando Bun..."
if ! command -v bun >/dev/null 2>&1; then
    echo "Bun não encontrado, instalando..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

echo "Instalando dependências..."
rm -rf node_modules/.cache
bun install

echo "Compilando opencode..."
cd packages/opencode  # Ajustar se o path for diferente
chmod +x script/build.ts
./script/build.ts --single

if [[ "$MODE" == "prod" ]]; then
    echo "Instalando binário..."
    mkdir -p ~/.opencode/bin ~/.opencode/sessions
    cp dist/${BIN_NAME}/bin/opencode ~/.opencode/bin/
    cp prompt_default.txt ~/.opencode/
    chmod 755 ~/.opencode/bin/opencode
    chmod -R 755 ~/.opencode

    # Preparar ambiente bash
    if ! grep -q "~/.opencode/bin" ~/.bashrc; then
        echo 'export PATH="$HOME/.opencode/bin:$PATH"' >> ~/.bashrc
        echo "Adicionado ~/.opencode/bin ao PATH no ~/.bashrc"
    fi

    echo "Executando opencode..."
    ~/.opencode/bin/opencode
else
    echo "Executando opencode em modo teste..."
    MARKSCODE_TEST=1 ./dist/${BIN_NAME}/bin/opencode
fi