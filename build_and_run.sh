echo "Compilando markscode..."
cd packages/markscode
bun run build --single

echo "Instalando binário..."
mkdir -p ~/.markscode/sessions
cp dist/markscode-linux-x64/bin/markscode ~/.markscode/bin/
chmod 755 ~/.markscode/bin/markscode
chmod -R 755 ~/.markscode

echo "Executando markscode..."
~/.markscode/bin/markscode