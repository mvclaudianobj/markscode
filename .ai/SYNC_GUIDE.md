# Sync

Rebase sobre `dev` e envia a branch atual.

---

## Como usar

```bash
./automator.sh sync
./automator.sh sync 1.1.48
```

---

## Entenda o que acontece

- Atualiza `dev` para espelhar exatamente `opencode/dev` (via `reset --hard`, com branch de backup se `dev` divergiu)
- Faz rebase da branch atual em cima da `dev` atualizada para reduzir conflitos
- Faz `push` da branch atual e opcionalmente cria/taggeia a versão quando você passa um número

---

## Resolva problemas comuns

```bash
# PATH shadowing / cache do shell
type -a markscode
which -a markscode
hash -r

# Smoke-check rápido antes de build
./automator.sh check
```
