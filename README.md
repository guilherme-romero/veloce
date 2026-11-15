# 🚴 VELOCE LABS

App pessoal para acompanhar treinos de ciclismo, evolução de peso e dados de saúde — integrado com **Strava** e **Garmin Connect**.

> Versão atual: **2.12.22** · PWA self-hosted (frontend estático + backend Node/SQLite), sem build step

### 🎨 Identidade visual "Hi-Vis Peloton"

Tema escuro "ink" (`#0d0f12`), acento **lima** (`#c6f135`) e **magenta** (`#ec3a8b`), tipografia **Bebas Neue** (títulos e números) + **Archivo** (texto), faixas-jersey e números em destaque. Favicons e ícones de PWA próprios. A semana é contada de **domingo a sábado** de forma consistente em todo o app.

**Nenhuma dependência de CDN.** Fontes, ícones, Chart.js e Leaflet são servidos pelo próprio repositório, e a CSP é `script-src 'self'` — o app carrega e funciona offline sem depender de terceiro no ar.

### 📱 Duas interfaces

`js/variant.js` escolhe a variante por **sinais de dispositivo** (nunca por largura de tela) e serve `index.html` no desktop ou `mobile.html` no celular — duas UIs de verdade, não um layout responsivo. O mobile tem navegação própria por abas (Início, Atividades, Bikes, Desempenho, Mais) e reaproveita a lógica compartilhada de `js/core/` e `js/utils.js`.

---

## ✨ O que o app faz

### 🏠 Início
Resumo com sua meta de peso, km da semana, sequência de dias ativos e índice de fadiga. Atalhos rápidos para registrar pesagem, marcar treino ou **sincronizar** (Strava + Garmin de uma vez, cada um se estiver conectado).

### 👤 Perfil
Agrupa dados do atleta e fisiologia em uma única aba:
- **Atleta** — idade, IMC, FC máxima, peso, bike ativa, projeção de peso em 12 semanas e análise de tendência (taxa de perda semanal e previsão da meta)
- **Peso 100% automático** — o peso atual e a projeção vêm direto da balança Garmin (regressão do histórico sincronizado); não há mais entrada manual de pesagem. Só a **meta** de peso é editável.
- **FC máxima do Garmin** — usa o maior pico de FC observado nas suas atividades (com fallback para a fórmula 220−idade), e as zonas são recalculadas sobre esse valor
- **Fisiologia** — seis zonas de FC (Z1–Z6), com cores consistentes em todo o app, e um gráfico de **distribuição de intensidade** com o tempo real em cada zona (Z1–Z5) das atividades Garmin
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

### 🧠 Treino (plano semanal via IA)
Um plano de treino da semana inteira gerado por IA a partir do seu perfil e dos seus dados reais (CTL/ATL/TSB, tendência de peso, dias disponíveis, nível e dia de longão):
- **Sete dias** com tipo (resistência, intervalado, longão, descanso), duração, RPE e blocos por zona de FC
- **Geração automática** — o job roda todo dia às 6h e gera só quando a semana ainda não tem plano; o resto do tempo não faz nada
- **Histórico** paginado com objetivo de cada plano, **favoritos** (protegidos de exclusão) e teto de 30 planos não-favoritados
- No celular, o histórico abre em **bottom sheet** com as mesmas ações do desktop

### 📈 Desempenho
- **Sugestão do dia** — o que treinar hoje, a partir da carga e da forma recentes
- **Análise de Performance** — comentário gerado por IA comparando a última atividade com um grupo de rides semelhantes; roda sozinha às 6h e só gasta IA quando a atividade de referência muda
- **Comparativo de Desempenho** — evolução entre períodos

### 🗓️ Passeios & Rotas
- Calendário mensal de passeios planejados, com **símbolo de clima em cada dia** dentro da janela de previsão
- Análise de rotas a partir de arquivos GPX (mapa, perfil de elevação, calculadora de tempo, previsão de clima)
- **Modal de clima detalhado para rotas** — temperatura máx/mín, sensação térmica, chuva, vento, rajadas, UV e nascer/pôr do sol

### 📊 Histórico
- **Filtros por ano** (ano atual + 2 anteriores · "Tudo") que recalculam os KPIs, o volume mensal e a lista — com badge de período em cada bloco
- **4 KPIs do período**: distância, tempo total, elevação e número de atividades
- Heat-map dos últimos 90 dias (estilo GitHub contributions), com sequência atual e **recorde histórico**
- Volume de treino: km/semana, tempo total, distribuição por zona FC
- **Gráfico de volume mensal combinado** — barras de km + barras de número de atividades + linha de elevação acumulada
- Última atividade com mini-mapa, distância, movimento, elevação, vel. média, **FC média, cadência e calorias**
- **Últimas 5 atividades** em cards detalhados com mini-mapa, distância, tempo, elevação, FC, calorias e potência/cadência — e **gráfico de distribuição por zona de FC** (Z1–Z5) em cada atividade Garmin
- Revisão de auto-registros dos últimos 7 dias

