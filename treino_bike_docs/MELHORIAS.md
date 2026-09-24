# MELHORIAS — treino_bike

Oportunidades de melhoria (qualidade, segurança preventiva, manutenibilidade, correção fina de
domínio) encontradas na rotina de revisão multi-agente (subagents `code-reviewer` +
`revisor-seguranca` + `revisor-performance`; até 2026-08-09 os agentes de domínio eram
`nutritionist` + `personal-trainer`). Auditorias: **2026-07-06** (v2.1.5), **2026-07-11** (v2.2.0)
e **2026-08-30** (v2.7.1).

Não são bugs com impacto imediato (esses estão em [BUGS.md](BUGS.md)). Cada item traz o esforço
estimado: **baixo** / **médio** / **alto**.

---

## PageSpeed/privacidade — login.html (2026-09-23, v2.9.4)

Login.html saiu do Font Awesome/Google Fonts via CDN (SVGs inline + fontes self-hosted em
`css/fonts/`), ganhou `noindex`/`robots.txt` e CSP sem `'unsafe-inline'`. PageSpeed Insights real
(mobile, produção): Desempenho 94, Acessibilidade 96, Boas Práticas 96, SEO 100 — medido **antes**
do deploy destas mudanças (achados batiam exatamente com o que foi corrigido: render-blocking de
CDN, CSS não usado do Font Awesome).

- **`index.html`/`mobile.html` continuam no Font Awesome + Google Fonts via CDN** — esforço
  **médio/alto**: usam dezenas de ícones pela nav e seções (ao contrário do login, que usava só
  4), então trocar por SVG inline é um refactor de superfície bem maior. Fica registrado como
  possível próxima onda, não como pendência da mudança do login.
- **Preload das fontes self-hosted** — esforço **baixo**: `<link rel="preload" as="font" ...>` em
  `login.html` para as duas fontes de `css/fonts/` eliminaria o flash de fonte e ganharia pontos
  de LCP. Incremental, não bloqueante.

---

## FASE 25 — auditoria da UI mobile (2026-09-03, v2.9.0)

Subagents `revisor-seguranca` e `revisor-performance` sobre `mobile.html`, `js/mobile/*`,
`js/variant.js` e `js/core/*`. Bugs correspondentes: BUG-072 a BUG-078 em [BUGS.md](BUGS.md).

Escala do banco no momento da medição, que condiciona tudo abaixo: 133 `garmin_activities`,
107 `strava_activities` (104 já com link — só ~3 sobrevivem ao dedup), 114 `garmin_daily_health`,
71 `weights`, 12 PRs, 2 bikes, DB de 1,5 MB. **Nenhum endpoint é caro em CPU de banco hoje** — o
pior caso medido é 4 ms. O custo real está em round-trips repetidos e em desperdício estrutural
que escala com o histórico.

### Padrão único de cache com TTL para as views mobile — esforço **baixo** · 🚧 PARCIAL na v2.9.2

> **Estado em 2026-09-04:** o helper existe e está em uso — `MShell.cached(chave, ttlMs, fn)`,
> `MShell.invalidate(chave?)` e `MShell.TTL_DADOS` (5 min), em `js/mobile/shell.js`. A v2.9.2 o
> aplicou em **Insights** (BUG-073) e **Bikes** (BUG-074), e ligou o `invalidate()` ao `syncAll()`.
>
> **Falta migrar** as três views que já tinham guarda própria: Atividades e Perfil (flag booleana
> eterna) e o clima de Passeios (TTL manual de 1 h, que pode virar caso do padrão). A flag eterna
> tem o defeito oposto ao da ausência de guarda — quem abre Atividades às 8h e volta às 20h nunca
> vê o pedal do dia sem F5 —, então migrar não é só cosmético. Falta também **Início** (BUG-077,
> 2 chamadas sem guarda).
>
> O texto abaixo é o desenho original, mantido porque a justificativa do TTL continua valendo.

Hoje convivem três padrões: flag booleana eterna (Atividades, Perfil, rides), TTL manual (clima,
`js/mobile/rides-mobile.js:163`) e nenhuma guarda (Insights, Início, Bikes). A flag eterna tem o
defeito oposto ao da ausência: quem abre Atividades às 8h e volta às 20h nunca vê o pedal do dia
sem dar F5.

Helper em `js/mobile/shell.js`:
```js
MShell.cached(chave, ttlMs, fn)  // memoiza ou reexecuta
MShell.invalidate()              // limpa tudo
```

**TTL de 5 minutos.** O sync roda a cada 30 min (`server/scheduler.js:10`) e os dados Garmin não
mudam entre syncs, então 5 min cobre 100% das trocas de aba de uma sessão — que é o caso a matar —
e no pior caso serve dado 5 min velho num universo onde ele já nasce até 30 min velho. TTL maior
não compra frescura e piora a percepção logo após um sync manual. Complemento obrigatório:
`MShell.invalidate()` no fim de `syncAll()` (`js/mobile/home-mobile.js:214`). O TTL do clima pode
seguir em 1 h — o Open-Meteo atualiza de hora em hora.

### `SELECT *` lendo 731 KB por request para descartar — esforço **baixo**

`server/routes/activities.js:64` e `:72` fazem `SELECT *`, mas `garminRow()`/`stravaRow()`
(`:14-55`) descartam `polyline`, `payload` e `hr_zones`. Medido no banco real:

| coluna | volume |
|---|---|
| `garmin_activities.polyline` | 411 KB |
| `strava_activities.payload` | 232 KB |
| `garmin_activities.payload` | 61 KB |
| `garmin_activities.hr_zones` | 27 KB |
| **total lido e jogado fora** | **731 KB** |

