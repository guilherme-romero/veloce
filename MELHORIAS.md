# MELHORIAS — treino_bike

Oportunidades de melhoria (qualidade, segurança preventiva, manutenibilidade, correção fina de
domínio) encontradas na rotina de revisão multi-agente (subagents `code-reviewer` +
`nutritionist` + `personal-trainer`) em **2026-07-06** sobre a versão **2.1.5**.

Não são bugs com impacto imediato (esses estão em [BUGS.md](BUGS.md)). Cada item traz o esforço
estimado: **baixo** / **médio** / **alto**.

---

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
