/* ═══════════════════════════════════════════════════════════════════════
   VARIANT — escolhe entre a UI desktop (index.html) e a mobile (mobile.html).

   Regra: o DISPOSITIVO decide. Celular e tablet abrem mobile.html; PC abre
   index.html. Não há botão de troca no desktop e não há preferência
   permanente — o override da aba "Mais" vale só enquanto a aba estiver
   aberta (sessionStorage), então ninguém fica preso na variante errada.

   BUG-069: a versão anterior decidia por window.innerWidth, e este script
   roda ANTES de o parser chegar na <meta name="viewport">. Até lá o browser
   móvel usa o viewport de layout padrão (~980px), então innerWidth nunca
   caía abaixo de 767 num celular e o redirect jamais acontecia. NADA aqui
   pode voltar a ler innerWidth: screen.width, matchMedia e o user agent são
   independentes da meta viewport.

   A decisão mora INTEIRAMENTE aqui, no cliente — nunca no service worker
   (que não lê storage) nem no nginx (o Cloudflare cacheia por URL, e servir
   HTML diferente na mesma URL entregaria a variante errada a metade dos
   acessos).
═══════════════════════════════════════════════════════════════════════ */
(function () {
  var KEY = 'vl.ui';        // sessionStorage: override temporário
  var HOP = 'vl.ui.hop';    // sessionStorage: guarda anti-loop

  var here = /mobile\.html$/.test(location.pathname) ? 'mobile' : 'desktop';

  function get()  { try { return sessionStorage.getItem(KEY); } catch (_) { return null; } }
  function set(v) { try { sessionStorage.setItem(KEY, v); }    catch (_) {} }
  function pageOf(v) { return v === 'mobile' ? 'mobile.html' : 'index.html'; }

  // Migração da v2.7.7, que gravava a escolha em localStorage. Sem apagar,
  // quem clicou uma vez em "versão desktop" continuaria preso nela mesmo com
  // a detecção corrigida.
  try { localStorage.removeItem(KEY); } catch (_) {}

  function isMobileDevice() {
    // 1. Client Hints: resposta direta do browser. true é conclusivo; false
    //    não é, porque tablet Android também responde false.
    if (navigator.userAgentData && navigator.userAgentData.mobile === true) return true;

    var ua = navigator.userAgent || '';

    // 2. User agent clássico — iPhone, Android (o tablet também traz
    //    "Android" no UA) e o resto do zoológico.
    if (/Android|iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(ua)) return true;

    // 3. iPad moderno se declara como "Macintosh"; o que o entrega é o toque
    //    — um Mac de verdade tem maxTouchPoints 0.
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return true;

    // 4. Fallback para o que escapou: ponteiro grosso (dedo, não mouse) numa
    //    tela pequena. screen.width é a largura física da tela e não depende
    //    da meta viewport.
    var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    return !!(coarse && screen.width <= 1024);
  }

  // ?ui=… é uma escolha explícita: vale nesta aba e sai da URL.
  var q = new URLSearchParams(location.search);
  var forced = q.get('ui');
  if (forced === 'mobile' || forced === 'desktop') set(forced);

  var want = get() || (isMobileDevice() ? 'mobile' : 'desktop');

  if (want !== here) {
    // Anti-loop: no máximo 1 hop por navegação. Cobre o caso patológico de
    // sessionStorage que aceita escrita mas devolve null na leitura (Safari
    // privado antigo).
    var hops = 0;
    try { hops = +(sessionStorage.getItem(HOP) || 0); } catch (_) {}
    if (hops < 1) {
      try { sessionStorage.setItem(HOP, hops + 1); } catch (_) {}
      q.delete('ui');
      var qs = q.toString();
      location.replace(pageOf(want) + (qs ? '?' + qs : '') + location.hash);
      return;  // não deixa o resto da página inicializar
    }
  }

  try { sessionStorage.removeItem(HOP); } catch (_) {}

  window.Variant = {
    current:  here,
    other:    here === 'mobile' ? 'desktop' : 'mobile',
    isMobileDevice: isMobileDevice,
    set:      set,
    switchTo: function (v) { set(v); location.replace(pageOf(v) + location.hash); }
  };
})();
