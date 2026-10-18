# veloce

App pessoal de treino de ciclismo — planejamento, histórico e análise de carga/fadiga a partir de
dados sincronizados da Garmin (e historicamente do Strava).

## Language

**Desempenho** (seção):
Nome canônico da seção antes chamada "Próximo Treino" (e, antes disso, "seção IA" no backlog
IDEIA-1+2). Renomeada em 2026-09-30 ao ganhar uma segunda metade: a seção passou a abrigar tanto a
Sugestão de Treino (prescritiva, hoje) quanto a Análise de Performance (retrospectiva, ver abaixo)
— "Próximo Treino" descrevia só a primeira metade. "Desempenho" (em vez do inglês "Performance")
mantém a seção alinhada ao restante do nav, 100% em português — "Insights" é a única exceção
conhecida, uma anomalia antiga, não uma convenção a estender. Fica posicionada logo após Insights.
_Avoid_: seção IA, Próximo Treino (nome anterior), Treinador, Performance (em inglês).

**Sugestão de Treino**:
Recomendação prescritiva e específica sobre o próximo treino, gerada pela seção Desempenho por
um motor de regras locais (100% frontend, `js/core/training-suggestion.js`) a partir do histórico
recente. Pertence a exatamente uma de três Categorias de sugestão, e a seção mostra **uma por
vez** — a de maior prioridade entre as que se justificam no momento (ver Prioridade de categoria).
Consome a Recomendação de fadiga como **sinal de entrada** (fadiga alta força recuperação, mesmo
que o TSB sozinho apontasse zona-alvo); TSB/CTL/ATL como sinal de volume; distribuição de tempo por
zona como sinal de zona-alvo — os limiares de zona-alvo e do Cruzamento sugestão×execução são
Limiares calibrados (ver abaixo); o de volume (TSB) fica fixo, ver ADR-0003. **Ausente** (estado
vazio, não uma sugestão "chutada") quando falta o sinal de maior prioridade disponível ou o
histórico é curto demais para TSB (~7 dias). Puramente efêmera: computada a cada abertura da seção,
nunca persistida — não há registro histórico de qual sugestão apareceu em qual dia. Implementada e
testada em 2026-09-30 (desktop); a extensão mobile reaproveita o mesmo motor sem simplificação.
_Avoid_: Recomendação (termo já ocupado, ver abaixo), dica, insight.

**Limiar calibrado**:
Um corte numérico usado por uma Categoria de sugestão ou pelo Cruzamento sugestão×execução que,
em vez de fixo, é recalculado como um percentil do próprio histórico do atleta (janela de 90 dias,
com fallback para o valor fixo original enquanto há menos de 30 dias de dado). Cacheado por 7 dias
— um percentil sobre 90 dias de histórico muda devagar, não precisa recalcular a cada abertura da
seção. Cobre três números: o corte de "pouco tempo em zona alta" (sinal de zona-alvo), o corte de
TSS que classifica um dia como "treinou pesado" (Cruzamento sugestão×execução) e o corte de TSB que
classifica "Sobrecarga" (sinal de volume) — os três recalibrados por percentil do próprio atleta,
sem exceção (ver ADR-0003, que documenta por que isso vale mesmo o TSB já nascendo relativo ao
próprio histórico de carga).
_Avoid_: limiar fixo (é o oposto: usado só pros valores hardcoded originais, antes da calibração
existir, e como fallback enquanto há pouco histórico).

