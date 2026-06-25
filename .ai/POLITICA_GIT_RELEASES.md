# Politica Git de Releases (Marks)

Objetivo: manter `main` sempre estavel, com rastreabilidade de cada versao e rollback simples.

## Branches

- `main`: branch protegida e sempre estavel.
- `release/x.y.z`: branch da versao (ex.: `release/1.0.7`).
- `feat/*` e `fix/*`: branches curtas para mudancas pontuais.
- `hotfix/x.y.z+1`: correcoes urgentes apos release.

## Regras obrigatorias

- Nao commitar direto na `main` (exceto hotfix critico com justificativa).
- Toda release nasce em `release/x.y.z`.
- Todo merge para `main` deve ser auditavel (preferir merge commit, sem squash para release).
- Rodar gate antes de merge:
  - `./automator.sh validate-patches --strict`
  - `bun typecheck` no pacote impactado.
- Garantir docs e definitions atualizados no mesmo ciclo da release.

## Fluxo padrao de release

1. Atualizar `main` local.
2. Criar branch `release/x.y.z` a partir da `main`.
3. Implementar ajustes (automator, `automator_files`, docs, definitions).
4. Validar com `validate-patches --strict` e typecheck.
5. Commitar com mensagens claras por bloco funcional.
6. Abrir PR `release/x.y.z` -> `main`.
7. Merge na `main`.
8. Criar tag `vX.Y.Z` na `main`.
9. Publicar artefatos e notas da versao.

## Convenções de nome

- Release: `release/1.0.7`
- Feature: `feat/browser-mode-template-catalog`
- Fix: `fix/dialog-provider-prompts`
- Hotfix: `hotfix/1.0.7.1`

## Checklist minimo antes do merge da release

- [ ] Patches obrigatorios passando em `validate-patches --strict`
- [ ] Browser Mode visivel no menu Session
- [ ] Provider Fenix validado (auth + modelos alvo)
- [ ] Memories validado (contexto/consulta)
- [ ] Remote-lab/multi-target validado (se aplicavel)
- [ ] Documentacao e definitions atualizadas

## Rollback

- Reverter merge commit da release na `main` se necessario.
- Nao reescrever historico de `main` (sem force push).
