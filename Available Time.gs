// AVAILABLETIME.GS - Backend da página de available time

// Busca dados por período (dataInicio e dataFim)
function getAvailableTimeD1(filtros, dataInicio, dataFim) {
  try {
    const projectId = 'meli-sbox';
    
    // Se não foram passadas datas, usar últimos 7 dias como padrão
    if (!dataInicio || !dataFim) {
      const hoje = new Date();
      const seteDiasAtras = new Date();
      seteDiasAtras.setDate(hoje.getDate() - 7);
      dataInicio = Utilities.formatDate(seteDiasAtras, 'America/Sao_Paulo', 'yyyy-MM-dd');
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
      dataFim = Utilities.formatDate(ontem, 'America/Sao_Paulo', 'yyyy-MM-dd');
    }
    
    let whereClause = `WHERE DATA BETWEEN DATE('${dataInicio}') AND DATE('${dataFim}')`;
    
    // Aplicar filtros
    if (filtros) {
      if (filtros.turno && filtros.turno !== 'todos') {
        whereClause += ` AND TURNO = '${filtros.turno}'`;
      }
      if (filtros.setor && filtros.setor !== 'todos') {
        whereClause += ` AND SETOR = '${filtros.setor}'`;
      }
      if (filtros.area && filtros.area !== 'todos') {
        whereClause += ` AND AREA = '${filtros.area}'`;
      }
    }
    
    const query = `
      SELECT 
        DATA,
        COLABORADOR,
        SETOR,
        AREA,
        TURNO,
        GESTOR,
        TARGET_DURATION,
        NET_WORK_DURATION,
        AVAILABLE_TIME_HORAS,
        AVAILABLE_TIME_MINUTOS,
        PERCENTUAL_APROVEITAMENTO,
        MINUTOS_JUSTIFICADOS,
        JUSTIFICATIVA,
        DESCRICAO
      FROM \`meli-sbox.IDEABORNTOBEUAI.HISTORICO_AVAILABLE_TIME_BA01\`
      ${whereClause}
      ORDER BY DATA DESC, AVAILABLE_TIME_MINUTOS DESC
    `;
    
    Logger.log('Query Available Time (últimos 7 dias): ' + query);
    
    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`;
    
    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false })
    };
    
    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result = JSON.parse(response.getContentText());
    
    if (result.error) throw new Error(result.error.message);
    if (!result.rows || result.rows.length === 0) {
      Logger.log('Nenhum dado de Available Time encontrado para os últimos 7 dias');
      return [];
    }
    
    const results = result.rows.map(row => {
      const obj = {};
      result.schema.fields.forEach((field, index) => {
        obj[field.name.toLowerCase()] = row.f[index].v;
      });
      return obj;
    });
    
    Logger.log('Available Time (últimos 7 dias): ' + results.length + ' registros');
    return results;
    
  } catch (error) {
    Logger.log('ERRO getAvailableTimeD1: ' + error.toString());
    throw error;
  }
}

/**
 * Busca dados de Available Time para um período específico
 * @param {string} dataInicio - Data inicial (YYYY-MM-DD)
 * @param {string} dataFim - Data final (YYYY-MM-DD)
 * @param {Object} filtros - Filtros opcionais
 * @returns {Array} Lista de registros
 */
function getAvailableTimeHistorico(dataInicio, dataFim, filtros) {
  try {
    const projectId = 'meli-sbox';
    
    let whereClause = `WHERE DATA BETWEEN DATE('${dataInicio}') AND DATE('${dataFim}')`;
    
    if (filtros) {
      if (filtros.turno && filtros.turno !== 'todos') {
        whereClause += ` AND TURNO = '${filtros.turno}'`;
      }
      if (filtros.setor && filtros.setor !== 'todos') {
        whereClause += ` AND SETOR = '${filtros.setor}'`;
      }
      if (filtros.area && filtros.area !== 'todos') {
        whereClause += ` AND AREA = '${filtros.area}'`;
      }
      if (filtros.colaborador) {
        whereClause += ` AND UPPER(COLABORADOR) LIKE '%${filtros.colaborador.toUpperCase()}%'`;
      }
    }
    
    const query = `
      SELECT 
        DATA,
        COLABORADOR,
        SETOR,
        AREA,
        TURNO,
        GESTOR,
        TARGET_DURATION,
        NET_WORK_DURATION,
        AVAILABLE_TIME_HORAS,
        AVAILABLE_TIME_MINUTOS,
        PERCENTUAL_APROVEITAMENTO,
        MINUTOS_JUSTIFICADOS,
        JUSTIFICATIVA,
        DESCRICAO
      FROM \`meli-sbox.IDEABORNTOBEUAI.HISTORICO_AVAILABLE_TIME_BA01\`
      ${whereClause}
      ORDER BY DATA DESC, PERCENTUAL_APROVEITAMENTO ASC
      LIMIT 500
    `;
    
    Logger.log('Query Available Time Histórico: ' + query);
    
    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`;
    
    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false })
    };
    
    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result = JSON.parse(response.getContentText());
    
    if (result.error) throw new Error(result.error.message);
    if (!result.rows || result.rows.length === 0) {
      return [];
    }
    
    const results = result.rows.map(row => {
      const obj = {};
      result.schema.fields.forEach((field, index) => {
        obj[field.name.toLowerCase()] = row.f[index].v;
      });
      return obj;
    });
    
    return results;
    
  } catch (error) {
    Logger.log('ERRO getAvailableTimeHistorico: ' + error.toString());
    throw error;
  }
}

/**
 * Busca resumo/totalizadores de Available Time dos últimos 7 dias
 * @returns {Object} Resumo com totais por turno, setor, área
 */
function getAvailableTimeResumo() {
  try {
    const projectId = 'meli-sbox';
    
    // Últimos 7 dias (de hoje - 7 até hoje - 1)
    const hoje = new Date();
    const seteDiasAtras = new Date();
    seteDiasAtras.setDate(hoje.getDate() - 7);
    const dataInicio = Utilities.formatDate(seteDiasAtras, 'America/Sao_Paulo', 'yyyy-MM-dd');
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    const dataFim = Utilities.formatDate(ontem, 'America/Sao_Paulo', 'yyyy-MM-dd');
    
    const query = `
      SELECT 
        TURNO,
        SETOR,
        AREA,
        COUNT(*) AS total_colaboradores,
        ROUND(SUM(AVAILABLE_TIME_MINUTOS), 2) AS total_minutos_perdidos,
        ROUND(AVG(AVAILABLE_TIME_MINUTOS), 2) AS media_minutos,
        ROUND(AVG(PERCENTUAL_APROVEITAMENTO), 2) AS media_aproveitamento
      FROM \`meli-sbox.IDEABORNTOBEUAI.HISTORICO_AVAILABLE_TIME_BA01\`
      WHERE DATA BETWEEN DATE('${dataInicio}') AND DATE('${dataFim}')
      GROUP BY TURNO, SETOR, AREA
      ORDER BY total_minutos_perdidos DESC
    `;
    
    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`;
    
    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false })
    };
    
    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result = JSON.parse(response.getContentText());
    
    if (result.error) throw new Error(result.error.message);
    if (!result.rows || result.rows.length === 0) {
      return {
        dataInicio: dataInicio,
        dataFim: dataFim,
        porTurno: [],
        porSetor: [],
        porArea: [],
        total: 0
      };
    }
    
    const results = result.rows.map(row => {
      const obj = {};
      result.schema.fields.forEach((field, index) => {
        obj[field.name.toLowerCase()] = row.f[index].v;
      });
      return obj;
    });
    
    // Agrupa por turno
    const porTurno = {};
    const porSetor = {};
    const porArea = {};
    let totalGeral = 0;
    
    results.forEach(r => {
      const turno = r.turno || 'Sem Turno';
      const setor = r.setor || 'Sem Setor';
      const area = r.area || 'Sem Área';
      const minutos = parseFloat(r.total_minutos_perdidos) || 0;
      const qtd = parseInt(r.total_colaboradores) || 0;
      
      if (!porTurno[turno]) porTurno[turno] = { total: 0, qtd: 0 };
      porTurno[turno].total += minutos;
      porTurno[turno].qtd += qtd;
      
      if (!porSetor[setor]) porSetor[setor] = { total: 0, qtd: 0 };
      porSetor[setor].total += minutos;
      porSetor[setor].qtd += qtd;
      
      if (!porArea[area]) porArea[area] = { total: 0, qtd: 0 };
      porArea[area].total += minutos;
      porArea[area].qtd += qtd;
      
      totalGeral += minutos;
    });
    
    return {
      dataInicio: dataInicio,
      dataFim: dataFim,
      porTurno: Object.entries(porTurno).map(([k, v]) => ({ nome: k, ...v })),
      porSetor: Object.entries(porSetor).map(([k, v]) => ({ nome: k, ...v })),
      porArea: Object.entries(porArea).map(([k, v]) => ({ nome: k, ...v })),
      totalMinutos: Math.round(totalGeral),
      totalHoras: Math.round(totalGeral / 60 * 10) / 10
    };
    
  } catch (error) {
    Logger.log('ERRO getAvailableTimeResumo: ' + error.toString());
    throw error;
  }
}

/**
 * Busca lista de setores disponíveis
 */
function getSetoresAvailableTime() {
  try {
    const projectId = 'meli-sbox';
    
    const query = `
      SELECT DISTINCT SETOR
      FROM \`meli-sbox.IDEABORNTOBEUAI.HISTORICO_AVAILABLE_TIME_BA01\`
      WHERE SETOR IS NOT NULL
      ORDER BY SETOR
    `;
    
    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`;
    
    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false })
    };
    
    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result = JSON.parse(response.getContentText());
    
    if (result.error) throw new Error(result.error.message);
    if (!result.rows) return [];
    
    return result.rows.map(row => row.f[0].v);
    
  } catch (error) {
    Logger.log('ERRO getSetoresAvailableTime: ' + error.toString());
    return [];
  }
}

/**
 * Busca lista de áreas disponíveis
 */
function getAreasAvailableTime() {
  try {
    const projectId = 'meli-sbox';
    
    const query = `
      SELECT DISTINCT AREA
      FROM \`meli-sbox.IDEABORNTOBEUAI.HISTORICO_AVAILABLE_TIME_BA01\`
      WHERE AREA IS NOT NULL
      ORDER BY AREA
    `;
    
    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`;
    
    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false })
    };
    
    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result = JSON.parse(response.getContentText());
    
    if (result.error) throw new Error(result.error.message);
    if (!result.rows) return [];
    
    return result.rows.map(row => row.f[0].v);
    
  } catch (error) {
    Logger.log('ERRO getAreasAvailableTime: ' + error.toString());
    return [];
  }
}

/**
 * Busca lista de gestores disponíveis com total de pendentes (últimos 7 dias)
 */
function getGestoresAvailableTime() {
  try {
    const projectId = 'meli-sbox';
    
    // Últimos 7 dias (de hoje - 7 até hoje - 1)
    const hoje = new Date();
    const seteDiasAtras = new Date();
    seteDiasAtras.setDate(hoje.getDate() - 7);
    const dataInicio = Utilities.formatDate(seteDiasAtras, 'America/Sao_Paulo', 'yyyy-MM-dd');
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    const dataFim = Utilities.formatDate(ontem, 'America/Sao_Paulo', 'yyyy-MM-dd');
    
    const query = `
      SELECT 
        GESTOR,
        COUNT(*) AS total_pendentes
      FROM \`meli-sbox.IDEABORNTOBEUAI.HISTORICO_AVAILABLE_TIME_BA01\`
      WHERE DATA BETWEEN DATE('${dataInicio}') AND DATE('${dataFim}')
        AND GESTOR IS NOT NULL
        AND (MINUTOS_JUSTIFICADOS IS NULL OR COALESCE(MINUTOS_JUSTIFICADOS, 0) < AVAILABLE_TIME_MINUTOS)
      GROUP BY GESTOR
      ORDER BY GESTOR
    `;
    
    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`;
    
    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false })
    };
    
    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result = JSON.parse(response.getContentText());
    
    if (result.error) throw new Error(result.error.message);
    if (!result.rows) return [];
    
    return result.rows.map(row => {
      const obj = {};
      result.schema.fields.forEach((field, index) => {
        obj[field.name.toLowerCase()] = row.f[index].v;
      });
      return obj;
    });
    
  } catch (error) {
    Logger.log('ERRO getGestoresAvailableTime: ' + error.toString());
    return [];
  }
}

/**
 * Busca lista de colaboradores disponíveis (últimos 7 dias com pendência)
 */
function getColaboradoresAvailableTime() {
  try {
    const projectId = 'meli-sbox';
    
    // Últimos 7 dias (de hoje - 7 até hoje - 1)
    const hoje = new Date();
    const seteDiasAtras = new Date();
    seteDiasAtras.setDate(hoje.getDate() - 7);
    const dataInicio = Utilities.formatDate(seteDiasAtras, 'America/Sao_Paulo', 'yyyy-MM-dd');
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    const dataFim = Utilities.formatDate(ontem, 'America/Sao_Paulo', 'yyyy-MM-dd');
    
    const query = `
      SELECT DISTINCT COLABORADOR
      FROM \`meli-sbox.IDEABORNTOBEUAI.HISTORICO_AVAILABLE_TIME_BA01\`
      WHERE DATA BETWEEN DATE('${dataInicio}') AND DATE('${dataFim}')
        AND COLABORADOR IS NOT NULL
        AND (MINUTOS_JUSTIFICADOS IS NULL OR COALESCE(MINUTOS_JUSTIFICADOS, 0) < AVAILABLE_TIME_MINUTOS)
      ORDER BY COLABORADOR
    `;
    
    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`;
    
    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false })
    };
    
    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result = JSON.parse(response.getContentText());
    
    if (result.error) throw new Error(result.error.message);
    if (!result.rows) return [];
    
    return result.rows.map(row => row.f[0].v);
    
  } catch (error) {
    Logger.log('ERRO getColaboradoresAvailableTime: ' + error.toString());
    return [];
  }
}

/**
 * Atualiza justificativa de Available Time na mesma tabela
 * @param {Object} justificativa - {data, colaborador, minutosJustificados, justificativa, descricao}
 * @returns {Object} {sucesso: boolean, message: string}
 */
function salvarJustificativaAvailableTime(justificativa) {
  try {
    const projectId = 'meli-sbox';
    const email = getUsuarioEmail();
    
    const query = `
      UPDATE \`meli-sbox.IDEABORNTOBEUAI.HISTORICO_AVAILABLE_TIME_BA01\`
      SET 
        MINUTOS_JUSTIFICADOS = ${parseFloat(justificativa.minutosJustificados) || 0},
        JUSTIFICATIVA = '${escaparAspas(justificativa.justificativa)}',
        DESCRICAO = '${escaparAspas(justificativa.descricao || '')}',
        RESPONSAVEL = '${escaparAspas(email)}'
      WHERE DATA = DATE('${justificativa.data}')
        AND UPPER(COLABORADOR) = UPPER('${escaparAspas(justificativa.colaborador)}')
    `;
    
    Logger.log('Atualizando justificativa: ' + query);
    
    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`;
    
    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false })
    };
    
    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result = JSON.parse(response.getContentText());
    
    if (result.error) throw new Error(result.error.message);
    
    return { sucesso: true, message: 'Justificativa salva com sucesso' };
    
  } catch (error) {
    Logger.log('ERRO salvarJustificativaAvailableTime: ' + error.toString());
    return { sucesso: false, message: error.toString() };
  }
}

/**
 * Salva múltiplas justificativas usando MERGE (apenas quando não há descrição)
 * @param {Array} justificativas - Array de objetos {data, colaborador, minutosJustificados, justificativa}
 * @returns {Object} {sucesso: boolean, message: string, total: number}
 */
function salvarJustificativaAvailableTimeBatch(justificativas) {
  try {
    if (!justificativas || justificativas.length === 0) {
      return { sucesso: false, message: 'Nenhuma justificativa para salvar' };
    }
    
    const projectId = 'meli-sbox';
    const email = getUsuarioEmail();
    
    // Remove duplicatas mantendo o último de cada colaborador/data
    const registrosUnicos = {};
    justificativas.forEach(j => {
      const key = `${j.data}_${j.colaborador.toUpperCase()}`;
      registrosUnicos[key] = j;
    });
    const listaUnica = Object.values(registrosUnicos);
    
    // Monta os valores para o MERGE
    const valores = listaUnica.map(j => 
      `SELECT 
        DATE('${j.data}') AS DATA,
        UPPER('${escaparAspas(j.colaborador)}') AS COLABORADOR,
        ${parseFloat(j.minutosJustificados) || 0} AS MINUTOS_JUSTIFICADOS,
        '${escaparAspas(j.justificativa)}' AS JUSTIFICATIVA,
        '' AS DESCRICAO,
        '${escaparAspas(email)}' AS RESPONSAVEL`
    ).join(' UNION ALL ');
    
    const query = `
      MERGE INTO \`meli-sbox.IDEABORNTOBEUAI.HISTORICO_AVAILABLE_TIME_BA01\` AS T
      USING (${valores}) AS S
      ON T.DATA = S.DATA AND UPPER(T.COLABORADOR) = S.COLABORADOR
      WHEN MATCHED THEN
        UPDATE SET 
          MINUTOS_JUSTIFICADOS = S.MINUTOS_JUSTIFICADOS,
          JUSTIFICATIVA = S.JUSTIFICATIVA,
          DESCRICAO = S.DESCRICAO,
          RESPONSAVEL = S.RESPONSAVEL
    `;
    
    Logger.log('MERGE justificativas batch: ' + listaUnica.length + ' registros');
    
    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`;
    
    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false })
    };
    
    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result = JSON.parse(response.getContentText());
    
    if (result.error) throw new Error(result.error.message);
    
    Logger.log('Batch salvo com sucesso: ' + listaUnica.length + ' registros');
    return { sucesso: true, message: 'Justificativas salvas com sucesso', total: listaUnica.length };
    
  } catch (error) {
    Logger.log('ERRO salvarJustificativaAvailableTimeBatch: ' + error.toString());
    return { sucesso: false, message: error.toString() };
  }
}