**Cruzamento sugestão×execução**:
Comparação retrospectiva entre a Sugestão de Treino que teria aparecido num dia passado e o que o
atleta de fato pedalou naquele dia — hoje só cobre a categoria recuperação (dia com TSS acima da
mediana do próprio histórico de 90 dias conta como "treinou pesado mesmo assim"; volume e zona-alvo
não têm veredito ainda). Mostrado como bloco inline na seção Desempenho ("nos últimos 90 dias, você
seguiu a recomendação de recuperação em X de Y ocasiões"). Sem persistência: recalculado
retroativamente reaplicando a função pura da Sugestão de Treino a cada dia passado — não quebra a
premissa de a Sugestão de Treino ser efêmera.

**Análise de Performance**:
Bloco retrospectivo/comparativo na seção Desempenho, abaixo da Sugestão de Treino — avalia se o
atleta melhorou ao comparar uma série de atividades parecidas entre si (ver Grupo de comparação) e
sugere foco de treino, usando a API do Gemini para a parte de interpretação/texto (ver ADR-0002 —
o app pré-calcula os números, o Gemini nunca faz conta). Diferente da Sugestão de Treino:
retrospectiva (não prescreve o treino de hoje), sob demanda (botão, não recalculada a cada
abertura), e não é efêmera — o resultado fica em cache por 24h. **Ausente** quando a Atividade de
referência não tem Grupo de comparação suficiente (menos de 3 atividades parecidas nos últimos 12
meses). Se a chamada ao Gemini falhar, mostra a última análise em cache mesmo vencida (com aviso),
ou uma mensagem de erro simples se não houver nenhuma ainda.
_Avoid_: Sugestão (reservado para Sugestão de Treino — a Análise de Performance não prescreve nada
pra hoje), Insights (termo já usado pela seção existente, que descreve estado atual, não evolução).

**Atividade de referência**:
A atividade mais recente do atleta que seja elegível para a Análise de Performance (bike, ≥10km) —
pula rolos curtos/testes ao escolher o ponto de partida da comparação, mesmo que não seja
literalmente a última atividade registrada. É contra ela que o Grupo de comparação é formado.

**Grupo de comparação**:
Conjunto de atividades dos últimos 12 meses parecidas com a Atividade de referência — dentro de
±15% de distância e ±20% de ganho de elevação. Precisa de ao menos 3 atividades (incluindo a
referência) para a Análise de Performance sair do estado ausente; abaixo disso, a diferença entre
"melhora real" e "ruído de um dia" não é distinguível. A Análise de Performance comenta a
**tendência** ao longo desse grupo (série), não uma comparação par a par entre só duas atividades.

**Recomendação**:
Mensagem contextual já existente hoje, embutida nos cards de Insights (ex.: banner do Índice de
Fadiga em `js/core/fatigue.js`), condicionada a forma/carga, sono ou HRV — descreve o **estado
atual** do atleta ("recuperação ótima", "evite volume alto"), não prescreve um treino específico.
Uma das Recomendações (a de fadiga) alimenta a Sugestão de Treino como sinal de entrada — ver ali.
_Avoid_: Sugestão (reservado para Sugestão de Treino).

**Categoria de sugestão**:
Uma das três classificações fechadas de Sugestão de Treino: **zona-alvo** (qual zona de FC treinar
hoje), **volume** (ajustar a carga da semana) ou **recuperação** (descansar). Taxonomia fechada na
v1 — não adicionar uma quarta categoria sem revisar esta decisão.

**Prioridade de categoria**:
Ordem fixa usada para escolher qual Categoria de sugestão vence quando mais de uma se justifica:
**Recuperação > Volume > Zona-alvo** (ver `docs/adr/0001-prioridade-fixa-entre-categorias-de-sugestao.md`).

**Rotação de modelo de IA**:
Mecanismo que escolhe automaticamente qual modelo de IA chamar para a Análise de Performance, sem
depender de um nome de modelo hardcoded no código — nomes de modelo saem de circulação em poucos
meses (confirmado: `gemini-2.0-flash`, usado na entrega original da Análise de Performance, foi
descontinuado pelo Google 4 meses depois). Descobre os modelos disponíveis em tempo real junto da
API de cada provedor, escolhe o melhor por um padrão de nome preferido (não por número de versão,
frágil de comparar como string), e tenta até 2 modelos por provedor antes de desistir dele. Gemini
é sempre o provedor principal; Groq só é tentado depois de esgotar as tentativas com o Gemini (ver
Provedor de fallback). Ver `docs/adr/0004-descoberta-dinamica-de-modelo-de-ia.md`.
_Avoid_: modelo de IA (sozinho, sem o contexto de que ele roda — é sempre resolvido em runtime, não
fixo no código).

**Provedor de fallback**:
Groq, usado pela Análise de Performance somente quando o provedor principal (Gemini) falha em
todas as tentativas da Rotação de modelo de IA — nunca chamado em paralelo com o Gemini. O
resultado da análise registra qual provedor/modelo de fato gerou o texto, exibido discretamente
na UI, para que fique visível quando a rotação estiver de fato acontecendo.

**Comparativo de Desempenho**:
Bloco da seção Desempenho que compara os **últimos N dias** contra os **N dias imediatamente
anteriores** (janela móvel, tempo corrido) em cinco frentes: volume, tempo de pedal, altimetria,
tempo por Categoria de zona, e peso corporal. **N ∈ {30, 60, 90}** é escolhido por um **seletor**
no topo do bloco (padrão 30; a escolha é lembrada entre visitas via `localStorage`, chave
`comp-janela-dias`, compartilhada entre desktop e mobile). Os períodos são fixos e contíguos — atual
`[hoje-(N-1), hoje]` vs. anterior `[hoje-(2N-1), hoje-N]` — e os lados são rotulados por janela
(`Atual (últimos N dias)` / `Anterior (N dias)`). Diferente da Análise de Performance (que compara
uma Atividade de referência contra um Grupo de comparação de atividades parecidas, ao longo de 12
meses): o Comparativo de Desempenho usa tempo corrido como eixo de comparação, não semelhança entre
atividades — os dois blocos respondem perguntas diferentes e convivem na mesma seção. **Sem gate de
nº mínimo**: o bloco aparece sempre que houver **pelo menos uma atividade** somando os dois períodos
(um período anterior vazio com atividades no atual é uma melhora válida, e mostra delta absoluto sem
percentual); fica **ausente** (bloco oculto, sem erro) só quando **ambos** os períodos estão vazios. O sub-bloco de peso tem seu próprio critério de ausência, independente dos outros
quatro (pode faltar peso mesmo com atividade suficiente). Só Volume/Tempo de pedal/Altimetria
recebem selo de alta/baixa (verde/vermelho) — zona e peso mostram a variação sem indicar se é boa
ou ruim, porque isso depende do objetivo pessoal do atleta, que o app não pergunta. Nasce
desktop-only; mobile é extensão futura, mesmo padrão já usado para o resto da seção.
_Avoid_: Grupo de comparação (termo já reservado para a Análise de Performance, não para este
bloco).

**Categoria de zona**:
Agrupamento das 5 zonas de FC com dado real por atividade (Z1–Z5, armazenadas por pedalada) em 3
categorias de treino, usado pelo Comparativo de Desempenho: **Resistência** (Z1+Z2), **Limiar
lático** (Z3+Z4) e **Esforço máximo** (Z5). Deliberadamente usa o modelo de 5 zonas que tem
histórico por atividade (o mesmo que já define "zona alta" = Z4+Z5 nos Limiares calibrados), não o
modelo de 6 zonas de exibição do perfil do atleta (`js/utils.js` `FC_ZONES`), que não tem dado
histórico por pedalada.

**Treino IA** (seção):
Seção desktop (IDEIA-7), ao lado de Treinos (semana padrão manual) no nav — hospeda o Plano de
Treino Semanal, com layout de grid de 7 colunas + painel de detalhe do dia selecionado (handoff
`treino_bike_docs/handoff_treino_ia/`). Coexiste com a aba Treinos manual nesta v1; não a substitui.
No mobile, não tem tab própria: vive dentro do mesmo seletor segmentado que já abriga Insights
dentro da tab Desempenho ("Desempenho | Insights | Treino IA" — ver `js/mobile/shell.js`
`MShell.segment`), com faixa compacta de dias + card de detalhe com swipe, em vez do grid. Intake de
preferências (objetivos priorizados, dias disponíveis, duração de sessão, dia do longão, nível de
experiência) é capturado no modal de Perfil do desktop — não tem formulário próprio no mobile.

**Plano de Treino Semanal**:
Uma única semana-padrão recorrente (7 dias, sem periodização nem progressão de carga entre
semanas) gerada pela seção Treino IA, sob demanda (botão "Gerar novo plano" — diferente da Análise
de Performance, não há job automático às 6h). Cada dia tem um **perfil de esforço**: lista de
blocos `{min, zona, intensidade, rotulo}` (ex.: aquecimento/bloco principal/desaquecimento), onde
`zona` usa os mesmos ids/cores de `window.FC_ZONES` (`z1`..`z6`, `js/utils.js`) — granularidade fina,
para mostrar a estrutura real de cada treino. O resumo semanal (volume, nº de treinos/descanso, %
por zona) é **sempre calculado no frontend** a partir desses blocos — nunca pedido à IA — e usa a
granularidade mais grossa já estabelecida pelo Comparativo de Desempenho (Categoria de zona:
Resistência/Limiar lático/Esforço máximo), não as 6 zonas finas. Usa a API do Gemini/Groq só para a
parte de interpretação/prescrição (mesma regra de ADR-0002/0004: o app pré-calcula CTL/ATL/TSB,
tendência de peso e Limiares calibrados no frontend, e também a **data** de cada dia — a IA nunca
calcula nem número nem aritmética de calendário). Persistido em `weekly_training_plans` —
**não-singleton** (diferente do cache da Análise de Performance): cada geração nova desativa a
anterior (`ativo`) mas preserva histórico, e **sem expiração por tempo** — o plano vale até o
usuário gerar outro manualmente. Se a geração falhar, mostra o último plano ativo (sem apagar),
igual ao comportamento já estabelecido pela Análise de Performance.
_Avoid_: confundir com Sugestão de Treino — são opostos em quase todo eixo: Sugestão de Treino é
diária, reativa, 100% local/determinística (sem IA) e nunca persistida; o Plano de Treino Semanal é
semanal, sob demanda, usa IA para a prescrição e é persistido com histórico.

**Relatório de fechamento mensal**:
Imagem-resumo (PNG) do **mês anterior fechado** (`[1º..último dia]` em horário local — não "últimos
30 dias"; rótulo "Fechamento de {mês}") enviada pelo canal Telegram automaticamente pelo
`scheduler.js` (dia 1º, 8h, dedup por `YYYY-MM`), opt-in via toggle `relatorioMensalTelegram` do
Perfil E Telegram configurado. Gerada server-side pelo subsistema de relatório
(`server/routes/report.js`, função client-side `reportResumoClient` do `#resumo`, renderizada via
Playwright — mesma infra do relatório PDF). Entregue em fases (épico #106, sub-issues #107–#112,
completo na v2.11.9) e composta por: **acumulados** do mês (#108 — distância, tempo, elevação, nº de
passeios); **dados do ciclista** (#109 — Carga CTL máx e Fadiga ATL máx do mês como pico da série EMA
de `calcTSBMetrics`, VO2máx mais recente, HRV noturno médio); **rosca de zona de FC** (#110 — donut
`conic-gradient` com a distribuição de tempo por zona Z1–Z5); **aderência ao plano** (#111 —
`WeightStats.adherence`, planejado vs. realizado, barra + %); e **Análise do mês** (#112 — texto de IA
`{observacao, foco}`, gerado por `server/services/monthly-analysis.js` na cascata Gemini→Groq, nunca
inventa números (ADR-0002); cache em `monthly_report_analysis_cache` por mês (`mes` = 'YYYY-MM');
falha de IA → relatório sai sem a seção). Diferente do relatório PDF completo (download in-app, 2
páginas): o fechamento mensal é um PNG resumido, retrospectivo de um mês só, disparado por agenda.
_Avoid_: relatório mensal (ambíguo — este é especificamente o fechamento do mês anterior), relatório
PDF (é o outro artefato do subsistema de relatório).

**Push da véspera**:
Notificação **push ativa** (web-push/VAPID) enviada ao celular por volta das **18h na véspera** de
cada passeio planejado, com horário + veredito de clima do dia seguinte — chega **mesmo com o app
fechado**. É o **Nível B** da IDEIA-6 do sino de notificações (entregue na v2.12.0→v2.12.2, Issue #3),
oposto ao sino **in-app** (Níveis A/A+): o sino só avisa quando o usuário **abre** o app; o push da
véspera é proativo. Opt-in explícito pelo toggle **"Avisar na véspera dos passeios"** (modal de Perfil
no desktop, tela Configurações no mobile), que faz `pushManager.subscribe` sob user-gesture. Disparado
pelo `scheduler.js` (job das 18h, `server/services/push-digest.js`), no máximo 1 push/dia por passeio
(dedup em `push_sent`). Foco **Android** no v1; no iOS exige o PWA instalado na tela inicial (detectado
e orientado, não suportado no v1). Reusa `WeatherRating.rating` rodando em Node (mesma fonte de verdade
do clima do app) e a lógica pura de `js/core/rides-schedule.js`.
_Avoid_: sino (reservado para o sino in-app, Níveis A/A+ — este é o push proativo), notificação (sozinho,
ambíguo entre as duas coisas).
