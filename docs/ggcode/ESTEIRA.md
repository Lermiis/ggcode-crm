# Esteira GG Code (Docker local)

- PATH do Docker no Git Bash: `export PATH="/c/Users/User/AppData/Local/Programs/DockerDesktop/resources/bin:$PATH"`
- Unitários de um arquivo: `npx pnpm@9.15.9 vitest run <arquivo>`
- Invariantes do banco (obrigatório antes de push com SQL): `npx pnpm@9.15.9 test:db`
- Typecheck: `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit -p tsconfig.typecheck.json`
- Publicar na VPS: `bash scripts/ggcode/publicar.sh <vX.Y.Z-gg.N>` (ver Task 7 do plano do Financeiro)
- Atualizar do upstream: `git fetch upstream --tags && git merge <tag-upstream>` na `main`, resolver, `test:db` verde, nova tag `-gg.N`, publicar.

## O que a primeira rodada local mostrou (Windows 11, 16 GB RAM, 6 CPUs)

- `test:db` roda **sem nenhum patch e sem variável de ambiente** (imagem padrão `pgvector/pgvector:pg15`, porta escolhida pelo Docker). Resultado: 439 arquivos / 3431 testes verdes, termina com `==> test:db verde`.
- **Duração: ~54 min** (suíte inteira, arquivos embaralhados, um banco por arquivo). Rode em segundo plano redirecionando para arquivo: `npx pnpm@9.15.9 test:db > /tmp/testdb.log 2>&1` e acompanhe com `tail`.
- **NÃO defina `MSYS_NO_PATHCONV=1`**: o script chama `git -C "$ROOT"` com caminho `/c/...` e o git do Windows precisa da conversão; com a variável, a conferência de isolamento do kit (`conferir-isolamento-do-kit.sh`) falha com `fatal: cannot change to '/c/Users/...'`.
- Opcionais do script: `TEST_DB_IMAGE=pgvector/pgvector:pg17` (matriz do CI), `TEST_DB_PORT=<porta>`. Argumentos extras vão ao vitest: `npx pnpm@9.15.9 test:db tests/invariants/<arquivo>.test.ts` roda só um arquivo (o ciclo todo de container+baseline leva ~1 min).
- **Docker Desktop pode cair durante a suíte longa** (visto uma vez: `Docker Desktop is unable to start` / 500 no `docker exec`, distro WSL `docker-desktop` parada, ~140 arquivos falham no setup). Não é defeito de teste. Recuperar: `docker desktop restart` e rodar de novo. Feche apps pesados antes (WSL usa ~7,7 GB).
- Não rode duas coisas pesadas ao mesmo tempo (typecheck de 12 GB + `test:db`).
