echo "Verificando Bun..."
if ! command -v bun >/dev/null 2>&1; then
    echo "Bun não encontrado, instalando..."
    curl -fsSL https://bun.sh/install | bash
    source ~/.bashrc
fi

echo "Instalando dependências..."
rm -rf node_modules/.cache
bun install

echo "Compilando markscode..."
cd packages/markscode
./script/build.ts --single

echo "Comprimindo binário..."
cd dist/markscode-linux-x64-baseline/bin
tar -czf ../../../markscode-linux-x64-baseline.tar.gz markscode
cd ../../../..

echo "Instalando binário..."
mkdir -p ~/.markscode/sessions
cp dist/markscode-linux-x64-baseline/bin/markscode ~/.markscode/bin/
cp prompt_default.txt ~/.markscode/
chmod 755 ~/.markscode/bin/markscode
chmod -R 755 ~/.markscode

echo "Executando markscode..."
~/.markscode/bin/markscode