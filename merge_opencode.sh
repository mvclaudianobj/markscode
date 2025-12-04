#!/bin/bash

# Script para merge de alterações da branch dev do opencode
# Atualiza, filtra diferenças e tenta mergear na branch markscode

set -e

OPENCODE_REPO="https://github.com/sst/opencode.git"
OPENCODE_BRANCH="dev"
LOCAL_OPENCODE_BRANCH="opencode-dev"
MAIN_BRANCH="markscode"

# Arquivos/diretórios a ignorar (específicos do markscode)
IGNORE_PATTERNS=("memories" "markscode-specific" "custom-ui")

echo "Atualizando branch $LOCAL_OPENCODE_BRANCH com $OPENCODE_REPO $OPENCODE_BRANCH..."
git fetch $OPENCODE_REPO $OPENCODE_BRANCH:$LOCAL_OPENCODE_BRANCH

echo "Checkout para $MAIN_BRANCH..."
git checkout $MAIN_BRANCH
git pull origin $MAIN_BRANCH

echo "Analisando diferenças entre $MAIN_BRANCH e $LOCAL_OPENCODE_BRANCH..."

# Listar arquivos modificados, ignorando padrões
DIFF_FILES=$(git diff --name-only $MAIN_BRANCH $LOCAL_OPENCODE_BRANCH | grep -v -E "$(IFS=\|; echo "${IGNORE_PATTERNS[*]}")" || true)

if [ -z "$DIFF_FILES" ]; then
    echo "Nenhuma diferença relevante encontrada."
    exit 0
fi

echo "Arquivos com diferenças (ignorando padrões específicos):"
echo "$DIFF_FILES"

# Filtrar diffs que são apenas replaces de "opencode" para "markscode"
echo "Filtrando mudanças que são apenas 'opencode' -> 'markscode'..."

RELEVANT_CHANGES=""
for file in $DIFF_FILES; do
    # Verificar se o arquivo existe em ambas as branches
    if git show $LOCAL_OPENCODE_BRANCH:$file > /dev/null 2>&1 && git show $MAIN_BRANCH:$file > /dev/null 2>&1; then
        # Diff e filtrar linhas que só mudam opencode para markscode
        DIFF_CONTENT=$(git diff $MAIN_BRANCH $LOCAL_OPENCODE_BRANCH -- $file)
        FILTERED_DIFF=$(echo "$DIFF_CONTENT" | grep -vE '^[-+].*opencode' | grep -vE '^[-+].*markscode' || echo "$DIFF_CONTENT")
        if [ -n "$FILTERED_DIFF" ]; then
            RELEVANT_CHANGES="$RELEVANT_CHANGES$file\n"
        fi
    else
        # Arquivo novo ou removido
        RELEVANT_CHANGES="$RELEVANT_CHANGES$file (novo/removido)\n"
    fi
done

if [ -z "$RELEVANT_CHANGES" ]; then
    echo "Nenhuma mudança relevante além de replaces 'opencode' -> 'markscode'."
    exit 0
fi

echo "Mudanças relevantes (melhorias, bugs, etc.):"
echo -e "$RELEVANT_CHANGES"

echo "Tentando mergear $LOCAL_OPENCODE_BRANCH em $MAIN_BRANCH..."
if git merge $LOCAL_OPENCODE_BRANCH --no-commit --no-ff; then
    echo "Merge realizado com sucesso. Revise e commite."
else
    echo "Conflitos detectados. Arquivos com conflitos:"
    git status --porcelain | grep "^UU" | awk '{print $2}'
    echo "Sugestão: Resolva conflitos priorizando $MAIN_BRANCH (markscode). Use 'git checkout --ours <file>' para manter versão atual, ou edite manualmente."
    echo "Após resolver, execute 'git commit'."
fi