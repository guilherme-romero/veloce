# BUGS — treino_bike

Registro de bugs encontrados na revisão. Rotina de revisão multi-agente
(subagents `code-reviewer` + `nutritionist` + `personal-trainer`).
Auditorias: **2026-07-06** sobre a **v2.1.5** e **2026-07-11** sobre a **v2.2.0**.
Itens marcados **✓ verificado** foram confirmados manualmente lendo o código;
os demais vêm do relatório dos agentes e devem ser confirmados antes da correção.

Convenção de severidade: **CRÍTICO** (segurança/quebra funcional), **IMPORTANTE** (bug real com
impacto ao usuário), **MENOR** (edge case / inconsistência de baixo impacto).

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

- **⚠ Lição (BUG-055):** ao revisar handlers, cruzar a definição da função com o `render()` que
  registra o listener — o shadowing de `sync` só é visível olhando os dois juntos. Padrão a
  varrer em toda conexão nova: `const <nome> = ...` com o mesmo nome de uma função de módulo.

- **`js/activities.js:242` `fmtKm(act.distanciaKm * 1000)`** — **não é bug.** `fmtKm` local
  (`activities.js:44`) espera metros e divide por 1000; a multiplicação por 1000 apenas desfaz a
  unidade. Resultado correto, apenas confuso — ver melhoria de consistência em MELHORIAS.md.
- **`js/insights.js:189` TSB = CTL − ATL** — sinal correto (convenção Banister/TrainingPeaks).
