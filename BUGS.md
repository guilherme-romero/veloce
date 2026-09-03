# BUGS — treino_bike

Registro de bugs encontrados na revisão. Rotina de revisão multi-agente
(subagents `code-reviewer` + `revisor-seguranca` + `revisor-performance`; até 2026-08-09 os
agentes de domínio eram `nutritionist` + `personal-trainer`, hoje substituídos pelas skills
`orientacao-nutricional` e `plano-de-treino`).
Auditorias: **2026-07-06** (v2.1.5), **2026-07-11** (v2.2.0) e **2026-08-30** (v2.7.1).
Itens marcados **✓ verificado** foram confirmados manualmente lendo o código;
os demais vêm do relatório dos agentes e devem ser confirmados antes da correção.

Convenção de severidade: **CRÍTICO** (segurança/quebra funcional), **IMPORTANTE** (bug real com
impacto ao usuário), **MENOR** (edge case / inconsistência de baixo impacto).

---

# Auditoria 2026-09-03 (v2.9.0) — FASE 25: revisão de segurança e performance da UI mobile

Primeira auditoria da superfície mobile (`mobile.html`, `js/mobile/*`, `js/variant.js`,
`js/core/*`), entregue nas releases v2.8.0 → v2.9.0. A auditoria de 2026-08-30 não a cobriu porque
nada disso existia. Subagents `revisor-seguranca` e `revisor-performance`.

**Nenhum achado CRÍTICO.** Os quatro pontos que a FASE 25 levantou como suspeitos foram
**verificados e estão corretos**: escape completo (`esc`/`escAttr`) nos 10 módulos mobile; a CSP
dupla (meta estrita em `mobile.html:10` + header permissivo do nginx) resulta na estrita, que é
subconjunto da outra em todas as diretivas; `js/variant.js` não tem open-redirect (o destino sai
sempre de um ternário fechado que só devolve `'mobile.html'` ou `'index.html'`); e o logout do
mobile por `fetch` direto aciona a revogação server-side igual ao desktop.

Todos os itens abaixo estão **✓ verificado** — reconferidos lendo o código antes de aceitar.

## BUG-079 — o gate de autenticação anula todo o cache offline do PWA ✓ verificado · ✅ CORRIGIDO na v2.9.1
**IMPORTANTE** · `js/mobile/boot.js:15-24` e, idêntico, `js/app.js:393-402`

```js
async function ensureAuthenticated() {
  try {
    const resp = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (resp.ok) return true;
  } catch (e) {
    console.warn('[auth] backend indisponível, redirecionando para login');
  }
  location.replace('/login.html');   // ← o catch NÃO retorna; cai aqui offline
  return false;
}
```

O `catch` não distingue **"rede indisponível"** de **"sem sessão"**: em ambos os casos a execução
segue para o `location.replace('/login.html')`. Sem rede, o `fetch` lança, e o app redireciona para
uma tela de login que também não consegue autenticar offline.

**Consequência: o PWA não funciona offline, apesar de cachear tudo corretamente.** Medido em
navegador real (`localhost` é secure context, então SW e Cache API funcionam):

```
fetch offline de ./mobile.html  → 200, 6.418 bytes, conteúdo mobile   ← o SW acerta
navegação real offline          → /login.html                          ← o app se auto-sabota
```

O service worker cumpre a parte dele: pré-cacheia os **67/67** itens do `SHELL`, e o fallback por
variante (`service-worker.js:158`) devolve `mobile.html` e não `index.html`. Todo esse trabalho é
descartado pelo gate — abrir o PWA instalado sem rede mostra uma tela de login intransponível.

**Correção:** tratar os dois casos separadamente — só redirecionar quando a resposta for um 401 de
verdade; num erro de rede, seguir com os dados do cache e deixar o `Api` redirecionar quando a
sessão realmente for negada.
```js
try {
  const resp = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (resp.ok) return true;
  if (resp.status === 401) { location.replace('/login.html'); return false; }
} catch (e) {
  console.warn('[auth] backend indisponível — seguindo com o cache offline');
  return true;                       // offline: deixa o app abrir
}
location.replace('/login.html');
return false;
```
O fix precisa ir nas **duas** variantes (é a terceira cópia dessa lógica — ver a melhoria
"extrair o logout/sessão para `js/core/`" em `MELHORIAS.md`).

**✅ Corrigido na v2.9.1**, nas duas variantes (`js/mobile/boot.js:15` e `js/app.js:393`): o erro
de rede agora devolve `true` e deixa o app abrir; só um 401 de verdade redireciona.

Como `service-worker.js:135` fazia `/api/*` **nunca** passar pelo cache, só o gate faria o app
abrir com todas as telas vazias. Então a release também passou a cachear as respostas:

- **network-first com fallback ao cache** para `GET /api/*` — online o comportamento é **idêntico**
  ao anterior (a rede sempre vence), e o cache só entra quando ela falha. Não é
  stale-while-revalidate de propósito: servir dado velho com rede disponível mascararia a falta de
  guarda do BUG-073.
- cache separado `treino-bike-data`, **sem versão**, para que uma release não apague o offline do
  usuário — e por isso excluído explicitamente da limpeza do `activate`.
- **`/api/auth/*` nunca é cacheado**: um `/auth/me` em cache faria um usuário deslogado parecer
  logado.
- o **logout apaga** `treino-bike-data` nas duas variantes, antes do `fetch`, para valer mesmo se a
  chamada de rede falhar — dados de saúde não podem sobreviver ao logout no aparelho.

Verificado em navegador real: o app abre offline na UI mobile e **com dados** — o recorde real de
82,5 km renderiza e o Perfil mostra as 6 zonas; 15 respostas no cache de dados, nenhuma de
`/api/auth/`; e o cache some após o logout. Suíte de PWA: **17/17**.

## BUG-080 — `start_url` manda a instalação do mobile para a variante desktop ✓ verificado
**MENOR** · `manifest.json:5`

```json
"start_url": "./",
"scope": "./"
```

`manifest.json` é único para as duas variantes, e `start_url: "./"` resolve para a raiz — ou seja,
`index.html`. Instalar o PWA a partir de `mobile.html` cria um atalho que abre a **desktop**. O que
salva o caso na prática é o `js/variant.js` redirecionando de volta pela detecção de dispositivo —
mas isso custa um hop a cada abertura e depende da detecção acertar, quando a intenção do usuário
já era explícita no momento da instalação.

Confirmado no manifest servido: `start_url='./'`, `scope='./'`, `display='standalone'`, 5 ícones.

**Correção:** as duas variantes precisariam de manifests distintos (`manifest.json` e
`manifest-mobile.json`, com `start_url: "./mobile.html"`), com `mobile.html:27` apontando para o
seu. Alternativa mais barata, se um manifest só for requisito: aceitar o hop e documentar.

## BUG-072 — `handoff_mobile/` servido publicamente na origem do app ✓ verificado · ✅ CORRIGIDO na v2.9.1
**IMPORTANTE · segurança** · `handoff_mobile/Veloce Labs Mobile.dc.html`, `handoff_mobile/support.js`

O docroot do nginx é o próprio repositório (`/etc/nginx/sites-available/treino_bike:5`) e o
`location /` não tem gate de autenticação. Confirmado por request:

```
GET /handoff_mobile/Veloce%20Labs%20Mobile.dc.html  → 200  (sem sessão)
GET /handoff_mobile/support.js                      → 200  (sem sessão)
```

São 52 KB de runtime de ferramenta de design de terceiro, versionados no commit `3233843`,
contendo `new Function(...)` (`support.js:688`, `:1026`) e `window.parent.postMessage`
(`:1464`) — servidos na **mesma origem do cookie `tb_session`**. O que segura o pior hoje é
acidente de configuração: a CSP do nginx não declara `'unsafe-eval'`, então o `new Function` é
bloqueado. É artefato de handoff, não código de produção.

**Correção:** mover `handoff_mobile/` para `excluir/` (gitignored, não servido) ou negar no nginx
junto do bloco de `/.git`:
```nginx
location ^~ /handoff_mobile { deny all; return 404; }
```

**✅ Corrigido na v2.9.1** removendo do repositório os três arquivos executáveis —
`Veloce Labs Mobile.dc.html`, `support.js` e `favicon.svg` (~129 KB). Nada no código os
referenciava. Ficaram `README.md` e os 5 screenshots, que são referência de design inerte.
Confirmado por HTTP: os três removidos devolvem **404**, `README.md` e os screenshots seguem em 200.

> **Descoberta durante a correção:** mover para `excluir/` **não** resolveria — a pasta também é
> servida (`/excluir/roadmap.txt` → **200**). O `CLAUDE.md` afirmava que ela "não é servida nem
> carregada pelo app"; só a segunda metade é verdade. A documentação foi corrigida.
>
> **Continua em aberto:** o nginx não tem `deny` para `/handoff_mobile` nem para `/excluir`, e a
> proteção por remoção só vale para o que já foi removido. Um bloco `deny` cobriria também o que
> cair nessas pastas no futuro — exige sudo, então ficou para você aplicar.

## BUG-073 — Insights refaz 7 chamadas de rede a cada `onEnter` ✓ verificado
**IMPORTANTE · performance** · `js/mobile/insights-mobile.js:288` (`Promise.all`), `:324` (`onEnter`)

