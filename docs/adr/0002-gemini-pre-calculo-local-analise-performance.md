# Análise de Performance: pré-cálculo local dos números, Gemini só interpreta

A Análise de Performance compara uma série de atividades parecidas (Grupo de comparação) e avalia
se o atleta melhorou. A forma mais simples de montar isso seria mandar os dados brutos das
atividades pro Gemini e deixar o próprio modelo calcular as diferenças (velocidade, tempo, FC) e
comentar. Decidimos o oposto: o app calcula os deltas numéricos localmente (reaproveitando
`js/core/metrics.js`/`activity-stats.js`), e o prompt manda só os números já prontos — o Gemini
nunca faz conta, só interpreta um resultado que já está certo.

Motivo: LLMs são inconsistentes em aritmética exata, e esse app já tem o código que faz essa conta
corretamente e é usado em outros lugares (Insights, TSB/CTL/ATL). Deixar o Gemini calcular
arriscaria mostrar um número errado com aparência de autoritativo — pior que não mostrar nada.
Separar "cálculo" (determinístico, local) de "interpretação" (texto, Gemini) também limita a
superfície de erro do LLM à parte que ele realmente faz bem.

Efeito colateral aceito: o prompt fica um pouco mais verboso (inclui os deltas já calculados, não
só os dados brutos), e qualquer mudança na fórmula de cálculo (ex.: revisar `tssDeAtividade`) exige
lembrar que a Análise de Performance também consome esse resultado.

Alternativa rejeitada: mandar dados brutos e deixar o Gemini calcular — mais simples de implementar
no início, mas troca precisão auditável por conveniência de prompt, inaceitável pra uma seção cujo
propósito é dizer se o atleta melhorou ou não.