### 🧠 Insights (a partir dos dados Garmin)
Painel de carga e forma no topo, seguido de análises detalhadas:
- **Banner de forma** — estado atual pelo TSB (Forma em pico / Em equilíbrio / Carregado / Sobrecarga), com mensagem e o TSB do dia
- **4 KPIs** — Carga (CTL), Fadiga (ATL), VO₂ máx (Garmin) e HRV noturno
- **Carga × Fadiga × Forma · 8 semanas** — gráfico das três curvas
- **Tempo por zona · 30 dias** — distribuição real de tempo em cada zona de FC do Garmin
- **Recomendações** — sugestões acionáveis condicionadas aos dados (forma/carga, qualidade de sono, intensidade/volume por zona, tendência de HRV)

Abaixo, os blocos analíticos completos: **Índice de Fadiga** (Body Battery + HRV + Stress), **Carga de Treino (TSB)** com ATL/CTL, **Intensidade/kg semanal**, **Sono × Desempenho**, **Custo metabólico**, **HRV × Carga**, **Training Readiness**, **Recordes pessoais** (distância semanal e de ciclismo, elevação semanal e por pedal, VO₂ máx) e **Hill + Endurance Score**.

### 🧰 Ferramentas
Calculadoras do ciclista, embarcadas como página própria (mesmo design *Hi-Vis Peloton*):
- **PSI ideal do pneu** — pressão recomendada por peso, largura, tipo de bike e terreno (10 terrenos), com correção de montagem e enchimento via cartucho de CO₂
- **Relação × Velocidade** — velocidade por relação (coroa × cog) e cadência, com base de cassetes/coroas Shimano e SRAM
- **Tempo de percurso** — estimativa por distância, elevação (modelo Strava de "km equivalente") e vento
- **Nutrição** — taxa de suor e plano de hidratação/carboidrato por temperatura, intensidade, peso e condicionamento, com cronograma de géis

### 🔌 Conexões
- **Strava** — importa atividades de bike, marca os dias treinados
- **Garmin Connect** — atividades, pesagens da balança, dados de saúde diários e estados de treino (Productive, Recovery, Maintaining)
- **Botão (i) em cada card** explicando como funciona a conexão de cada serviço (OAuth oficial do Strava × login não-oficial da Garmin com MFA)
- **Auto-sync** — sincronização automática a cada 30 minutos (Strava + Garmin, sem intervenção manual), com **toggle por serviço** para desligar um sem desligar o outro
- De-duplicação automática quando a mesma ride aparece nos dois
- Edição manual sempre prevalece sobre o sync (regra "manual wins")

### 💾 Backup e Relatórios
- **Backup automático semanal** — snapshot do banco em `data/backups/` (retenção: últimos 8)
- Lista de snapshots disponíveis para download direto no app
- Exportar/importar JSON completo (inclui resumo de atividades Strava/Garmin e a garagem de bikes)
- Exportar pesagens em CSV
- **Relatório completo em PDF**, renderizado **no servidor** (Chromium headless via Playwright), com filtro de período (30 dias / 90 dias / tudo)
  - Capa, perfil, evolução de peso (gráfico), pesagens, atividades, insights, recordes
  - **Heat-map de atividade dos últimos 90 dias** desenhado no PDF, volume mensal e HRV × Carga
  - Seção de Bike: km total por bike, vida útil de componentes, histórico de manutenções
- **Download da base completa em ZIP** — `training.db` + avatares (tokens não incluídos)
- **Restauração da base a partir de um ZIP** — com confirmação dupla (digitar "RESTAURAR"), backup de segurança automático antes da troca e reinício do serviço ao final
- **Fechamento mensal pelo Telegram** (opcional) — no dia 1º, um resumo do mês anterior em imagem, com análise do período gerada por IA. Exige `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` no `.env` **e** o toggle ligado no Perfil; sem os dois, o job simplesmente não roda. Para mandar uma prévia fora do dia 1º: `node server/scripts/enviar-resumo.js --dry-run`