`load()` é chamado incondicionalmente, sem guarda. Trocar de aba e voltar refaz os 7 fetches, os
~4,1 ms de event loop e os ~55 KB de JSON. Eram 4 chamadas antes da v2.9.0 — os três cards novos
(Índice de Fadiga, Training Readiness, Recordes Pessoais) somaram mais 3.

Numa sessão de 10 trocas de aba: 70 requests e ~550 KB para dados que só mudam a cada 30 min
(`server/scheduler.js:10`, `SYNC_INTERVAL_MIN = 30`).

**Correção:** guarda com TTL — ver a melhoria "padrão único de cache" em `MELHORIAS.md`.

## BUG-074 — Bikes recarrega sem guarda, com fan-out de 3+N requests ✓ verificado
**IMPORTANTE · performance** · `js/mobile/bikes-mobile.js:29`

`onEnter` chama `Bikes.load()` incondicionalmente, e `Bikes.load()` (`js/bikes.js:205`) dispara
`GET /bikes` + `/bikes/meta/brands` + `/component-types` + **uma chamada `/bikes/:id/components`
por bike**. Com 2 bikes são 5 requests por entrada na aba, e cada `/components` reexecuta o
`calcBikeKm` que o `GET /bikes` já calculou no mesmo instante — o dobro de agregação sobre
`garmin_activities` + `strava_activities`, crescendo linearmente com o número de bikes.

Esta view **não constava** do levantamento de guardas da FASE 25 (ver correção no `ROADMAP.md`).

**Correção:** flag `_loaded` no padrão de `js/mobile/activities-mobile.js:18`, invalidada após
mutação de bike/componente. Estruturalmente melhor: `GET /bikes` já embutir `components` e
eliminar o N+1 de rede.

## BUG-075 — logout engole a falha e o usuário sai "logado" ✓ verificado
**MENOR · segurança** · `js/mobile/more-mobile.js:71-76` (e idêntico no desktop, `js/app.js:405`)

```js
try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
catch (_) {}
location.replace('/login.html');
```

O `catch` vazio cobre falha de rede e o código não checa `resp.ok`. Se a chamada falhar (offline,
backend caído, 500), o `UPDATE auth_state SET last_logout_at` não roda, o `clearCookie` não chega,
e o cookie `tb_session` continua válido no browser — mas o usuário vê a tela de login e acredita
que saiu. Basta navegar de volta para `mobile.html` para voltar autenticado.

**Correção:** checar `r.ok` e avisar por toast em vez de redirecionar. O fix precisa ir nas **duas**
variantes.

## BUG-076 — `?ui=desktop` prende a aba na variante desktop ✓ verificado
**MENOR** · `js/mobile/home-mobile.js:164`

```js
location.href = 'index.html?ui=desktop#/inicio';
```

`?ui=desktop` grava `vl.ui = 'desktop'` em `sessionStorage` (`js/variant.js:61`) pelo resto da aba.
A partir daí o "voltar" do celular para `mobile.html` é interceptado por `variant.js:65` e devolve
o usuário ao desktop. Não é falha de segurança (mesma origem, mesma sessão, destino no whitelist do
`pageOf`), mas é a única forma de estado externo influenciar navegação.

**Correção:** `location.href = 'index.html#/inicio'` — o destino já é explícito e a detecção por
dispositivo não força o retorno enquanto a aba estiver lá.

## BUG-077 — Início refaz 2 chamadas a cada `onEnter` ✓ verificado
**MENOR · performance** · `js/mobile/home-mobile.js:173`, `:186`

Mesma classe do BUG-073, 3× menor: `/activities/unified?days=30` (0,38 ms) e
`/garmin/training-readiness?days=1` (0,025 ms), em `await` **sequencial**. O banco é irrelevante; o
que incomoda são os 2 round-trips e o re-render completo do skeleton a cada volta para a aba mais
visitada do app.

> Correção de premissa: a FASE 25 registrou "Início = 6 chamadas". São **2**. As outras 4 estão em
> `syncAll()` (`home-mobile.js:198-214`), que só roda no clique do botão de sync — ação explícita
> do usuário, não custo de navegação.

## BUG-078 — corrida entre o `await` do `load()` e o `onLeave` cria gráfico em canvas oculto ✓ verificado
**MENOR** · `js/mobile/insights-mobile.js:283` · mesmo padrão em `js/mobile/profile-mobile.js:168`

`destroyCharts()` roda **antes** do `Promise.all`; os gráficos nascem depois (`:125`, `:175`). Se o
usuário sair da aba durante os 7 fetches, o `onLeave` (`:328`) roda com o array ainda vazio e as 2
instâncias Chart.js são criadas em seguida, num canvas 0×0, com listener de resize pendurado até o
próximo `load()`. Não é vazamento permanente — o `load()` seguinte limpa — mas é lixo evitável.

**Correção:** token de geração — `const gen = ++_gen` no início de `load()` e
`if (gen !== _gen) return;` depois do `await`, antes de renderizar.

---

# Levantamento 2026-09-02 (v2.8.1) — ajustes na aba Atividades

Origem: relato direto do usuário sobre a aba Atividades do mobile. Dois dos três pontos eram de
layout; o terceiro (legenda no gráfico de Volume mensal) revelou um bug no helper compartilhado.

## MENOR

- **✅ CORRIGIDO (2026-09-02, v2.8.1)** — **[MENOR] [BUG-071] `js/mobile/shell.js`** — `MShell.mChart`
  apagava o `legend: { display: false }` de qualquer gráfico que configurasse um tooltip.

  **Causa raiz:** `cfg.options = Object.assign(base, cfg.options || {})` é um merge **raso**. Quem
  passa `options.plugins` — mesmo que só para um `tooltip.callbacks` — substitui o objeto `plugins`
  inteiro, e o `legend:false` do base vai junto. O Chart.js volta ao default e desenha a legenda
  dentro do canvas. Presente desde a v2.7.7.

  **Dois gráficos afetados:**

  | Gráfico | Sintoma |
  |---|---|
  | Volume mensal (`activities-mobile.js:166`) | legenda com rótulo vazio (o que o usuário relatou) |
  | Rosca de zonas (`insights-mobile.js:175`) | legenda Z1–Z5 duplicando a legenda HTML ao lado e comendo espaço de um canvas de 130×130 |

  **Correção:** `plugins` passou a ser mesclado explicitamente
  (`Object.assign({}, base.plugins, opts.plugins)`), preservando o base e o que o chamador pede.
  Os tooltips dos dois gráficos continuam funcionando — é justamente o que o merge raso preservava
  às custas da legenda.

  **Nota:** `elements` tem a mesma fragilidade estrutural, mas hoje nenhum chamador o sobrescreve.

---

# Levantamento 2026-09-02 (v2.8.0) — telas Perfil e Passeios no mobile

Origem: encontrado pela harness de validação das telas novas (`cdp-novas-telas.js`), ao checar que
um slug desktop-only cai na aba "Mais" com o aviso correto.

## MENOR

- **✅ CORRIGIDO (2026-09-02, v2.8.0)** — **[MENOR] [BUG-070] `js/mobile/router-mobile.js`** —
  navegar para um slug que a UI mobile não implementa **não fazia nada** quando o usuário já estava
  na aba "Mais".

  **Causa raiz:** `apply()` abria com `if (current === slug) return;`, comparando o slug **já
  resolvido**. Como todos os slugs desktop-only resolvem para `mais` pelo FALLBACK, estando em
  `#/mais` a ida para `#/rotas` batia nesse early-return: a URL mudava, o `onEnter` não rodava e a
  tela não se atualizava. Presente desde a v2.7.7.

  **Efeito antes da v2.8.0:** invisível, porque a aba "Mais" renderizava a mesma lista fosse qual
  fosse o slug pedido. Passou a importar quando ela ganhou o aviso "esta seção existe só na versão
  desktop", que depende do slug pedido.

  **Correção:** o router passou a guardar também `currentRaw` (o slug **pedido**, antes do
  FALLBACK). Mesma view com pedido diferente re-executa só o `onEnter`, sem refazer a troca de
  views nem disparar o `onLeave` — que destruiria gráficos sem necessidade.

---

# Levantamento 2026-09-01 (v2.7.7) — relato de uso

Origem: relato direto do usuário — no celular, o app abria a versão desktop e era preciso entrar no
menu hambúrguer e clicar em "Versão mobile" na mão. Reproduzido e corrigido no mesmo dia.

## IMPORTANTE