**Ganho medido:** `days=1825` cai de 3,98 ms → **2,52 ms** (−37%); `days=180` de 2,23 → 1,43 ms
(−36%). O payload de rede não muda — essas colunas nunca chegavam ao JSON, isso já está correto.

**Correção:** listar as 17 colunas usadas. Mesmo tratamento em `server/routes/garmin.js:374`
(`/garmin/activities`, também `SELECT *`). A polyline cresce ~3 KB por pedal, então o desperdício
aumenta linearmente para sempre.

### Remover `'unsafe-inline'` de `script-src` no mobile — esforço **baixo**

`mobile.html:10` declara `'unsafe-inline'` em `script-src`, e **nada que o mobile carrega precisa
disso**. Verificado: zero `<script>` inline em `mobile.html`, zero handler `on*=` gerado pelos
módulos mobile, e o único gerador de handler inline do projeto (`js/utils.js:43`, no
`Avatar.html`) não é chamado por nenhum arquivo carregado no mobile. O único `on*` do código mobile
é `rides-mobile.js:112` (`el.onclick = ...`), que é atribuição de propriedade JS e não sofre CSP.

```
script-src 'self' https://cdnjs.cloudflare.com;
```

Dá ao mobile uma defesa em profundidade contra XSS que o desktop **não consegue ter** enquanto
`utils.js:43` gerar `onerror="..."`. `style-src 'unsafe-inline'` continua obrigatório (os módulos
usam `style="..."` em dezenas de lugares). Testar as 7 telas com o console aberto antes de publicar.

### CSP: faltam `base-uri`, `form-action` e `object-src` — esforço **baixo**

Nenhuma das duas CSPs (meta e header do nginx) declara essas três diretivas. Com `'unsafe-inline'`
presente, um `<base href="https://evil/">` injetado redireciona todos os `<script src="js/...">`
relativos. Acrescentar `base-uri 'self'; form-action 'self'; object-src 'none';` custa nada.

### `kpi()` com contratos de escape opostos entre dois módulos — esforço **baixo**

```js
<div class="m-sub">${sub || ''}</div>     // js/mobile/home-mobile.js:31    → HTML cru
<div class="m-sub">${esc(sub)}</div>      // js/mobile/insights-mobile.js:33 → escapado
```

Mesmo nome, assinatura quase idêntica, contratos **opostos**. Hoje é seguro — os quatro chamadores
de Início são numéricos ou já aplicam `esc()` internamente (`:81`, `:91`) — mas é exatamente a
armadilha que um chamador novo pisa. Renomear o parâmetro para `subHTML` e documentar "HTML já
escapado pelo chamador", como `js/mobile/shell.js:17` faz com `actions`. Mesmo padrão em
`js/mobile/profile-mobile.js:101` e `:110` (`taxa`/`faltam` são fragmentos crus, e o vizinho `msg`
na `:112` é escapado).

### Extrair o logout para `js/core/session.js` — esforço **baixo**

`js/mobile/more-mobile.js:73` duplica `js/app.js:405` de propósito (o comentário na `:72` assume).
Como a lógica é sensível (revogação server-side) e agora tem duas cópias, o fix do BUG-075 corre o
risco de chegar só a uma. É o mesmo argumento que `js/mobile/boot.js:5-7` já faz sobre
`ensureAuthenticated()` — que é a **terceira** cópia desse tipo de duplicação.

### Insights pede 180 dias para usar 60 — esforço **baixo**

`js/mobile/insights-mobile.js:289` busca `?days=180`, mas `Metrics.calcTSBMetrics`
(`js/core/metrics.js:76-97`) monta uma série fixa de 60 dias e a EMA de 42 d converge dentro dela.
Nada mais em Insights usa `items`. Os 120 dias extras são ~35 atividades, ~14 KB de JSON e ~1 ms de
handler sem uso. Trocar por `?days=90` (60 da série + warm-up da EMA). **Conferir antes** se
`js/insights.js` (desktop) depende da janela maior.

### Chart.js (205 KB) carregado síncrono numa tela que não tem gráfico — esforço **médio**

`mobile.html:108` carrega o UMD do CDN antes de todos os módulos, mas a Home mobile **não tem
nenhum gráfico** (não há chamada a `mChart` em `home-mobile.js`) — o primeiro só aparece em
Atividades, Insights ou Perfil. São ~205 KB de parse+eval no thread principal antes de o `boot()`
começar, num LXC de 2 vCPU e em CPU de celular. O gzip do nginx está ativo e o SW cacheia, então o
peso é de **parse**, não de rede — e acontece em toda abertura do app.

**Correção:** `MShell.ensureChart()` injetando a tag sob demanda no primeiro `onEnter` que precise,
ou no mínimo `defer`. Mesmo raciocínio para `js/bikes.js` (82 KB, o maior arquivo do mobile, usado
por uma aba só).

### Proxy Open-Meteo sem cache no servidor — esforço **baixo**

`server/routes/weather.js:50` faz um fetch externo por request. O TTL de 1 h do mobile
(`rides-mobile.js:163`) protege só aquela aba naquela sessão — um F5, o desktop, ou o PWA reaberto
batem de novo. Cache em módulo com TTL de 30 min chaveado por lat/lon: 6 linhas, tira a latência
externa do caminho de Passeios.

### `db.prepare()` dentro de função chamada em loop — esforço **baixo**

