# Descoberta dinâmica de modelo de IA, sem hardcode de nome

A Análise de Performance (ADR-0002) chama a API do Gemini com um nome de modelo fixo no código
(`gemini-2.0-flash`). Em 1º/jun/2026 — 4 meses depois dessa decisão — o Google descontinuou esse
modelo. A Análise de Performance ficou quebrada em produção sem que ninguém tivesse tocado no
código, até ser notada só quando o fallback pra Groq foi planejado.

Decidimos não substituir o nome hardcoded por outro nome hardcoded (resolveria o sintoma, não a
causa — o próximo modelo também vai sair de linha eventualmente). Em vez disso, o backend descobre
em runtime quais modelos cada provedor (Gemini, Groq) tem disponíveis agora, via o endpoint de
listagem de cada um (`GET .../v1beta/models` no Gemini, `GET .../v1/models` na Groq), e escolhe o
melhor dentro dessa lista por um **padrão de nome preferido** (contém `"flash"`, não contém
`"preview"/"exp"/"deprecated"`) — nunca por parsing de número de versão, que não ordena de forma
confiável como string (`gemini-3.8-flash` vs. `gemini-3.10-flash`).

A lista descoberta é cacheada por 7 dias (não muda de hora em hora) e o último modelo que funcionou
é tentado primeiro na próxima chamada, antes de rotacionar de novo — evita bater repetidamente num
modelo que já se sabe morto. Gemini continua sendo sempre o provedor principal; Groq (API
compatível com formato OpenAI) só é tentado depois de esgotar as tentativas com o Gemini.

Efeito colateral aceito: cada análise bem-sucedida pode, em teoria, usar um modelo ligeiramente
diferente do que usou da última vez (se o modelo preferido anterior tiver saído da lista) — não há
garantia de "mesmo modelo sempre". Aceitável porque o propósito da Análise de Performance é
interpretação textual de números já calculados localmente (ADR-0002), não uma métrica sensível à
escolha exata do modelo.

Alternativa rejeitada: manter uma lista hardcoded de 2-3 nomes de modelo por provedor, atualizada
manualmente quando alguém notar que quebrou — é o que já falhou uma vez (4 meses de silêncio até a
análise voltar a funcionar) e exige um humano lembrar de atualizar o código toda vez que uma
empresa descontinua um modelo, sem nenhum aviso automático de que isso aconteceu.
