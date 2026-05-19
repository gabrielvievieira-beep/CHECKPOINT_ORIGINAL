// DIAGNOSTICO_DUPLICIDADE.GS
// ─────────────────────────────────────────────────────────────────────────────
// Análise minuciosa de duplicidades e inconsistências nas tabelas do BA01.
//
// TABELAS ANALISADAS:
//   CP_LISTA_COLABORADORES  → campo ID_GROOT   (com underscore)
//   CP_HISTORICO_ABS        → campo IDGROOT    (sem underscore)  ← inconsistência de schema
//   CP_AUSENCIAS_PROGRAMADAS
//
// COMO USAR:
//   1. Cole este arquivo no Apps Script do projeto BA01
//   2. Execute: diagnosticoCompleto()          → relatório completo no Logger + email
//      ou       diagnosticoCompleto(false)     → apenas Logger, sem email
//      ou       executarDiagnostico()          → atalho rápido (Logger only)
//
// SEÇÕES DO RELATÓRIO:
//   A. Duplicatas na CP_LISTA_COLABORADORES
//      A1 — ID_GROOT duplicado entre ativos
//      A2 — ID_GROOT duplicado entre TODOS (incluindo inativos)
//      A3 — Nome duplicado com IDs diferentes (mesmo colaborador, dois registros)
//      A4 — ID_GROOT nulo ou vazio (ativos)
//      A5 — Linhas exatamente idênticas (nome + área + setor + turno + gestor)
//
//   B. Duplicatas / anomalias na CP_HISTORICO_ABS
//      B1 — CHAVE duplicada (DDMMYY+IDGROOT repetida no mesmo dia)
//      B2 — Múltiplos STATUS_PRESENCA para mesmo IDGROOT + DATA_ABS
//      B3 — IDGROOT nulo no histórico
//      B4 — Nome no histórico diverge do nome na lista para o mesmo IDGROOT
//
//   C. Inconsistências cruzadas (lista × histórico)
//      C1 — IDGROOT presente no histórico mas ausente na lista de colaboradores
//      C2 — Colaboradores ativos na lista sem nenhum registro no histórico (últimos 60 dias)
//
//   D. Anomalias em CP_AUSENCIAS_PROGRAMADAS
//      D1 — Ausências duplicadas (mesmo colaborador + mesmo dia + mesmo status)
//      D2 — Colaborador na tabela de ausências sem registro ativo na lista
// ─────────────────────────────────────────────────────────────────────────────

function executarDiagnostico() {
  return diagnosticoCompleto(false);
}

