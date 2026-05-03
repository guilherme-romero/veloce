# Treino Cicloviagem

Plano de treino de ciclismo com foco em **perda de peso** e **ganho de condicionamento**, com perfil editável, gráfico de progresso, zonas de FC, agenda semanal de treinos e calendário de passeios planejados.

PWA instalável, com cache offline.

---

## ✨ Funcionalidades

- 📊 **Perfil & Objetivos** — perfil editável, IMC com classificação, FC máxima, projeção de 12 semanas a partir de uma data inicial real
- 📈 **Gráfico de peso evoluído** — projeção teórica + peso real medido + histórico anterior, sobrepostos
- ❤️ **Zonas de FC** — 6 zonas calculadas automaticamente a partir da idade
- 🏠 **Fortalecimento em casa** — circuito Core & Pernas
- 🚴 **Agenda de treinos** — CRUD completo de treinos, com modos dinâmicos (criar / renomear / excluir)
- 📅 **Passeios planejados** — calendário mensal + lista cronológica, com toggle, dificuldade, distância, altimetria, duração, nota e observações
- 💾 **Backup JSON** — exportar e importar todos os dados
- 📱 **PWA** — instalável no celular, funciona offline, atualização com notificação

---

## 🆕 Mudanças na 1.1.0

A 1.1.0 é uma revisão profunda do código com correções importantes. Resumo:

| Área | O que mudou |
|------|-------------|
| **`js/rides.js`** | Reescrito do zero para usar `Storage` e `Modals` do app (antes operava com sistemas paralelos) |
| **`css/rides.css`** | Reescrito para usar os tokens (`--teal`, `--amber`, etc.) e seguir a identidade visual do projeto |
| **Schema dos passeios** | Padronizado em pt-BR (`data`, `destino`, `distancia`, `altitude`, `duracao`, `dificuldade`, `nota`, `notas`) |
| **Migração automática** | Passeios cadastrados com a v1.0 (campos em inglês: `date`, `destination`, etc.) são normalizados automaticamente para o novo schema |
| **`js/storage.js`** | Versão de schema bumpada para `2`. Função `normalizeRide()` blinda dados malformados |
| **`js/profile.js`** | Z6 agora é calculada dinamicamente (antes tinha texto hardcoded) |
| **`js/charts.js`** | Bug do histórico corrigido (uma posição era sobrescrita indevidamente, deformando a curva) |
| **`service-worker.js`** | Cache bumpado para `v1.1.0` e agora inclui `css/rides.css` no shell |
| **Segurança (XSS)** | Todo HTML dinâmico no `rides.js` agora passa por `esc()`/`escAttr()` |

> **Importante:** se você tinha passeios cadastrados na v1.0, eles serão migrados automaticamente na primeira abertura da v1.1. Recomendamos exportar um backup antes de atualizar, por garantia.

---

## 📁 Estrutura

```
treino_bike/
├── index.html              # Markup principal
├── manifest.json           # Manifest do PWA
├── service-worker.js       # Cache offline + atualização
├── icone.png
├── README.md
├── css/
│   ├── style.css           # Tokens, layout e componentes (base)
│   └── rides.css           # Estilos específicos da seção de passeios
├── js/
│   ├── version.js          # Versão centralizada do app
│   ├── defaults.js         # Treinos padrão (1ª migração)
│   ├── storage.js          # Persistência (localStorage) + migrações
│   ├── profile.js          # Cálculos: idade, IMC, FCM, zonas (Z1–Z6)
│   ├── charts.js           # Gráficos: peso (real + projeção) + intensidade
│   ├── modals.js           # Sistema genérico de modais e toasts
│   ├── workouts.js         # CRUD treinos + modos dinâmicos
│   ├── rides.js            # Calendário + lista de passeios planejados
│   ├── backup.js           # Export/Import JSON
│   ├── app.js              # Bootstrap + handlers de UI
│   └── pwa.js              # Registro do SW + banner de atualização
└── docs/
    └── dados_usuario.txt   # Legado — usado apenas na 1ª migração
```

---

## 🎨 Design system

Tokens definidos em `css/style.css`:

