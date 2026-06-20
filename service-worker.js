/* ═══════════════════════════════════════════════════════════════════════
   SERVICE WORKER — cache offline + atualização controlada por mensagem
   IMPORTANTE: ao publicar nova versão, atualize APP_VERSION em /js/version.js
   E o número CACHE_VERSION abaixo. Os dois precisam bater (ou apenas mantenha
   o CACHE_VERSION sincronizado manualmente — ele é a fonte da verdade do SW).
═══════════════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'v1.19.0';
const CACHE_NAME = `treino-bike-${CACHE_VERSION}`;

// Arquivos que compõem o "shell" do app — pré-cacheados na instalação
const SHELL = [
  './',
  './index.html',
  './login.html',
  './manifest.json',
  './icone.png',
  './css/style.css',
  './css/rides.css',
  './css/routes.css',
  './css/bikes.css',
  './css/login.css',
  './js/version.js',
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
  './js/home.js',
  './js/app.js',
  './js/login.js',
  './js/pwa.js',
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
      // Se NÃO há SW controlando ainda (primeira instalação), ativa imediatamente.
      // Senão, espera o cliente pedir via mensagem (banner "Atualizar").
      const clients = await self.clients.matchAll();
      const hasController = clients.some(c => c.frameType !== 'none');
      if (!hasController) {
        await self.skipWaiting();
      }
    })()
  );
});

/* ── ACTIVATE: limpa caches antigos ─────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k.startsWith('treino-bike-') && k !== CACHE_NAME)
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

  // /api/* NUNCA passa pelo cache — sempre vai direto pra rede (com cookies)
  if (url.pathname.startsWith('/api/')) return;

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
        .catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
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
