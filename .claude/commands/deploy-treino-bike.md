Execute o fluxo de deploy do projeto treino_bike. Este é um projeto sem build step (PWA estática + backend Fastify). O diretório de trabalho atual (`/home/prod/env/prod/treino_bike`) já É o ambiente de produção — não existe ambiente DEV separado.

### 1. Validação

Verifique o estado atual com `git status` e `git diff --stat`.

Se houver arquivos JS modificados em `js/` ou `server/routes/`, rode `node -c <arquivo>` nos principais para checar sintaxe.

Se houver mudanças em `server/package.json` ou `server/package-lock.json`, rode `cd server && npm install` para garantir dependências atualizadas.

**Não há lint, build ou testes automatizados** — validação é manual via navegador (por design do projeto, conforme CLAUDE.md).

Se algo na validação falhar, pare aqui e reporte o erro antes de prosseguir.

### 2. Verificar versão

Confira a versão atual em `js/version.js`. Se as mudanças incluem novas features ou bugfixes relevantes, verifique se a versão já foi bumpada nos 4 lugares obrigatórios:
- `js/version.js` → `window.APP_VERSION = 'X.Y.Z'`
- `service-worker.js` → `const CACHE_VERSION = 'vX.Y.Z'`
- `server/package.json` → `"version": "X.Y.Z"`
- Todos os `?v=X.Y.Z` em `index.html` e `login.html`

Se não foi bumpada, avise o usuário antes de continuar.

### 3. Commit

- Revise `git diff` para entender o que está sendo commitado
- Monte uma mensagem clara e descritiva baseada nas alterações reais
- `git add <arquivos relevantes>` (evite `git add -A` sem revisar)
- `git commit -m "..."`

### 4. Push

- `git push origin main`
- Confirme que o push foi bem-sucedido (sem erros de remote)

### 5. Restart do serviço (se necessário)

Verifique se houve mudanças em arquivos do backend (`server/`):
- **Sim** → `sudo systemctl restart treino-bike-api` e confirme com `sudo systemctl status treino-bike-api --no-pager -n 5`
- **Apenas frontend** (css/, js/, index.html, login.html, manifest.json, service-worker.js, icone.png) → nenhuma ação extra, os arquivos são servidos diretamente do filesystem

### 6. Confirmação final

Resuma:
- Arquivos alterados e o que mudou
- Hash e mensagem do commit
- Se o serviço foi reiniciado e está ativo
- App disponível na URL pública configurada

### 7. Rollback (se o deploy quebrar o site)

Se o serviço falhar ou o site apresentar erros críticos após o deploy:

```bash
# Ver commits recentes para identificar o estável anterior
git log --oneline -5

# Opção A — revert (preferido, mantém histórico)
git revert HEAD
git push origin main

# Opção B — reset forçado (apenas se necessário)
git reset --hard <hash_do_commit_anterior>
git push origin main --force

# Reiniciar o serviço após reverter
sudo systemctl restart treino-bike-api
sudo systemctl status treino-bike-api --no-pager -n 5
```

Registre o que falhou e por quê antes de tentar um novo deploy.
