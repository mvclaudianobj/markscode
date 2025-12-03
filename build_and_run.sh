#!/bin/bash

echo "Compilando markscode..."
cd packages/markscode
bun run build --single

echo "Instalando binário..."
cp dist/markscode-linux-x64/bin/markscode ~/.markscode/bin/
chmod 755 ~/.markscode/bin/markscode

echo "Executando markscode..."
~/.markscode/bin/markscode