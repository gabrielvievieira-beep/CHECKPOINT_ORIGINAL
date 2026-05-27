// HISTORICO.GS
//
// CORREÇÕES APLICADAS:
//   - getHistorico(): removido gerarFiltrosCargoSetor('CARGO',...) — CP_HISTORICO_ABS não tem coluna CARGO
//   - getMapaPresenca(): removido gerarFiltrosCargoSetor('CARGO',...) e removido filtro STATUS (coluna não existe)
//     CP_HISTORICO_ABS tem STATUS_PRESENCA, não STATUS

// SELECT * da tabela CP_HISTORICO_ABS
// Filtra por período: diasLimite (últimos X dias) ou mes/ano
function getHistorico(mes, ano, diasLimite) {
  try {
    const areasExcl  = (typeof AREAS_EXCLUIDAS !== 'undefined' && AREAS_EXCLUIDAS.length > 0)
                       ? AREAS_EXCLUIDAS
                       : ['Safety','Flow','Treinamento','Plant Engineering','Line Haul','People','Staff','Customer','Operations','Software','Loss Prevention'];
    const areasNOTIN = areasExcl.map(a => `'${a.toUpperCase()}'`).join(', ');

    // Whitelist — alinhada com Chamada e Flow (única fonte de verdade)
    const cargosIncl = (typeof CARGOS_INCLUIDOS !== 'undefined' && CARGOS_INCLUIDOS.length > 0)
                       ? CARGOS_INCLUIDOS
                       : ['Representante de Envio 1','Representante de Envio 2','Representante de Envio 3',
                          'Problem Solver','Operador Logistico 1','Operador Logistico 2',
                          'Sr Team Leader - Shipping'];
    const cargosIN = cargosIncl.map(a => `'${a.toUpperCase()}'`).join(', ');

    const filtros = [];

    if (diasLimite && diasLimite > 0) {
      filtros.push(`DATA_ABS >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL ${Number(diasLimite)} DAY)`);
    } else if (mes && ano) {
      filtros.push(`EXTRACT(YEAR FROM DATA_ABS) = ${Number(ano)}`);
      filtros.push(`EXTRACT(MONTH FROM DATA_ABS) = ${Number(mes)}`);
    }

    filtros.push(`(AREA IS NULL OR UPPER(TRIM(AREA)) NOT IN (${areasNOTIN}))`);
    filtros.push(`CAST(IDGROOT AS INT64) IN (
        SELECT CAST(ID_GROOT AS INT64)
        FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
        WHERE UPPER(TRIM(CARGO)) IN (${cargosIN})
          AND ID_GROOT IS NOT NULL
      )`);

    let query = `SELECT * FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\``;
    if (filtros.length > 0) {
      query += ' WHERE ' + filtros.join(' AND ');
    }
    query += ` ORDER BY DATA_ABS DESC, AREA, SETOR, GESTOR, COLABORADOR`;

    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;

    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false, timeoutMs: 30000 })
    };

    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result = JSON.parse(response.getContentText());

    if (result.error) throw new Error(result.error.message);
    if (!result.rows || result.rows.length === 0) return [];

    const historico = result.rows.map(row => {
      const registro = {};
      result.schema.fields.forEach((field, index) => {
        registro[field.name.toLowerCase()] = row.f[index].v;
      });
      return registro;
    });

    return historico;
  } catch (error) {
    Logger.log('Erro ao buscar histórico: ' + error.toString());
    throw error;
  }
}

// UPDATE STATUS_PRESENCA e RESPONSAVEL na tabela CP_HISTORICO_ABS
// WHERE IDGROOT = X AND DATA_ABS = Y
function atualizarStatusHistorico(idgroot, dataStr, novoStatus) {
  try {
    const token = getTokenBigQuery();
    const email = getUsuarioEmail();

    const query = `
      UPDATE \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
      SET STATUS_PRESENCA = '${escaparAspas(novoStatus)}',
          RESPONSAVEL = '${email}'
      WHERE IDGROOT = ${parseInt(idgroot)}
        AND DATA_ABS = DATE('${dataStr}')
    `;

    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;
    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false })
    };

    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result = JSON.parse(response.getContentText());

    if (result.error) throw new Error(result.error.message);

    Logger.log('Status atualizado: IDGROOT=' + idgroot + ', DATA=' + dataStr + ', STATUS=' + novoStatus);
    return { success: true, message: 'Status atualizado com sucesso' };

  } catch (error) {
    Logger.log('Erro ao atualizar status: ' + error.toString());
    return { success: false, message: error.toString() };
  }
}

