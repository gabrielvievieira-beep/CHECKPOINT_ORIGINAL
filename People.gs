// PEOPLE.GS
//
// CORREÇÕES APLICADAS:
//   - Base da query alterada para CP_LISTA_COLABORADORES (LEFT JOIN histórico).
//     Garante que TODOS os colaboradores ativos apareçam no People, mesmo os
//     que não têm registros em CP_HISTORICO_ABS (ex: cargos ADM, staff, analistas
//     cujo ETL não alimenta o histórico). Quem não tem histórico aparece com
//     dias_uteis=0 e percentual_presenteismo=null (exibido como "Sem dados").
//   - STATUS NULL e 'not_apply' excluídos do cálculo de dia_util.
//   - Agregação por COLABORADOR+IDGROOT evita duplicidade por área/setor.

// Calcula presenteísmo usando CP_LISTA_COLABORADORES como base (todos os ativos)
// com LEFT JOIN no histórico — sem exclusão de cargo, setor ou área.
function getPresenteismoPeriodo(dataInicio, dataFim, filtros) {
  try {
    // Filtros de UI aplicados na lista de colaboradores (fonte primária)
    const listaWhere = [`l.STATUS NOT IN ('Inativo', 'INATIVO')`];
    // Filtros de UI aplicados no histórico (fonte secundária)
    const histWhere  = [
      `DATA_ABS >= DATE('${dataInicio}')`,
      `DATA_ABS <= DATE('${dataFim}')`
    ];

    if (filtros) {
      if (filtros.turno && filtros.turno !== 'todos') {
        listaWhere.push(`l.TURNO = '${escaparAspas(filtros.turno)}'`);
      }
      if (filtros.setor && filtros.setor !== 'todos') {
        listaWhere.push(`UPPER(l.SETOR) = UPPER('${escaparAspas(filtros.setor)}')`);
      }
      if (filtros.area && filtros.area !== 'todos') {
        const af = filtros.area;
        if (af === 'ICQA') {
          listaWhere.push(`UPPER(l.AREA) IN ('ICQA','INVENTARIO','INVENTÁRIO','QUALIDADE')`);
        } else if (af === 'REVERSA') {
          listaWhere.push(`UPPER(l.AREA) IN ('REVERSA','RETIRO','RETIROS','RETURNS')`);
        } else {
          listaWhere.push(`UPPER(l.AREA) = UPPER('${escaparAspas(af)}')`);
        }
      }
      if (filtros.gestor && filtros.gestor !== 'todos') {
        listaWhere.push(`l.GESTOR = '${escaparAspas(filtros.gestor)}'`);
      }
      if (filtros.colaborador && filtros.colaborador !== 'todos') {
        listaWhere.push(`l.COLABORADOR = '${escaparAspas(filtros.colaborador)}'`);
      }
    }

    const listaWhereStr = listaWhere.join(' AND ');
    const histWhereStr  = histWhere.join(' AND ');

    const query = `
      -- CTE 1: todos os colaboradores ativos da lista (sem filtro de cargo/setor/area)
      WITH lista AS (
        SELECT
          CAST(ID_GROOT AS INT64)  AS IDGROOT,
          COLABORADOR,
          CARGO,
          CASE
            WHEN UPPER(AREA) IN ('INVENTARIO','INVENTÁRIO','QUALIDADE') THEN 'ICQA'
            WHEN UPPER(AREA) IN ('RETIRO','RETIROS','RETURNS')          THEN 'REVERSA'
            ELSE UPPER(AREA)
          END AS AREA,
          SETOR,
          TURNO,
          GESTOR
        FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\` AS l
        WHERE ${listaWhereStr}
      ),
      -- CTE 2: histórico do período com classificação de dia_util / dia_presente
      hist AS (
        SELECT
          IDGROOT,
          CASE
            WHEN STATUS_PRESENCA IS NULL                                       THEN 0
            WHEN STATUS_PRESENCA = 'VAZIO - Justificativa não encontrada'     THEN 0
            WHEN STATUS_PRESENCA LIKE 'DSR%'                                  THEN 0
            WHEN STATUS_PRESENCA LIKE 'FE%'    THEN 0
            WHEN STATUS_PRESENCA LIKE 'AF%'    THEN 0
            WHEN STATUS_PRESENCA LIKE 'FJ%'    THEN 0
            WHEN STATUS_PRESENCA LIKE 'BH%'    THEN 0
            WHEN STATUS_PRESENCA LIKE 'SIE%'   THEN 0
            WHEN STATUS_PRESENCA LIKE 'HCD%'   THEN 0
            WHEN STATUS_PRESENCA = 'not_apply' THEN 0
            ELSE 1
          END AS dia_util,
          CASE
            WHEN STATUS_PRESENCA LIKE 'P%'    THEN 1
            WHEN STATUS_PRESENCA = 'PRESENTE' THEN 1
            ELSE 0
          END AS dia_presente
        FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
        WHERE ${histWhereStr}
      ),
      -- CTE 3: agrega histórico por IDGROOT
      hist_agg AS (
        SELECT
          IDGROOT,
          SUM(dia_util)     AS dias_uteis,
          SUM(dia_presente) AS dias_presentes
        FROM hist
        GROUP BY IDGROOT
      )
      -- JOIN: todos os ativos da lista, com dados de histórico quando existirem
      SELECT
        l.COLABORADOR,
        l.IDGROOT,
        l.SETOR,
        l.AREA,
        l.TURNO,
        l.GESTOR,
        l.CARGO,
        COALESCE(h.dias_uteis,     0) AS dias_uteis,
        COALESCE(h.dias_presentes, 0) AS dias_presentes,
        COALESCE(h.dias_uteis, 0) - COALESCE(h.dias_presentes, 0) AS dias_faltas,
        CASE
          WHEN COALESCE(h.dias_uteis, 0) > 0
          THEN ROUND(SAFE_DIVIDE(h.dias_presentes, h.dias_uteis) * 100, 2)
          ELSE NULL
        END AS percentual_presenteismo
      FROM lista l
      LEFT JOIN hist_agg h ON h.IDGROOT = l.IDGROOT
      ORDER BY percentual_presenteismo ASC NULLS LAST, dias_faltas DESC
    `;

    Logger.log('Query Presenteísmo: ' + query);

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
    const result   = JSON.parse(response.getContentText());

    if (result.error) {
      Logger.log('Erro na query Presenteísmo: ' + JSON.stringify(result.error));
      throw new Error(result.error.message);
    }

    if (!result.rows || result.rows.length === 0) {
      Logger.log('Nenhum dado de presenteísmo encontrado');
      return [];
    }

    const schema = result.schema.fields;
    const results = result.rows.map(row => {
      const obj = {};
      row.f.forEach((cell, index) => {
        obj[schema[index].name.toLowerCase()] = cell.v;
      });
      return obj;
    });

    Logger.log('Presenteísmo: ' + results.length + ' registros');
    return results;

  } catch (error) {
    Logger.log('Erro ao buscar presenteísmo: ' + error.toString());
    throw error;
  }
}

