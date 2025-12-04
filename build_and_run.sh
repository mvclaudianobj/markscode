#!/bin/bash

# Verificar modo
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

echo "Verificando Bun..."
if ! command -v bun >/dev/null 2>&1; then
    echo "Bun não encontrado, instalando..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

echo "Instalando dependências..."
rm -rf node_modules/.cache
bun install

# Detectar plataforma
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
if [[ "$ARCH" == "x86_64" ]]; then
    ARCH="x64"
elif [[ "$ARCH" == "aarch64" ]]; then
    ARCH="arm64"
fi

BIN_NAME="markscode-${OS}-${ARCH}-baseline"

echo "Compilando markscode..."
cd packages/markscode
chmod +x script/build.ts
./script/build.ts --single

if [[ "$MODE" == "prod" ]]; then
    echo "Instalando binário..."
    mkdir -p ~/.markscode/bin ~/.markscode/sessions
    cp packages/markscode/dist/${BIN_NAME}/bin/markscode ~/.markscode/bin/
    cp prompt_default.txt ~/.markscode/
    chmod 755 ~/.markscode/bin/markscode
    chmod -R 755 ~/.markscode

    # Preparar ambiente bash
    if ! grep -q "~/.markscode/bin" ~/.bashrc; then
        echo 'export PATH="$HOME/.markscode/bin:$PATH"' >> ~/.bashrc
        echo "Adicionado ~/.markscode/bin ao PATH no ~/.bashrc"
    fi

    echo "Executando markscode..."
    ~/.markscode/bin/markscode
else
    echo "Executando markscode em modo teste..."
    MARKSCODE_TEST=1 ./dist/${BIN_NAME}/bin/markscode
fi