// ── Helper: buscar e cachear IDGROOTs de cargos INCLUÍDOS (whitelist) ──────────
// Substitui getIdgrootsExcluidosFlow_ (blacklist) — agora retorna IDs a INCLUIR.
// Cache de 6h — mesma duração do cache geral de colaboradores.
function getIdgrootsIncluidosFlow_() {
  const CACHE_KEY = 'idgroots_incluidos_flow';
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get(CACHE_KEY);
    if (cached) {
      const ids = JSON.parse(cached);
      Logger.log('getIdgrootsIncluidosFlow_: cache hit — ' + ids.length + ' IDs operacionais');
      return ids;
    }
  } catch (e) { /* ignora falha de cache */ }

  const cargosIncl = (typeof CARGOS_INCLUIDOS !== 'undefined' && CARGOS_INCLUIDOS.length > 0)
                     ? CARGOS_INCLUIDOS
                     : ['Representante de Envio 1','Representante de Envio 2','Representante de Envio 3',
                        'Problem Solver','Operador Logistico 1','Operador Logistico 2',
                        'Sr Team Leader - Shipping'];
  const cargosIN = cargosIncl.map(a => `'${a.toUpperCase()}'`).join(', ');

  // Query leve — apenas IDs dos cargos whitelisted
  const query = `
    SELECT DISTINCT CAST(ID_GROOT AS STRING) AS id
    FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
    WHERE UPPER(TRIM(CARGO)) IN (${cargosIN})
      AND ID_GROOT IS NOT NULL
  `;

  try {
    const token = getTokenBigQuery();
    const res   = UrlFetchApp.fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`,
      {
        method: 'POST',
        contentType: 'application/json',
        headers: { 'Authorization': `Bearer ${token}` },
        payload: JSON.stringify({ query: query, useLegacySql: false, timeoutMs: 15000 }),
        muteHttpExceptions: true
      }
    );
    const result = JSON.parse(res.getContentText());
    if (result.error || !result.rows) {
      Logger.log('getIdgrootsIncluidosFlow_: erro ou sem linhas — ' + JSON.stringify(result.error || {}));
      return [];
    }
    const ids = result.rows.map(r => r.f[0].v).filter(Boolean);
    Logger.log('getIdgrootsIncluidosFlow_: ' + ids.length + ' IDGROOTs operacionais encontrados');
    try {
      CacheService.getScriptCache().put(CACHE_KEY, JSON.stringify(ids), CACHE_DURATION);
    } catch(e) { /* ignora se cache cheio */ }
    return ids;
  } catch (e) {
    Logger.log('getIdgrootsIncluidosFlow_: exceção — ' + e.toString());
    // Falha segura: prefere mostrar vazio a exibir cargos gerenciais
    return [];
  }
}

// ── BigQuery Jobs API assíncrona (sem timeout) ───────────────────────────────
// Submete um job via /jobs, faz polling até DONE, retorna o objeto results.
// Elimina o problema de jobComplete=false do endpoint /queries síncrono.
function runBigQueryAsync_(query, maxResults) {
  const token   = getTokenBigQuery();
  const baseUrl = 'https://bigquery.googleapis.com/bigquery/v2/projects/' + PROJECT_ID;

  // 1. Criar o job
  const submitRes = UrlFetchApp.fetch(baseUrl + '/jobs', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    contentType: 'application/json',
    payload: JSON.stringify({
      configuration: { query: { query: query, useLegacySql: false } }
    }),
    muteHttpExceptions: true
  });
  const rawSubmit = submitRes.getContentText();
  if (rawSubmit.trimStart().startsWith('<')) {
    throw new Error('BigQuery retornou HTML ao criar job (HTTP ' + submitRes.getResponseCode() + '). Verifique credenciais.');
  }
  const job = JSON.parse(rawSubmit);

  if (!job.jobReference || !job.jobReference.jobId) {
    const msg = (job.error && job.error.message) || rawSubmit;
    throw new Error('Erro ao criar job BigQuery: ' + msg);
  }

  const jobId   = job.jobReference.jobId;
  const jobLoc  = (job.jobReference.location) || '';
  Logger.log('runBigQueryAsync_: jobId=' + jobId + ' — aguardando conclusão...');

  // 2. Polling até DONE (máx 5 minutos)
  const MAX_MS      = 300000;
  const POLL_MS     = 2000;
  const startTime   = new Date().getTime();
  let   jobDone     = false;

  while (!jobDone) {
    Utilities.sleep(POLL_MS);
    const elapsed = new Date().getTime() - startTime;
    if (elapsed > MAX_MS) throw new Error('BigQuery job timeout após ' + Math.round(elapsed / 1000) + 's.');

    const locParam  = jobLoc ? '?location=' + jobLoc : '';
    const statusRes = UrlFetchApp.fetch(baseUrl + '/jobs/' + jobId + locParam, {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    const rawStatus = statusRes.getContentText();
    if (rawStatus.trimStart().startsWith('<')) throw new Error('BigQuery status retornou HTML (HTTP ' + statusRes.getResponseCode() + ').');
    const status = JSON.parse(rawStatus);

    if (status.status && status.status.state === 'DONE') {
      if (status.status.errorResult) {
        throw new Error('BigQuery job falhou: ' + status.status.errorResult.message);
      }
      jobDone = true;
      Logger.log('runBigQueryAsync_: DONE em ' + Math.round(elapsed / 1000) + 's');
    }
  }

  // 3. Buscar resultados via jobs.getQueryResults (/queries/{jobId})
  //    NOTA: o endpoint correto é /queries/{jobId}, NÃO /jobs/{jobId}/queryResults
  const locParam   = jobLoc ? '&location=' + jobLoc : '';
  const resultsRes = UrlFetchApp.fetch(
    baseUrl + '/queries/' + jobId + '?maxResults=' + (maxResults || 25000) + locParam,
    { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
  );
  const rawResults = resultsRes.getContentText();
  if (rawResults.trimStart().startsWith('<')) throw new Error('BigQuery results retornou HTML (HTTP ' + resultsRes.getResponseCode() + ').');
  const results = JSON.parse(rawResults);
  if (results.error) throw new Error('Erro ao buscar resultados: ' + (results.error.message || JSON.stringify(results.error)));
  return results;
}

// ── Carregar apenas um dia específico (rápido, sincronizado) ─────────────────
// Usado na Fase 1 do carregamento em 2 etapas do Flow:
//   Fase 1 → getFlowDataDia(hoje)  — rápido, mostra AO VIVO imediatamente
//   Fase 2 → getFlowData(mes, ano) — mais lento, atualiza o calendário
function getFlowDataDia(data) {
  try {
    const areasExcl  = (typeof AREAS_EXCLUIDAS !== 'undefined' && AREAS_EXCLUIDAS.length > 0)
                       ? AREAS_EXCLUIDAS
                       : ['Safety','Flow','Treinamento','Plant Engineering','Line Haul','People','Staff','Customer','Operations','Software','Loss Prevention'];
    const areasNOTIN = areasExcl.map(a => `'${a.toUpperCase()}'`).join(', ');

    const includedIds = getIdgrootsIncluidosFlow_();
    // Whitelist: exibe apenas IDGROOTs de cargos operacionais autorizados
    const idFilter    = includedIds.length > 0
      ? `AND CAST(h.IDGROOT AS STRING) IN (${includedIds.map(id => `'${id}'`).join(',')})`
      : 'AND 1 = 0'; // falha segura: sem IDs → mostra vazio em vez de dados gerenciais

    // DSR — filtra todas as escalas em folga no dia (via CP_ESCALAS_ROTATIVAS)
    const turmasHoje = getTurmasEmFolgaDia_(data);
    const dsrFilter  = turmasHoje.length > 0
      ? `AND UPPER(TRIM(COALESCE(c_dsr.ESCALA, ''))) NOT IN (${turmasHoje.map(t => `'${t}'`).join(', ')})`
      : ''; // sem escalas cadastradas → não filtra (seguro)

    // Query de um único dia — muito rápida independente do tamanho da tabela
    // LEFT JOIN com CP_LISTA_COLABORADORES (alias c_dsr) para filtro DSR (escala)
    const query = `
      SELECT
        h.COLABORADOR              AS colaborador,
        CAST(h.DATA_ABS AS STRING) AS data_abs,
        h.STATUS_PRESENCA          AS status_presenca,
        CAST(h.CLOCK_IN AS STRING) AS clock_in,
        h.AREA                     AS area,
        h.SETOR                    AS setor,
        h.TURNO                    AS turno,
        h.GESTOR                   AS gestor,
        CAST(h.IDGROOT AS STRING)  AS idgroot
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\` h
      LEFT JOIN \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\` c_dsr
        ON CAST(h.IDGROOT AS INT64) = CAST(c_dsr.ID_GROOT AS INT64)
      WHERE h.DATA_ABS = DATE '${data}'
        AND (h.AREA IS NULL OR UPPER(h.AREA) NOT IN (${areasNOTIN}))
        ${idFilter}
        ${dsrFilter}
      LIMIT 5000
    `;

    const token      = getTokenBigQuery();
    const apiEndpoint = 'https://bigquery.googleapis.com/bigquery/v2/projects/' + PROJECT_ID + '/queries';

    const response = UrlFetchApp.fetch(apiEndpoint, {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ query: query, useLegacySql: false, timeoutMs: 30000, maxResults: 5000 }),
      muteHttpExceptions: true
    });
    const rawDia = response.getContentText();
    if (rawDia.trimStart().startsWith('<')) {
      throw new Error('BigQuery retornou HTML (HTTP ' + response.getResponseCode() + '). Verifique credenciais e PROJECT_ID.');
    }
    const result = JSON.parse(rawDia);

    if (result.error)          throw new Error(result.error.message);
    if (result.jobComplete === false) {
      // Fallback: usar Jobs API assíncrona se o dia único ainda for lento
      Logger.log('getFlowDataDia: sincronizado timeout para ' + data + ' — usando async');
      const asyncResult = runBigQueryAsync_(query, 5000);
      if (!asyncResult.rows) return [];
      return asyncResult.rows.map(row => {
        const obj = {};
        asyncResult.schema.fields.forEach((f, i) => { obj[f.name.toLowerCase()] = row.f[i].v; });
        return obj;
      });
    }
    if (!result.rows) return [];

    Logger.log('getFlowDataDia(' + data + '): ' + result.rows.length + ' registros');
    return result.rows.map(row => {
      const obj = {};
      result.schema.fields.forEach((f, i) => { obj[f.name.toLowerCase()] = row.f[i].v; });
      return obj;
    });

  } catch (e) {
    Logger.log('Erro getFlowDataDia: ' + e.toString());
    throw e;
  }
}