### 🔔 Notificações push
Push de verdade no celular, via Web Push/VAPID (opcional — exige chaves VAPID no `.env`):
- **Digest da véspera** às 18h: para cada passeio de amanhã, horário e veredito de clima
- Opt-in explícito pelo app, com a subscription removida sozinha quando o navegador a invalida
- Foco em Android; no iOS exige o PWA instalado (o app detecta e orienta)

### 🌤️ Previsão do tempo (Passeios + Rotas)
- Faixa de previsão com ícone WMO, máx/mín, % chuva, UV e indicador de esforço para ciclismo (com nota de quantos dias de previsão estão disponíveis)
- **Símbolo de clima em cada dia** do calendário de passeios, dentro da janela de previsão
- Modal detalhado por dia: sensação térmica, rajadas, mm de chuva, nascer/pôr do sol
- Alertas específicos: vento perigoso, calor extremo, chuva forte, UV alto
- Proxy server-side (sem problema de CORS no PWA)

---

## 📱 Como acessar

**Web:** acesse pela URL onde você hospedar a aplicação (login com usuário + senha).

**App (mobile):** instale como PWA — abra o site no navegador → menu → "Adicionar à tela inicial". Funciona offline depois de carregado.

---

## 🚀 Implantação

Não há build step: o frontend é servido como arquivos estáticos e o backend Fastify expõe `/api/*`.

1. **Backend** — em `server/`: `cp .env.example .env` e preencha os segredos (JWT, credenciais Strava/Garmin), depois `npm install`. Rode na porta 3000 (em produção via systemd — ver `server/scripts/README-systemd.md`).
2. **Frontend** — sirva a raiz do repositório com nginx (ou qualquer servidor estático) e proxie `/api/*` para `127.0.0.1:3000`.
3. **HTTPS/domínio** — aponte seu domínio para o servidor através de um proxy reverso / CDN à sua escolha. O PWA exige HTTPS para instalar e funcionar offline.

> ⚠️ O relatório em PDF usa Chromium headless: depois do `npm install`, rode
> `npx playwright install --with-deps chromium` no servidor (~190 MB) antes de subir o serviço.

O fluxo de versão exige incrementar `js/version.js`, `service-worker.js`, `server/package.json` e os `?v=` nos **três** HTML — `index.html`, `login.html` e `mobile.html`. Esquecer o `mobile.html` serve assets antigos justamente para a superfície mais usada.

Arquivo novo em `js/`, `css/` ou na raiz também precisa entrar no array `SHELL` do `service-worker.js`: o `cache.addAll` é atômico e uma entrada que não responda 200 derruba o pré-cache inteiro.

---

## 🛠 Tecnologia (resumo)

- **Frontend:** HTML5, CSS puro e JavaScript vanilla (sem framework)
- **Backend:** Node.js (Fastify) + SQLite + autenticação JWT (cookie httpOnly)
- **Garmin:** wrapper Python chamado pelo Node via subprocess, usando um **fork** de `python-garminconnect` (v0.3.6, em [`guilherme1985/python-garminconnect`](https://github.com/guilherme1985/python-garminconnect)), instalado em venv isolado em `server/garmin/venv/`
- **Strava:** OAuth simplificado single-user
- **IA:** cascata Gemini → Groq, com os nomes de modelo **descobertos em runtime** pelo endpoint de listagem de cada provedor — nomes saem de circulação em poucos meses, então nada é fixado no código
- **Gráficos:** Chart.js 4.4 · **Mapas:** Leaflet 1.9 · **Clima:** Open-Meteo — os dois primeiros auto-hospedados em `js/lib/`
- **Testes:** 210 testes `node:test` (sem browser, rodam na CI) mais suítes locais que dirigem Chromium por CDP contra o app real

A ordem de carregamento dos módulos JS, o esquema do banco e as responsabilidades de cada arquivo estão documentados em comentários no próprio código.

---

## 📦 Privacidade

Por ser self-hosted, todos os dados ficam no servidor onde você implantar a aplicação — nada é enviado a terceiros. As credenciais de Strava e Garmin vivem apenas no `.env` do servidor, que **não é versionado** (está no `.gitignore`); portanto, nenhum token ou dado pessoal é exposto neste repositório público.

---

## 📜 Licença

Distribuído sob a licença **MIT** — uso, cópia e modificação livres, mantido o aviso de copyright. Veja o arquivo [`LICENSE`](LICENSE).

Código-fonte em [github.com/guilherme-romero/veloce](https://github.com/guilherme-romero/veloce).

---

## ☕ Apoie o projeto

Se este projeto te ajudou, considere me pagar um café!

[![Buy Me A Coffee](https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=☕&slug=guilhermeromero&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff)](https://buymeacoffee.com/guilhermeromero)