`server/routes/bikes.js:141`, `:151`, `:186`, `:193`, `:225`, `:232` — `calcBikeStats` prepara 2
statements por bike, e `GET /api/bikes` (`:334`) o chama num `map`. **Medido:** 0,218 ms com
`prepare()` dentro vs **0,101 ms** hoisted (2,2× por bike). Com 2 bikes o ganho é 0,23 ms —
irrelevante hoje, mas o padrão está errado e `server/routes/garmin.js` já faz certo
(`ACTIVITY_UPSERT_SQL` preparado uma vez). Os placeholders de `EXCLUDED_*_TYPES` são constantes, o
hoist é trivial. Corrigir junto de outra passada nesse arquivo.

### `dailyWeights` recalculado 3× por render — esforço **baixo**

`js/mobile/profile-mobile.js:80`, `:149`, `:187` chamam
`WeightStats.dailyWeights(Storage.getWeights())` três vezes, reagrupando e reordenando 71 pesagens.
Custo desprezível (<0,1 ms); anotado porque é uma linha — calcular uma vez em `render()`.

### Escape duplo em títulos de modal — esforço **baixo**

`js/bikes.js:667`, `:693`, `:723`, `:785` fazem `title: \`Remover ${esc(bike.nome)}?\``, mas
`js/modals.js:26` já aplica `esc(title)`. Uma bike chamada `Caloi & Cia` aparece como
`Caloi &amp;amp; Cia`. Cosmético e pré-existente, mas agora visível também na aba Bikes do mobile,
que reaproveita `bikes.js` inteiro.

### Não são problemas — não reabrir

- **gzip**: configurado corretamente (`/etc/nginx/sites-available/treino_bike:84-87`, inclui
  `application/json`) e verificado em resposta real.
- **Índices**: `idx_garmin_data`, `idx_strava_data` e `idx_activity_links_strava` cobrem os planos
  quentes com `SEARCH`, não `SCAN`. `/activities/weekly-records` faz `SCAN garmin_activities`, mas
  com 133 linhas é 0,5 ms e um índice em `tipo` seria **pior que inútil** nessa cardinalidade.
- **`/activities/unified` vazando polyline no JSON**: não vaza, `garminRow()` projeta. O
  desperdício é só do lado do SQLite.
- **`js/core/` com complexidade quadrática**: nenhum dos 6 arquivos é O(n²) nem precisa de
  memoização. O único candidato é `metrics.js:100` (`_movingAvg`, O(n·k) pelo `slice`), usado só
  por `js/insights.js:298` no desktop sobre 60 pontos.
- **Vazamento de listeners no mobile**: não confirmado. As views reescrevem `view.innerHTML` e
  `MShell.setHeader` reescreve o header inteiro — os nós antigos levam os handlers junto.

---

## Onda mobile — trace de performance (2026-09-01, v2.7.9)

Origem: trace via CDP com iPhone 14 Pro emulado, CPU 4× mais lenta e Fast 3G, cache frio, sem
service worker. Mediana de 3 execuções por cenário.

**Referência medida.** A UI mobile já era muito mais leve que a desktop nas mesmas condições:

| | mobile | desktop |
|---|---:|---:|
| Total Blocking Time | **7 ms** | 1.595 ms |
| First Contentful Paint | 1.140 ms | 2.660 ms |
| Nós no DOM | 192 | 1.670 |
| Event listeners | 14 | 145 |
| Long tasks | 1 | 14 |

**O teste local exagerava o custo de rede.** Cada JS local custava ~170 ms independente do tamanho
(`version.js`, 700 bytes, levava 177 ms) — latência do HTTP/1.1 sem multiplexação do servidor de
teste. Medindo a produção com o mesmo throttling: **HTTP/3 + Cloudflare + zstd**, 4 ms por arquivo,
DOMContentLoaded de 5.461 ms → **1.042 ms**, 82 kB transferidos para 550 kB descompactados.
**Conclusão: os 20 arquivos JS separados não são problema e não devem ser concatenados.** De quebra,
o HTML tem `cf-cache-status: DYNAMIC` — o Cloudflare não cacheia o documento, então não há risco de
servir HTML velho por 7 dias.

### ✅ IMPLEMENTADO (v2.7.9) — carga seletiva no boot mobile · esforço baixo

`Storage.loadAll()` buscava 8 coleções antes do primeiro pixel de conteúdo; as telas mobile leem
**2** (`profile` via `getUser`, `training-log` via `getTrainingLog`). `modes`, `workouts`,
`weights`, `rides`, `home-exercises` e `routes` não são lidas por nenhuma delas — `js/bikes.js` fala
direto com a API. Além disso, `auth/me` e a carga eram sequenciais.

- `js/storage.js` — o corpo de `loadAll()` virou o mapa `LOADERS`; nasceu `Storage.load(nomes)` e
  `loadAll()` passou a ser `load(Object.keys(LOADERS))`. O desktop não muda: mesmas 8 chamadas.
- `js/mobile/boot.js` — `Storage.load(['profile','training-log'])` disparado **em paralelo** com o
  gate de autenticação.

**Resultado** (mesmo instrumento, medindo a partir do DOMContentLoaded para descontar a variação da
rede local): tempo até o primeiro render **576 ms → 269 ms** (−53%); LCP relativo −299 ms; chamadas
na fase de boot **9 → 3**.

**Guarda contra regressão:** `scratchpad/guard-colecoes.js` faz grep dos `Storage.getX()` em tudo
que `mobile.html` carrega e confere contra a lista `COLECOES` de `js/mobile/boot.js`. Uma tela nova
que use um getter não coberto receberia cache vazio **sem erro no console** — o teste transforma
isso em falha explícita.

---

## Auditoria de performance 2026-08-30 (v2.7.1)

Primeira varredura com o `revisor-performance` adaptado ao stack. Todos os itens foram
**reconfirmados no código e no banco** (via `EXPLAIN QUERY PLAN` em `sqlite3 -readonly`).
Resumida no `ROADMAP.md`, FASE 24 — **nada aplicado**, é levantamento.