// ── Carregar o mês completo ────────────────────────────────────────────────────
// Tenta endpoint síncrono (timeoutMs:30000) primeiro — mais rápido para a maioria
// dos meses. Só cai no Jobs API assíncrono se o resultado não vier em 30s.
function getFlowData(mes, ano) {
  try {
    const mesNum = Number(mes);
    const anoNum = Number(ano);

    const mesProx = mesNum === 12 ? 1  : mesNum + 1;
    const anoProx = mesNum === 12 ? anoNum + 1 : anoNum;
    const dataIni = `${anoNum}-${String(mesNum).padStart(2,'0')}-01`;
    const dataFim = `${anoProx}-${String(mesProx).padStart(2,'0')}-01`;

    const areasExcl  = (typeof AREAS_EXCLUIDAS !== 'undefined' && AREAS_EXCLUIDAS.length > 0)
                       ? AREAS_EXCLUIDAS
                       : ['Safety','Flow','Treinamento','Plant Engineering','Line Haul','People','Staff','Customer','Operations','Software','Loss Prevention'];
    const areasNOTIN = areasExcl.map(a => `'${a.toUpperCase()}'`).join(', ');

    // Whitelist — mesma lógica de getFlowDataDia (migrado de blacklist NOT IN)
    const includedIds = getIdgrootsIncluidosFlow_();
    const idFilter    = includedIds.length > 0
      ? `AND CAST(IDGROOT AS STRING) IN (${includedIds.map(id => `'${id}'`).join(',')})`
      : 'AND 1 = 0'; // falha segura: sem IDs → mostra vazio

    const query = `
      SELECT
        COLABORADOR              AS colaborador,
        CAST(DATA_ABS AS STRING) AS data_abs,
        STATUS_PRESENCA          AS status_presenca,
        CAST(CLOCK_IN AS STRING) AS clock_in,
        AREA                     AS area,
        SETOR                    AS setor,
        TURNO                    AS turno,
        GESTOR                   AS gestor,
        CAST(IDGROOT AS STRING)  AS idgroot
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
      WHERE DATA_ABS >= DATE '${dataIni}'
        AND DATA_ABS <  DATE '${dataFim}'
        AND (AREA IS NULL OR UPPER(AREA) NOT IN (${areasNOTIN}))
        ${idFilter}
      LIMIT 25000
    `;

    // ── Fase rápida: endpoint síncrono com 30s de timeout ────────────
    const token      = getTokenBigQuery();
    const apiEndpoint = 'https://bigquery.googleapis.com/bigquery/v2/projects/' + PROJECT_ID + '/queries';

    Logger.log('getFlowData: tentando endpoint síncrono para ' + mes + '/' + ano);
    const syncRes = UrlFetchApp.fetch(apiEndpoint, {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ query: query, useLegacySql: false, timeoutMs: 30000, maxResults: 25000 }),
      muteHttpExceptions: true
    });

    const rawSync = syncRes.getContentText();
    if (rawSync.trimStart().startsWith('<')) {
      throw new Error('BigQuery retornou HTML (HTTP ' + syncRes.getResponseCode() + ').');
    }
    const syncResult = JSON.parse(rawSync);

    if (syncResult.error) throw new Error(syncResult.error.message);

    // Retornou dentro de 30s — usa direto
    if (syncResult.jobComplete !== false) {
      if (!syncResult.rows || syncResult.rows.length === 0) return [];
      Logger.log('getFlowData (sync): ' + syncResult.rows.length + ' registros para ' + mes + '/' + ano);
      return syncResult.rows.map(row => {
        const obj = {};
        syncResult.schema.fields.forEach((f, i) => { obj[f.name.toLowerCase()] = row.f[i].v; });
        return obj;
      });
    }

    // ── Fallback: Jobs API assíncrona se sync não completou em 30s ────
    Logger.log('getFlowData: sync timeout — usando Jobs API assíncrona para ' + mes + '/' + ano);
    const asyncResult = runBigQueryAsync_(query, 25000);

    if (!asyncResult.rows || asyncResult.rows.length === 0) return [];

    Logger.log('getFlowData (async): ' + asyncResult.rows.length + ' registros para ' + mes + '/' + ano);
    return asyncResult.rows.map(row => {
      const obj = {};
      asyncResult.schema.fields.forEach((f, i) => { obj[f.name.toLowerCase()] = row.f[i].v; });
      return obj;
    });

  } catch (error) {
    Logger.log('Erro getFlowData: ' + error.toString());
    throw error;
  }
}

