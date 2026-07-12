# MELHORIAS — treino_bike

Oportunidades de melhoria (qualidade, segurança preventiva, manutenibilidade, correção fina de
domínio) encontradas na rotina de revisão multi-agente (subagents `code-reviewer` +
`nutritionist` + `personal-trainer`). Auditorias: **2026-07-06** (v2.1.5) e **2026-07-11** (v2.2.0).

Não são bugs com impacto imediato (esses estão em [BUGS.md](BUGS.md)). Cada item traz o esforço
estimado: **baixo** / **médio** / **alto**.

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

- **[baixo] `js/modals.js`** — Fazer de `openModal`/`toast` a barreira final de escape (escapar
  `tag`/`title`/`label`/`message` por padrão), em vez de confiar nos callers. *(Ver BUGS.md — hoje
  é um bug real de XSS no `toast`.)*
- **[baixo] `server/index.js`** — Adicionar **rate-limit** (`@fastify/rate-limit`, ex.: 5 req/min por
  IP) no `/api/auth/login`. O bcrypt encarece, mas não substitui rate-limit contra força bruta.
- **[baixo] `server/index.js`** — Configurar **CORS** explicitamente (`@fastify/cors` com origem
  restrita) como hardening, mesmo servindo na mesma origem via nginx.
- **[baixo] `js/ferramentas.js:343`** — sql.js (`sql-wasm`) é carregado de CDN externo sem
  `integrity` (SRI). Adicionar SRI ou hospedar localmente.
- **[baixo] `server/routes/profile.js:69`** — `PUT /api/profile` persiste qualquer objeto JSON sem
  validação de campos (inofensivo em single-user, mas sem guarda). Validar campos conhecidos.

## Robustez / resiliência

- **[baixo] `server/services/garmin.js:23`** — `runCli` acumula stdout/stderr sem limite; resposta
  Garmin muito grande cresce em memória. Adicionar teto de bytes e rejeitar.
- **[baixo] `server/middleware/auth.js:10`** — `lastLogoutAt()` consulta o banco a cada request
  autenticado; cachear por ~1s (invalidando no logout) elimina a query.
- **[baixo] `js/pwa.js:44`** — `controllerchange` chama `location.reload()` automaticamente ao SW
  assumir controle, podendo interromper o usuário. Condicionar ao banner "Atualizar" já existente.
- **[baixo] `js/rides.js:499`** — `saveRide` não valida data real (`"9999-99-99"` passa). Adicionar
  `isNaN(new Date(data))`.
- **[baixo] `js/api.js:56`** — quando a resposta de erro não é JSON, a mensagem vira genérica
  `Erro <status>`; incluir o corpo texto quando disponível.
- **[baixo] `js/login.js:19`** — check de auth no load é fire-and-forget com `.catch(()=>{})`;
  adicionar timeout curto para não redirecionar por lentidão do backend.

## Manutenibilidade / duplicação

- **[baixo] `js/routes.js:345` + `js/rides.js:588`** — dois mapeamentos `WMO_ICONS` idênticos.
  Extrair para helper compartilhado em `utils.js`.
- **[médio] `server/routes/garmin.js:43` + `server/scheduler.js:24`** — `upsertStmt` de
  `garmin_activities` duplicado (~20 linhas). Centralizar em `services/garmin.js`.
- **[baixo] `js/activities.js:242`** — unificar o contrato de `fmtKm` (metros) vs `l5Km` (km);
  documentar a unidade esperada e remover a dupla conversão `distanciaKm * 1000`.
- **[médio] `js/insights.js`** — `renderTSS` e `renderInsightsTop` recalculam TSS/CTL/ATL por
  caminhos separados; centralizar num único cálculo `{ ctl, atl, tsb, ctlSerie, atlSerie }` para
  evitar divergência futura entre card e gráfico.
- **[médio] `js/backup.js:397`** — `exportJSON` faz várias chamadas por bike (componentes +
  manutenções + retirados). Um endpoint `/bikes/export` no backend reduziria round-trips.

## UX

- **[médio] `js/garmin.js:174`** — substituir `prompt()` do código MFA por um modal do próprio
  sistema `Modals`, com validação de 6 dígitos.

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