// SELECT DISTINCT SETOR da tabela CP_HISTORICO_ABS
function getSetoresPeople() {
  try {
    const query = `
      SELECT DISTINCT SETOR
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
      WHERE SETOR IS NOT NULL
      ORDER BY SETOR
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
    const result   = JSON.parse(response.getContentText());

    if (result.error) { Logger.log('Erro ao buscar setores: ' + JSON.stringify(result.error)); return []; }
    if (!result.rows) return [];

    return result.rows.map(row => row.f[0].v);
  } catch (error) {
    Logger.log('Erro ao buscar setores: ' + error.toString());
    return [];
  }
}

// SELECT DISTINCT AREA normalizada da tabela CP_HISTORICO_ABS
function getAreasPeople() {
  try {
    const query = `
      SELECT DISTINCT
        CASE
          WHEN UPPER(AREA) IN ('INVENTARIO', 'INVENTÁRIO', 'QUALIDADE') THEN 'ICQA'
          WHEN UPPER(AREA) IN ('RETIRO', 'RETIROS', 'RETURNS') THEN 'REVERSA'
          ELSE UPPER(AREA)
        END AS AREA
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
      WHERE AREA IS NOT NULL
      ORDER BY AREA
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
    const result   = JSON.parse(response.getContentText());

    if (result.error) { Logger.log('Erro ao buscar áreas: ' + JSON.stringify(result.error)); return []; }
    if (!result.rows) return [];

    return [...new Set(result.rows.map(row => row.f[0].v))];
  } catch (error) {
    Logger.log('Erro ao buscar áreas: ' + error.toString());
    return [];
  }
}

// SELECT DISTINCT GESTOR da tabela CP_HISTORICO_ABS
function getGestoresPeople() {
  try {
    const query = `
      SELECT DISTINCT GESTOR
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
      WHERE GESTOR IS NOT NULL
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
    const result   = JSON.parse(response.getContentText());

    if (result.error) { Logger.log('Erro ao buscar gestores: ' + JSON.stringify(result.error)); return []; }
    if (!result.rows) return [];

    return result.rows.map(row => row.f[0].v);
  } catch (error) {
    Logger.log('Erro ao buscar gestores: ' + error.toString());
    return [];
  }
}

// SELECT DISTINCT TURNO da tabela CP_HISTORICO_ABS
function getTurnosPeople() {
  try {
    const query = `
      SELECT DISTINCT TURNO
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
      WHERE TURNO IS NOT NULL
      ORDER BY TURNO
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
    const result   = JSON.parse(response.getContentText());

    if (result.error) { Logger.log('Erro ao buscar turnos: ' + JSON.stringify(result.error)); return []; }
    if (!result.rows) return [];

    return result.rows.map(row => row.f[0].v);
  } catch (error) {
    Logger.log('Erro ao buscar turnos: ' + error.toString());
    return [];
  }
}

// SELECT DISTINCT COLABORADOR da tabela CP_HISTORICO_ABS
function getColaboradoresPeople() {
  try {
    const query = `
      SELECT DISTINCT COLABORADOR
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
      WHERE COLABORADOR IS NOT NULL
      ORDER BY COLABORADOR
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
    const result   = JSON.parse(response.getContentText());

    if (result.error) { Logger.log('Erro ao buscar colaboradores: ' + JSON.stringify(result.error)); return []; }
    if (!result.rows || result.rows.length === 0) return [];

    return result.rows.map(row => row.f[0].v);
  } catch (error) {
    Logger.log('Erro ao buscar colaboradores para People: ' + error.toString());
    return [];
  }
}
