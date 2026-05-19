// AUSENCIA.GS — Funções da página de Ausências Programadas
//
// SCHEMA CP_AUSENCIAS_PROGRAMADAS (schema real do BigQuery):
//   DATA           DATE      ← data de referência para chave (= DATA_INICIO)
//   IDGROOT        INTEGER
//   CHAVE          INTEGER   ← formato DDMMYY (de DATA_INICIO) + IDGROOT
//   COLABORADOR    STRING
//   GESTOR         STRING
//   ESCALA         STRING    ← turno/escala do colaborador
//   JUSTIFICATIVA  STRING
//   DATA_INICIO    DATE
//   DATA_FIM       DATE
//   RESPONSAVEL    STRING    ← email de quem cadastrou
//   PROGRAMADO_EM  DATE      ← data do cadastro
//   CAD            STRING    ← nome do CAD responsável

/**
 * Buscar colaboradores ativos para autocomplete
 * Retorna: id_groot, colaborador, gestor, turno (usado como ESCALA)
 */
function getColaboradoresAusencia() {
  try {
    const query = `
      SELECT ID_GROOT, COLABORADOR, GESTOR, TURNO
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE STATUS NOT IN ('Inativo', 'INATIVO')
        AND COLABORADOR IS NOT NULL
        AND ID_GROOT IS NOT NULL
        AND UPPER(CARGO) NOT IN ('SUPERVISOR','GERENTE','ANALISTA','ANALISTA SEMI SENIOR','COORDINATOR','ASSISTENTE','GERENTE SENIOR','ANALISTA SENIOR','ANALISTA SSR','ANALISTA SR','ASSITANT','ANALISTA JR','GERENTE SR','ANALIST','ANALISTA - IT','ANALISTA SEMI SENIOR - IT','ASISTENTE','ASISTENTE - IT','COORDINATOR - SHIPPING','DIRECTOR','LÍDER DE PROJETO - IT','SPECIALIST','SPECIALIST SADM')
        AND UPPER(SETOR) NOT IN ('TREINAMENTO','STAFF','FLOW','PEOPLE','LINE HAUL','PLANT ENGINEERING')
      ORDER BY COLABORADOR
    `;

    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;
    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false, location: BQ_LOCATION })
    };

    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result   = JSON.parse(response.getContentText());

    if (result.error) throw new Error(result.error.message);
    if (!result.rows) return [];

    return result.rows.map(row => {
      const obj = {};
      result.schema.fields.forEach((field, i) => { obj[field.name.toLowerCase()] = row.f[i].v; });
      return obj;
    });
  } catch (error) {
    Logger.log('Erro ao buscar colaboradores para ausencia: ' + error.toString());
    throw error;
  }
}

/**
 * Buscar ausencias registradas, com filtro opcional de mes/ano
 */
function getAusencias(mes, ano) {
  try {
    const filtros = [];

    if (mes && ano) {
      filtros.push(`(DATA_INICIO <= DATE(${Number(ano)}, ${Number(mes)}, 28) AND DATA_FIM >= DATE(${Number(ano)}, ${Number(mes)}, 1))`);
    }

    let query = `
      SELECT *
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_AUSENCIAS}\`
    `;
    if (filtros.length > 0) {
      query += ' WHERE ' + filtros.join(' AND ');
    }
    query += ` ORDER BY DATA_INICIO DESC, COLABORADOR`;

    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;
    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false, location: BQ_LOCATION })
    };

    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result   = JSON.parse(response.getContentText());

    // Tabela ainda não existe → retorna vazio sem crashar
    if (result.error) {
      const msg = result.error.message || '';
      if (msg.includes('Not found') || msg.includes('404')) {
        Logger.log('Tabela CP_AUSENCIAS_PROGRAMADAS ainda nao existe. Retornando vazio.');
        return [];
      }
      throw new Error(msg);
    }
    if (!result.rows) return [];

    return result.rows.map(row => {
      const obj = {};
      result.schema.fields.forEach((field, i) => { obj[field.name.toLowerCase()] = row.f[i].v; });
      return obj;
    });
  } catch (error) {
    Logger.log('Erro ao buscar ausencias: ' + error.toString());
    // Se tabela nao existe, nao propaga o erro — apenas retorna vazio
    if (error.toString().includes('Not found') || error.toString().includes('404')) return [];
    throw error;
  }
}

