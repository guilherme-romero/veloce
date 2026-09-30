# treino_bike

App pessoal de treino de ciclismo — planejamento, histórico e análise de carga/fadiga a partir de
dados sincronizados da Garmin (e historicamente do Strava).

## Language

**Próximo Treino** (seção):
Nome canônico da seção antes chamada "IA" no backlog (IDEIA-1+2). Renomeada porque o motor é regras
locais, não LLM — o projeto evita nomear features pela tecnologia que não usam (mesmo critério já
aplicado ao Índice de Fadiga, rotulado explicitamente como heurístico). Fica posicionada logo após
Insights, sem depender da seção Testes (que é temporária/descartável).
_Avoid_: seção IA, Treinador.

**Sugestão de Treino**:
Recomendação prescritiva e específica sobre o próximo treino, gerada pela seção Próximo Treino por
um motor de regras locais (100% frontend, `js/core/training-suggestion.js`) a partir do histórico
recente. Pertence a exatamente uma de três Categorias de sugestão, e a seção mostra **uma por
vez** — a de maior prioridade entre as que se justificam no momento (ver Prioridade de categoria).
Consome a Recomendação de fadiga como **sinal de entrada** (fadiga alta força recuperação, mesmo
que o TSB sozinho apontasse zona-alvo); TSB/CTL/ATL como sinal de volume; distribuição de tempo por
zona como sinal de zona-alvo — limiares numéricos exatos ficam para a implementação. **Ausente**
(estado vazio, não uma sugestão "chutada") quando falta o sinal de maior prioridade disponível ou
o histórico é curto demais para TSB (~7 dias). Puramente efêmera: computada a cada abertura da
seção, nunca persistida — não há registro histórico de qual sugestão apareceu em qual dia (v1).
Desktop-only na v1; mobile é extensão de fase 2.
_Avoid_: Recomendação (termo já ocupado, ver abaixo), dica, insight.

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
