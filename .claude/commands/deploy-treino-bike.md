Execute o fluxo de deploy do projeto treino_bike. Este é um projeto sem build step (PWA estática + backend Fastify). O diretório de trabalho atual (`/home/prod/env/prod/treino_bike`) já É o ambiente de produção — não existe ambiente DEV separado.

### 1. Validação

Verifique o estado atual com `git status` e `git diff --stat`.

Se houver arquivos JS modificados em `js/` ou `server/routes/`, rode `node -c <arquivo>` nos principais para checar sintaxe.

Se houver mudanças em `server/package.json` ou `server/package-lock.json`, rode `cd server && npm install` para garantir dependências atualizadas.

**Não há lint nem build.** Testes automatizados hoje: o smoke test estático de assets (`node --test tests/*.test.js`, roda na CI de toda PR) e o smoke test de símbolos pós-deploy (passo 5.5). A validação de UI/UX restante segue manual via navegador (por design, conforme treino_bike_docs/CLAUDE.md).

Se algo na validação falhar, pare aqui e reporte o erro antes de prosseguir.

### 1.5. Revisão de código com subagents (recomendado)

Antes de commitar, rode a rotina de revisão sobre **o que mudou** (não o projeto inteiro):

- Dispare o subagent **`code-reviewer`** com o escopo do `git diff` (arquivos alterados),
  pedindo o formato padrão `## BUGS` / `## MELHORIAS` com `arquivo:linha` e severidade.
- Se o diff tocar **segurança** (`server/routes/auth.js`, `server/middleware/`, `server/config.js`,
  `server/index.js`, rotas que recebem body, ou qualquer JS que monte HTML dinâmico), dispare
  também **`revisor-seguranca`**.
- Se o diff tocar **caminho quente** (loop de query, rota muito chamada, `server/scheduler.js`,
  sync Garmin/Strava), dispare **`revisor-performance`**.
- Se o diff tocar **lógica de treino/fisiologia** (`js/profile.js`, `js/insights.js`,
  `js/workouts.js` — FCM, zonas, TRIMP/TSS/CTL/ATL/TSB), consulte a skill **`plano-de-treino`**
  na conversa principal para checar correção das fórmulas.
- Se o diff tocar **lógica nutricional** (calculadora em `js/ferramentas.js`), consulte a skill
  **`orientacao-nutricional`** para checar constantes/faixas seguras.

Consolide os achados: **verifique** cada item CRÍTICO/IMPORTANTE lendo o código antes de aceitar,
corrija o que for barato agora e **registre o restante** em `treino_bike_docs/BUGS.md` (bugs) e `treino_bike_docs/MELHORIAS.md`
(melhorias), preservando o formato desses arquivos. Não bloqueie o deploy por MENORES/nitpicks —
apenas registre-os.

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

### 5.5. Smoke test de símbolos (pós-deploy)

Depois que o site está atualizado (e o Cloudflare já pode estar servindo a nova
versão), confirme que os ícones Font Awesome carregam na superfície pública real —
pega a classe da #71 (CSS/webfont servido com MIME errado, 404 virando página HTML,
ou cache stale do Cloudflare):

```bash
TB_CHROME=/usr/bin/google-chrome-stable TB_BASE=https://bike.arkhamcloud.net \
  node tests/simbolos.js
```

Roda da máquina de dev (tem `google-chrome-stable`) ou do host prod. Não precisa de
login (assets públicos). Exit 0 = símbolos íntegros; exit ≠ 0 = investigar antes de
dar o deploy por concluído (ver resultado em `tests/resultado-simbolos.json`).
Fallback se o Cloudflare desafiar o headless: `TB_BASE=http://127.0.0.1:8002` no host
prod (isola o nginx).

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
