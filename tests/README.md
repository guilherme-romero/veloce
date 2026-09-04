# Harness de testes — treino_bike

Testes de ponta a ponta que dirigem o Chrome headless pelo Chrome DevTools Protocol, **contra o
backend e o banco de produção**. Não há mock: o nginx já serve o repositório inteiro em
`http://127.0.0.1:8002` contra o Fastify e o `data/training.db` reais, e como `localhost` é
*secure context*, service worker, Cache API e teste offline funcionam sem HTTPS e sem celular.

Nasceram na FASE 25 (2026-09-03), que validou a UI mobile, e cobrem hoje as correções das releases
v2.9.1 → v2.9.3.

## Como rodar

```bash
TB_USER=<usuario> TB_PASS=<senha> node tests/run-all.js       # tudo, na ordem certa
node tests/run-all.js --only drive                            # uma suíte só
```

Credenciais também aceitas como argumento (`node tests/run-all.js <user> <pass>`), mas as variáveis
de ambiente são preferíveis — argv fica no histórico do shell.

**Use sempre o `run-all.js`.** O `pwa.js` termina fazendo um **logout de verdade**, que revoga a
sessão no servidor; quem roda as suítes na mão em sequência vê a seguinte falhar inteira por 401, o
que parece regressão e é só sessão expirada. O `run-all.js` faz login novo antes de cada suíte.

## As suítes

| Arquivo | O que cobre |
|---|---|
| `drive.js` | Percurso das 7 telas contra dados reais, checagens de fundo (recordes, zonas de FC, heatmap, condição do clima) e as guardas de cache |
| `bordas.js` | Bordas que os dados reais não exercitam — forçadas no cliente via CDP `Fetch.enable`, **sem tocar no banco** |
| `desktop.js` | Fumaça da variante desktop; existe porque vários fixes tocam `js/app.js` e `js/core/`, compartilhados |
| `pwa.js` | Service worker, pré-cache do `SHELL`, fallback offline por variante, cache de dados e logout |

Vários testes afirmam o comportamento **corrigido** de um `BUG-NNN` (ver `BUGS.md`): se um deles
regredir, a suíte falha nominalmente. Um teste que ainda afirme um bug como *aberto* diz isso no
próprio nome, para falhar e cobrar atualização quando for corrigido.

## Armadilhas que custaram tempo

Estão aqui para ninguém redescobrir:

- **Emular o viewport não basta para entrar na variante mobile.** `js/variant.js` decide por
  `navigator.userAgentData.mobile`, User-Agent e `pointer: coarse` — **nunca** por `innerWidth`
  (BUG-069). Um viewport de 390px com UA de desktop é redirecionado para `index.html`. Use o
  `emularCelular()` do `cdp.js`, que faz `setUserAgentOverride` + `setTouchEmulationEnabled` +
  `setDeviceMetricsOverride` e exercita o caminho real de detecção.
- **`--user-data-dir` novo a cada execução.** Reusar perfil faz o service worker servir JS antigo e
  produz falso-negativo.
- **Nunca `sleep` fixo para "esperar renderizar".** Use `waitFor(cdp, sid, expr)`, que faz *poll*
  com timeout explícito.
- **Processos do Chrome vazam.** O LXC tem 2 GiB; confira `pgrep -c chrome` ao terminar.
- **Asserção sobre o código-fonte precisa ser específica.** Uma que procurava `ui=desktop` no fonte
  passou a pegar o *próprio comentário* do fix. Ancore no padrão de código, não na palavra.

## Requisitos

- **Node 22+** — o `cdp.js` usa a implementação nativa de `WebSocket`, sem dependências.
- `chrome-headless-shell` do cache do Playwright. Outro caminho? `TB_CHROME=/caminho/para/binario`.
- Backend no ar (`systemctl status treino-bike-api`) e nginx servindo a porta 8002.

Tudo o que varia por máquina está em `config.js`, sobrescrevível por ambiente (`TB_BASE`,
`TB_CHROME`, `TB_USER`, `TB_PASS`).

## Cuidados

- **Roda contra dados de produção.** As suítes só leem; as bordas são forçadas interceptando a
  resposta **no cliente**, sem escrita no banco. A única exceção é o `pwa.js`, que faz logout real.
- **`tests/.cookie` guarda uma sessão viva** e está no `.gitignore`. Nunca versione.
- **Esta pasta fica dentro do webroot do nginx** e, sem bloqueio, é servida publicamente. O bloco
  `deny` para `/tests` segue o mesmo padrão de `/handoff_mobile` e `/excluir` — e o `^~` é
  obrigatório, senão `/tests/drive.js` casa com a `location` regex de assets e é servido assim
  mesmo:

  ```nginx
  location ^~ /tests { deny all; return 404; }
  ```

  Se o site for recriado do zero, esse bloco precisa voltar.