**Contexto de escala — importante para priorizar:** o banco tem hoje **132 atividades Garmin, 107
Strava, 1,5 MB**. O custo absoluto atual é baixo; nada aqui está causando dor perceptível. O valor
destes itens é serem baratos agora e evitarem a dor quando o histórico crescer. A exceção é o
cache do Garmin (23 MB), que já está desproporcional. Nenhum número abaixo é benchmark — são
estimativas a partir do plano de execução e da contagem de operações.

### Esforço baixo — ganho grande, risco quase zero

- **`server/utils/training-log-helper.js:42,84,92`** — `autoFillBike` chama `db.prepare()` três
  vezes (SELECT, UPDATE, INSERT) e é invocada **uma vez por atividade** nos quatro call sites de
  sync (`scheduler.js:61`, `routes/garmin.js:127`, `routes/strava.js:128`). O `better-sqlite3` não
  cacheia `prepare()` — cada chamada recompila o SQL. O scheduler roda a cada 30 min.
  → Receber os três statements prontos, ou lazy-init por instância de `db`. **Maior ganho barato
  do backend.**

- **`server/routes/garmin.js:96` e `server/routes/strava.js:100`** — `prepare()` dentro do laço de
  sync. É **regressão de paridade**, não escolha: `server/scheduler.js:26` faz exatamente a mesma
  query já hoisted, com comentário explícito ("Preparado uma vez (fora da transação)"). As rotas
  ficaram para trás. → Hoistar para junto de `upsertStmt` (`garmin.js:43`).

- **`server/routes/activities.js:65,72` e `server/routes/garmin.js:348`** — `SELECT *` traz
  `polyline` (média 3,1 KB, máx 8,2 KB), `payload` (~474 B) e `hr_zones`, que `garminRow()`/
  `stravaRow()` descartam — usam ~15 colunas escalares. São ~0,7 MB lidos do disco e materializados
  em JS por request, para nada; como o driver é síncrono, é tempo de event loop bloqueado.
  → Listar as colunas explicitamente nas três queries.

- **`js/router.js:95,102`** — `Bikes.load()` e `Insights.load()` re-executam a cada navegação de
  hash, sem guarda. `Insights.load()` (`js/insights.js:1194-1200`) dispara **7 requests em
  paralelo**, incluindo os dois mais caros do backend. O padrão correto já existe no projeto:
  `js/ferramentas.js:681` usa `if (!_loaded) { _loaded = true; … }`.
  → Aplicar o mesmo `_loaded`, invalidado após sync/mutação.

- **`server/garmin/garmin_cli.py:54`** — `DiskCache(str(CACHE_DIR))` sem `size_limit` nem política
  de cull. O cache está em **23 MB, ~15× o tamanho do banco de produção (1,5 MB)**, e é o que domina
  o `_dirSize` do `/api/health`. Contraste: os snapshots têm retenção explícita
  (`server/scripts/snapshot.js:24`, `server/routes/backup.js:82`). → Passar `size_limit` (o
  `diskcache` faz cull automático) ou podar por idade num job.

- **`server/index.js:86`** — `execFileSync('df', …)` com timeout de 1 s dentro de um handler
  Fastify `async`: enquanto o `df` roda, o processo inteiro não atende mais nada. Some 7 `COUNT(*)`
  com `prepare()` por chamada (`_safeCount`, `:95-97`). → Trocar por `execFile` assíncrono (a rota
  já é `async`) e cachear o resultado por ~60 s.

### Esforço médio

- **`server/routes/activities.js:112-122` (`weekly-records`)** — `EXPLAIN QUERY PLAN` confirma
  `SCAN garmin_activities`: não há índice em `tipo` e não há filtro de data, então varre **todo o
  histórico, sempre**; o agrupamento por semana é feito com um `Map` em JS (`:132-146`) quando um
  `GROUP BY` resolveria. Chamado em todo `Insights.load()`. → `GROUP BY` em SQL + índice em `tipo`;
  candidato natural a memoização (o valor só muda após sync).

- **`js/notifications.js:110` → `server/routes/activities.js:91`** — o sino pede
  `?days=1825&limit=1` para mostrar "Última atividade", mas a paginação é `all.slice(offset, offset+limit)`
  **depois** do `SELECT *` das duas tabelas inteiras + concat + sort. O caso que mais precisa ser
  barato é o mais caro. → Endpoint `/activities/latest` com `ORDER BY … LIMIT 1` em SQL.

- **`server/routes/bikes.js:142,151`** (e o mesmo padrão em `:184,193` e `:225,232`) —
  `calcBikeStats` prepara os dois SELECTs a cada chamada, e `/api/bikes` (`:336`) chama uma vez por
  bike; `calcBikeKm` é chamado de novo em `/components`, `/limpar`, `/substituir`, `/intervals` e
  `/revisao-completa`. O `Bikes.load()` dispara `/bikes` + N × `/bikes/:id/components`, cada um
  refazendo as agregações. → Hoistar os statements para o escopo do plugin (o SQL é fixo, as listas
  de tipos excluídos são constantes) e calcular `kmBike` uma vez por request.

- **Cache compartilhado de `/activities/unified`** — 8 módulos chamam com janelas diferentes
  (`js/rides.js:706` e `js/notifications.js:110` com 1825d, `js/activities.js:350` 1095d,
  `js/profile.js:168` e `js/testes.js:128` 365d, `js/insights.js:1194` 180d, `js/home.js:112` 30d),
  cada um refazendo o `SELECT *` + sort. Uma sessão Home → Perfil → Passeios → Insights paga isso
  4–5× com dados idênticos. Nota: `js/profile.js:168` puxa 365 dias inteiros só para extrair **um**
  `MAX(fc_max)`. → Cache por janela em `Storage` (a maior janela serve as menores por filtro em
  memória) + endpoint `/activities/max-hr`.