```css
--bg:       #0c0d10   /* fundo principal */
--surface:  #13151a   /* cards e elementos elevados */
--surface2: #1c1f28   /* elementos sobre cards */
--border:   #252830   /* linhas e divisores */
--text:     #e8eaf0   /* texto principal */
--muted:    #6b7280   /* texto secundário */

--teal:   #14d9b8     /* primária — ações positivas */
--amber:  #f5a523     /* avisos, fortalecimento */
--red:    #f0523a     /* perigo, FC máxima */
--blue:   #4e9ef5     /* Z2 (resistência) */
--green:  #22c55e     /* Z3 (aeróbica) */
--purple: #a855f7     /* Z6 (anaeróbica) */
```

Tipografia: **[Outfit](https://fonts.google.com/specimen/Outfit)** (Google Fonts), pesos 400/500/600/700/800.

---

## 🚀 Como rodar (desenvolvimento)

Precisa de um servidor estático (não funciona via `file://` por causa do `fetch()` na migração e do registro do service worker).

```bash
# Python 3
python3 -m http.server 8000

# Node
npx http-server -p 8000

# PHP
php -S localhost:8000
```

Abra `http://localhost:8000`. Na primeira execução, os dados de `docs/dados_usuario.txt` são lidos uma única vez para popular o `localStorage`. Depois disso, toda edição é via interface (botão ✏ ou ⊕).

---

## 🌐 Deploy em produção (Cloudflare + Nginx)

### 1. Nginx — `server` block recomendado

```nginx
server {
    listen 443 ssl http2;
    server_name treino.seudominio.com;

    root /var/www/treino_bike;
    index index.html;

    # SSL
    ssl_certificate     /etc/letsencrypt/live/treino.seudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/treino.seudominio.com/privkey.pem;

    # Servir o site
    location / {
        try_files $uri $uri/ =404;
    }

    # MIME do .txt legado (migração)
    location ~* \.(txt)$ {
        add_header Content-Type "text/plain; charset=utf-8";
    }

    # Service Worker — NUNCA cachear (cache-busting é controlado internamente)
    location = /service-worker.js {
        add_header Cache-Control "no-store, no-cache, must-revalidate";
        expires 0;
    }

    # Manifest — cache curto
    location = /manifest.json {
        add_header Cache-Control "public, max-age=3600";
    }

    # CSS/JS/imagens — cache longo, mas funciona com ?v= cache busting
    location ~* \.(css|js|png|jpg|jpeg|svg|woff2)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # HTML — sem cache (atualizações imediatas)
    location = /index.html {
        add_header Cache-Control "no-cache, must-revalidate";
        expires 0;
    }

    # Bloquear arquivos sensíveis
    location ~ /\.(git|env|htaccess) {
        deny all;
    }

    # Compressão
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    # Headers de segurança
    add_header X-Frame-Options          "SAMEORIGIN" always;
    add_header X-Content-Type-Options   "nosniff" always;
    add_header Referrer-Policy          "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy  "default-src 'self'; \
        script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; \
        style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; \
        font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com data:; \
        img-src 'self' data:; \
        connect-src 'self' https://cdnjs.cloudflare.com; \
        manifest-src 'self'; \
        worker-src 'self';" always;
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name treino.seudominio.com;
    return 301 https://$server_name$request_uri;
}
```

Permissões:
```bash
sudo chown -R www-data:www-data /var/www/treino_bike
sudo find /var/www/treino_bike -type d -exec chmod 755 {} \;
sudo find /var/www/treino_bike -type f -exec chmod 644 {} \;
```

### 2. Cloudflare — configurações

| Onde | Configuração | Valor |
|------|--------------|-------|
| SSL/TLS → Overview | Encryption mode | **Full (strict)** |
| SSL/TLS → Edge Cert | Always Use HTTPS | **On** |
| Speed → Optimization | Auto Minify (HTML/CSS/JS) | **On** |
| Speed → Optimization | Brotli | **On** |
| Caching → Cache Rules | `URI Path contains /service-worker.js` | **Bypass cache** |
| Caching → Cache Rules | `URI Path contains /index.html` | **Bypass cache** |

A regra de bypass do `service-worker.js` é **crítica**: sem ela, atualizações não chegam ao usuário.

---

## 🔄 Como publicar uma atualização

Quando você modificar qualquer arquivo do projeto:

1. **Incrementar a versão em DOIS lugares**:
   - `js/version.js` → `window.APP_VERSION = '1.1.1';`
   - `service-worker.js` → `const CACHE_VERSION = 'v1.1.1';`

2. **Atualizar os `?v=` no `index.html`**:
   ```html
   <link rel="stylesheet" href="css/style.css?v=1.1.1">
   <link rel="stylesheet" href="css/rides.css?v=1.1.1">
   <script src="js/storage.js?v=1.1.1"></script>
   ...
   ```

   💡 No editor, faça find-replace de `?v=1.1.0` para `?v=1.1.1` — pega tudo de uma vez.

3. **Subir os arquivos** para `/var/www/treino_bike/`

4. **No Cloudflare**: as Cache Rules cuidam do `service-worker.js` e do `index.html`. Os assets versionados são baixados naturalmente porque o `?v=` mudou.

5. **Resultado para o usuário**: na próxima vez que abrir o site, o service worker detecta a nova versão e mostra um banner *"Nova versão disponível · Atualizar"* no canto inferior. Ao clicar, recarrega com a versão nova.

### Mudanças que envolvem schema do Storage

Se a atualização mudar o formato dos dados em `localStorage` (como aconteceu na 1.0 → 1.1):

1. Bumpar `SCHEMA_VERSION` em `js/storage.js`
2. Adicionar bloco em `migrateSchema()` que normalize os dados antigos:
   ```js
   if (current < 3) {
     // exemplo: renomear campo X para Y em todas as entradas
     const items = get(KEYS.SOMETHING, []);
     const migrated = items.map(it => ({ ...it, novoCampo: it.campoAntigo }));
     set(KEYS.SOMETHING, migrated);
   }
   ```
3. Testar com um backup real importado antes de subir.

---

## 💾 Persistência

Tudo em `localStorage` sob o prefixo `tb.`:

| Chave         | Conteúdo                                               |
|---------------|--------------------------------------------------------|
| `tb.user`     | Perfil + meta + data de início do plano                |
| `tb.modes`    | Lista de modos de treino (mín. 1, ilimitado)           |
| `tb.workouts` | `{ modeId: [workouts] }`                               |
| `tb.weights`  | Pesagens registradas (`atual` ou `histórico`)          |
| `tb.rides`    | Passeios planejados (schema pt-BR)                     |
| `tb.version`  | Versão do schema (controle de migração entre versões)  |

### Schema do Passeio (Ride)

```js
{
  id:          "ride_<timestamp>_<rand>",
  data:        "YYYY-MM-DD",
  destino:     "Serra da Mantiqueira",
  distancia:   80.5,         // km (number)
  altitude:    1200,         // m (number)
  duracao:     "4h 30min",   // texto livre
  dificuldade: "baixa" | "media" | "alta",
  nota:        0..5,         // estrelas (0 = sem nota)
  notas:       "...",        // observações livres
  createdAt:   "ISO-8601"
}
```

Para resetar tudo: clique em ⓘ Backup na navbar → "Apagar todos os dados". Ou no DevTools → Application → Local Storage → Clear all.

---

## 📱 PWA — Instalar no celular

**Android (Chrome):** abre o site → menu (⋮) → *Instalar app* / *Adicionar à tela inicial*.

**iOS (Safari):** abre o site → botão de compartilhar → *Adicionar à Tela de Início*.

Depois de instalado, abre como app (sem barra do navegador), com seu ícone na home, e funciona offline.

---

## 🛠 Tecnologias

- HTML5 + CSS puro (sem frameworks)
- JavaScript vanilla (módulos no escopo global, expostos via `window`)
- [Chart.js](https://www.chartjs.org/) 4.x — gráficos
- [Font Awesome](https://fontawesome.com/) 6.x — ícones
- [Outfit](https://fonts.google.com/specimen/Outfit) (Google Fonts) — tipografia
- Service Worker API + Web App Manifest — PWA

---

## ⚠️ Notas importantes

- **localStorage é por dispositivo + navegador.** Se quiser sincronizar entre celular e desktop, exporte o JSON e importe no outro dispositivo — ou implemente um backend (não está no escopo atual).
- **PWA + offline** funciona perfeitamente, mas a primeira visita precisa estar online para baixar os assets para o cache.
- **HTTPS é obrigatório** para o PWA funcionar — ok via Cloudflare.
- **Os dados ficam só no seu navegador.** Se limpar o cache do site, perde tudo. Faça backup periodicamente (botão de nuvem na navbar).