- **✅ CORRIGIDO (2026-09-01, v2.7.8)** — **[IMPORTANTE] [BUG-069] `js/variant.js`** — a detecção
  automática de variante **nunca disparava num celular**: `index.html` sempre abria a UI desktop.

  **Causa raiz:** o `variant.js` da v2.7.7 decidia por `window.innerWidth <= 767`, e o `<script>`
  era o **primeiro elemento do `<head>`, antes da `<meta name="viewport">`**. Enquanto essa meta não
  é processada, o browser móvel usa o **viewport de layout padrão**, e `innerWidth` vale **980** —
  acima do corte. O redirect nunca acontecia; depois do load, `innerWidth` já era 390, tarde demais.

  **Medido com o dispositivo emulado (`Page.addScriptToEvaluateOnNewDocument` + iPhone):**

  | momento | `innerWidth` | `screen.width` |
  |---|---|---|
  | topo do `<head>` (onde o script rodava) | **980** | 390 |
  | após o load (meta viewport já valeu) | 390 | 390 |

  **Por que a validação da v2.7.7 não pegou:** os testes headless rodaram com
  `--window-size=390,844`, que define o viewport **direto**, sem depender da meta. `innerWidth` já
  nascia 390 e o redirect funcionava — falso negativo do ambiente de teste. **Lição:** validar
  comportamento de mobile exige `Emulation.setDeviceMetricsOverride({ mobile: true })`, nunca
  apenas redimensionar a janela.

  **Correção:** a decisão passou a ser por **tipo de dispositivo** (Client Hints → user agent →
  iPad com UA de Macintosh + `maxTouchPoints` → `pointer: coarse` com `screen.width <= 1024`).
  Nenhum desses sinais depende da meta viewport. O `<script>` também foi movido para depois da meta
  CSP — assim é coberto por ela e a armadilha de ordem não volta. Como efeito colateral bem-vindo,
  uma janela estreita num PC deixou de virar UI mobile.

  **Mudanças relacionadas na mesma versão:** o item "Versão mobile" saiu da nav desktop
  (`index.html`, `js/app.js`) e o override deixou de ser permanente — vive em `sessionStorage` e
  vale só na aba corrente, com o `localStorage['vl.ui']` da v2.7.7 apagado na migração (sem isso,
  quem já tinha clicado no botão continuaria preso no desktop).

---

# Levantamento 2026-08-31 (v2.7.5) — relato de uso

Origem: relato direto do usuário — o popup "Nova versão disponível" aparecia repetidamente, no
navegador e no PWA do celular, **sem que houvesse publicação nova**. Reproduzido e corrigido no
mesmo dia.

## IMPORTANTE

- **✅ CORRIGIDO (2026-08-31, v2.7.6)** — **[IMPORTANTE] [BUG-068] `js/pwa.js:48-53`** — o banner
  "Nova versão disponível" aparecia **sem existir versão nova**, sempre que a página carregava sem
  service worker controlando.

  **Reproduzido sem alterar nenhuma versão durante o teste:**

  | carga | banner | página já controlada? |
  |---|---|---|
  | 1ª (SW ainda não instalado) | **SIM** | não |
  | 2ª (SW já instalado) | não | sim |
  | 3ª | não | sim |
  | após remover o SW (simula expiração no iOS) | **SIM** | não |

  **Causa raiz:** o listener de `controllerchange` mostrava o banner sempre que o controlador mudava
  e o usuário não havia clicado em "Atualizar". Mas `controllerchange` **também dispara na primeira
  instalação**: o `service-worker.js` faz `skipWaiting()` no install (`:88`) e `clients.claim()` no
  activate (`:101`), e o `claim()` assume a página já aberta que ainda não tinha controlador —
  emitindo o evento sem que exista atualização.

  **A guarda já existia no caminho irmão.** O `updatefound` (`js/pwa.js:25`) checava
  `navigator.serviceWorker.controller` justamente para separar instalação de atualização; o
  `controllerchange` ficou sem o equivalente. **Mesmo formato do BUG-067** (`min-width: 0` aplicado a
  um filho do flex e não aos outros dois) e do BUG-064 (guarda numa função utilitária que o call
  site anulava). É um padrão recorrente neste código: a proteção certa aplicada num ponto só.

  **Evidência que isolou o caminho:** na reprodução o console mostrou apenas `[PWA] SW registrado` —
  **não** apareceu `[PWA] Nova versão pronta — banner exibido` (`js/pwa.js:27`, log do caminho
  `updatefound`). Logo o banner vinha do `controllerchange`, que não logava nada.

  **Por que aparecia tantas vezes no uso real:** primeira visita; Shift+Reload; limpar dados do
  navegador; desinstalar/reinstalar o PWA; e o caso mais provável no celular — **o iOS/Safari
  descartar o service worker após ~7 dias sem uso**, o que se encaixa num app pessoal aberto de
  forma intermitente.

  **Correção (v2.7.6):** uma foto do estado tirada **antes** de registrar o SW
  (`const paginaJaControlada = !!navigator.serviceWorker.controller`), usada como fonte única de
  verdade nos **dois** caminhos. No `controllerchange`, se a página nasceu sem controlador o evento é
  instalação e não gera banner. No `updatefound`, a foto substitui a leitura ao vivo do controlador —
  que era uma corrida: com `skipWaiting()`, o `claim()` pode já ter ocorrido quando o `statechange`
  dispara, e a leitura ao vivo passaria a mentir justamente numa instalação nova.

  **Verificado com dois testes, deliberadamente.** O negativo sozinho não provaria nada — uma
  correção que simplesmente nunca mostrasse o banner passaria nele:
  1. **Negativo:** as 4 cargas da tabela acima, agora todas `banner=nao`.
  2. **Positivo:** com o `CACHE_VERSION` alterado para um valor inédito, o banner **aparece**, com o
     texto correto, o botão "Atualizar" e o "×" funcionando.

  **Não se mexeu no `service-worker.js`:** `skipWaiting` + `clients.claim` são deliberados
  (documentados em `service-worker.js:84-87`) e existem para o usuário não ficar preso numa versão
  velha. O defeito era a interpretação do evento no cliente, não a estratégia de ativação.

  **Descartado na investigação:** Cloudflare servindo o `service-worker.js` em pingue-pongue — um SW
  cacheado por CDN faria o navegador alternar entre cópias e disparar atualizações genuínas
  repetidas. Não é o caso: o nginx serve `/service-worker.js` com `no-store, no-cache,
  must-revalidate`, confirmado na resposta HTTP real e não só na configuração. (Observação sem
  relação com o bug: a resposta traz dois cabeçalhos `Cache-Control` — o `max-age=0` do `expires 0` é
  redundante ali.)

---

# Levantamento 2026-08-31 (v2.7.4) — medição de layout

Origem: preparação do kit de design mobile (capturas do app em produção via Playwright). Não foi
uma auditoria de código — o achado abaixo apareceu ao medir o layout real no navegador, e foi
confirmado em 20 larguras distintas.

## IMPORTANTE

- **✅ CORRIGIDO (2026-08-31, v2.7.5)** — **[IMPORTANTE] [BUG-067] `css/style.css` — a `nav` estoura horizontalmente entre 390px e 1433px**
  A barra de navegação exige **1.422px** para caber. Abaixo disso ela empurra o documento para fora
  da janela e o app inteiro passa a rolar na horizontal. Medido no Chromium, com o banner de
  atualização do PWA suprimido para não contaminar:

  | viewport | scrollWidth | estouro | `.nav-links` |
  |---:|---:|---:|---|
  | 1450 | 1450 | — | visíveis |
  | 1400 | 1422 | +22px | visíveis |
  | 1280 | 1422 | **+142px** | visíveis |
  | 1024 | 1422 | **+398px** | visíveis |
  |  720 | 1422 | **+702px** | visíveis |
  |  700 |  700 | — | drawer |
  |  480 |  480 | — | drawer |
  |  390 |  450 | **+60px** | drawer |
  |  360 |  450 | **+90px** | drawer |

  **Dois regimes, uma causa.** Entre 701px e ~1433px os links do menu ainda estão visíveis e não
  cabem — o pior caso é 720px, logo antes do breakpoint, com a página no dobro da largura da tela.
  Abaixo de ~450px o drawer já assumiu, mas a marca e o cluster de ícones sozinhos ainda não cabem.
  **1024 e 1280 são larguras de notebook comuns** — não é um caso de canto.

  **Causa raiz (medida, não inferida):** a `nav` é flex `nowrap` com `padding: 0 28px` e
  `gap: 24px`. Os filhos `.nav-brand` (200px) e `.nav-right` (200px) estão com
  `min-width: auto` — o padrão de item flex, que impede encolher abaixo do conteúdo. Em 390px:
  `28 + 200 + 24 + 200 + 28 = 480px` de demanda para 390px de tela.

  **Detalhe revelador:** `.nav-links` **já tem** `min-width: 0` explícito. A correção foi aplicada a
  um filho e não aos outros dois — sugere que o sintoma já foi encontrado uma vez e tratado só onde
  doía naquele momento.

  **Efeitos colaterais confirmados:** o modal de detalhe fica com **397px numa tela de 390px**, e o
  badge de fonte nos cards de atividade aparece cortado ("GARMI") nas capturas.

  **Correção aplicada (v2.7.5).** Princípio: marca e ícones **nunca** encolhem — são identidade e
  alvos de toque; quem absorve a falta de espaço é a faixa de links, que passa a rolar dentro de si
  mesma em vez de estourar a página.

  - `min-width: 0` + `flex: 0 0 auto` em `.nav-brand` e `.nav-right`.
  - `.nav-links` ganhou `overflow-x: auto` (barra de rolagem oculta) e os botões, `flex: 0 0 auto`,
    para rolarem em vez de espremer.
  - `.nav-btn` com padding horizontal de 14px → **11px**. Sem isso os 11 botões somam 1040px e só
    cabem 989px dentro do container de 1400px — ou seja, **eles transbordavam a faixa mesmo num
    monitor grande**, o que passava despercebido porque o excesso vazava para a margem. Com 11px
    somam 974px e cabem de verdade.
  - No regime do drawer (≤700px): `.nav-inner` com padding 28→14px e gap 24→12px; abaixo de 430px o
    letreiro da marca recolhe e fica só o símbolo.

  **Verificado por medição em 13 larguras de 360px a 1600px: estouro zero em todas.** Além disso:
  os 11 links continuam alcançáveis onde a faixa rola (último botão testado em cada largura); o
  drawer abre, lista os 11 itens e fecha com Esc; e o modal de detalhe caiu de **397px para 334px**
  numa tela de 390px. Em ≥1400px os links agora cabem inteiros no container, o que **não acontecia
  antes** da correção.

  **Não é o redesenho.** A nav mobile ainda será repensada no trabalho de design; isto apenas tira a
  rolagem horizontal de produção enquanto isso não acontece.

