# Limiares calibrados por percentil do histórico, incluindo o TSB

Três números que a Sugestão de Treino/Cruzamento sugestão×execução usam como corte — "pouco tempo
em zona alta", "TSS que conta como treino pesado" e o TSB que classifica "Sobrecarga" (hoje ≤ −20)
— nasceram como estimativas fixas de primeira passada (10%, uma referência genérica de TSS, e a
convenção externa do Performance Manager/Coggan, respectivamente). Decidimos recalcular os três como
percentis do próprio histórico do atleta (janela de 90 dias, com fallback pro valor fixo original
enquanto há menos de 30 dias de dado).

Motivo: "pouco tempo em Z4+Z5", "TSS alto" e "TSB baixo o suficiente pra contar como sobrecarga"
significam coisas diferentes pra um atleta iniciante e um avançado; um percentil do próprio
histórico se ajusta a isso automaticamente, sem exigir recalibração manual (relevante mesmo num app
de usuário único — o "usuário único" muda de condicionamento ao longo do tempo, e o limiar deveria
acompanhar).

Por que o TSB entra também, apesar de já nascer relativo ao próprio atleta (é CTL menos ATL, ambas
médias móveis exponenciais da carga real do usuário — diferente de "zona alta" e "TSS", que eram
números absolutos): a convenção de −20 = "Sobrecarga" vem de uma referência externa (Performance
Manager/Coggan), pensada pra atletas de endurance em geral, não calibrada contra o padrão de treino
específico deste atleta. "TSB relativo à própria carga" e "corte de Sobrecarga calibrado ao próprio
histórico de TSB" são duas coisas diferentes — a primeira já existia, a segunda é nova aqui.

Efeito colateral aceito, e o mais caro dos três: calcular o percentil de TSB exige uma série de TSB
diário dos últimos 90 dias, e `Metrics.calcTSBMetrics` (usada por Insights e pela Sugestão de
Treino) tem a data de referência ("hoje") hardcoded — não aceita calcular "TSB como estaria no dia
X". Recalibrar TSB por percentil exige generalizar essa função pra aceitar uma data de referência
opcional (default = hoje, pra não quebrar nenhum call site existente), e então rodá-la 90 vezes
(uma por dia da janela) só para a calibração. Aceito porque o cálculo é local, sem I/O por chamada,
e roda dentro do cache de 7 dias (não a cada abertura da seção).

Alternativa considerada: manter o TSB fixo, por já ser relativo por construção — descartada porque
comprime dois conceitos diferentes ("TSB é relativo à carga do atleta" e "o CORTE de Sobrecarga é
calibrado ao histórico do atleta") na mesma linha de raciocínio, quando são independentes; a decisão
final trata os três limiares de forma consistente.