/**
 * Salvar nova ausencia programada
 * @param {Object} dados - { idgroot, colaborador, gestor, escala, justificativa, dataInicio, dataFim, cad }
 */
function salvarAusencia(dados) {
  try {
    if (!dados || !dados.idgroot || !dados.dataInicio || !dados.dataFim || !dados.justificativa) {
      return { success: false, message: 'Campos obrigatorios ausentes: colaborador, justificativa, data inicio e data fim.' };
    }

    const token    = getTokenBigQuery();
    const email    = getUsuarioEmail();
    const agora    = new Date();
    const hoje     = Utilities.formatDate(agora, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const idgroot  = parseInt(String(dados.idgroot));

    // CHAVE = DDMMYY (de DATA_INICIO) + IDGROOT  — mesmo padrão de CP_HISTORICO_ABS
    const dataRef  = new Date(dados.dataInicio + 'T00:00:00');
    const ddmmyy   = Utilities.formatDate(dataRef, Session.getScriptTimeZone(), 'ddMMyy');
    const chave    = parseInt(`${ddmmyy}${idgroot}`);

    const query = `
      INSERT INTO \`${PROJECT_ID}.${DATASET_ID}.${TABLE_AUSENCIAS}\`
        (DATA, IDGROOT, CHAVE, COLABORADOR, GESTOR, ESCALA,
         JUSTIFICATIVA, DATA_INICIO, DATA_FIM, RESPONSAVEL, PROGRAMADO_EM, CAD)
      VALUES (
        DATE '${dados.dataInicio}',
        ${idgroot},
        ${chave},
        '${escaparAspas(dados.colaborador   || '')}',
        '${escaparAspas(dados.gestor        || '')}',
        '${escaparAspas(dados.escala        || '')}',
        '${escaparAspas(dados.justificativa)}',
        DATE '${dados.dataInicio}',
        DATE '${dados.dataFim}',
        '${email}',
        DATE '${hoje}',
        '${escaparAspas(dados.cad           || email)}'
      )
    `;

    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;
    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false, location: BQ_LOCATION })
    };

    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result   = JSON.parse(response.getContentText());

    if (result.error) throw new Error(result.error.message);

    Logger.log('Ausencia salva: IDGROOT=' + idgroot + ', CHAVE=' + chave + ', ' + dados.dataInicio + ' a ' + dados.dataFim);

    // ── Reconciliação retroativa ──────────────────────────────────────────────
    // Atualiza CP_HISTORICO_ABS para datas passadas cobertas pela ausência.
    //
    // REGRA: a reconciliação só roda para EXCEÇÕES (justificativas que excluem o
    // colaborador do HC efetivo e do %ABS no Flow):
    //   • AF - *  (Afastado INSS, Licença Maternidade, Ext. Lic. Maternidade)
    //   • FE - *  (Férias)
    //   • DSR - * (Fora de Escala)
    //   • FJ - Atestado  (somente este FJ)
    //
    // Demais justificativas (FJ outros, BH, FR, AB, etc.) NÃO atualizam o histórico
    // para que o STATUS_PRESENCA original (FI = falta) continue refletindo no ABS.
    //
    const _justUpper = dados.justificativa.toUpperCase().trim();
    const _ehExcecao = _justUpper.startsWith('AF - ')  ||
                       _justUpper.startsWith('FE - ')  ||
                       _justUpper.startsWith('DSR - ') ||
                       _justUpper === 'FJ - ATESTADO';

    try {
      const dataFimReconcilia = dados.dataFim < hoje ? dados.dataFim : hoje;

      if (_ehExcecao && dados.dataInicio <= hoje) {
        const queryRec = `
          UPDATE \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
          SET STATUS_PRESENCA = '${escaparAspas(dados.justificativa)}'
          WHERE CAST(IDGROOT AS INT64) = ${idgroot}
            AND DATA_ABS BETWEEN DATE '${dados.dataInicio}' AND DATE '${dataFimReconcilia}'
            AND (STATUS_PRESENCA = 'FI'
                 OR STATUS_PRESENCA IS NULL
                 OR TRIM(STATUS_PRESENCA) = '')
        `;

        const optRec = {
          method: 'POST',
          contentType: 'application/json',
          headers: { 'Authorization': 'Bearer ' + token },
          payload: JSON.stringify({ query: queryRec, useLegacySql: false, location: BQ_LOCATION })
        };

        const resRec    = UrlFetchApp.fetch(apiEndpoint, optRec);
        const resultRec = JSON.parse(resRec.getContentText());

        if (resultRec.error) {
          Logger.log('[salvarAusencia] Reconciliação falhou (não crítico): ' + resultRec.error.message);
        } else {
          Logger.log('[salvarAusencia] Reconciliação OK — IDGROOT=' + idgroot +
            ' | ' + dados.dataInicio + ' a ' + dataFimReconcilia +
            ' | STATUS_PRESENCA → ' + dados.justificativa);
        }
      } else if (!_ehExcecao) {
        Logger.log('[salvarAusencia] Reconciliação ignorada (não é exceção) — justificativa="' + dados.justificativa + '" mantém FI/FALTA no histórico.');
      }
    } catch (errRec) {
      // Reconciliação é best-effort — falha silenciosa não cancela o save
      Logger.log('[salvarAusencia] Exceção na reconciliação: ' + errRec.toString());
    }

    return { success: true };

  } catch (error) {
    Logger.log('Erro ao salvar ausencia: ' + error.toString());
    return { success: false, message: error.toString() };
  }
}