---

# Auditoria 2026-08-30 (v2.7.1)

Escopo: projeto completo. Primeira rodada com os revisores especializados
(`revisor-seguranca`, `revisor-performance`) adaptados ao stack. Todos os itens abaixo foram
**conferidos manualmente no código** antes do registro. Achados de performance foram para
[MELHORIAS.md](MELHORIAS.md) — aqui só o que é bug.

Registrada no `ROADMAP.md` como **FASE 24** (backlog priorizado + lição de processo).
Status da leva: **fechada em 2026-08-30 (v2.7.2)** — BUG-056 a BUG-065 corrigidos;
BUG-066 (infra) com permissões restauradas e causa raiz identificada. **Nenhum item aberto.**

**Validação manual no navegador (2026-08-31)** — o projeto não tem suíte, então é assim que se
valida. Feitas e OK as três que mexiam em validação de entrada, onde o risco era apertar demais e
quebrar caminho legítimo: **perfil** (altura / peso meta / peso da bike persistem após reload — a
coerção numérica nova não zera campo válido), **import de backup antigo** (não passou a ser
rejeitado pelas chaves novas do `validateBackupStructure`) e **sync manual da Garmin** (o ambiente
enxuto do subprocess Python não quebrou a sessão SSO). As duas restantes foram validadas em 2026-08-31 rodando o
código real contra o banco de produção (`sqlite3 -readonly`), o que cobre todo o histórico em vez
de um dia escolhido a dedo: **BUG-060** confirmado — a regra antiga escondia **3 pedais** do
calendário (três voltas de 1,92/1,69/1,46 km em 29/03/2024 e dois registros de 0 km em 01/04/2026,
todos Garmin+Garmin, justamente o caso que a dedup não deveria tocar); 133 → 136 exibidos, sem
nenhum par cross-fonte voltando a duplicar. **BUG-064** revelou correção incompleta, fechada na
v2.7.4 (ver o item).

## CRÍTICO

- **✅ CORRIGIDO (2026-08-30, v2.7.2)** — **[CRÍTICO] [BUG-056] `js/app.js:80,98,115`** — XSS armazenado por quebra de atributo no modal
  de perfil. Os três campos numéricos interpolam sem escape:
  `value="${u.altura || ''}"`, idem `u.pesoMeta` e `u.bikePeso`. Os campos vizinhos do **mesmo
  template** usam `esc()` corretamente (`f-nasc:78`, `f-bmodelo:111`), o que mostra que é omissão,
  não decisão.
  **Cadeia confirmada:** `validateBackupStructure` (`js/backup.js:719-723`) valida `nome`, `altura`
  e `pesoAtual` — **não** valida `pesoMeta` nem `bikePeso`. `server/routes/profile.js:88` faz
  `clean[k] = body[k]` sem coerção de tipo, gravando a string crua. O CSP tem
  `script-src 'unsafe-inline'` (`index.html:10`), então o handler injetado executa.
  Vetor: import de backup JSON malicioso ("importa esse backup pra recuperar teus dados").
  **Correção:** `escAttr()` nos três valores **e** coerção numérica no backend
  (`Number.isFinite`) para as chaves numéricas da `ALLOWED_PROFILE_KEYS`; incluir `pesoMeta`/
  `bikePeso` no `validateBackupStructure`.

- **✅ CORRIGIDO (2026-08-30, v2.7.2)** — **[CRÍTICO] [BUG-057] `js/workouts.js:334,342,345`** — mesmo vetor: `m.nome` é escapado
  (`:336`), mas `m.id` não, em `data-mode-id`, `data-rename` e `data-delete-mode`. Hoje o id é
  gerado no cliente (`js/storage.js:168`), porém `validateBackupStructure` (`js/backup.js:729`) só
  exige `m.id` truthy e `server/routes/modes.js:55` só exige `m.id && m.nome` — um backup com
  `id: 'x" onmouseover="…'` quebra o atributo ao abrir "Gerenciar modos de treino".
  **Correção:** `escAttr(m.id)` nos três pontos + validar formato (`/^[\w:-]{1,64}$/`) no
  `POST/PUT /api/modes`.

## IMPORTANTE

- **✅ CORRIGIDO (2026-08-30, v2.7.2)** — **[IMPORTANTE] [BUG-058] `server/index.js:7` + `server/routes/auth.js:24`** — rate limit do
  login contornável por header. Confirmado ponta a ponta: `@fastify/rate-limit` 9.1.0 usa
  `defaultKeyGenerator = (req) => req.ip` (index.js:27 do pacote); `trustProxy: true` faz o Fastify
  derivar `req.ip` do `X-Forwarded-For`; e o nginx usa `$proxy_add_x_forwarded_for`
  (`/etc/nginx/sites-available/treino_bike:27`), que **anexa** ao valor enviado pelo cliente.
  Rotacionando `X-Forwarded-For: 1.2.3.<n>`, cada tentativa cai num bucket novo e o teto de 5/min
  nunca é atingido — sobra só o custo do bcrypt como freio contra força bruta.
  **Correção aplicada:** `trustProxy: 1` em `server/index.js:7`.
  ⚠ **Achado durante a correção:** a alternativa "lista de IPs confiáveis"
  (`trustProxy: ['127.0.0.1','::1']`) **não funciona nesta topologia** e foi testada antes — como o
  nginx roda no mesmo host, ele anexa `127.0.0.1` ao XFF; estando o loopback na lista, o
  `proxy-addr` continua andando na cadeia e chega ao valor forjado. Verificado na prática:
  `curl -H 'X-Forwarded-For: 9.9.9.9' localhost:8002/api/health` ainda produzia
  `req.ip = 9.9.9.9`. Só a **contagem** de hops interrompe a caminhada.
  **Validado:** com XFF forjado o `req.ip` passou a ser o peer real
  (`127.0.0.1` / `192.168.15.20` conforme a origem), e 6 tentativas de login com
  `X-Forwarded-For` rotacionado devolvem `401 401 401 401 401 429`.

- **✅ CORRIGIDO (2026-08-30)** — **[IMPORTANTE] [BUG-059] `.gitignore` + `server/services/strava.js:18,29`** — segredo fora do
  `.gitignore`. `writePersistedRefresh()` grava o refresh token rotacionado do Strava em
  `data/strava_token.json`; `git check-ignore` confirma que o caminho **não** é ignorado. O arquivo
  ainda não existe (rotação não ocorreu), então dá para corrigir antes do estrago — quando o Strava
  rotacionar, um `git add data/` publica um refresh token vivo no repositório, que é público.
  **Correção aplicada:** `data/strava_token.json` adicionado ao `.gitignore` (linha 28), antes
  de a rotação criar o arquivo.

- **✅ CORRIGIDO (2026-08-30, v2.7.2)** — **[IMPORTANTE] [BUG-060] `js/rides.js:694`** — dedup do calendário descarta atividade real.
  O `find` compara só `|Δdistância| < 0,5 km`, **sem checar horário e sem checar fonte** — apesar de
  o comentário em `:682-684` afirmar que o dedup é para "fontes diferentes". O matcher server-side,
  para a mesma decisão, exige ±100 m **e** ±300 s (`server/utils/activity-matcher.js:17,75`).
  Cenário: dois trajetos no mesmo dia (10,0 km de manhã, 10,3 km à tarde) → o segundo some do badge
  do calendário (`js/rides.js:189-200`). Só exibição, não corrompe dado persistido.
  **Correção aplicada:** `a.inicio` entrou na comparação com tolerância de ±300 s, espelhando o
  matcher do servidor. Detalhe que quase passou: o `inicio` do Strava é `start_date_local` rotulado
  com `Z` (não é UTC) e o da Garmin usa espaço — sem a mesma normalização do `parseLocal`
  (`replace('Z','').replace(' ','T')`), os dois lados ficariam deslocados pelo fuso e o dedup entre
  serviços nunca casaria.

## MENOR

- **✅ CORRIGIDO (2026-08-30, v2.7.2)** — **[MENOR] [BUG-061] `server/services/garmin.js:43-47`** — o subprocess Python herda
  `{ ...process.env }`, entregando `JWT_SECRET`, `ADMIN_PASS_HASH`, `STRAVA_CLIENT_SECRET` e
  `STRAVA_REFRESH_TOKEN` ao `garmin_cli.py` e a toda a árvore de dependências (`garminconnect`,
  `requests`, DiskCache), sem necessidade. Dependência comprometida ou traceback com dump de env
  expõe a chave de assinatura de sessão. **Correção:** ambiente mínimo explícito (`PATH`, `HOME`,
  `LANG` + as duas `GARMIN_*`).

- **✅ CORRIGIDO (2026-08-30, v2.7.2)** — **[MENOR] [BUG-062] `server/routes/garmin.js:75`** — `reply.code(502).send({ error: err.message })`
  devolve a primeira linha do stderr do Python ao cliente (pode conter URL interna, corpo de
  resposta da Garmin ou trecho de traceback). `server/routes/strava.js:76` já faz o certo: mensagem
  genérica + `req.log.error`. **Correção:** padronizar pelo comportamento do strava.js.