### Esforço alto / delegado

- **Índices — delegar a `db-architect`.** Cruzamento uso × índice confirmado em `sqlite_master`:

  | Coluna | Usada em | Situação |
  |---|---|---|
  | `garmin_activities(tipo)` | `activities.js:114`, `bikes.js:149,191,230` | sem índice → SCAN |
  | `strava_activities(tipo)` | `activities.js:121`, `bikes.js:160,202,239` | sem índice → SCAN |
  | `garmin_activities(inicio_local)` | `ORDER BY` em `activities.js:65`, `garmin.js:348` | sem índice → `USE TEMP B-TREE` (confirmado) |
  | `strava_activities(inicio_iso)` | `ORDER BY` em `activities.js:75` | idem |
  | `bike_maintenance_log(component_id)` | `JOIN` em `bikes.js:766` | FK sem índice |
  | `bike_retired_components(component_id)` | `WHERE` em `bikes.js:618` | FK sem índice |

  Índices compostos `(data_inicio, tipo)` possivelmente cobrem dois casos de uma vez — a definição
  do DDL fica para o `db-architect`. (`bike_service_intervals(component_id)` **já tem** índice.)

- **`server/utils/activity-matcher.js:50-83`** — `runMatching` roda após todo sync e reexamina para
  sempre as atividades que nunca vão casar: busca todas as Strava sem link e roda `candStmt` uma vez
  por atividade. Hoje são só 3 não-linkadas (104 links / 107 Strava), mas o conjunto só cresce.
  → Marcar `match_attempted_at` e reexaminar só o que entrou desde o último sync, ou trocar o laço
  por um único `JOIN` com as tolerâncias no `ON`.

- **CSP sem `'unsafe-inline'`** — `index.html:10` tem `script-src 'self' 'unsafe-inline' …`, que é
  exatamente o que transforma BUG-056/057 em execução direta em vez de atributo inerte. Removê-lo
  exige eliminar os `onclick=` inline (`js/workouts.js:134`, `js/home-workout.js:40`, entre outros).
  Defesa em profundidade real, mas é refactor de superfície ampla.

### Verificado e OK (não re-reportar)

- sql.js e `data/cassetes.db` **já** são carregados sob demanda (`js/ferramentas.js:362-365`, atrás
  do `_loaded` em `:681`).
- `runCli` mantém teto de 8 MB e timeout (`server/services/garmin.js:21,54`); as chamadas pesadas ao
  Python já são serializadas por `_runExclusive` (`:31-36`).
- Os laços de escrita do scheduler e dos syncs já estão dentro de `db.transaction()`.
- Gráficos recriados com `destroy()` + `new Chart()` em vez de `.update()` existem
  (`js/insights.js:300,357,399,474,560`, `js/activities.js:276,551,632`, `js/routes.js:238,494`),
  mas o impacto é baixo — só vale mexer nos que re-renderizam com frequência.
- `js/bikes.js:451` — `intervalStmt.all(c.id)` por componente é N+1, mas o statement está
  corretamente hoisted (`:442`) e N é minúsculo (7 componentes). Anotar, não agir.

---

## Onda de qualidade v2.7.1 (2026-08-09)

Lote focado de correção fina, revisado por `code-reviewer` + `personal-trainer` + `nutritionist`
(sem achados críticos/importantes). Antes de implementar, cada item foi **reconfirmado no código**.

**Implementados em v2.7.1** (frontend-only, sem restart):
- **[treino] `js/insights.js`** — TRIMP/TSS: fallback de intensidade sem FC agora varia pela
  **duração** (`intensityFallback`: <45min≈0,75; >3h≈0,65; senão 0,70), em vez do fixo 0,70;
  aprovado pelo `personal-trainer` (curva duração×intensidade).
- **[treino] `js/insights.js`** — limiar de tendência de volume passou de `>10%` para faixas de
  ciclismo (>20% alerta, 5–20% saudável, <−15% queda), + **piso de base** (`penult>3`) p/ não
  disparar alerta na retomada pós-descanso. A "regra dos 10%" é da corrida (impacto), não do ciclismo.
- **[nutrição] `js/ferramentas.js`** — salvaguardas de plausibilidade (peso <40/>150 kg, duração
  >10 h, intenso+calor extremo por horas) exibem aviso "ordem de grandeza, não prescrição".
- **[nutrição] `js/ferramentas.js`** — comentário do cap de hidratação de 1000 ml/h corrigido
  (limite gástrico; hiponatremia = overdrinking cumulativo, não a taxa — Hew-Butler EAH 2015).
- **[nutrição] `js/ferramentas.js`** — linha "Pré-saída" escala com a duração: pedais >3 h orientam
  carga de carbo 3–4 h antes (~1–4 g/kg; ACSM/ISSN 2016; topo da faixa exige teste prévio).

**Reconfirmados como JÁ RESOLVIDOS** (em ondas anteriores; o doc não fora marcado):
- Token de cancelamento em `renderIntensity`/`renderZoneDist` (`charts.js:24` `_intensityToken`;
  `activities.js:507` `_zoneToken`).
- Índice de fadiga rotulado como heurístico + citação da convenção de TSB (popovers
  `index.html:815/836`); data/versão da `ENDURANCE_TABLE` (`insights.js:760`); rótulo "esforço
  vigoroso ≥85% FCM" em vez de "Z4–Z5" (`insights.js:1082`).
