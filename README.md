# 🚴 Treino Bike

App pessoal para acompanhar treinos de ciclismo, evolução de peso e dados de saúde — integrado com **Strava** e **Garmin Connect**.

> Versão atual: **1.22.0** · Em produção em [bike.arkhamcloud.net](https://bike.arkhamcloud.net)

---

## ✨ O que o app faz

### 🏠 Início
Resumo com sua meta de peso, km da semana, sequência de dias ativos e índice de fadiga. Atalhos rápidos para registrar pesagem, marcar treino ou **sincronizar** (Strava + Garmin de uma vez, cada um se estiver conectado).

### 👤 Perfil
Agrupa dados do atleta e fisiologia em uma única aba:
- **Atleta** — idade, IMC, FC máxima, peso, bike ativa, projeção de peso em 12 semanas e análise de tendência (taxa de perda semanal e previsão da meta)
- **Peso 100% automático** — o peso atual e a projeção vêm direto da balança Garmin (regressão do histórico sincronizado); não há mais entrada manual de pesagem. Só a **meta** de peso é editável.
- **Fisiologia** — seis zonas de FC (Z1–Z6) calculadas a partir da idade, com cores consistentes em todo o app (gráficos, calendário, badges)
- Foto de perfil personalizada

### 🚲 Bike (garagem virtual)
Cadastro de bicicletas com rastreamento automático de desgaste de componentes:
- Modelo "bike ativa": uma bike acumula km de atividades Garmin/Strava a partir de uma data
- **Badge de status** — círculo verde (ATIVA) ou vermelho (INATIVA) com data de início em destaque
- **Estatísticas agregadas** — km total, tempo em movimento e elevação por bike, com modal de detalhes (médias e máximas de velocidade, FC e potência)
- Componentes (pneu, corrente, pastilhas, discos, cassete, cabo de freio) com vida útil em km, **marca, modelo e observação editável**
- **Pressão de pneu (PSI)** configurável (aparece só para pneus)
- Alertas de substituição quando o desgaste atinge 80% e 100%, com **filtro "Atenção"** para ver só o que precisa de cuidado
- Ciclo de limpeza para corrente e **intervalos de serviço recorrentes** (por km ou por dias) com registro rápido
- **Substituição com avaliação** — ao trocar uma peça, ela vai para o histórico com km rodado real, dias de uso, nota por estrelas (1–5) e review
- **Durabilidade de componentes** — média de km e nota por marca/modelo (ex.: "Pneu Continental GP5000 · 4.200 km média · ★4,3 · 3 trocas") para apoiar a recompra
- **Página de detalhe do componente** + gerações anteriores + histórico completo de manutenções e revisões

### 🚴 Treinos
Agrupa fortalecimento em casa e agenda semanal de bike na mesma aba:
- **Em casa** — CRUD de exercícios de fortalecimento (core, pernas, mobilidade)
- **Semana padrão** — agenda semanal personalizável com modos de treino dinâmicos

### 🗓️ Passeios & Rotas
- Calendário mensal de passeios planejados, com **símbolo de clima em cada dia** dentro da janela de previsão
- Análise de rotas a partir de arquivos GPX (mapa, perfil de elevação, calculadora de tempo, previsão de clima)
- **Modal de clima detalhado para rotas** — temperatura máx/mín, sensação térmica, chuva, vento, rajadas, UV e nascer/pôr do sol

### 📊 Histórico
- Heat-map dos últimos 90 dias (estilo GitHub contributions), com sequência atual e **recorde histórico**
- Volume de treino: km/semana, tempo total, distribuição por zona FC
- **Gráfico de volume mensal combinado** — barras de km + barras de número de atividades + linha de elevação acumulada
- Última atividade com mini-mapa, distância, movimento, elevação, vel. média, **FC média, cadência e calorias**
- **Últimas 5 atividades** em cards detalhados com mini-mapa, distância, tempo, elevação, FC, calorias e potência/cadência — e **gráfico de distribuição por zona de FC** (Z1–Z5) em cada atividade Garmin
- Revisão de auto-registros dos últimos 7 dias

### 🧠 Insights (a partir dos dados Garmin)
Análises derivadas dos dados de saúde e performance do seu relógio:
1. **Índice de Fadiga** — combina Body Battery, HRV e Stress
2. **Sono × Desempenho** — sono profundo da noite anterior × FC do treino
3. **Intensidade/kg semanal** — TRIMP normalizado pelo peso (com fallback para atividades sem FC)
4. **Carga de Treino (TSB)** — fitness vs. fadiga (ATL/CTL/TSB)
5. **Custo metabólico** — kcal/km com baseline
6. **HRV × Carga** — quanto seu corpo recupera entre treinos
7. **Training Readiness (Garmin)** — score matinal oficial da Garmin (sono + recuperação + HRV)
8. **Recordes pessoais** — seus PBs com badge "Novo!" para conquistas recentes, formatação por tipo de esporte (distância ciclismo em km, elevação em m, potência em W)
9. **Hill + Endurance Score** — capacidade em subidas e resistência aeróbica

### 🔌 Conexões
- **Strava** — importa atividades de bike, marca os dias treinados
- **Garmin Connect** — atividades, pesagens da balança, dados de saúde diários e estados de treino (Productive, Recovery, Maintaining)
- **Botão (i) em cada card** explicando como funciona a conexão de cada serviço (OAuth oficial do Strava × login não-oficial da Garmin com MFA)
- **Auto-sync** — sincronização automática a cada 30 minutos (Strava + Garmin, sem intervenção manual)
- De-duplicação automática quando a mesma ride aparece nos dois
- Edição manual sempre prevalece sobre o sync (regra "manual wins")

### 💾 Backup e Relatórios
- **Backup automático semanal** — snapshot do banco em `data/backups/` (retenção: últimos 8)
- Lista de snapshots disponíveis para download direto no app
- Exportar/importar JSON completo (inclui resumo de atividades Strava/Garmin e a garagem de bikes)
- Exportar pesagens em CSV
- **Relatório completo em PDF** com filtro de período (30 dias / 90 dias / tudo)
  - Capa, perfil, evolução de peso (gráfico), pesagens, atividades, insights, recordes
  - **Heat-map de atividade dos últimos 90 dias** desenhado no PDF, volume mensal e HRV × Carga
  - Seção de Bike: km total por bike, vida útil de componentes, histórico de manutenções
- **Download da base completa em ZIP** — `training.db` + avatares (tokens não incluídos)
- **Restauração da base a partir de um ZIP** — com confirmação dupla (digitar "RESTAURAR"), backup de segurança automático antes da troca e reinício do serviço ao final
- Imprimir / salvar como PDF

### 🌤️ Previsão do tempo (Passeios + Rotas)
- Faixa de previsão com ícone WMO, máx/mín, % chuva, UV e indicador de esforço para ciclismo (com nota de quantos dias de previsão estão disponíveis)
- **Símbolo de clima em cada dia** do calendário de passeios, dentro da janela de previsão
- Modal detalhado por dia: sensação térmica, rajadas, mm de chuva, nascer/pôr do sol
- Alertas específicos: vento perigoso, calor extremo, chuva forte, UV alto
- Proxy server-side (sem problema de CORS no PWA)

---

## 📱 Como acessar

**Web:** [bike.arkhamcloud.net](https://bike.arkhamcloud.net) (login com usuário + senha).

**App (mobile):** instale como PWA — abra o site no navegador → menu → "Adicionar à tela inicial". Funciona offline depois de carregado.

---

## 🛠 Tecnologia (resumo)

- **Frontend:** HTML5, CSS puro e JavaScript vanilla (sem framework)
- **Backend:** Node.js (Fastify) + SQLite + autenticação JWT (cookie httpOnly)
- **Garmin:** wrapper Python chamado pelo Node via subprocess, usando [`cyberjunky/python-garminconnect`](https://github.com/cyberjunky/python-garminconnect) v0.3.5 (instalado em venv isolado em `server/garmin/venv/`)
- **Strava:** OAuth simplificado single-user
- **Gráficos:** Chart.js · **Mapas:** Leaflet · **Clima:** Open-Meteo

Arquitetura mais técnica e decisões de design ficam no arquivo `CLAUDE.md` (interno).

---

## 📦 Privacidade

Todos os seus dados ficam num servidor próprio (LXC em Proxmox). Strava e Garmin são acessados via tokens isolados que vivem apenas no `.env` do servidor — nada vai para terceiros.

---

## 📜 Licença & Uso

Projeto pessoal, não distribuído publicamente. Código-fonte em [github.com/guilherme1985/treino_bike](https://github.com/guilherme1985/treino_bike).

---

## ☕ Apoie o projeto

Se este projeto te ajudou, considere me pagar um café!

[![Buy Me A Coffee](https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=☕&slug=guilhermeromero&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff)](https://buymeacoffee.com/guilhermeromero)