- **✅ CORRIGIDO (2026-08-30, v2.7.2)** — **[MENOR] [BUG-063] `server/routes/backup.js:179,217` e `server/routes/profile.js:116`** —
  rotas caras e destrutivas sem `config.rateLimit` (o limite é opt-in, `global:false` em
  `server/index.js:26`). `POST /api/backup/restore` aceita 50 MB, roda unzip, troca o banco e
  reinicia o serviço; `POST /api/backup/snapshot` faz zip nível 9; `POST /api/user/avatar` aceita
  5 MB. Exigem sessão válida — cenário é pós-comprometimento (encadeado com BUG-056/057): um XSS
  chama `/restore` em laço e deixa o serviço em ciclo de restart.

- **✅ CORRIGIDO (2026-08-30, v2.7.2; completado em 2026-08-31, v2.7.4)** — **[MENOR] [BUG-064] `js/bikes.js:90-94`** — `severityFor(pct)` recebe `null` quando o componente
  não tem vida útil configurada; `null >= 100` e `null >= 80` são `false`, então retorna `'green'`
  (classe de "ok") em vez de estado neutro. Hoje inofensivo porque os call sites só renderizam a
  barra quando `hasKm`/`hasTempo` é verdadeiro — é fragilidade latente, não defeito visível.
  **A primeira correção (v2.7.2) foi incompleta**, e isso só apareceu ao validar: a guarda
  `!Number.isFinite(pct) → 'neutral'` estava certa, mas **inalcançável**. Os dois call sites que
  decidem o status geral (`renderComponent` e o modal de detalhe) faziam
  `Math.max(kmPct ?? 0, timePct ?? 0)`, resolvendo o `null` para `0` **antes** de chamar a função —
  então um componente sem km nem tempo continuava exibindo bolinha verde e "0% da vida", que é
  literalmente a queixa original. **v2.7.4:** `pct` permanece `null` quando nenhuma dimensão está
  configurada, o status vira "vida útil não definida" e o item recebe a classe `unknown`
  (cinza `--border`/`--muted2`, sem competir com verde/âmbar/vermelho). Verificado por simulação
  dos 7 cenários: o caso não-configurado passou a `neutral` e **nenhum** caso configurado mudou.
  **Lição:** guarda em função utilitária não vale nada se o call site normaliza a entrada antes —
  a validação precisa começar pelo call site, não pela função.

- **✅ CORRIGIDO (2026-08-30, v2.7.2)** — **[MENOR] [BUG-065] `server/scheduler.js:34-44` e `server/routes/garmin.js:95`** — quando
  `a.startTimeLocal` falta, `dataIso` cai para `startTimeGMT` (pode virar o dia errado em UTC-3
  perto da meia-noite) e `inicio_local` fica `null`. Isso faz `parseLocal(null)` → `0` →
  `timeDiffSeconds` retornar `Infinity`, e a atividade **nunca** casa com a Strava correspondente.
  Raro (a API da Garmin normalmente traz `startTimeLocal`), registrado como nota.
  **Correção aplicada:** `log.warn` nos dois pontos de sync — **de propósito não se preenche
  `inicio_local` com o horário GMT**: rotular GMT como local seria falso e o desvio de 3 h
  continuaria fora da tolerância de 300 s, ou seja, fabricar o dado não faria a atividade casar,
  só esconderia o caso. A correção é de observabilidade.

## Infraestrutura

- **✅ FECHADO (2026-08-30, causa raiz identificada)** — **[CRÍTICO] [BUG-066] Permissões do
  filesystem de produção.**
  Algo executou um `chmod -R 777` na árvore do projeto: 117 arquivos rastreados passaram de
  `100644` para `100755`, 7727 arquivos ficaram world-writable, e **`server/.env` ficou `777`** —
  world-readable e world-writable, contendo `JWT_SECRET`, `ADMIN_PASS_HASH` e os tokens reais de
  Strava/Garmin. `data/training.db` ficou `775`.
  **Corrigido:** `server/.env` → `600`; `data/training.db` (+WAL/SHM) → `660`; os 117 rastreados
  restaurados ao modo que o HEAD registra; diretórios → `755`; zero world-writable restante. Os 3
  scripts `.py` da skill seguem `755` (eram executáveis em HEAD).
  **Causa raiz (informada pelo usuário, 2026-08-30):** falha crítica no host Proxmox `.52` que
  hospeda este LXC `.20`. Na recuperação dos LXCs os privilégios foram perdidos, e a restauração do
  acesso exigiu uma **concessão genérica de permissões** — foi ela que espalhou o `777`. Não houve,
  portanto, script do projeto nem comprometimento: foi operação de recuperação de infraestrutura.
  Consistente com as evidências: os binários batiam por hash com o HEAD (só o modo mudou) e o
  `/etc/nginx` ficou intacto — o alcance foi a árvore restaurada, não o sistema.
  **Não há follow-up de código.** A prevenção é operacional: numa próxima recuperação, restaurar
  permissões por alvo em vez de `-R 777`, e conferir `server/.env` (600) e `data/training.db` (660)
  logo depois. Os binários foram verificados por hash contra o HEAD e estão íntegros.

## Falsos-positivos desta auditoria (não corrigir)

- **`CLAUDE.md` citando `personal-trainer`/`nutritionist`** — reportado pelo `code-reviewer` como
  referência órfã. **Não procede:** o arquivo já havia sido corrigido na mesma sessão. O agente leu
  o snapshot do `CLAUDE.md` presente no contexto da sessão dele (capturado no boot, antes da edição)
  em vez de ler o arquivo do disco.
  **⚠ Lição:** agente que recebe o CLAUDE.md no contexto pode reportar sobre a versão velha —
  ao receber achado sobre arquivo de instruções, conferir no disco antes de aceitar.

---

# Auditoria 2026-07-11 (v2.2.0)

Escopo: projeto completo, com foco nas features pós-2.1.5 (Endurance por atividade, TESTES
de zonas, guia do Endurance Score, nutrição recalibrada) + fluxo de dados backend.
Planejamento da correção: **FASE 22** do roadmap (BUG-040…054).

## ✔ Corrigidos em v2.2.1 (2026-07-11) — Onda B1 (IMPORTANTES)

Revisados no diff pelo `code-reviewer` antes do merge.

- **✓ [CRÍTICO] [BUG-055] `js/garmin.js:63`** — botão "Sincronizar" da seção CONEXÕES **não
  fazia nada** (só o de INÍCIO funcionava). Dentro de `render()`, `const sync = fmtSyncParts(...)`
  sombreava a `async function sync()` do módulo; em `addEventListener('click', sync)` (linha 81)
  o handler recebia o objeto `{ data, hora }` (sem `handleEvent`) em vez da função. **É o mesmo
  bug já corrigido no Strava em v2.1.6** — passou despercebido no Garmin (a auditoria revisou
  `sync()` isolado, sem cruzar com o shadowing no `render()`). **Fix:** renomear a local para
  `syncMeta` (linhas 63-69). *(Reportado pelo usuário.)*
  Também: label do botão no caminho de erro voltou a "Sincronizar" (era "…últimos 90 dias").

- **[BUG-040] `js/insights.js`** — EMA unificada: `emaSeries` passou a ser a única
  implementação (warm-up a partir de 0, inclui `serie[0]`) e `calcEMA` delega a ela
  (`.at(-1)`). Card 7.2 e banner do topo agora exibem CTL/ATL/TSB idênticos.
- **[BUG-041] `js/insights.js`** — `enduranceRow` retorna `null` sem sexo definido (não
  assume masculino); a meta abaixo da barra pede o preenchimento de sexo/nascimento e o
  botão "Guia score" fica oculto até haver perfil completo.
- **[BUG-042] `js/testes.js`** — "FCM hoje" agora segue a precedência de
  `insights.js:calcFCMax` (`user.fcMax` → pico Garmin 120–230 via `/activities/unified` →
  220−idade), com a fonte exibida na nota. *(Nota: `user.fcMax` ainda não é populado por
  formulário — ramo mantido por paridade com insights.js; hoje resolve para Garmin/220−idade.)*
- **[BUG-043] `js/testes.js`** — Karvonen passou a usar faixas próprias de %FCR
  (`PCTS_FCR = [.50,.60,.70,.80,.90]`, ~10 p.p. abaixo de %FCM); tabela mostra as duas
  faixas e a nota explica que são zonas equivalentes.
- **[BUG-044] `server/routes/weights.js`** — `POST` remove a linha `fonte='garmin'` do
  mesmo dia antes de inserir a manual (regra "manual vence" nos dois sentidos).
- **[BUG-045] `js/ferramentas.js`** — barra e rótulos de PSI usam `rangeMin/rangeMax` que
  sempre contêm o resultado clampado (fim do "12 psi" sob rótulo "15–35 psi").
- *(BUG-049, `esc()` na nota do testes.js, também aplicado nesta onda.)*

## ✔ Corrigidos em v2.2.2 (2026-07-11) — Onda B2 (MENORES)

Revisados no diff pelo `code-reviewer` (regressões/XSS) e pelo `nutritionist` (BUG-047/050/054).

- **[BUG-046] `js/insights.js`** — fallback do peso semanal do TRIMP/kg usa o último dia da
  própria semana (`fimIncl = fim − 1`), não mais o domingo da semana seguinte (fim exclusivo).
