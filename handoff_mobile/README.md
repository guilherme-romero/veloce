# Veloce Labs — Handoff Mobile (Hi-Vis Peloton)

Especificação para implementar as telas mobile (390 px) do app de ciclismo com dados do Garmin Connect.
Fonte de verdade visual: `Veloce Labs Mobile.dc.html` + `screenshots/`.

---

## 1. Grid e métricas

| Item | Valor |
|---|---|
| Largura de referência | **390 px** (iPhone 13/14/15) |
| Altura de referência | 844 px |
| Padding lateral do conteúdo | **18 px** |
| Gap vertical entre blocos | 14–16 px |
| Gap entre cards de grid | 10 px |
| Header (sticky) | 56–72 px, `blur(12px)`, borda inferior 1 px |
| Tab bar (fixa) | 5 colunas, padding `8px 6px 12px`, itens com `min-height: 48px` |
| Área de scroll | `padding-bottom: 96px` (não deixar conteúdo sob a tab bar) |
| Alvo de toque mínimo | **44 px** (botões secundários 40 px só quando pareados) |

Breakpoint: abaixo de 480 px usar este layout; de 481–1023 px, grid de 2 colunas; ≥1024 px, layout desktop existente.

---

## 2. Cores

| Token | Hex | Uso |
|---|---|---|
| `ink` | `#0d0f12` | fundo do app |
| `canvas` | `#08090b` | fundo fora do device (só na prancheta) |
| `surface` | `#14181d` | cards |
| `surface-2` | `#1c2128` | cards internos, botões secundários, chips |
| `border` | `#2a313a` | bordas 1 px, divisores, trilhas de barra |
| `lime` (primária) | `#c6f135` | CTA, ativo, destaque numérico |
| `magenta` (jersey) | `#ec3a8b` | alertas, badge Garmin, queda de métrica |
| `text` | `#eef2f4` | texto principal |
| `text-2` | `#c4ccd4` | texto em botão secundário |
| `muted` | `#8b95a1` | labels, legendas, ícones inativos |
| `green` | `#22c55e` | elevação, componente saudável |
| `yellow` | `#e5c024` | atenção / índice moderado |
| `red` | `#ef4444` | vencido |

Zonas FC: Z1 `#3b82f6` · Z2 `#e5c024` · Z3 `#22c55e` · Z4 `#ef4444` · Z5 `#a855f7`.

Regra: no máximo **2 cores de fundo** por tela (`ink` + `surface`). Lima e magenta só como acento — a única superfície colorida cheia é o alerta de sobrecarga (`#ec3a8b` com texto `#0d0f12`).

---

## 3. Tipografia

- **Bebas Neue** — números, títulos de tela, botões primários. `letter-spacing: .02em`, `line-height: .82–1`.
- **Archivo** (400/500/700/800) — corpo, labels, descrições.

| Papel | Fonte / tamanho |
|---|---|
| Título de tela (header) | Bebas 26 px |
| Título hero | Bebas 40 px / `line-height: .88` |
| Nome de bike / modal | Bebas 28–38 px |
| Número grande (card) | Bebas 34–38 px |
| Número em linha de atividade | Bebas 22–26 px |
| Unidade colada ao número | 11–16 px, cor lima |
| Eyebrow / seção | Archivo 9.5–10 px, 700, `letter-spacing: .14–.2em`, uppercase, `muted` |
| Corpo | Archivo 11.5–13 px |
| Micro-label sob número | Archivo 8.5 px, `letter-spacing: .1em`, uppercase |

---

## 4. Componentes

**Card padrão** — `background: surface; border: 1px solid border; border-radius: 16–20px; padding: 14–18px`.

**Card de atividade** — `border-left: 3px solid` (lima = manual, magenta = importada do Garmin) + grid de 4 métricas (km / tempo / km/h / elev m), sendo km/h em lima e elevação em verde.

**Card de componente da bike** — `surface-2`, `border-left: 3px` colorido pelo estado (verde ok, amarelo atenção, vermelho vencido), barra de progresso 5 px, linha de contexto em `muted` e botões de ação pareados de 40 px.

**Chips / filtros** — pílula `border-radius: 999px`, inativo `surface-2` + borda `border` + texto `muted`, ativo fundo `rgba(198,241,53,.14)` + borda e texto lima. Linhas de chips rolam na horizontal (scrollbar oculta).

**Faixa jersey** — `repeating-linear-gradient(90deg, #c6f135 0 14px, #ec3a8b 14px 28px)`, 6 px de altura no topo da bike ativa; versão vertical (8 px de largura) no card hero da Home.

**Tab bar** — 5 itens, ícone 16 px + label 9 px uppercase; ativo em lima, inativo em `muted`. Ordem: Início · Atividades · Insights · Bikes · Mais.

**Bottom sheet (modal)** — sobe do rodapé, `border-radius: 26px 26px 0 0`, handle de 42×4 px, `max-height: 88%`, corpo com scroll próprio, ações fixas no pé (primária lima, secundária `surface-2`). Fundo: conteúdo borrado + overlay `rgba(8,9,11,.72)`.

---

## 5. Telas entregues

| # | Tela | Arquivo | Notas |
|---|---|---|---|
| 01 | Início | `screenshots/01-inicio.png` | hero de saudação + 4 KPIs 2×2 + últimas atividades |
| 02 | Atividades | `screenshots/02-atividades.png` | filtros por ano, KPIs em carrossel horizontal, mapa de constância 15 col., última atividade, volume mensal |
| 03 | Insights | `screenshots/03-insights.png` | alerta de sobrecarga, CTL/ATL/VO₂/HRV, curva carga×fadiga, rosca de zonas com legenda à direita, cards de recomendação |
| 04 | Bikes | `screenshots/04-bikes.png` | bike ativa com faixa jersey, componentes com estado, bike inativa a 72% de opacidade |
| 05 | Modal componente | `screenshots/05-modal-componente.png` | bottom sheet de desgaste + histórico |

Não incluída nesta rodada: **Passeios** (fora do escopo escolhido).

---

## 6. Diferenças propositais vs. a versão desktop

1. Navegação vira **tab bar inferior** (desktop usa nav superior).
2. KPIs em grid 2×2 na Home e em **carrossel horizontal** em Atividades — nunca 4 colunas espremidas.
3. Números caem de 48 px (desktop) para 34–38 px, mas continuam em Bebas — a hierarquia é mantida pelo peso, não pelo tamanho.
4. Modais viram **bottom sheets**, nunca diálogos centralizados.
5. Ações repetidas por item (editar/excluir) saem da linha: só as duas principais ficam visíveis; o resto vai para o sheet do componente.
6. Mapa de constância reduz para 15 colunas × 4 linhas (90 dias agregados) em vez da matriz semanal completa.

---

## 7. Como rodar

Abra `Veloce Labs Mobile.dc.html` no navegador (precisa de `support.js` na mesma pasta). As telas são artboards lado a lado numa prancheta com pan/zoom; cada uma rola internamente.

Fontes por CDN: Google Fonts (Archivo, Bebas Neue) e Font Awesome 6.4.0.