- Nutrição: aviso de *gut training* ≥75 g/h (`ferramentas.js:542`), carbo exibido em **g/kg/h**
  (`:511`), nota de suor populacional/Sawka (`:547`), origem da rampa de carbo/Jeukendrup (`:480`).

**Cancelados pelo usuário:** Tanaka (FCM) e zonas Karvonen no Perfil.

**Adiados** (registrados abaixo/nas seções originais): simplificar `autoFillBike` (correto hoje,
refactor de risco por ganho nulo) e endpoint `/bikes/export` (backend, cabe em fase dedicada).

---

## Lote v2.6.0 — itens deixados para depois

- **[médio] Rename interno TREINOBIKE → VELOCELABS.** O v2.6.0 trocou só o nome **visível**
  (títulos, header, login, boas-vindas, PDF, `manifest.json`). Os identificadores **internos**
  seguem como `treino-bike`/`treino_bike`: serviço systemd `treino-bike-api`, `server/package.json`
  (`name`), `server/index.js`, prefixos de backup `treino-bike-data-*.zip` (backend + `js/backup.js`),
  `README.md` e o slash command `/deploy-treino-bike`. Renomear isso exige mexer em systemd/nginx e
  migrar os backups existentes — fazer num **plano focado e revisado** à parte, com janela de deploy.

  Inclui também o **rename do subdomínio** para **`veloce.arkhamcloud.net`** (hoje `bike.arkhamcloud.net`):
    - **Cloudflare** — criar/ajustar o registro DNS + regra do subdomínio novo.
    - **Tunnel no gateway** (`192.168.15.10`) — atualizar a config do cloudflared (ingress do hostname).
    - **Proxy reverso no nginx** — atualizar `server_name`/vhost para o novo hostname.
    - Manter `bike.arkhamcloud.net` como redirect/alias durante a transição (evitar link quebrado + PWA já instalado).
    - **Cloudflare cacheia por 7 dias** (ver memória) — validar cache/purge após o corte.

  Inclui também o **rename do repositório no GitHub** (`guilherme1985/treino_bike` → nome novo):
    - Renomear pelo GitHub (mantém redirect automático do path antigo, mas não é eterno).
    - Atualizar o `origin` local: `git remote set-url origin git@github.com:guilherme1985/<novo>.git`.
    - Conferir referências ao slug antigo (README, docs, CI/webhooks se houver).

- **[baixo/investigação] Garmin PR `type_id` 15 e 16.** Em `garmin_personal_records` há só **1
  amostra de cada**, ambas com valor **229** (2026-08-02), sem atividade vinculada — não
  identificável com um único ponto. Rechecado em **2026-08-05**: segue 1 amostra de cada, sem
  novidade. 12/13/14 já mapeados como passos dia/semana/mês. Revisitar
  quando (a) mais amostras acumularem em syncs futuros, ou (b) confirmarmos o enum oficial
  `personalRecordTypeId` (lib `garminconnect`/docs Garmin). Seguem **ocultos** em
  `ALLOWED_PR_TYPES` (`js/insights.js`) até lá.

---

## Sino de notificações (v2.4.0) — follow-ups do code-review

Nitpicks não-bloqueantes do sino in-app (IDEIA-6 Nível A):

- **✔ [baixo] `js/notifications.js`** — *(v2.4.1)* `Notifications.load()` agora é re-chamado após o
  sync Garmin/Strava (`js/garmin.js`, `js/strava.js`) e ao salvar passeio (`js/rides.js`), então o
  badge reflete sem recarregar.
- **✔ [baixo] `js/notifications.js`** — *(v2.4.1)* abrir o sino antes do `load()` terminar mostra
  "Carregando…" e re-renderiza ao concluir; não marca como visto com cache vazio nem se o painel
  for fechado antes de carregar.

---

## Auditoria 2026-07-11 (v2.2.0) — novos itens

> **Status (FASE 22.1):** implementados em **v2.2.3** — remoção de `bucketByMonth`, streak
> único (`Utils.calcTrainingStreak`), tokens de cancelamento em charts, simplificação do
> `autoFillBike`, lock de sync (mutex em `garmin.runCli`), `refineFcMaxFromGarmin` com `Math.max`,
> rótulo "esforço vigoroso" no card de intensidade, disclaimer do índice de fadiga + citação TSB,
> data/versão da `ENDURANCE_TABLE`, faixas min–max nas zonas de TESTES, aviso de *gut training* e
> nota de suor populacional.
>
> **Implementados em v2.2.4** (infra sensível): renomear `recovery_time_h` →
> `recovery_time_min` (migração idempotente guardada por `PRAGMA table_info` na tabela
> `garmin_training_readiness`; migração testada em sqlite isolado — preserva dados e é
> idempotente) e paginação opt-in (`limit`/`offset`) no `GET /activities/unified` (sem
> `limit`, comportamento idêntico ao atual). O streak também foi unificado em `js/backup.js`
> (3ª cópia) via `Utils.calcTrainingStreak`.

### Consistência / manutenibilidade

- **[baixo] `js/activities.js:105-126`** — `bucketByMonth` é código morto (nenhum caller);
  superada por `bucketByCalendarMonth`/`bucketMonthsOfYear`. Remover.
- **[médio] `js/home.js:116-152` + `js/heatmap.js:58-89`** — duas implementações de streak
  semanal com regras diferentes (dias distintos × nº de entradas) que só coincidem porque
  `training_log.data` é UNIQUE. Extrair para helper único (ex.: `Utils.calcTrainingStreak(log)`).
- **[baixo] `js/charts.js:159-198` / `js/activities.js:636-675`** — `renderIntensity` e
  `renderZoneDist` sem token de cancelamento de fetch (padrão `_last5Token` já existe em
  `activities.js`); resposta antiga pode sobrescrever a nova. Hoje inócuo (query fixa), mas
  padronizar evita regressão.