// SELECT DISTINCT GESTOR para Mapa de Presença (apenas ano atual)
function getGestoresMapaPresenca() {
  try {
    const anoAtual = new Date().getFullYear();

    const query = `
      SELECT DISTINCT GESTOR
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
      WHERE GESTOR IS NOT NULL
        AND GESTOR != ''
        AND EXTRACT(YEAR FROM DATA_ABS) = ${anoAtual}
      ORDER BY GESTOR
    `;

    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;

    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false }),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result = JSON.parse(response.getContentText());

    if (result.error) {
      Logger.log('Erro ao buscar gestores: ' + JSON.stringify(result.error));
      throw new Error(result.error.message);
    }

    if (!result.rows) return [];

    return result.rows.map(row => row.f[0].v);
  } catch (error) {
    Logger.log('Erro ao buscar gestores para mapa: ' + error.toString());
    throw error;
  }
}

// SELECT para Mapa de Presença
// Retorna colaborador, dia, status_abreviado para um gestor e mês/ano específicos
function getMapaPresenca(gestor, mes, ano) {
  try {
    const filtros = [];
    // CORREÇÃO: gerarFiltrosCargoSetor removido — CP_HISTORICO_ABS não tem coluna CARGO
    // CORREÇÃO: removido filtro STATUS NOT IN (...) — coluna não existe; a coluna correta é STATUS_PRESENCA
    filtros.push(`GESTOR = '${escaparAspas(gestor)}'`);
    filtros.push(`EXTRACT(YEAR FROM DATA_ABS) = ${Number(ano)}`);
    filtros.push(`EXTRACT(MONTH FROM DATA_ABS) = ${Number(mes)}`);

    const query = `
      SELECT
        COLABORADOR as colaborador,
        EXTRACT(DAY FROM DATA_ABS) as dia,
        STATUS_PRESENCA as status_abreviado
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
      WHERE ${filtros.join(' AND ')}
      ORDER BY COLABORADOR, DATA_ABS
    `;

    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;

    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false }),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result = JSON.parse(response.getContentText());

    if (result.error) {
      Logger.log('Erro na query Mapa de Presença: ' + JSON.stringify(result.error));
      throw new Error(result.error.message);
    }

    if (!result.rows) return [];

    const mapa = result.rows.map(row => {
      return {
        colaborador: row.f[0].v,
        dia: row.f[1].v,
        status_abreviado: row.f[2].v
      };
    });

    Logger.log('Mapa de Presença: ' + mapa.length + ' registros para ' + gestor + ' em ' + mes + '/' + ano);
    return mapa;

  } catch (error) {
    Logger.log('Erro ao buscar mapa de presença: ' + error.toString());
    throw error;
  }
}

