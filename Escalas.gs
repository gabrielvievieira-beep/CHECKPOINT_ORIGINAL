// ESCALAS.GS — Funções de Escala Rotativa
//
// Tabela: meli-sbox.BRBA01.CP_ESCALAS_ROTATIVAS
// Schema descoberto via getEsquemaEscalas() — rodar UMA VEZ e verificar o log.

// ── Descoberta de Schema (rodar uma vez para ver os campos) ──────────────────
function getEsquemaEscalas() {
  try {
    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;

    // 1. Pegar os nomes das colunas via INFORMATION_SCHEMA
    const querySchema = `
      SELECT column_name, data_type, is_nullable
      FROM \`${PROJECT_ID}.${DATASET_ID}.INFORMATION_SCHEMA.COLUMNS\`
      WHERE table_name = '${TABLE_ESCALAS}'
      ORDER BY ordinal_position
    `;

    const optSchema = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: querySchema, useLegacySql: false }),
      muteHttpExceptions: true
    };

    const resSchema = UrlFetchApp.fetch(apiEndpoint, optSchema);
    const schema    = JSON.parse(resSchema.getContentText());

    const colunas = (schema.rows || []).map(r => ({
      nome:      r.f[0].v,
      tipo:      r.f[1].v,
      nullable:  r.f[2].v
    }));
    Logger.log('=== SCHEMA ' + TABLE_ESCALAS + ' ===');
    colunas.forEach(c => Logger.log(c.nome + ' (' + c.tipo + ')'));

    // 2. Pegar as primeiras 3 linhas para ver os dados reais
    const queryAmostra = `
      SELECT *
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_ESCALAS}\`
      LIMIT 3
    `;

    const optAmostra = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: queryAmostra, useLegacySql: false }),
      muteHttpExceptions: true
    };

    const resAmostra = UrlFetchApp.fetch(apiEndpoint, optAmostra);
    const amostra    = JSON.parse(resAmostra.getContentText());

    if (amostra.rows) {
      const campos = (amostra.schema || {}).fields || [];
      Logger.log('=== AMOSTRA (3 linhas) ===');
      amostra.rows.forEach((row, i) => {
        const obj = {};
        campos.forEach((f, idx) => { obj[f.name] = row.f[idx].v; });
        Logger.log('Linha ' + (i+1) + ': ' + JSON.stringify(obj));
      });
    }

    return { colunas: colunas };

  } catch (e) {
    Logger.log('Erro getEsquemaEscalas: ' + e.toString());
    throw e;
  }
}

// ── Calcular turma de folga para uma data qualquer (YYYY-MM-DD) ──────────────
//
// Ciclo 8 dias: [A,A,B,B,C,C,D,D] | Referência: 2026-01-03 = Turma A (índice 0)
// Compartilhada com Chamada.gs (mesma lógica do folgaDoDate no frontend)
function getTurmaFolgaData_(dataStr) {
  const FOLGA_CYCLE = ['A','A','B','B','C','C','D','D'];
  const parts = dataStr.split('-');
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const r = new Date(2026, 0, 3); // Jan 3 2026 = Turma A
  const diff = Math.round((d - r) / 86400000);
  return FOLGA_CYCLE[((diff % 8) + 8) % 8];
}

// ── Buscar todas as escalas em folga para uma data (fonte: CP_ESCALAS_ROTATIVAS) ─
function getTurmasEmFolgaDia_(dataStr) {
  try {
    const token = getTokenBigQuery();
    const res = UrlFetchApp.fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`,
      {
        method: 'POST', contentType: 'application/json',
        headers: { 'Authorization': 'Bearer ' + token },
        payload: JSON.stringify({
          query: `SELECT DISTINCT ESCALA FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_ESCALAS}\`
                  WHERE DATA = DATE '${dataStr}' AND FOLGA = true`,
          useLegacySql: false, timeoutMs: 15000
        }),
        muteHttpExceptions: true
      }
    );
    const result = JSON.parse(res.getContentText());
    if (!result.rows) return [];
    return result.rows.map(r => r.f[0].v).filter(Boolean);
  } catch(e) {
    Logger.log('[getTurmasEmFolgaDia_] erro: ' + e.toString());
    return [];
  }
}

// Exposta ao frontend via google.script.run
function getTurmasEmFolgaDia(dataStr) {
  return getTurmasEmFolgaDia_(dataStr);
}