- **[BUG-047] `js/ferramentas.js`** — alerta de calor extremo dispara por `temp > 35` em
  qualquer intensidade (o suor/sódio já escalavam nessa faixa); a frase "reduza a intensidade"
  só aparece p/ hard/max. Títulos/frases são strings literais fixas (sem dado do usuário).
- **[BUG-048] `js/activities.js`** — delta de Endurance sufixa "(dia)" quando há 2+ atividades
  no mesmo dia (o ganho é diário, não por pedal) — deixa de parecer dobrado.
- **[BUG-050] `js/ferramentas.js`** — piso de 45 g/h de carbo p/ hard/max acima de 45 min
  (validado pelo `nutritionist`: dentro de 30–60 g/h, Jeukendrup 2014; `carbCap` ainda limita).
- **[BUG-051] `js/ferramentas.js`** — nota de terreno rugoso usa `mult <= 0.85` (antes `<`,
  deixava "Asfalto em mau estado" com `mult 0.85` sem nota alguma).
- **[BUG-052] `js/insights.js`** — `calcFCMax` reusa `_age()`/`Profile.calcAge` (ano-mês-dia)
  em vez de dividir por 365,25 — some a divergência de ±1 bpm perto de aniversários.
- **[BUG-053] `server/db/schema-training.sql`** — comentário do matcher corrigido para
  `tempo(+/-300s)` (batia com `activity-matcher.js:TIME_TOL_S = 300`, dizia 60s).
- **[BUG-054] `js/ferramentas.js`** — pedal mais curto que o intervalo de gel gera um evento
  de ingestão na metade do tempo (antes: um único evento "beba tudo ao terminar").

---

## CRÍTICO

*Nenhum encontrado.* (Sem vulnerabilidade de segurança nova, sem quebra funcional.)

## IMPORTANTE

- **✓ [IMPORTANTE] [BUG-040] `js/insights.js:95` vs `:927`** — **duas implementações de EMA
  divergentes para CTL/ATL/TSB.** `calcEMA` (card 7.2 "TSS/CTL/ATL/TSB", linhas 189-190) usa
  semente `0` e começa em `i=1` — descarta `serie[0]` por completo; `emaSeries` (banner do topo,
  linhas 1064-1065) usa semente `serie[0]`. Ambas consomem a MESMA série de 60 dias construída
  do mesmo jeito (confirmado: 174-187 ≡ 1059-1063). Efeito: banner pode dizer "Em equilíbrio"
  enquanto o card diz "Carregado" para os mesmos dados, com CTL/ATL numericamente diferentes
  nos dois lugares. **Fix:** uma única função (semente 0 com warm-up, incluindo `serie[0]` no
  loop) usada por ambos; `calcEMA` vira `emaSeries(...).at(-1)`.

- **✓ [IMPORTANTE] [BUG-041] `js/insights.js:765,815,867`** — sexo ausente no perfil é tratado
  silenciosamente como masculino: `ENDURANCE_TABLE[sexo === 'f' ? 'f' : 'm']` e
  `sexoTxt = user.sexo === 'f' ? 'feminina' : 'masculina'`. Usuária sem o campo preenchido é
  classificada pelos limiares masculinos (mais altos) e o guia afirma "(masculina)" como se
  fosse dado confirmado — tier artificialmente inferior. **Fix:** sem sexo definido, retornar
  `null` de `enduranceRow` (ocultar tier/guia) ou pedir o preenchimento no próprio card.

- **✓ [IMPORTANTE] [BUG-042] `js/testes.js:103`** — a comparação usa `Profile.calcFCMax(idade)`
  (sempre `220 − idade`) como "FCM hoje", ignorando a precedência real do app
  (`user.fcMax` manual → pico Garmin via `refineFcMaxFromGarmin` → `220 − idade`). Quem tem FCM
  manual/refinada vê uma coluna "Hoje" que não corresponde às zonas reais do Perfil, e a nota
  afirma "(220−idade)" sem ressalva. **Fix:** usar a mesma precedência de `insights.js:calcFCMax`
  (ou a FCM final exibida no Perfil) e ajustar a nota.

- **✓ [IMPORTANTE/treino] [BUG-043] `js/testes.js:20,29`** — Karvonen reaproveita o vetor
  `PCTS` de **%FCM** sobre a **FC de reserva**: `fcRep + p×(fcmTanaka − fcRep)` com p = 0.60…1.00.
  Fisiologicamente, %FCR equivale a ~%FCM − 10 a 15 p.p. (Swain & Leutholtz 1997); usar os
  mesmos percentuais infla sistematicamente as zonas "Karvonen" no gráfico e induz a conclusão
  errada de que "as zonas atuais estão baixas". **Fix:** vetor próprio `PCTS_FCR` por zona
  (ex.: Z1 <50, Z2 50-60, Z3 60-70, Z4 70-80, Z5 80-90% FCR) ou nota explícita de que a
  comparação é didática entre bases diferentes. *(Achado do `personal-trainer`, confirmado no código.)*

- **✓ [IMPORTANTE] [BUG-044] `server/routes/weights.js:35-52`** — `POST /api/weights` sempre
  INSERE; não trata o caso de já existir linha `fonte='garmin'` na mesma `data`. Sequência
  sync Garmin → pesagem manual no mesmo dia cria **duas linhas** para a data (o inverso é
  tratado: o sync respeita linha manual existente). Histórico duplicado e "peso do dia" ambíguo.
  **Fix:** no POST, remover/atualizar a linha `garmin` do mesmo dia antes de inserir a manual
  (regra "manual vence" aplicada nos dois sentidos).

- **✓ [IMPORTANTE] [BUG-045] `js/ferramentas.js:120-131`** — o PSI final é clampado por
  `safeMin/safeMax`, mas os rótulos da barra (`psi-range-min/max`, index.html:1156) mostram
  `minPsi/maxPsi` (faixa típica, mais estreita). Combinações reais (ex.: ciclista leve + pneu
  largo + Cascalho Cat 4: resultado 12 psi vs rótulo "15–35 psi") exibem valor fora da faixa
  anunciada; `barPct` também pode estourar (clamp 3-97 disfarça). **Fix:** rótulos e barra
  usarem a mesma faixa do clamp (ou expandir a faixa exibida para conter o resultado).

## MENOR

- **✓ [MENOR] [BUG-046] `js/insights.js:249`** — fallback do peso semanal no TRIMP/kg usa
  `pesoDoDia(isoFim)`, e `isoFim` é o domingo da semana SEGUINTE (fim exclusivo) — uma pesagem
  feita exatamente nesse dia "vaza" para a média da semana anterior. Janela de 1 dia, efeito
  pequeno. **Fix:** usar o último dia da própria semana (`isoFim − 1`).

- **✓ [MENOR/nutrição] [BUG-047] `js/ferramentas.js:512`** — o alerta de calor extremo
  (hiponatremia, isotônicos) só dispara com `temp > 35 && (hard||max)`, mas o cálculo de
  suor/sódio já escala para `temp > 35` em QUALQUER intensidade — quem pedala easy/mod a 38 °C
  vê números de risco sem o aviso correspondente. **Fix:** disparar por `temp > 35` sozinho e
  mencionar "reduza a intensidade" apenas quando hard/max.

- **✓ [MENOR] [BUG-048] `js/activities.js:700-706`** — delta de Endurance é indexado por
  data (`_enduranceDelta['YYYY-MM-DD']`); com 2+ atividades no mesmo dia, o MESMO ganho do dia
  aparece em todas as linhas (parece dobrado). O comentário documenta a limitação da API, mas a
  UI não. **Fix:** exibir só na primeira atividade do dia ou sufixar "(dia)" quando houver mais
  de uma.

- **✔ [MENOR/sec] [BUG-049] `js/testes.js:59-61`** — *(corrigido em v2.2.1, Onda B1)*
  `note.innerHTML` interpola `fcRepFonte` (contém `arr[i].data` vindo de `/garmin/health`) sem
  `esc()`. Hoje é sempre `YYYY-MM-DD` gerado pelo backend (não explorável), mas quebra a regra
  do projeto. **Fix aplicado:** `esc(fcRepFonte)` (e `esc(fcmFonte)`).

- **✓ [MENOR/nutrição] [BUG-050] `js/ferramentas.js:474`** — rampa de carbo é só por duração
  com `+10 g/h` fixo por intensidade: treino de 45 min hard/max recebe 35 g/h, abaixo do
  consenso p/ exercício intenso de 45-60+ min (30-60 g/h, Jeukendrup 2014). Efeito absoluto
  pequeno em pedais curtos. **Fix:** escalar o ajuste de intensidade com a faixa de duração
  (ou piso de 45-60 g/h p/ hard/max acima de ~1h).

- **✓ [MENOR] [BUG-051] `js/ferramentas.js:138`** — nota contextual usa `tData.mult < 0.85`
  (estrito), e "Asfalto em mau estado" tem `mult: 0.85` exato — único terreno rugoso que não
  recebe nenhuma nota (nem a de liso, `>= 1.03`). **Fix:** `<= 0.85`.

- **✓ [MENOR] [BUG-052] `js/insights.js:56-58`** — `calcFCMax` local calcula idade via
  `365.25 dias` (float) em vez de `Profile.calcAge` (ano-mês-dia); perto de aniversários a FCM
  pode divergir ±1 bpm da mostrada no Perfil. **Fix:** reusar `Profile.calcAge`/`_age()`.

- **✓ [MENOR] [BUG-053] `server/db/schema-training.sql:259`** — comentário do matcher diz
  `tempo(+/-60s)`, mas `activity-matcher.js:17` usa `TIME_TOL_S = 300`. **Fix:** atualizar comentário.

