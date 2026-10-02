/* ═══════════════════════════════════════════════════════════════════════
   SERVICE WORKER — cache offline + atualização controlada por mensagem
   IMPORTANTE: ao publicar nova versão, atualize APP_VERSION em /js/version.js
   E o número CACHE_VERSION abaixo. Os dois precisam bater (ou apenas mantenha
   o CACHE_VERSION sincronizado manualmente — ele é a fonte da verdade do SW).
═══════════════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'v2.9.20';
const CACHE_NAME = `treino-bike-${CACHE_VERSION}`;

// Cache das respostas de dados (/api/* GET). SEM versao de proposito: uma
// release nova nao pode apagar o offline do usuario. Limpo no logout, pelas
// duas variantes (js/app.js e js/mobile/more-mobile.js).
const DATA_CACHE = 'treino-bike-data';

// Arquivos que compõem o "shell" do app — pré-cacheados na instalação
const SHELL = [
  './',
  './index.html',
  './mobile.html',
  './login.html',
  './manifest.json',
  './manifest-mobile.json',
  './robots.txt',
  './icons/favicon.svg',
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './css/style.css',
  './css/rides.css',
  './css/routes.css',
  './css/bikes.css',
  './css/ferramentas.css',
  './css/login.css',
  './css/fonts/archivo-variable.woff2',
  './css/fonts/bebas-neue-400.woff2',
  './css/mobile.css',
  './css/mobile-sheet.css',
  './css/mobile-bikes.css',
  './css/mobile-desempenho.css',
  './js/version.js',
  './js/variant.js',
  './js/utils.js',
  './js/router.js',
  './js/defaults.js',
  './js/api.js',
  './js/storage.js',
  './js/profile.js',
  './js/charts.js',
  './js/modals.js',
  './js/workouts.js',
  './js/rides.js',
  './js/bikes.js',
  './js/training-log.js',
  './js/home-workout.js',
  './js/backup.js',
  './js/gpx.js',
  './js/routes.js',
  './js/heatmap.js',
  './js/strava.js',
  './js/garmin.js',
  './js/activities.js',
  './js/insights.js',
  './js/proximo-treino.js',
  './js/performance-analysis.js',
  './js/comparative-performance.js',
  './js/ferramentas.js',
  './js/home.js',
  './js/notifications.js',
  './js/app.js',
  './js/login.js',
  './js/pwa.js',
  './js/core/metrics.js',
  './js/core/activity-stats.js',
  './js/core/weight-stats.js',
  './js/core/fatigue.js',
  './js/core/records.js',
  './js/core/weather-rating.js',
  './js/core/training-suggestion.js',
  './js/core/suggestion-history.js',
  './js/core/performance-analysis.js',
  './js/core/comparative-performance.js',
  './js/mobile/router-mobile.js',
  './js/mobile/shell.js',
  './js/mobile/home-mobile.js',
  './js/mobile/activities-mobile.js',
  './js/mobile/insights-mobile.js',
  './js/mobile/performance-analysis-mobile.js',
  './js/mobile/comparative-performance-mobile.js',
  './js/mobile/desempenho-mobile.js',
  './js/mobile/bikes-mobile.js',
  './js/mobile/profile-mobile.js',
  './js/mobile/rides-mobile.js',
  './js/mobile/more-mobile.js',
  './js/mobile/boot.js',
  // dados_usuario.txt entra como cache opcional — não falha install se faltar
];

const EXTERNAL_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

/* ── INSTALL: pré-cacheia o shell ───────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Shell crítico
      await cache.addAll(SHELL).catch(err => {
        console.warn('[SW] addAll partial failure:', err);
      });
      // Assets externos (best-effort)
      await Promise.all(EXTERNAL_ASSETS.map(u =>
        fetch(u, { mode: 'no-cors' })
          .then(r => cache.put(u, r))
          .catch(() => null)
      ));
      // Ativa SEMPRE a nova versão imediatamente (não espera o banner).
      // Combinado com clients.claim() no activate + reload no pwa.js, garante
      // que toda atualização publicada reflete na próxima carga, sem o usuário
      // ficar preso numa versão antiga em cache.
      await self.skipWaiting();
    })()
  );
});

/* ── ACTIVATE: limpa caches antigos ─────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        // DATA_CACHE fica de fora: ele nao e versionado e sobrevive as releases.
        keys.filter(k => k.startsWith('treino-bike-') && k !== CACHE_NAME && k !== DATA_CACHE)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH: estratégia — cache-first p/ shell, network-first p/ HTML ── */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Só GET, e protocolo http(s)
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // /api/* — network-first com fallback ao cache (BUG-079). Online o
  // comportamento e IDENTICO ao de antes: a rede sempre vence, e o cache so
  // entra quando ela falha. Nao e stale-while-revalidate de proposito — servir
  // dado velho com rede disponivel mascararia a falta de guarda das views.
  if (url.pathname.startsWith('/api/')) {
    // /api/auth/* NUNCA e cacheado: um /auth/me cacheado faria um usuario
    // deslogado parecer logado. Vai direto pra rede, como sempre foi.
    if (url.pathname.startsWith('/api/auth/')) return;
    event.respondWith(
      fetch(req)
        .then(resp => {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            const clone = resp.clone();
            caches.open(DATA_CACHE).then(c => c.put(req, clone));
          }
          return resp;
        })
        .catch(() => caches.match(req, { cacheName: DATA_CACHE }))
    );
    return;
  }

  // Cross-origin (CDNs como cdnjs, unpkg, fontes Google): deixa o navegador
  // buscar diretamente. Interceptar gera responses opacas que o navegador
  // rejeita para fontes (.woff2, .ttf) — causando ícones quebrados.
  if (url.origin !== self.location.origin) return;

  // Para HTML (navegação): network-first com fallback ao cache
  // (garante que sempre tenta pegar a versão mais nova primeiro)
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then(resp => {
          // Atualiza cache em paralelo
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, respClone));
          return resp;
        })
        // Fallback por variante: uma navegação a mobile.html offline não pode
        // cair no HTML desktop. A navegação a './' cai em index.html de
        // propósito — variant.js roda lá e redireciona se a preferência do
        // usuário for mobile (o SW não tem acesso ao localStorage).
        .catch(() => caches.match(req).then(c => c || caches.match(
          url.pathname.endsWith('/mobile.html') ? './mobile.html' : './index.html')))
    );
    return;
  }

  // Para outros assets (CSS/JS/PNG/font): cache-first
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        // Cacheia respostas válidas dinamicamente
        if (resp && resp.status === 200 && resp.type !== 'opaque') {
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, respClone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});

/* ── MESSAGES: o cliente pede para ativar a nova versão ─────────────── */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