function diagnosticoCompleto(enviarEmail) {
  if (typeof enviarEmail === 'undefined') enviarEmail = true;

  const token     = getTokenBigQuery();
  const inicio    = new Date();
  const resultados = {};
  const erros     = [];

  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('  DIAGNÓSTICO DE DUPLICIDADE — BA01');
  Logger.log('  Início: ' + inicio.toLocaleString('pt-BR'));
  Logger.log('═══════════════════════════════════════════════════════\n');

  // ── A1: ID_GROOT duplicado entre ativos ─────────────────────────────────
  try {
    const q = `
      SELECT
        ID_GROOT,
        COUNT(*)            AS qtd,
        STRING_AGG(COLABORADOR, ' | ' ORDER BY COLABORADOR)  AS nomes,
        STRING_AGG(AREA,        ' | ' ORDER BY COLABORADOR)  AS areas,
        STRING_AGG(SETOR,       ' | ' ORDER BY COLABORADOR)  AS setores,
        STRING_AGG(TURNO,       ' | ' ORDER BY COLABORADOR)  AS turnos,
        STRING_AGG(STATUS,      ' | ' ORDER BY COLABORADOR)  AS statuses
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE STATUS NOT IN ('Inativo','INATIVO')
        AND ID_GROOT IS NOT NULL
      GROUP BY ID_GROOT
      HAVING COUNT(*) > 1
      ORDER BY qtd DESC, ID_GROOT
    `;
    resultados.A1 = _runQuery(q, token);
    _logSecao('A1', 'ID_GROOT duplicado entre ATIVOS', resultados.A1,
      r => `  ID_GROOT ${r.id_groot} → ${r.qtd}x | Nomes: ${r.nomes} | Áreas: ${r.areas} | Turnos: ${r.turnos}`);
  } catch(e) { erros.push('A1: ' + e.message); Logger.log('ERRO A1: ' + e); }

  // ── A2: ID_GROOT duplicado entre TODOS ──────────────────────────────────
  try {
    const q = `
      SELECT
        ID_GROOT,
        COUNT(*)            AS qtd,
        STRING_AGG(COLABORADOR, ' | ' ORDER BY STATUS, COLABORADOR) AS nomes,
        STRING_AGG(STATUS,      ' | ' ORDER BY STATUS, COLABORADOR) AS statuses
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE ID_GROOT IS NOT NULL
      GROUP BY ID_GROOT
      HAVING COUNT(*) > 1
      ORDER BY qtd DESC, ID_GROOT
    `;
    resultados.A2 = _runQuery(q, token);
    _logSecao('A2', 'ID_GROOT duplicado (ATIVOS + INATIVOS)', resultados.A2,
      r => `  ID_GROOT ${r.id_groot} → ${r.qtd}x | ${r.nomes} | Status: ${r.statuses}`);
  } catch(e) { erros.push('A2: ' + e.message); Logger.log('ERRO A2: ' + e); }

  // ── A3: Mesmo nome com IDs diferentes ───────────────────────────────────
  try {
    const q = `
      SELECT
        COLABORADOR,
        COUNT(DISTINCT ID_GROOT) AS qtd_ids,
        STRING_AGG(CAST(ID_GROOT AS STRING), ' | ' ORDER BY ID_GROOT) AS ids,
        STRING_AGG(STATUS,                  ' | ' ORDER BY ID_GROOT) AS statuses,
        STRING_AGG(AREA,                    ' | ' ORDER BY ID_GROOT) AS areas
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE COLABORADOR IS NOT NULL
        AND ID_GROOT IS NOT NULL
      GROUP BY COLABORADOR
      HAVING COUNT(DISTINCT ID_GROOT) > 1
      ORDER BY qtd_ids DESC, COLABORADOR
    `;
    resultados.A3 = _runQuery(q, token);
    _logSecao('A3', 'Mesmo NOME com ID_GROOTs diferentes', resultados.A3,
      r => `  ${r.colaborador} → ${r.qtd_ids} IDs: ${r.ids} | Status: ${r.statuses} | Áreas: ${r.areas}`);
  } catch(e) { erros.push('A3: ' + e.message); Logger.log('ERRO A3: ' + e); }

  // ── A4: ID_GROOT nulo ou vazio (ativos) ─────────────────────────────────
  try {
    const q = `
      SELECT
        COLABORADOR, AREA, SETOR, TURNO, GESTOR, STATUS, CARGO
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE STATUS NOT IN ('Inativo','INATIVO')
        AND (ID_GROOT IS NULL OR CAST(ID_GROOT AS STRING) = '')
      ORDER BY COLABORADOR
    `;
    resultados.A4 = _runQuery(q, token);
    _logSecao('A4', 'Colaboradores ATIVOS sem ID_GROOT', resultados.A4,
      r => `  ${r.colaborador} | ${r.area} | ${r.setor} | ${r.turno} | Gestor: ${r.gestor}`);
  } catch(e) { erros.push('A4: ' + e.message); Logger.log('ERRO A4: ' + e); }

  // ── A5: Linhas exatamente idênticas na lista ─────────────────────────────
  try {
    const q = `
      SELECT
        COLABORADOR, AREA, SETOR, TURNO, GESTOR, STATUS, CARGO,
        COUNT(*) AS qtd
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      GROUP BY COLABORADOR, AREA, SETOR, TURNO, GESTOR, STATUS, CARGO
      HAVING COUNT(*) > 1
      ORDER BY qtd DESC, COLABORADOR
    `;
    resultados.A5 = _runQuery(q, token);
    _logSecao('A5', 'Linhas EXATAMENTE idênticas na lista', resultados.A5,
      r => `  ${r.colaborador} | ${r.area} | ${r.turno} | ${r.status} → ${r.qtd}x`);
  } catch(e) { erros.push('A5: ' + e.message); Logger.log('ERRO A5: ' + e); }

  // ── B1: CHAVE duplicada no histórico ─────────────────────────────────────
  try {
    const q = `
      SELECT
        CHAVE,
        COUNT(*)  AS qtd,
        STRING_AGG(COLABORADOR,       ' | ' ORDER BY COLABORADOR)       AS nomes,
        STRING_AGG(DATA_ABS,          ' | ' ORDER BY COLABORADOR)       AS datas,
        STRING_AGG(STATUS_PRESENCA,   ' | ' ORDER BY COLABORADOR)       AS statuses,
        MIN(DATA_ABS) AS data_ref
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
      WHERE CHAVE IS NOT NULL
      GROUP BY CHAVE
      HAVING COUNT(*) > 1
      ORDER BY qtd DESC, data_ref DESC
      LIMIT 200
    `;
    resultados.B1 = _runQuery(q, token);
    _logSecao('B1', 'CHAVE duplicada no histórico (DDMMYY+IDGROOT)', resultados.B1,
      r => `  CHAVE ${r.chave} → ${r.qtd}x | ${r.nomes} | Status: ${r.statuses} | Data: ${r.data_ref}`);
  } catch(e) { erros.push('B1: ' + e.message); Logger.log('ERRO B1: ' + e); }

  // ── B2: Múltiplos STATUS para mesmo IDGROOT + DATA ───────────────────────
  try {
    const q = `
      SELECT
        IDGROOT,
        DATA_ABS,
        COUNT(*)  AS qtd_registros,
        STRING_AGG(DISTINCT STATUS_PRESENCA, ' | ' ORDER BY STATUS_PRESENCA) AS statuses,
        STRING_AGG(DISTINCT COLABORADOR,     ' | ' ORDER BY COLABORADOR)     AS nomes,
        STRING_AGG(DISTINCT RESPONSAVEL,     ' | ' ORDER BY RESPONSAVEL)     AS responsaveis
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
      WHERE IDGROOT IS NOT NULL
        AND DATA_ABS >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
      GROUP BY IDGROOT, DATA_ABS
      HAVING COUNT(*) > 1
      ORDER BY DATA_ABS DESC, qtd_registros DESC
      LIMIT 300
    `;
    resultados.B2 = _runQuery(q, token);
    _logSecao('B2', 'Múltiplos registros (IDGROOT + DATA) — últimos 90 dias', resultados.B2,
      r => `  IDGROOT ${r.idgroot} | ${r.data_abs} | ${r.qtd_registros}x | Status: ${r.statuses} | Resp: ${r.responsaveis}`);
  } catch(e) { erros.push('B2: ' + e.message); Logger.log('ERRO B2: ' + e); }

  // ── B3: IDGROOT nulo no histórico ────────────────────────────────────────
  try {
    const q = `
      SELECT
        COLABORADOR,
        COUNT(*)    AS qtd_registros,
        MIN(DATA_ABS) AS primeira_ocorrencia,
        MAX(DATA_ABS) AS ultima_ocorrencia,
        STRING_AGG(DISTINCT AREA,  ' | ' ORDER BY AREA)  AS areas,
        STRING_AGG(DISTINCT TURNO, ' | ' ORDER BY TURNO) AS turnos
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
      WHERE IDGROOT IS NULL
      GROUP BY COLABORADOR
      ORDER BY qtd_registros DESC
    `;
    resultados.B3 = _runQuery(q, token);
    _logSecao('B3', 'IDGROOT nulo no histórico', resultados.B3,
      r => `  ${r.colaborador || '(sem nome)'} | ${r.qtd_registros} registros | de ${r.primeira_ocorrencia} a ${r.ultima_ocorrencia}`);
  } catch(e) { erros.push('B3: ' + e.message); Logger.log('ERRO B3: ' + e); }

  // ── B4: Nome no histórico diverge da lista para o mesmo IDGROOT ──────────
  try {
    const q = `
      SELECT
        h.IDGROOT,
        l.COLABORADOR AS nome_lista,
        h.COLABORADOR AS nome_historico,
        COUNT(*) AS qtd_ocorrencias_historico
      FROM (
        SELECT DISTINCT IDGROOT, COLABORADOR
        FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
        WHERE IDGROOT IS NOT NULL AND COLABORADOR IS NOT NULL
      ) h
      INNER JOIN \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\` l
        ON CAST(h.IDGROOT AS INT64) = l.ID_GROOT
      LEFT JOIN (
        SELECT IDGROOT, COUNT(*) AS qtd
        FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
        WHERE IDGROOT IS NOT NULL
        GROUP BY IDGROOT
      ) cnt ON cnt.IDGROOT = h.IDGROOT
      WHERE UPPER(TRIM(h.COLABORADOR)) != UPPER(TRIM(l.COLABORADOR))
      ORDER BY h.IDGROOT
    `;
    resultados.B4 = _runQuery(q, token);
    _logSecao('B4', 'Nome divergente entre histórico e lista (mesmo IDGROOT)', resultados.B4,
      r => `  IDGROOT ${r.idgroot} | Lista: "${r.nome_lista}" ≠ Histórico: "${r.nome_historico}"`);
  } catch(e) { erros.push('B4: ' + e.message); Logger.log('ERRO B4: ' + e); }

  // ── C1: IDGROOT no histórico ausente na lista ────────────────────────────
  try {
    const q = `
      SELECT
        h.IDGROOT,
        STRING_AGG(DISTINCT h.COLABORADOR, ' | ' ORDER BY h.COLABORADOR) AS nomes_historico,
        COUNT(*)        AS qtd_registros,
        MIN(h.DATA_ABS) AS primeira_ocorrencia,
        MAX(h.DATA_ABS) AS ultima_ocorrencia
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\` h
      LEFT JOIN \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\` l
        ON CAST(h.IDGROOT AS INT64) = l.ID_GROOT
      WHERE h.IDGROOT IS NOT NULL
        AND l.ID_GROOT IS NULL
      GROUP BY h.IDGROOT
      ORDER BY ultima_ocorrencia DESC, qtd_registros DESC
      LIMIT 200
    `;
    resultados.C1 = _runQuery(q, token);
    _logSecao('C1', 'IDGROOT no histórico SEM correspondência na lista', resultados.C1,
      r => `  IDGROOT ${r.idgroot} | ${r.nomes_historico} | ${r.qtd_registros} registros | último: ${r.ultima_ocorrencia}`);
  } catch(e) { erros.push('C1: ' + e.message); Logger.log('ERRO C1: ' + e); }

  // ── C2: Ativos na lista sem registro nos últimos 60 dias ─────────────────
  try {
    const q = `
      SELECT
        l.ID_GROOT,
        l.COLABORADOR,
        l.AREA,
        l.SETOR,
        l.TURNO,
        l.GESTOR,
        l.STATUS
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\` l
      LEFT JOIN (
        SELECT DISTINCT IDGROOT
        FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
        WHERE DATA_ABS >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
      ) h ON CAST(h.IDGROOT AS INT64) = l.ID_GROOT
      WHERE l.STATUS NOT IN ('Inativo','INATIVO')
        AND l.ID_GROOT IS NOT NULL
        AND h.IDGROOT IS NULL
      ORDER BY l.AREA, l.SETOR, l.COLABORADOR
    `;
    resultados.C2 = _runQuery(q, token);
    _logSecao('C2', 'Colaboradores ATIVOS sem registro nos últimos 60 dias', resultados.C2,
      r => `  ${r.colaborador} | IDGROOT: ${r.id_groot} | ${r.area} | ${r.setor} | ${r.turno} | Gestor: ${r.gestor}`);
  } catch(e) { erros.push('C2: ' + e.message); Logger.log('ERRO C2: ' + e); }

  // ── D1: Ausências duplicadas ─────────────────────────────────────────────
  try {
    const q = `
      SELECT
        COLABORADOR,
        DATA_INICIO,
        DATA_FIM,
        STATUS,
        COUNT(*) AS qtd
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_AUSENCIAS}\`
      GROUP BY COLABORADOR, DATA_INICIO, DATA_FIM, STATUS
      HAVING COUNT(*) > 1
      ORDER BY qtd DESC, DATA_INICIO DESC
      LIMIT 100
    `;
    resultados.D1 = _runQuery(q, token);
    _logSecao('D1', 'Ausências programadas duplicadas', resultados.D1,
      r => `  ${r.colaborador} | ${r.data_inicio} → ${r.data_fim} | ${r.status} | ${r.qtd}x`);
  } catch(e) { erros.push('D1: ' + e.message); Logger.log('ERRO D1: ' + e); }

  // ── D2: Colaborador em ausências sem registro ativo na lista ─────────────
  try {
    const q = `
      SELECT
        a.COLABORADOR,
        COUNT(DISTINCT a.DATA_INICIO) AS qtd_ausencias,
        MIN(a.DATA_INICIO) AS primeira,
        MAX(a.DATA_FIM)    AS ultima
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_AUSENCIAS}\` a
      LEFT JOIN \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\` l
        ON UPPER(TRIM(a.COLABORADOR)) = UPPER(TRIM(l.COLABORADOR))
        AND l.STATUS NOT IN ('Inativo','INATIVO')
      WHERE l.COLABORADOR IS NULL
        AND a.COLABORADOR IS NOT NULL
      GROUP BY a.COLABORADOR
      ORDER BY qtd_ausencias DESC
      LIMIT 100
    `;
    resultados.D2 = _runQuery(q, token);
    _logSecao('D2', 'Colaboradores em ausências sem ativo na lista', resultados.D2,
      r => `  ${r.colaborador} | ${r.qtd_ausencias} ausências | de ${r.primeira} a ${r.ultima}`);
  } catch(e) { erros.push('D2: ' + e.message); Logger.log('ERRO D2: ' + e); }

  // ── Sumário ──────────────────────────────────────────────────────────────
  const fim = new Date();
  const duracao = Math.round((fim - inicio) / 1000);

  Logger.log('\n═══════════════════════════════════════════════════════');
  Logger.log('  SUMÁRIO FINAL');
  Logger.log('═══════════════════════════════════════════════════════');
  const secoes = [
    ['A1','ID_GROOT duplicado — ativos'],
    ['A2','ID_GROOT duplicado — todos'],
    ['A3','Mesmo nome, IDs diferentes'],
    ['A4','Ativos sem ID_GROOT'],
    ['A5','Linhas idênticas na lista'],
    ['B1','CHAVE duplicada no histórico'],
    ['B2','Múltiplos STATUS por dia (90d)'],
    ['B3','IDGROOT nulo no histórico'],
    ['B4','Nome divergente lista × histórico'],
    ['C1','IDGROOT órfão no histórico'],
    ['C2','Ativos sem registro (60d)'],
    ['D1','Ausências duplicadas'],
    ['D2','Ausência sem ativo na lista'],
  ];
  let totalProblemas = 0;
  secoes.forEach(([key, label]) => {
    const r = resultados[key];
    const n = r ? r.length : '?';
    const status = (n === 0 || n === '?') ? '✓' : '⚠';
    Logger.log(`  ${status} ${key} — ${label}: ${n}`);
    if (typeof n === 'number' && n > 0) totalProblemas += n;
  });
  if (erros.length > 0) {
    Logger.log('\n  Seções com erro:');
    erros.forEach(e => Logger.log('    ✗ ' + e));
  }
  Logger.log(`\n  Total de ocorrências problemáticas: ${totalProblemas}`);
  Logger.log(`  Tempo de execução: ${duracao}s`);
  Logger.log('═══════════════════════════════════════════════════════\n');

  if (enviarEmail && totalProblemas > 0) {
    _enviarRelatorioDiagnostico(resultados, secoes, totalProblemas, duracao, erros);
  }

  return { resultados, totalProblemas, duracao, erros };
}


