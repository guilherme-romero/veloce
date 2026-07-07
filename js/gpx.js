/* ═══════════════════════════════════════════════════════════════════════
   GPX — parser client-side usando DOMParser
   Extrai waypoints (lat, lon, ele) e calcula métricas de rota.
═══════════════════════════════════════════════════════════════════════ */

function parseGPX(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  const err = doc.querySelector('parsererror');
  if (err) throw new Error('XML inválido — verifique se o arquivo é um GPX válido.');

  const trkpts = Array.from(doc.querySelectorAll('trkpt'));
  if (trkpts.length === 0) throw new Error('Nenhum ponto de track encontrado no GPX');

  const waypoints = trkpts.map(pt => {
    const eleTxt = pt.querySelector('ele')?.textContent?.trim() || '0';
    const ele    = parseFloat(eleTxt);
    return {
      lat: parseFloat(pt.getAttribute('lat')),
      lon: parseFloat(pt.getAttribute('lon')),
      ele: isNaN(ele) ? 0 : ele,
    };
  }).filter(p => !isNaN(p.lat) && !isNaN(p.lon));

  if (waypoints.length < 2) throw new Error('GPX insuficiente: menos de 2 pontos válidos');

  return { waypoints, stats: calcGPXStats(waypoints) };
}

function calcGPXStats(waypoints) {
  let distancia = 0;
  let desnivelPos = 0;
  let desnivelNeg = 0;
  let altMax = -Infinity;

  for (let i = 1; i < waypoints.length; i++) {
    distancia += haversine(waypoints[i - 1], waypoints[i]);
    const dEle = waypoints[i].ele - waypoints[i - 1].ele;
    if (dEle > 0) desnivelPos += dEle;
    else desnivelNeg += Math.abs(dEle);
  }

  waypoints.forEach(p => { if (p.ele > altMax) altMax = p.ele; });

  return {
    distancia:   +distancia.toFixed(2),
    desnivelPos: Math.round(desnivelPos),
    desnivelNeg: Math.round(desnivelNeg),
    altMax:      Math.round(altMax === -Infinity ? 0 : altMax),
  };
}

function haversine(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

window.parseGPX = parseGPX;
