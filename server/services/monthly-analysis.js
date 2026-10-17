/* ═══════════════════════════════════════════════════════════════════════
   MONTHLY ANALYSIS — análise de IA do mês para o relatório de fechamento
   (Telegram, #106/#112). Espelha o design de performance-analysis.js:
   prompt → IA (cascata Gemini→Groq via gerarAnalise) → JSON {observacao,foco}
   → upsert no cache. Diferenças: cache multi-row chaveado por mês ('YYYY-MM',
   tabela monthly_report_analysis_cache) e os insumos vêm prontos do cliente
   (o template do resumo já os calcula) em vez de serem derivados aqui.

   Falha de IA propaga para a rota, que responde sem a seção de análise — o
   relatório NUNCA deixa de sair por causa da IA. Sucesso grava no cache; uma
   chamada de IA por mês (renders repetidos no mesmo mês = cache hit).
═══════════════════════════════════════════════════════════════════════ */
const { gerarAnalise } = require('./ai-providers');

const NOMES_MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function nomeMes(mes) {
  const m = parseInt(String(mes).slice(5, 7), 10);
  return (m >= 1 && m <= 12) ? NOMES_MESES[m - 1] : mes;
}

function montarPromptMensal({ mes, dados }) {
  const d = dados || {};
  const ac = d.acumulados || {};
  const zonas = Array.isArray(d.zonasPct) ? d.zonasPct : [];
  const linhas = [
    'Você é um treinador de ciclismo. Abaixo estão os números do MÊS FECHADO de um ciclista amador. ',
    'Faça um balanço do mês e sugira um foco para o próximo. Baseie-se SÓ nos números fornecidos — ',
    'não invente valores nem cite dados que não estão aqui.\n\n',
    `Mês: ${nomeMes(mes)}.\n`,
    `Volume: ${ac.km ?? '—'} km em ${ac.count ?? 0} saídas; tempo ${ac.horas ?? '—'} h; elevação ${ac.elev ?? '—'} m.\n`,
  ];
  if (d.ctlMax != null || d.atlMax != null) {
    linhas.push(`Carga (CTL máx): ${d.ctlMax ?? '—'}; Fadiga (ATL máx): ${d.atlMax ?? '—'} (ATL > CTL = fadiga aguda acima do condicionamento de base).\n`);
  }
  if (d.vo2 != null) linhas.push(`VO2máx: ${d.vo2}.\n`);
  if (d.hrv != null) linhas.push(`HRV noturno médio: ${d.hrv} ms.\n`);
  if (zonas.length === 5) {
    linhas.push(`Distribuição por zona de FC (% do tempo): Z1 ${zonas[0]}%, Z2 ${zonas[1]}%, Z3 ${zonas[2]}%, Z4 ${zonas[3]}%, Z5 ${zonas[4]}% (Z1-Z2 base aeróbica; Z3-Z4 limiar; Z5 máximo).\n`);
  }
  if (d.aderPct != null) linhas.push(`Aderência ao plano de treino: ${d.aderPct}% do volume planejado.\n`);
  if (d.peso && d.peso.atual != null) {
    linhas.push(`Peso atual: ${d.peso.atual} kg${d.peso.meta != null ? ` (meta ${d.peso.meta} kg)` : ''}.\n`);
  }
  linhas.push(
    '\nResponda em português, SOMENTE com um objeto JSON válido (sem markdown, sem ```), no formato ',
    'exato: {"observacao": "2-4 frases de balanço do mês, misturando pontos positivos e a melhorar", ',
    '"foco": "1-3 frases de sugestão de foco para o próximo mês"}.',
  );
  return linhas.join('');
}

function lerCacheMensal(db, mes) {
  return db.prepare('SELECT * FROM monthly_report_analysis_cache WHERE mes = ?').get(String(mes));
}

// Trava de promessa em voo (mesmo motivo de performance-analysis.js): o render
// automático do dia 1º e um render manual podem coincidir; reusar a mesma
// promessa evita duas chamadas de IA. Single-user, janela de poucos segundos.
let emVoo = null;

/**
 * Gera a análise do mês via IA, parseia como JSON {observacao,foco} (fallback:
 * texto bruto → observacao), e faz upsert no cache chaveado por mês. Grava SÓ
 * em sucesso.
 * @throws {Error} (.cascata) quando todos os provedores de IA falham.
 * @return {{observacao,foco,provider,model,geradoEm}}
 */
async function gerarEArmazenarMensal(db, { mes, dados }) {
  if (emVoo) return emVoo;

  emVoo = (async () => {
    const { texto, provider, model } = await gerarAnalise(montarPromptMensal({ mes, dados }));

    let observacao = texto;
    let foco = null;
    try {
      const parsed = JSON.parse(texto);
      if (parsed && typeof parsed.observacao === 'string') {
        observacao = parsed.observacao;
        foco = typeof parsed.foco === 'string' ? parsed.foco : null;
      }
    } catch (_) { /* resposta não veio em JSON — usa o texto bruto como observação */ }

    const payload = JSON.stringify({ observacao, foco, provider, model, insumos: dados });
    db.prepare(`INSERT INTO monthly_report_analysis_cache (mes, payload, gerado_em)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(mes) DO UPDATE SET payload = excluded.payload, gerado_em = excluded.gerado_em`)
      .run(String(mes), payload);

    const row = lerCacheMensal(db, mes);
    return { ...JSON.parse(row.payload), geradoEm: row.gerado_em };
  })();

  try {
    return await emVoo;
  } finally {
    emVoo = null;
  }
}

module.exports = { montarPromptMensal, lerCacheMensal, gerarEArmazenarMensal };
