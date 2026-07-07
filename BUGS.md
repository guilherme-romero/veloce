# BUGS — treino_bike

Registro de bugs encontrados na revisão. Gerado pela rotina de revisão multi-agente
(subagents `code-reviewer` + `nutritionist` + `personal-trainer`) em **2026-07-06** sobre a
versão **2.1.5**. Itens marcados **✓ verificado** foram confirmados manualmente lendo o código;
os demais vêm do relatório dos agentes e devem ser confirmados antes da correção.

Convenção de severidade: **CRÍTICO** (segurança/quebra funcional), **IMPORTANTE** (bug real com
impacto ao usuário), **MENOR** (edge case / inconsistência de baixo impacto).

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
- Fusos horários (`js/activities.js:54,63`, `server/utils/activity-matcher.js`): o matcher já assume UTC
  corretamente (referência do relatório desatualizada); requer reanálise dedicada antes de mexer no `parseDT`.
- Nutrição (`js/ferramentas.js:375-376` kcal da rota e `:433` duração via distância virtual): alteram
  fórmulas fisiológicas — deixar para uma passada com o subagent `nutritionist`.
- Demais MENORES abaixo permanecem em aberto.

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

- **[MENOR/perf] `server/scheduler.js:55,246`** — `db.prepare('SELECT 1 ...')` dentro do loop da
  transação recompila o statement a cada item. **Fix:** preparar uma vez fora da transação.

- **[MENOR] `server/routes/bikes.js:124-155`** — `EXCLUDED_*_TYPES` são fragmentos SQL interpolados
  (`tipo NOT IN ${const}`). Não é exploitável (constantes de módulo) mas é padrão errado.
  **Fix:** `IN (?,?,...)` com array de parâmetros.

- **[MENOR/nutrição] `js/profile.js:32`** e **`js/insights.js:16 vs 81-92`** — `220−idade` é a fórmula
  menos acurada (Tanaka `208−0.7×idade` é melhor para adultos); e o comentário do cabeçalho ("1h em
  limiar = 100 TSS") contradiz a fórmula usada (`tempo_h × intensity² × 100` dá ~77 a 88% FCM). São
  aproximações aceitáveis para uso pessoal — ajustar comentários/fórmula se quiser precisão.

- **[MENOR] `js/insights.js:175`** — filtro de FCM observada só tem piso (`>=120`), sem teto; um
  artefato de sensor (>230 bpm) entraria. **Fix:** limitar `maxObs <= 230`.

---

## Falsos-positivos investigados (não corrigir)

- **`js/activities.js:242` `fmtKm(act.distanciaKm * 1000)`** — **não é bug.** `fmtKm` local
  (`activities.js:44`) espera metros e divide por 1000; a multiplicação por 1000 apenas desfaz a
  unidade. Resultado correto, apenas confuso — ver melhoria de consistência em MELHORIAS.md.
- **`js/insights.js:189` TSB = CTL − ATL** — sinal correto (convenção Banister/TrainingPeaks).