// ── Buscar colaboradores escalados para um dia específico ────────────────────
//
// Schema de CP_ESCALAS_ROTATIVAS: DATA (DATE), ESCALA (STRING), FOLGA (BOOL)
// Lógica:
//   1. Consulta CP_ESCALAS_ROTATIVAS para descobrir quais ESCALAs estão ativas (FOLGA=false)
//   2. Se achar → filtra CP_LISTA_COLABORADORES pela ESCALA ativa + cargo whitelist
//   3. Se não achar (tabela desatualizada) → fallback: todos os ativos com cargo whitelist
//   4. Sempre exclui a turma de DSR do dia (cálculo independente do calendário BQ)
//
// Retorna: { rows, fallback, escalasAtivas, turmaFolga, erro? }
//   rows: [{ idgroot, colaborador, turno, escala, area, setor, gestor, cargo }]
function getEscalasDia(data) {
  try {
    const token       = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;

    const _bq = function(sql, timeout) {
      const res = UrlFetchApp.fetch(apiEndpoint, {
        method: 'POST', contentType: 'application/json',
        headers: { 'Authorization': 'Bearer ' + token },
        payload: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: timeout || 20000 }),
        muteHttpExceptions: true
      });
      return JSON.parse(res.getContentText());
    };

    // ── Passo 1: escalas ativas no dia ────────────────────────────────────
    const resEsc = _bq(
      `SELECT ESCALA FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_ESCALAS}\`
       WHERE DATA = DATE '${data}' AND FOLGA = false`, 15000
    );

    const escalasAtivas = (resEsc.rows || []).map(r => r.f[0].v).filter(Boolean);
    const temEscalas    = escalasAtivas.length > 0;

    Logger.log('[getEscalasDia] Data: ' + data +
      (temEscalas ? ' | Escalas ativas: ' + escalasAtivas.join(', ')
                  : ' | Sem escalas no calendário — usando fallback (todos ativos)'));

    // ── Passo 2: filtros dinâmicos ────────────────────────────────────────
    const esc = (s) => s.replace(/'/g, "''");

    // Filtro de ESCALA (via CP_ESCALAS_ROTATIVAS)
    const filtroEscala = temEscalas
      ? `AND ESCALA IN (${escalasAtivas.map(e => `'${esc(e)}'`).join(', ')})`
      : '/* fallback: todas as escalas */';

    // Filtro DSR: exclui todas as escalas em folga no dia (via CP_ESCALAS_ROTATIVAS)
    const turmasEmFolga = getTurmasEmFolgaDia_(data);
    const filtroDSR     = turmasEmFolga.length > 0
      ? `AND UPPER(TRIM(COALESCE(ESCALA, ''))) NOT IN (${turmasEmFolga.map(t => `'${t}'`).join(', ')})`
      : '';
    Logger.log('[getEscalasDia] Escalas em folga (' + data + '): ' + (turmasEmFolga.join(', ') || 'nenhuma'));

    // Filtro de CARGO (whitelist)
    const filtroCargo = (typeof CARGOS_INCLUIDOS !== 'undefined' && CARGOS_INCLUIDOS.length > 0)
      ? `AND UPPER(TRIM(CARGO)) IN (${CARGOS_INCLUIDOS.map(c => `'${esc(c.toUpperCase())}'`).join(', ')})`
      : '';

    // Filtro de SETOR (whitelist)
    const filtroSetor = (typeof SETORES_INCLUIDOS !== 'undefined' && SETORES_INCLUIDOS.length > 0)
      ? `AND UPPER(TRIM(SETOR)) IN (${SETORES_INCLUIDOS.map(s => `'${esc(s.toUpperCase())}'`).join(', ')})`
      : '';

    // ── Passo 3: colaboradores ────────────────────────────────────────────
    const queryColabs = `
      SELECT
        ID_GROOT    AS idgroot,
        COLABORADOR AS colaborador,
        TURNO       AS turno,
        ESCALA      AS escala,
        AREA        AS area,
        SETOR       AS setor,
        GESTOR      AS gestor,
        CARGO       AS cargo,
        STATUS      AS status
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE STATUS NOT IN ('Inativo', 'INATIVO')
        AND ID_GROOT IS NOT NULL
        ${filtroEscala}
        ${filtroDSR}
        ${filtroCargo}
        ${filtroSetor}
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ID_GROOT ORDER BY COLABORADOR) = 1
      ORDER BY AREA, SETOR, TURNO, COLABORADOR
    `;

    Logger.log('[getEscalasDia] Query colabs: ' + queryColabs.replace(/\s+/g, ' ').trim());

    const result = _bq(queryColabs, 30000);

    if (result.error) {
      Logger.log('[getEscalasDia] Erro BQ: ' + JSON.stringify(result.error));
      return { rows: [], fallback: !temEscalas, escalasAtivas: [], erro: result.error.message };
    }
    if (result.jobComplete === false) {
      return { rows: [], fallback: !temEscalas, escalasAtivas: [], erro: 'timeout' };
    }
    if (!result.rows) {
      Logger.log('[getEscalasDia] Sem colaboradores para ' + data);
      return { rows: [], fallback: !temEscalas, escalasAtivas: escalasAtivas };
    }

    const campos = (result.schema || {}).fields || [];
    const linhas = result.rows.map(row => {
      const obj = {};
      campos.forEach((f, i) => { obj[f.name.toLowerCase()] = row.f[i].v; });
      return obj;
    });

    Logger.log('[getEscalasDia] ' + linhas.length + ' colaboradores' +
      (temEscalas ? '' : ' [fallback]') + ' para ' + data);
    if (linhas.length > 0) Logger.log('[getEscalasDia] Amostra: ' + JSON.stringify(linhas[0]));

    return { rows: linhas, fallback: !temEscalas, escalasAtivas: escalasAtivas };

  } catch (e) {
    Logger.log('[getEscalasDia] Exceção: ' + e.toString());
    return { rows: [], fallback: false, escalasAtivas: [], erro: e.toString() };
  }
}