- **[baixo] `server/utils/training-log-helper.js:83-88`** — retorno de `autoFillBike` com três
  ramificações aninhadas para dois resultados; correto hoje, frágil a regressão (afetaria os
  contadores `daysMarked`). Simplificar o fluxo de controle.
- **[baixo] `server/db` + `server/scheduler.js`/`routes/garmin.js`** — renomear coluna
  `recovery_time_h` → `recovery_time_min` (migração idempotente) — unidade real é minutos
  (confirmado na lib `garminconnect`); o nome atual engana.

### Robustez / performance (backend)

- **[baixo] `server/scheduler.js` + rotas de sync** — lock simples (flag em memória) para evitar
  sync automático e manual simultâneos (dois subprocess `garmin_cli.py` competindo e gastando
  rate-limit; upserts são idempotentes, então hoje é só desperdício).
- **[médio] `server/routes/activities.js:60-90`** — `GET /unified` aceita `days=1825` sem
  paginação/limite; degradação futura conforme o histórico cresce.

### Correção fina de domínio — treino (personal-trainer)

- **[baixo] `js/profile.js:165-177`** — `refineFcMaxFromGarmin` substitui a FCM estimada mesmo
  quando o pico observado é MENOR que `220 − idade` (pico de quem nunca fez esforço máximo
  subestima a FCM real). Considerar `Math.max(fórmula, picoObservado)` ou explicitar no subtítulo
  que o valor pode subir com um teste máximo.
- **[médio] `js/insights.js:136-144`** — índice de fadiga: normalizações heurísticas sem fonte
  (`stress×1.5` satura em 67; queda de 25% no HRV satura o score; `bbDrain/bbMax` se realimenta
  em dias ruins). Documentar as curvas na UI como índice heurístico do projeto (não métrica
  validada) e considerar limiar de HRV baseado em CV (Plews/Buchheit).
- **[baixo] `js/insights.js:194-197`** — citar a convenção dos limiares de TSB
  (TrainingPeaks/Coggan; os usados são um pouco mais conservadores) no popover.
- **[baixo] `js/insights.js:714-750`** — registrar data/versão da fonte da `ENDURANCE_TABLE`
  (a Garmin já revisou esses limiares); lembrete de revisão periódica.
- **[baixo] `js/insights.js:1005-1006`** — rótulo "Z4–Z5" usa critério `fc ≥ 85% FCM`, que já é
  meio de Z4; ajustar rótulo ("esforço vigoroso") ou critério (≥90%).
- **[médio] `js/testes.js`** — se a seção for mantida: mostrar min–max de cada zona (não só o
  topo) e destacar mais o "estimada" do fallback de FC repouso 60 bpm.

### Correção fina de domínio — nutrição (nutritionist)

- **[médio] `js/ferramentas.js:518-519`** — adicionar aviso de *gut training* quando
  `carb_gh ≥ 75`: taxas de 75-120 g/h exigem adaptação intestinal prévia em treino
  (Jeukendrup 2017; Thomas et al. 2016) — não estrear no dia da prova.
- **[baixo] `js/ferramentas.js:474`** — comentar a origem da rampa de carbo 25/45/67/75/90 g/h
  (guideline por duração de Jeukendrup 2014), como já se faz com kcal (ACSM/Ainsworth).
- **[baixo] `js/ferramentas.js:471,481`** — nota visível ao usuário (não só comentário) de que
  as taxas de suor de referência são médias populacionais (reais variam 0,5–2,5+ L/h; Sawka) —
  orientação, não prescrição.

---

## Auditoria 2026-07-06 (v2.1.5)

## Segurança preventiva

> **Status (FASE 23.1):** implementada em **v2.3.0** — rate-limit no login, CORS restrito,
> validação do `PUT /api/profile` e SRI no sql.js. Code-review sem achados críticos.

- **✔ [baixo] `js/modals.js`** — *(já resolvido em v2.1.6, ver BUGS.md)* `openModal`/`toast` como
  barreira final de escape (`tag`/`title`/`label`/`message`).
- **✔ [baixo] `server/index.js`** — *(v2.3.0)* **rate-limit** via `@fastify/rate-limit` (opt-in,
  5 req/min por IP) só em `POST /api/auth/login` (`routes/auth.js`); validado por `fastify.inject`
  (429 após 5).
- **✔ [baixo] `server/index.js`** — *(v2.3.0)* **CORS** via `@fastify/cors` com origem restrita a
  `config.ALLOWED_ORIGINS` (`.env` opcional; default cobre produção + dev), `credentials:true`.
- **✔ [baixo] `js/ferramentas.js`** — *(v2.3.0)* SRI `sha384` no `sql-wasm.min.js` (cdnjs) +
  `crossOrigin=anonymous`; versão/URL centralizadas em `SQLJS_BASE`/`SQLJS_SRI`; fallback embutido
  cobre falha de checksum. *(Nota: o `.wasm` carregado por `initSqlJs` não tem SRI — limitação da
  lib; o JS principal está protegido.)*
- **✔ [baixo] `server/routes/profile.js`** — *(v2.3.0)* `PUT /api/profile` filtra por whitelist
  `ALLOWED_PROFILE_KEYS`, rejeita array, teto de 16 KB e loga chaves descartadas.

## Robustez / resiliência

> **Status (FASE 23.2 + 23.4):** itens de robustez implementados em **v2.3.0**. O `exportJSON`
> → endpoint `/bikes/export` foi deixado para uma fase futura (ver Manutenibilidade).