/**
 * Retorna ausências programadas para uma data específica
 * Usado pelo painel de Previsão HC no Flow
 * @param {string} data  YYYY-MM-DD
 */
function getAusenciasProgramadasDia(data) {
  try {
    const query = `
      SELECT
        CAST(IDGROOT AS STRING)                   AS idgroot,
        COLABORADOR                               AS colaborador,
        GESTOR                                    AS gestor,
        ESCALA                                    AS escala,
        UPPER(TRIM(JUSTIFICATIVA))                AS justificativa,
        FORMAT_DATE('%d/%m/%Y', DATA_INICIO)      AS data_inicio,
        FORMAT_DATE('%d/%m/%Y', DATA_FIM)         AS data_fim
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_AUSENCIAS}\`
      WHERE DATE '${data}' BETWEEN DATA_INICIO AND DATA_FIM
      ORDER BY GESTOR, COLABORADOR
    `;

    const token      = getTokenBigQuery();
    const endpoint   = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;
    const options    = {
      method: 'POST', contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ query, useLegacySql: false, timeoutMs: 15000, location: BQ_LOCATION })
    };

    const result = JSON.parse(UrlFetchApp.fetch(endpoint, options).getContentText());

    if (result.error) {
      const msg = result.error.message || '';
      if (msg.includes('Not found') || msg.includes('404')) return [];
      throw new Error(msg);
    }
    if (!result.rows) return [];

    return result.rows.map(row => {
      const obj = {};
      result.schema.fields.forEach((f, i) => { obj[f.name.toLowerCase()] = row.f[i].v; });
      return obj;
    });
  } catch (e) {
    Logger.log('Erro getAusenciasProgramadasDia: ' + e.toString());
    if (e.toString().includes('Not found') || e.toString().includes('404')) return [];
    throw e;
  }
}

/**
 * Excluir ausencia pela CHAVE (INTEGER unico: DDMMYY + IDGROOT)
 * @param {number} chave
 */
function excluirAusencia(chave) {
  try {
    const token = getTokenBigQuery();

    const query = `
      DELETE FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_AUSENCIAS}\`
      WHERE CHAVE = ${parseInt(chave)}
    `;

    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;
    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false, location: BQ_LOCATION })
    };

    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result   = JSON.parse(response.getContentText());

    if (result.error) throw new Error(result.error.message);

    Logger.log('Ausencia excluida: CHAVE=' + chave);
    return { success: true };

  } catch (error) {
    Logger.log('Erro ao excluir ausencia: ' + error.toString());
    return { success: false, message: error.toString() };
  }
}