// ── Taxa histórica de absenteísmo (últimos N dias) ────────────────────────────
//
// Calcula a % de faltas inesperadas sobre o total de registros operacionais.
// Denominador: registros com STATUS_PRESENCA preenchido, excluindo afastamentos
//   programados (DSR, AF - *, FE - *) que não representam absenteísmo real.
// Numerador  : registros com STATUS_PRESENCA = 'FI' ou que contenham 'FALTA'.
//
// Retorna: { taxa (0..1), faltas, total, diasCalculo }
function getTaxaAbsenteismoHistorico(diasHistorico) {
  try {
    const dias = Math.max(1, Math.min(parseInt(diasHistorico) || 30, 365));

    const query = `
      WITH base AS (
        SELECT UPPER(TRIM(STATUS_PRESENCA)) AS sp
        FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
        WHERE DATA_ABS >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL ${dias} DAY)
          AND DATA_ABS  <  CURRENT_DATE('America/Sao_Paulo')
          AND STATUS_PRESENCA IS NOT NULL
          AND TRIM(STATUS_PRESENCA) != ''
          AND TRIM(STATUS_PRESENCA) != 'VAZIO - Justificativa não encontrada'
          -- Exclui folgas de escala e afastamentos programados (não são absenteísmo)
          AND UPPER(TRIM(STATUS_PRESENCA)) NOT LIKE 'DSR%'
          AND UPPER(TRIM(STATUS_PRESENCA)) NOT LIKE 'AF -%'
          AND UPPER(TRIM(STATUS_PRESENCA)) NOT LIKE 'FE -%'
      )
      SELECT
        COUNT(*)                                              AS total,
        COUNTIF(sp = 'FI' OR sp LIKE '%FALTA%')              AS faltas
      FROM base
    `;

    const token       = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;
    const options = {
      method: 'POST', contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ query: query, useLegacySql: false, timeoutMs: 20000 }),
      muteHttpExceptions: true
    };

    const result = JSON.parse(UrlFetchApp.fetch(apiEndpoint, options).getContentText());

    if (result.error) {
      Logger.log('[getTaxaAbsenteismoHistorico] Erro BQ: ' + result.error.message);
      return { taxa: 0, faltas: 0, total: 0, diasCalculo: dias };
    }

    const row    = (result.rows || [])[0];
    const total  = row ? parseInt(row.f[0].v || '0') : 0;
    const faltas = row ? parseInt(row.f[1].v || '0') : 0;
    const taxa   = total > 0 ? faltas / total : 0;

    Logger.log('[getTaxaAbsenteismoHistorico] Últimos ' + dias + ' dias: ' +
      faltas + ' faltas / ' + total + ' total = ' + (taxa * 100).toFixed(2) + '%');

    return { taxa: taxa, faltas: faltas, total: total, diasCalculo: dias };

  } catch (e) {
    Logger.log('[getTaxaAbsenteismoHistorico] Exceção: ' + e.toString());
    return { taxa: 0, faltas: 0, total: 0, diasCalculo: diasHistorico || 30 };
  }
}