- **✓ [MENOR/nutrição] [BUG-054] `js/ferramentas.js:530-533`** — pedal mais curto que o
  intervalo de gel gera cronograma com UM evento no fim do percurso ("beba tudo ao terminar").
  **Fix:** evento intermediário na metade do tempo, ou suprimir o cronograma abaixo de ~20 min
  com mensagem simples.

## Pendências da auditoria anterior — resolvidas nesta rodada

- **`recovery_time_h` (unidade)** — **RESOLVIDO/confirmado:** a lib `garminconnect`
  (`typed.py:330`) documenta que `recoveryTime` vem em **minutos**. A exibição
  (`insights.js:537`, `/60` → horas) está CORRETA e o comentário no código já avisa. Fica
  como melhoria opcional renomear a coluna para `recovery_time_min` (migração idempotente).

## Falsos-positivos desta auditoria (não corrigir)

- **`js/ferramentas.js:551` `gelsThisEvent` negativo** — não ocorre: `Math.round((i+1)·g/n)` é
  não-decrescente em `i`, logo as diferenças acumuladas são sempre ≥ 0.
- **`server/scheduler.js:16-20` `slotKey` mistura data UTC + hora local** — sem efeito de dado;
  o Set só deduplica slots dentro do mesmo processo.
- **`server/utils/training-log-helper.js:83-88` retorno de `autoFillBike`** — semanticamente
  correto hoje; a fragilidade do fluxo de controle virou item de MELHORIAS.md.
- **`GET /activities/unified` × `runMatching` concorrente** — duplicata apenas transitória entre
  polls do frontend; autocorrige no próximo fetch. Registrado como melhoria (lock de sync).

---

# Auditoria 2026-07-06 (v2.1.5)

---

## ✔ Corrigidos em v2.1.6 (2026-07-07)

**CRÍTICO (todos):**
- `js/strava.js:62,78` — variável `sync` renomeada para `syncMeta` (botão Sincronizar volta a funcionar).
- `js/modals.js:128` — `toast` escapa `message` via `esc()`.
- `js/modals.js:25,26,39` — `openModal` escapa `tag`, `title` e `label` (defesa em profundidade). `confirmModal` deixou de duplo-escapar.
- `server/routes/auth.js:50` — `POST /api/auth/logout` agora exige `preHandler: requireAuth`.

**IMPORTANTE:**
- `js/app.js:517` — usa `window.toast(msg, { kind:'error' })` (o `Modals.toast` inexistente caía sempre no `alert`).
- Assinatura posicional de `toast` normalizada para `{ kind }` em `strava.js`, `garmin.js`, `home.js`, `activities.js` (erros voltam a aparecer como erro).
- `js/backup.js:575` — `readVal('readiness-score')` (PDF deixa de imprimir sempre `—`).
- `js/workouts.js:478` / `js/home-workout.js:175` — validação de tipo/tamanho do JSON importado.
- `server/routes/weights.js:48` — `fonte` restrita a whitelist `['manual','garmin']`.
- `server/routes/garmin.js:85` — código MFA validado por `/^\d{6,8}$/` (400 se inválido).
- `js/insights.js:95` — `calcEMA` inicia em `0` (warm-up), evita CTL/ATL inflado no início do histórico.
- `js/ferramentas.js:94` — parsing de `psi-distrib` com validação (fallback 40/60, sem "NaN psi").
- `js/bikes.js:985` — removido `novaObservacao: notas` (não duplica a nota de substituição na observação do novo componente).
- `js/login.js:9` — null-checks em `btnLbl`/`btnSpin`/`setBusy`.
- `js/insights.js:534` — **não era bug:** `recovery_time_h` guarda minutos (Garmin `recoveryTime`), `/60`→horas está correto; adicionado comentário.

**MENOR:**
- `js/backup.js:919` — CSV export com quoting + neutralização de fórmula (CSV injection).

**Pendentes (não incluídos neste lote):**
- Demais MENORES abaixo permanecem em aberto.

---

## ✔ Corrigidos em v2.1.7 (2026-07-07) — pendências da revisão

**Fusos horários:**
- `js/activities.js:51` — `fmtDate` usava `new Date(iso)` e recuava a data em pedais de madrugada
  (start_date_local vem com "Z"); passou a usar o normalizador `parseDT()` já existente no módulo.
- `server/utils/activity-matcher.js` — **não era bug:** `inicio_iso` guarda `start_date_local`
  (horário local rotulado com "Z"), então `parseLocal` comparar wall-clock local vs local está
  correto (o offset do servidor se cancela na subtração). Removido o `parseIso` (código morto) e
  esclarecido o comentário.

**Nutrição (validado com subagent `nutritionist`):**
- `js/ferramentas.js` — extraído helper `estimateRideTimeMin` (plano + penalidade de subida),
  reusado por `calcRoute` e `calcNutri`.
- `calcRoute` — kcal agora via `estimateRideCalories` normalizado pelo **peso do perfil**
  (`Storage.getUser().pesoAtual`, atualizado pela sync Garmin) + energia de subida fisiológica
  (`elev·peso·0,0098`), no lugar de `elev*0.08` (~6–8× baixo).
- `calcRoute` — faixas `flatKcalPerKm` corrigidas de 3,5–8 para **20/25/30/37 kcal/km** (base 72 kg,
  derivadas de METs ACSM); as antigas subestimavam o gasto plano ~4–5×. Apontado pelo `nutritionist`.
- `calcNutri` — duração via modelo de penalidade de subida (não mais distância virtual ÷ velocidade
  plana), corrigindo carbo/sódio inflados em rotas montanhosas.
- `calcNutri` (segurança, endossado pelo `nutritionist`): cap de sódio p/ *heavy sweater* em
  **1400 mg/h**; aviso de mix glicose+frutose passa a disparar a partir de **2h** (antes 4h).

---

## CRÍTICO

- **✓ [CRÍTICO] `js/strava.js:62,78`** — Botão "Sincronizar" do Strava **não faz nada**. Dentro de
  `render()`, `const sync = fmtSyncParts(...)` (linha 62) faz shadow da `async function sync()`
  (linha 121). Em `btn.addEventListener('click', sync)` (linha 78), `sync` resolve para o objeto
  `{ data, hora }`, não a função. **Fix:** renomear a variável local para `syncMeta` (e ajustar
  linhas 63, 68).

- **✓ [CRÍTICO] `js/modals.js:128`** — XSS no `toast()`: `message` é injetado via `innerHTML` sem
  escape (`<span>${message}</span>`). Vários callers concatenam `err.message` vindo do backend
  (ex.: `app.js`, `storage.js`, `garmin.js`, `backup.js`). Uma mensagem de erro com HTML executa
  script. **Fix:** `<span>${esc(message)}</span>` (opção `html:true` só para casos intencionais).

- **✓ [CRÍTICO] `js/modals.js:25,26,39`** — XSS/defesa-em-profundidade: `tag`, `title` e `a.label`
  são injetados em `innerHTML` sem escape. Hoje os callers passam literais, mas o contrato não
  garante. **Fix:** escapar `tag`, `title` e `label` dentro de `openModal` (o `bodyHTML` continua
  HTML livre por design).

- **✓ [CRÍTICO/sec] `server/routes/auth.js:50`** — `POST /api/auth/logout` **sem** `preHandler:
  requireAuth`. Qualquer requisição não autenticada grava `last_logout_at` e invalida a sessão
  ativa do dono (DoS de sessão sem credenciais). **Fix:** adicionar `{ preHandler: requireAuth }`.

## IMPORTANTE

- **✓ [IMPORTANTE] `js/app.js:517`** — `Modals.toast` não existe (`window.Modals = { open, close,
  confirm }`), então o branch cai sempre no `alert()`. Além disso passa `'error'` posicional.
  **Fix:** usar `window.toast(msg, { kind: 'error' })`.

- **✓ [IMPORTANTE] assinatura de `toast` posicional** — `modals.js:123` é `toast(message, { kind })`,
  mas ~15 chamadas passam a string posicional `toast(msg, 'success'|'error')`, o que deixa `kind`
  `undefined`. Efeito: **toasts de erro aparecem como sucesso** (sem `toast-error`). Sites:
  `strava.js:130,140`, `garmin.js:169,181,184,189,204,207,234,245`, `activities.js:483,514`,
  `home.js:275,279,317,327`. **Fix:** padronizar para `{ kind: '...' }`.

- **✓ [IMPORTANTE] `js/backup.js:575`** — `readVal('readiness-value')` referencia id inexistente;
  o correto é `readiness-score` (`insights.js:525`). O PDF imprime sempre `—` para Training
  Readiness. **Fix:** `readVal('readiness-score')`.

- **[IMPORTANTE] `js/workouts.js:478` e `js/home-workout.js:175`** — `importPlan` /
  `importHomeExercises` não validam a estrutura do JSON importado (só `Array.isArray`), diferente
  de `validateBackupStructure` em `backup.js`. Import malicioso injeta objetos arbitrários no
  Storage. **Fix:** validar tipos/tamanhos espelhando `validateBackupStructure`.

- **[IMPORTANTE] `server/routes/weights.js:48`** — campo `fonte` aceita qualquer string do cliente;
  um cliente autenticado grava `fonte:'garmin'` e confunde a lógica de prioridade do scheduler.
  **Fix:** whitelist `['manual','garmin'].includes(fonte) ? fonte : 'manual'`.

