# Limiares calibrados por percentil do histórico, exceto TSB (fixo)

Dois números que a Sugestão de Treino/Cruzamento sugestão×execução usam como corte — "pouco tempo
em zona alta" e "TSS que conta como treino pesado" — nasceram como estimativas fixas de primeira
passada (10% e uma referência genérica, respectivamente). Decidimos recalculá-los como percentis do
próprio histórico do atleta (janela de 90 dias, com fallback pro valor fixo original enquanto há
menos de 30 dias de dado). O terceiro limiar do mesmo motor, o corte de TSB que classifica
"Sobrecarga" (hoje ≤ −20), **fica fixo** — não entra na calibração por percentil.

Motivo da calibração nos dois primeiros: "pouco tempo em Z4+Z5" e "TSS alto" significam coisas
muito diferentes pra um atleta iniciante e um avançado; um percentil do próprio histórico se ajusta
a isso automaticamente, sem exigir recalibração manual por usuário (relevante mesmo sendo um app de
usuário único — o "usuário único" muda de condicionamento ao longo do tempo).

Motivo do TSB ficar fora: o TSB já nasce relativo ao próprio atleta, por construção — é
CTL (carga crônica) menos ATL (carga aguda), ambas médias móveis exponenciais da carga real do
próprio usuário. A convenção de −20 = "Sobrecarga" vem de uma referência externa estabelecida
(Performance Manager, Coggan/TrainingPeaks), não de um número arbitrário do projeto. Recalibrar por
cima disso seria compor duas normalizações diferentes sem necessidade, e romperia a rastreabilidade
com uma convenção conhecida fora do projeto.

Efeito colateral aceito: os dois limiares calibrados dependem de uma janela de 90 dias de
histórico (mais dado do que a seção busca hoje) e de um cache de 7 dias — a primeira exceção ao
padrão "sem cache" que a Sugestão de Treino usa em tudo o mais. Aceito porque um percentil sobre 90
dias muda devagar; recalcular a cada abertura da seção seria trabalho sem ganho perceptível.