// Retorna registros dos últimos 30 dias com STATUS_PRESENCA nulo (pendentes de justificativa)
function getPendencias30Dias() {
  try {
    const areasExcl = (typeof AREAS_EXCLUIDAS !== 'undefined' && AREAS_EXCLUIDAS.length > 0)
                     ? AREAS_EXCLUIDAS
                     : ['Safety','Flow','Treinamento','Plant Engineering','Line Haul','People','Staff','Customer','Operations','Software','Loss Prevention'];
    const areasNOTIN = areasExcl.map(function(a) { return "'" + a.toUpperCase() + "'"; }).join(', ');

    const cargosIncl = (typeof CARGOS_INCLUIDOS !== 'undefined' && CARGOS_INCLUIDOS.length > 0)
                       ? CARGOS_INCLUIDOS
                       : ['Representante de Envio 1','Representante de Envio 2','Representante de Envio 3',
                          'Problem Solver','Operador Logistico 1','Operador Logistico 2',
                          'Sr Team Leader - Shipping'];
    const cargosIN = cargosIncl.map(function(a) { return "'" + a.toUpperCase() + "'"; }).join(', ');

    const query = `
      SELECT
        COLABORADOR, GESTOR, AREA, SETOR, TURNO,
        CAST(IDGROOT AS STRING) AS IDGROOT,
        FORMAT_DATE('%Y-%m-%d', DATA_ABS) AS DATA_ABS
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
      WHERE DATA_ABS >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY)
        AND DATA_ABS < CURRENT_DATE('America/Sao_Paulo')
        AND (STATUS_PRESENCA IS NULL OR TRIM(STATUS_PRESENCA) = '' OR TRIM(STATUS_PRESENCA) = 'VAZIO - Justificativa não encontrada')
        AND (AREA IS NULL OR UPPER(TRIM(AREA)) NOT IN (${areasNOTIN}))
        AND CAST(IDGROOT AS INT64) IN (
          SELECT CAST(ID_GROOT AS INT64)
          FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
          WHERE UPPER(TRIM(CARGO)) IN (${cargosIN})
            AND ID_GROOT IS NOT NULL
        )
      ORDER BY GESTOR, COLABORADOR, DATA_ABS DESC
      LIMIT 5000
    `;

    const token = getTokenBigQuery();
    const apiEndpoint = 'https://bigquery.googleapis.com/bigquery/v2/projects/' + PROJECT_ID + '/queries';

    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ query: query, useLegacySql: false, timeoutMs: 30000 }),
      muteHttpExceptions: true
    };

    let result = JSON.parse(UrlFetchApp.fetch(apiEndpoint, options).getContentText());

    if (result.error) {
      Logger.log('[getPendencias30Dias] Erro BQ: ' + result.error.message);
      return [];
    }

    // BQ não concluiu em 30s — usa Jobs API assíncrona para aguardar
    if (result.jobComplete === false) {
      Logger.log('[getPendencias30Dias] jobComplete=false — fallback para Jobs API assíncrona');
      result = runBigQueryAsync_(query, 5000);
    }

    if (!result.rows || result.rows.length === 0) return [];

    return result.rows.map(function(row) {
      var reg = {};
      result.schema.fields.forEach(function(field, i) {
        reg[field.name.toLowerCase()] = row.f[i].v;
      });
      return reg;
    });

  } catch (e) {
    Logger.log('[getPendencias30Dias] Exceção: ' + e.toString());
    throw e;
  }
}
