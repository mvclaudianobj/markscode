#!/bin/bash

# Salvar diretório inicial
ORIGINAL_DIR=$(pwd)

# Verificar se é modo teste
if [[ "$1" == "--test" || "$1" == "--dev" ]]; then
    MODE="test"
    echo "Modo teste ativado: executando diretamente do dist."
else
    MODE="prod"
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

echo "Compilando markscode..."
cd packages/markscode
chmod +x script/build.ts
./script/build.ts --single

if [[ "$MODE" == "prod" ]]; then
    echo "Instalando binário..."
    mkdir -p ~/.markscode/bin ~/.markscode/sessions
    cp packages/markscode/dist/markscode-linux-x64-baseline/bin/markscode ~/.markscode/bin/
    chmod 755 ~/.markscode/bin/markscode
    chmod -R 755 ~/.markscode

    echo "Preparando prompt..."
    cd "$ORIGINAL_DIR"
    cp prompt_default.txt .

    echo "Executando markscode..."
    ~/.markscode/bin/markscode
else
    echo "Preparando prompt..."
    cd "$ORIGINAL_DIR"
    cp prompt_default.txt .

    echo "Executando markscode em modo teste..."
    cd packages/markscode
    ./dist/markscode-linux-x64-baseline/bin/markscode
fi