- **✔ [baixo] `server/services/garmin.js`** — *(v2.3.0)* `runCli` aborta (SIGKILL + `OUTPUT_LIMIT`)
  se stdout+stderr do subprocess passar de 8 MB.
- **✔ [baixo] `server/middleware/auth.js`** — *(v2.3.0)* `lastLogoutAt()` com cache in-memory (TTL
  1s) + `invalidateLogoutCache()` chamado no logout (revogação imediata para o dono).
- **✔ [baixo] `js/pwa.js`** — *(v2.3.0)* `controllerchange` só recarrega se o usuário clicou
  "Atualizar" (`userTriggeredUpdate`); o SW faz skipWaiting, então sem isso a nova versão
  recarregava sozinha. Caso contrário, mostra o banner.
- **✔ [baixo] `js/rides.js`** — *(v2.3.0)* `saveRide` rejeita data inválida (`isNaN(new Date(...))`).
- **✔ [baixo] `js/api.js`** — *(v2.3.0)* erro não-JSON usa o corpo texto (truncado em 300) antes do
  genérico `Erro <status>`.
- **✔ [baixo] `js/login.js`** — *(v2.3.0)* check de auth com `AbortController` + timeout de 3s (não
  trava a tela se o backend demorar).

## Manutenibilidade / duplicação

> **Status (FASE 23.3):** WMO_ICONS, upsert do Garmin, cálculo de TSS/CTL/ATL e contrato de `fmtKm`
> unificados em **v2.3.0**. O endpoint `/bikes/export` fica adiado.

- **✔ [baixo] `js/routes.js` + `js/rides.js`** — *(v2.3.0)* `WMO_ICONS` único em
  `Utils.wmoIcon` (`js/utils.js`); os dois helpers locais delegam a ele.
- **✔ [médio] `server/routes/garmin.js` + `server/scheduler.js`** — *(v2.3.0)* SQL de upsert de
  `garmin_activities` centralizado em `services/garmin.js` (`ACTIVITY_UPSERT_SQL`); os dois callers
  preparam a partir dele.
- **✔ [baixo] `js/activities.js`** — *(v2.3.0)* `fmtKm` passou a receber **km** (mesmo contrato de
  `l5Km`), eliminando o round-trip `distanciaKm * 1000` (único caller). Data ausente agora mostra
  "—" em vez de "0,0 km".
- **✔ [médio] `js/insights.js`** — *(v2.3.0)* `calcTSBMetrics(activities, fcMax)` é a fonte única de
  `{ ctl, atl, tsb, ctlSerie, atlSerie }`; card 7.4 e banner do topo consomem dela. `calcEMA` órfão
  removido. **Números idênticos** (ambos já usavam `emaSeries`).
- **[médio] `js/backup.js:397`** — `exportJSON` faz várias chamadas por bike (componentes +
  manutenções + retirados). Um endpoint `/bikes/export` no backend reduziria round-trips.
  *(Adiado — fora do escopo da FASE 23 para manter as ondas enxutas.)*

## UX

- **✔ [médio] `js/garmin.js`** — *(v2.3.0)* `prompt()` do MFA substituído por `Modals.prompt`
  (novo helper reutilizável em `modals.js`), com validação de 6–8 dígitos espelhando o backend.

## Correção fina de domínio — treino (personal-trainer)

- **[baixo] `js/profile.js:32,151`** — oferecer/adotar a fórmula de **Tanaka** (`208 − 0.7×idade`),
  mais acurada para adultos, e atualizar o label "220 − idade". Mitigado quando há FCM observada
  da Garmin.
- **[médio] `js/profile.js:36-50`** — opção de zonas por **FC de reserva (Karvonen)** além de % FCM
  bruta (requer campo FC de repouso). Mais preciso para intensidade real.
  *→ Parcial em v2.2.0: a seção TESTES compara os métodos (com o viés do BUG-043), mas as zonas
  do Perfil continuam só em %FCM.*
- **[baixo] `js/insights.js:63-66`** — TRIMP usa fallback fixo `intensity=0.70` para atividades sem
  FC; ajustar por `type` da atividade (HIIT ~0.85, longão ~0.65) para não subestimar carga.
- **[baixo] `js/insights.js:266`** — limiar de alerta de progressão de volume em >10%/semana é
  conservador para ciclismo (consenso 15-20% com base construída). Ajustar texto/threshold.

## Correção fina de domínio — nutrição (nutritionist)

- ~~**[baixo] `js/ferramentas.js:451`** — reduzir o `carbCap` de **120 → 90 g/h**~~ — **revisado
  (nutritionist, 2026-07-07): manter.** 120 g/h é o limite superior aceitável para nível avançado
  com *gut training* dedicado (Jeukendrup 2017); só se aplica ao nível `advanced`.
- **[médio] `js/ferramentas.js:417-563`** — normalizar carboidrato por **g/kg/h** (hoje o peso só
  ajusta sudorese), e adicionar salvaguardas para inputs extremos (peso <40 kg, duração >10 h,
  "max" + >35 °C por horas) com aviso de plausibilidade.
- **[baixo] `js/ferramentas.js:446`** — documentar por que a hidratação é capeada em 1000 ml/h
  (segurança contra hiponatremia), já que taxas de suor reais podem passar disso em calor extremo.
- **[baixo] `js/ferramentas.js:513`** — pré-saída fixa (350 ml + 1 gel ~30 min antes) não escala com
  duração; para rides longos, orientar carregamento de carbo nas 3-4 h anteriores.

---

*Fonte: relatórios dos subagents em 2026-07-06. Reconfirmar item antes de implementar; priorizar
os de segurança e os IMPORTANTES listados em [BUGS.md](BUGS.md).*