// ─── Funções auxiliares ──────────────────────────────────────────────────────

function _runQuery(sql, token) {
  const endpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;
  const opts = {
    method:      'POST',
    contentType: 'application/json',
    headers:     { 'Authorization': 'Bearer ' + token },
    payload:     JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 90000 }),
    muteHttpExceptions: true
  };
  const res    = JSON.parse(UrlFetchApp.fetch(endpoint, opts).getContentText());
  if (res.error) throw new Error(res.error.message);
  if (!res.rows) return [];
  return res.rows.map(row => {
    const obj = {};
    res.schema.fields.forEach((f, i) => { obj[f.name.toLowerCase()] = row.f[i].v; });
    return obj;
  });
}

function _logSecao(codigo, titulo, rows, formatFn) {
  Logger.log(`\n── ${codigo}: ${titulo} ──────────────────`);
  if (!rows || rows.length === 0) {
    Logger.log('  ✓ Nenhuma ocorrência encontrada.');
  } else {
    Logger.log(`  ⚠ ${rows.length} ocorrência(s):`);
    rows.slice(0, 50).forEach(r => Logger.log(formatFn(r)));
    if (rows.length > 50) Logger.log(`  ... e mais ${rows.length - 50} ocorrência(s) (ver email)`);
  }
}

function _enviarRelatorioDiagnostico(resultados, secoes, totalProblemas, duracao, erros) {
  const destinatarios = EMAIL_DESTINATARIOS.join(',');
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  let html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;background:#0f172a;padding:32px 20px;color:#e2e8f0;min-height:100vh;">
  <div style="max-width:720px;margin:0 auto;">

    <div style="background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.3);border-radius:14px;padding:20px 24px;margin-bottom:24px;">
      <div style="font-size:20px;font-weight:700;color:#c7d2fe;margin-bottom:4px;">🔍 Diagnóstico de Duplicidade — BA01</div>
      <div style="font-size:13px;color:rgba(148,163,184,.7);">Gerado em ${agora} · ${totalProblemas} ocorrências · ${duracao}s</div>
    </div>
  `;

  secoes.forEach(([key, label]) => {
    const rows = resultados[key] || [];
    if (rows.length === 0) return; // pula seções limpas

    html += `
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px 20px;margin-bottom:16px;">
      <div style="font-size:13px;font-weight:700;color:#fbbf24;margin-bottom:12px;letter-spacing:.04em;text-transform:uppercase;">
        ⚠ ${key} — ${label} (${rows.length} ocorrência${rows.length !== 1 ? 's' : ''})
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
    `;

    // Cabeçalhos
    const cols = Object.keys(rows[0]);
    html += '<tr>';
    cols.forEach(c => {
      html += `<th style="padding:6px 10px;background:rgba(255,255,255,.06);color:rgba(148,163,184,.8);text-align:left;font-weight:600;border-bottom:1px solid rgba(255,255,255,.07);">${c.toUpperCase()}</th>`;
    });
    html += '</tr>';

    // Linhas (máx 100 por seção no email)
    rows.slice(0, 100).forEach((r, idx) => {
      const bg = idx % 2 === 0 ? 'rgba(255,255,255,.02)' : 'transparent';
      html += `<tr style="background:${bg}">`;
      cols.forEach(c => {
        const val = r[c] !== null && r[c] !== undefined ? r[c] : '—';
        html += `<td style="padding:5px 10px;color:#e2e8f0;border-bottom:1px solid rgba(255,255,255,.04);white-space:nowrap;">${val}</td>`;
      });
      html += '</tr>';
    });

    if (rows.length > 100) {
      html += `<tr><td colspan="${cols.length}" style="padding:8px 10px;color:rgba(148,163,184,.5);font-size:11px;">... e mais ${rows.length - 100} linha(s) omitida(s)</td></tr>`;
    }

    html += `</table></div>`;
  });

  if (erros.length > 0) {
    html += `
    <div style="background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);border-radius:12px;padding:16px 20px;margin-bottom:16px;">
      <div style="font-size:13px;font-weight:700;color:#f87171;margin-bottom:8px;">✗ Seções com erro de execução</div>
      ${erros.map(e => `<div style="font-size:12px;color:rgba(248,113,113,.75);margin-bottom:4px;">${e}</div>`).join('')}
    </div>`;
  }

  html += `
    <div style="text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid rgba(255,255,255,.06);">
      <div style="font-size:12px;color:rgba(148,163,184,.4);">Checkpoint BA01 · Time ID/EA</div>
    </div>
  </div></div>`;

  try {
    MailApp.sendEmail({
      to:       destinatarios,
      subject:  `[BA01] Diagnóstico de Duplicidade — ${totalProblemas} ocorrências`,
      body:     `Diagnóstico gerado em ${agora}. ${totalProblemas} ocorrências encontradas. Veja o relatório HTML em anexo.`,
      htmlBody: html
    });
    Logger.log('Email de diagnóstico enviado para: ' + destinatarios);
  } catch(e) {
    Logger.log('Erro ao enviar email de diagnóstico: ' + e.toString());
  }
}