- **[IMPORTANTE] `server/services/garmin.js:77` / rota `server/routes/garmin.js:85`** — código MFA
  (`req.body.mfa`) vai ao subprocess sem validação de formato (não há injeção de shell, mas valor
  malformado é passado ao Python). **Fix:** validar `/^\d{6,8}$/` na rota (400 se inválido).

- **[IMPORTANTE] fusos horários** — três pontos removem/ignoram timezone e podem deslocar datas
  quando `TZ` do servidor ≠ UTC-3: `js/activities.js:63` (`parseDT` remove `Z`), `js/activities.js:54`
  (`fmtDate` usa `new Date(iso)` → UTC meia-noite vira dia anterior em UTC-3),
  `server/utils/activity-matcher.js:26` (`parseLocal` remove `Z`, quebrando o match Strava⇄Garmin
  por offset > tolerância de 300 s). **Fix:** normalizar para `T12:00:00` como o resto do código e
  fixar o fuso no matcher.

- **[IMPORTANTE] `js/insights.js:95`** — `calcEMA` inicializa com `serieDiaria[0]` em vez de `0`.
  Com janela de 60 dias sem warm-up, CTL/ATL (42d/7d) ficam contaminados/inflados no início e só
  convergem nos últimos ~42 dias, produzindo TSB impreciso para histórico curto. **Fix:** inicializar
  `ema = 0` (ou buscar 42 dias extras só para warm-up). *(TSB = CTL − ATL está correto — confirmado.)*

- **[IMPORTANTE] `js/insights.js:534`** — `recovery_time_h` é dividido por 60 (`/60`) e exibido com
  sufixo `h`. O nome do campo (schema `recovery_time_h INTEGER`, vindo de `r.recoveryTime`) sugere
  **horas** — se for horas, a divisão dá valor 60× menor. **Verificar** a unidade real que a Garmin
  retorna em `recoveryTime` e alinhar nome/cálculo.
  *→ Resolvido na auditoria 2026-07-11: a unidade é MINUTOS (lib `garminconnect`); a divisão está
  correta. Renomear a coluna é melhoria opcional.*

- **[IMPORTANTE] `js/ferramentas.js:94`** — parsing de `psi-distrib` ("40/60") sem validação: entrada
  vazia/malformada gera `NaN` e exibe "NaN psi". **Fix:** validar 2 partes numéricas somando 100,
  senão fallback 40/60.

- **[IMPORTANTE] `js/bikes.js:985`** — `novaObservacao: notas` duplica o campo `notas` (mesmo valor
  para dois campos com semânticas possivelmente distintas). **Verificar** o que o backend espera.

- **[IMPORTANTE] `js/login.js:9`** — `btn.querySelector('.login-btn-spin')` sem null-check; se o HTML
  do botão mudar, `setBusy(true)` lança `TypeError` e quebra o submit. **Fix:** guardas de null.

- **[IMPORTANTE/nutrição] `js/ferramentas.js:375-376`** — estimativa de kcal da rota (`calcRoute`)
  ignora o peso do ciclista (faixas fixas por velocidade) e usa fator de elevação `elev*0.08` kcal/m,
  ~6-8× abaixo do custo real (~0,5–0,8 kcal/m; Minetti 2002). Para 800 m de ganho: ~64 kcal
  calculadas vs ~520 kcal reais. **Fix:** normalizar por peso (~0,16 kcal/kg/km) e corrigir o fator
  de subida; ou exibir disclaimer de que peso não é considerado.

- **[IMPORTANTE/nutrição] `js/ferramentas.js:433`** — `calcNutri` calcula `duration_h = virtDist/speed`
  com `virtDist = dist + elev/100`, misturando km reais com equivalência de elevação sobre a
  velocidade de plano; superestima duração (e carbo/sódio totais) em percursos montanhosos.
  **Fix:** estimar duração com penalidade de subida explícita, ou pedir a duração ao usuário.

## ✔ Corrigidos em v2.2.0 (2026-07-07) — Onda A (MENORES rápidos)

- `js/gpx.js` — mensagem de erro XML genérica (não embute o cru do `<parsererror>`).
- `js/profile.js` — `escHTML` (em vez de `escAttr`) para o texto do modelo da bike; teto de FCM
  observada `≤230` (descarta artefato de sensor) em `refineFcMaxFromGarmin`.
- `js/insights.js` — badge ATL "recuperado" → "em equilíbrio" (mais preciso).
- `js/charts.js` — `weekIndex` usa `Math.floor` (mapeamento de semana previsível).
- `js/ferramentas.js` — `alert` do cassete → `toast`; listener do `#terrain-guide` só registrado
  uma vez (guarda `dataset.closeWired`).
- `js/bikes.js` — fallback local de `esc` completo (`& < > " '`); `escAttr` cai no `esc`.
- `js/storage.js` — `importJSON` com `try/catch` no `JSON.parse`.
- *(Vento da rota — falso-positivo: o `<select id="route-wind">` já traz opções com sinal
  explícito "A favor +5 / Contra −5"; sem mudança.)*

---

## MENOR

- **✓ [MENOR] `js/backup.js:919`** — CSV injection: `w.data/tipo/fonte` sem aspas/escape; vírgula ou
  quebra de linha corrompe o CSV. Baixo risco (valores enum/ISO hoje). **Fix:** quotar campos.

- **[MENOR/sec] `js/gpx.js:11`** — `textContent` do `<parsererror>` (conteúdo do arquivo de terceiro)
  é propagado em `Error`/`toast`. **Fix:** mensagem genérica "XML inválido" sem embutir o cru.

- **[MENOR] `js/profile.js:84-87,149`** — usa `escAttr()` para conteúdo de texto (deveria ser
  `escHTML()`). Hoje `escAttr === esc`, sem diferença prática, mas é frágil. **Fix:** usar `escHTML`.

- **[MENOR] `js/insights.js:1075`** — `atl <= ctl ? 'recuperado' : 'fadiga elevada'`: "recuperado"
  é ambíguo (pode ser só semana leve). Texto "em equilíbrio" seria mais preciso.

- **[MENOR] `js/charts.js:308`** — `Math.round(daysBetween/7)` pode mapear pesagem à semana errada;
  `Math.floor` é mais previsível.

- **[MENOR] `js/ferramentas.js:598`** — `populateTerrainGrid()` re-registra o listener de
  `#terrain-guide` a cada visita da seção (acúmulo). **Fix:** `{ once:true }` ou checar existência.

- **[MENOR] `js/ferramentas.js:259`** — `alert()` bloqueante, inconsistente com o sistema de `toast`.

- **[MENOR] `js/ferramentas.js:369`** — campo de vento (`route-wind`) não indica sinal (favor/contra);
  positivo sempre favorece a velocidade, invertendo o caso comum (vento de frente).

- **[MENOR] `js/bikes.js:29-30`** — fallbacks locais de `esc`/`escAttr` são incompletos (sem `& < >`);
  se `window.esc` faltar por race de carga, o fallback é inseguro. **Fix:** fallback completo.

- **[MENOR] `js/storage.js:474`** — `importJSON` faz `JSON.parse` sem try/catch (erro escapa ao caller).

- **✔ [MENOR/perf] `server/scheduler.js:55,246`** — *(corrigido em v2.3.0, FASE 23.2)*
  `db.prepare('SELECT 1 ...')` era recompilado a cada item da transação. **Fix aplicado:** statement
  `exists` preparado uma vez fora da transação (Garmin e Strava).

- **✔ [MENOR] `server/routes/bikes.js:124-155`** — *(corrigido em v2.3.0, FASE 23.2)*
  `EXCLUDED_*_TYPES` eram fragmentos SQL interpolados (`tipo NOT IN ${const}`). **Fix aplicado:**
  constantes viraram arrays; queries usam `NOT IN (?,?,...)` com bind por parâmetros (SQL
  equivalente ao anterior, verificado).

- **[MENOR/nutrição] `js/profile.js:32`** e **`js/insights.js:16 vs 81-92`** — `220−idade` é a fórmula
  menos acurada (Tanaka `208−0.7×idade` é melhor para adultos); e o comentário do cabeçalho ("1h em
  limiar = 100 TSS") contradiz a fórmula usada (`tempo_h × intensity² × 100` dá ~77 a 88% FCM). São
  aproximações aceitáveis para uso pessoal — ajustar comentários/fórmula se quiser precisão.

- **[MENOR] `js/insights.js:175`** — filtro de FCM observada só tem piso (`>=120`), sem teto; um
  artefato de sensor (>230 bpm) entraria. **Fix:** limitar `maxObs <= 230`.

---

## Falsos-positivos investigados (não corrigir)

- **⚠ Lição (BUG-055):** ao revisar handlers, cruzar a definição da função com o `render()` que
  registra o listener — o shadowing de `sync` só é visível olhando os dois juntos. Padrão a
  varrer em toda conexão nova: `const <nome> = ...` com o mesmo nome de uma função de módulo.

- **`js/activities.js:242` `fmtKm(act.distanciaKm * 1000)`** — **não é bug.** `fmtKm` local
  (`activities.js:44`) espera metros e divide por 1000; a multiplicação por 1000 apenas desfaz a
  unidade. Resultado correto, apenas confuso — ver melhoria de consistência em MELHORIAS.md.
- **`js/insights.js:189` TSB = CTL − ATL** — sinal correto (convenção Banister/TrainingPeaks).
