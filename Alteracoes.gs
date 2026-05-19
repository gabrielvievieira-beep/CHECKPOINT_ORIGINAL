// ALTERACOES.GS

// INSERT na tabela SOLICITACOES_ALTERACOES_BA01
// Campos: IDGROOT, COLABORADOR, GESTOR, ESCALA, TIPO_ALTERACAO, NOVA_ESCALA, NOVO_GESTOR, DATA_DESLIGAMENTO, DESCRICAO, STATUS, DATA_SOLICITACAO, RESPONSAVEL
function salvarSolicitacaoAlteracao(solicitacao) {
  try {
    const token = getTokenBigQuery();
    const email = getUsuarioEmail();
    const agora = new Date();
    const dataAtual = Utilities.formatDate(agora, 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm:ss');
    
    const query = `
      INSERT INTO \`${PROJECT_ID}.${DATASET_ID}.SOLICITACOES_ALTERACOES_BA01\` 
      (IDGROOT, COLABORADOR, GESTOR, ESCALA, TIPO_ALTERACAO, NOVA_ESCALA, NOVO_GESTOR, DATA_DESLIGAMENTO, DESCRICAO, STATUS, DATA_SOLICITACAO, RESPONSAVEL)
      VALUES 
      (${solicitacao.colaboradorId}, '${escaparAspas(solicitacao.colaboradorNome)}', '${escaparAspas(solicitacao.gestor)}', 
       '${escaparAspas(solicitacao.escala)}', '${solicitacao.tipo}', 
       ${solicitacao.novaEscala ? "'" + escaparAspas(solicitacao.novaEscala) + "'" : 'NULL'}, 
       ${solicitacao.novoGestor ? "'" + escaparAspas(solicitacao.novoGestor) + "'" : 'NULL'}, 
       ${solicitacao.dataDesligamento ? "DATE('" + solicitacao.dataDesligamento + "')" : 'NULL'}, 
       ${solicitacao.descricao ? "'" + escaparAspas(solicitacao.descricao) + "'" : 'NULL'}, 'PENDENTE', '${dataAtual}', '${email}')
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
    
    Logger.log('Solicitação de alteração salva: ' + JSON.stringify(solicitacao));
    return { success: true, message: 'Solicitação enviada com sucesso' };
    
  } catch (error) {
    Logger.log('Erro ao salvar solicitação: ' + error.toString());
    return { success: false, message: error.toString() };
  }
}

// SELECT SOLICITACOES_ALTERACOES_BA01 onde STATUS = PENDENTE ou VALIDAR
function listarSolicitacoesAlteracao(filtros) {
  try {
    const token = getTokenBigQuery();
    
    const tipo = typeof filtros === 'object' ? filtros.tipo : filtros;
    const dataInicio = typeof filtros === 'object' ? filtros.dataInicio : null;
    const dataFim = typeof filtros === 'object' ? filtros.dataFim : null;
    
    let filtrosSQL = [];
    if (tipo && tipo !== 'todos') {
      filtrosSQL.push(`TIPO_ALTERACAO = '${tipo}'`);
    }
    if (dataInicio && dataInicio.length > 0) {
      filtrosSQL.push(`CAST(DATA_SOLICITACAO AS DATE) >= DATE('${dataInicio}')`);
    }
    if (dataFim && dataFim.length > 0) {
      filtrosSQL.push(`CAST(DATA_SOLICITACAO AS DATE) <= DATE('${dataFim}')`);
    }
    
    const filtroExtra = filtrosSQL.length > 0 ? 'AND ' + filtrosSQL.join(' AND ') : '';
    
    const query = `
      SELECT IDGROOT, COLABORADOR, GESTOR, ESCALA, TIPO_ALTERACAO, NOVA_ESCALA, NOVO_GESTOR,
             DATA_DESLIGAMENTO, DESCRICAO, STATUS, DATA_SOLICITACAO, DATA_RESOLVIDA, RESPONSAVEL, RESPONSAVEL_TRATATIVA
      FROM \`${PROJECT_ID}.${DATASET_ID}.SOLICITACOES_ALTERACOES_BA01\`
      WHERE STATUS IN ('PENDENTE', 'VALIDAR')
        ${filtroExtra}
      ORDER BY DATA_SOLICITACAO DESC
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
    if (!result.rows) return [];
    
    return result.rows.map(row => {
      const solicitacao = {};
      result.schema.fields.forEach((field, index) => {
        solicitacao[field.name.toLowerCase()] = row.f[index].v;
      });
      return solicitacao;
    });
    
  } catch (error) {
    Logger.log('Erro ao listar solicitações: ' + error.toString());
    return [];
  }
}

// SELECT SOLICITACOES_ALTERACOES_BA01 onde STATUS != PENDENTE e VALIDAR (histórico)
function listarSolicitacoesHistorico(filtros) {
  try {
    const token = getTokenBigQuery();
    
    const tipo = typeof filtros === 'object' ? filtros.tipo : filtros;
    const dataInicio = typeof filtros === 'object' ? filtros.dataInicio : null;
    const dataFim = typeof filtros === 'object' ? filtros.dataFim : null;
    
    let filtrosSQL = [];
    if (tipo && tipo !== 'todos') {
      filtrosSQL.push(`TIPO_ALTERACAO = '${tipo}'`);
    }
    if (dataInicio) {
      filtrosSQL.push(`CAST(DATA_RESOLVIDA AS DATE) >= DATE('${dataInicio}')`);
    }
    if (dataFim) {
      filtrosSQL.push(`CAST(DATA_RESOLVIDA AS DATE) <= DATE('${dataFim}')`);
    }
    
    const filtroExtra = filtrosSQL.length > 0 ? 'AND ' + filtrosSQL.join(' AND ') : '';
    
    const query = `
      SELECT IDGROOT, COLABORADOR, GESTOR, ESCALA, TIPO_ALTERACAO, NOVA_ESCALA, NOVO_GESTOR,
             DATA_DESLIGAMENTO, DESCRICAO, STATUS, DATA_SOLICITACAO, DATA_RESOLVIDA, RESPONSAVEL, RESPONSAVEL_TRATATIVA
      FROM \`${PROJECT_ID}.${DATASET_ID}.SOLICITACOES_ALTERACOES_BA01\`
      WHERE STATUS NOT IN ('PENDENTE', 'VALIDAR')
        ${filtroExtra}
      ORDER BY DATA_RESOLVIDA DESC
      LIMIT 50
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
    if (!result.rows) return [];
    
    return result.rows.map(row => {
      const solicitacao = {};
      result.schema.fields.forEach((field, index) => {
        solicitacao[field.name.toLowerCase()] = row.f[index].v;
      });
      return solicitacao;
    });
    
  } catch (error) {
    Logger.log('Erro ao listar histórico: ' + error.toString());
    return [];
  }
}

/**
 * Busca turno e setor de um gestor específico
 */
function getInfoGestor(nomeGestor) {
  try {
    const query = `
      SELECT DISTINCT TURNO, SETOR
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE COLABORADOR = '${escaparAspas(nomeGestor)}'
        AND STATUS NOT IN ('Inativo', 'INATIVO')
      LIMIT 1
    `;
    
    const token = getTokenBigQuery();
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
    if (!result.rows || result.rows.length === 0) {
      return { turno: null, setor: null };
    }
    
    const row = result.rows[0];
    const info = {};
    result.schema.fields.forEach((field, index) => {
      info[field.name.toLowerCase()] = row.f[index].v;
    });
    
    return { turno: info.turno || null, setor: info.setor || null };
    
  } catch (error) {
    Logger.log('Erro ao buscar informações do gestor: ' + error.toString());
    return { turno: null, setor: null };
  }
}

/**
 * Busca lista de gestores ativos
 */
function getGestoresAlteracoes() {
  try {
    const query = `
      SELECT DISTINCT GESTOR as nome
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE STATUS NOT IN ('Inativo', 'INATIVO')
        AND GESTOR IS NOT NULL
        AND TRIM(GESTOR) != ''
      ORDER BY GESTOR
    `;
    
    const token = getTokenBigQuery();
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
    if (!result.rows) return [];
    
    const gestores = result.rows.map(row => {
      return row.f[0].v; // Retorna apenas o nome
    });
    
    return gestores;
  } catch (error) {
    Logger.log('Erro ao buscar gestores: ' + error.toString());
    return [];
  }
}

/**
 * Busca lista de supervisores ativos
 */
function getSupervisores() {
  try {
    const query = `
      SELECT DISTINCT COLABORADOR as nome
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE STATUS NOT IN ('Inativo', 'INATIVO')
        AND (UPPER(CARGO) = 'SUPERVISOR' OR CARGO = 'Supervisor')
        AND COLABORADOR IS NOT NULL
        AND TRIM(COLABORADOR) != ''
      ORDER BY COLABORADOR
    `;
    
    const token = getTokenBigQuery();
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
    if (!result.rows) return [];
    
    const supervisores = result.rows.map(row => {
      return row.f[0].v; // Retorna apenas o nome
    });
    
    return supervisores;
  } catch (error) {
    Logger.log('Erro ao buscar supervisores: ' + error.toString());
    return [];
  }
}

/**
 * Busca lista de áreas únicas
 */
function getAreas() {
  try {
    const query = `
      SELECT DISTINCT AREA
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE STATUS NOT IN ('Inativo', 'INATIVO')
        AND AREA IS NOT NULL
        AND TRIM(AREA) != ''
      ORDER BY AREA
    `;
    
    const token = getTokenBigQuery();
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
    if (!result.rows) return [];
    
    const areas = result.rows.map(row => {
      return row.f[0].v;
    });
    
    return areas;
  } catch (error) {
    Logger.log('Erro ao buscar áreas: ' + error.toString());
    return [];
  }
}

/**
 * Busca lista de setores únicos
 */
function getSetores() {
  try {
    const query = `
      SELECT DISTINCT SETOR
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE STATUS NOT IN ('Inativo', 'INATIVO')
        AND SETOR IS NOT NULL
        AND TRIM(SETOR) != ''
      ORDER BY SETOR
    `;
    
    const token = getTokenBigQuery();
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
    if (!result.rows) return [];
    
    const setores = result.rows.map(row => {
      return row.f[0].v;
    });
    
    return setores;
  } catch (error) {
    Logger.log('Erro ao buscar setores: ' + error.toString());
    return [];
  }
}

/**
 * Busca lista de cargos únicos
 */
function getCargos() {
  try {
    const query = `
      SELECT DISTINCT CARGO
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE STATUS NOT IN ('Inativo', 'INATIVO')
        AND CARGO IS NOT NULL
        AND TRIM(CARGO) != ''
      ORDER BY CARGO
    `;
    
    const token = getTokenBigQuery();
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
    if (!result.rows) return [];
    
    const cargos = result.rows.map(row => {
      return row.f[0].v;
    });
    
    return cargos;
  } catch (error) {
    Logger.log('Erro ao buscar cargos: ' + error.toString());
    return [];
  }
}

/**
 * Busca lista de tipos de empresa únicos (TIPO)
 */
function getTiposEmpresa() {
  try {
    const query = `
      SELECT DISTINCT TIPO
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE STATUS NOT IN ('Inativo', 'INATIVO')
        AND TIPO IS NOT NULL
        AND TRIM(TIPO) != ''
      ORDER BY TIPO
    `;
    
    const token = getTokenBigQuery();
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
    if (!result.rows) return [];
    
    const tipos = result.rows.map(row => {
      return row.f[0].v;
    });
    
    return tipos;
  } catch (error) {
    Logger.log('Erro ao buscar tipos de empresa: ' + error.toString());
    return [];
  }
}

/**
 * Salvar batch de solicitações de alteração com MERGE
 */
function salvarSolicitacaoAlteracaoBatch(solicitacoes) {
  try {
    if (!solicitacoes || solicitacoes.length === 0) {
      return { success: false, message: 'Nenhuma solicitação para salvar' };
    }

    const token = getTokenBigQuery();
    const email = getUsuarioEmail();
    const agora = new Date();
    const dataAtual = Utilities.formatDate(agora, 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm:ss');
    
    // Monta os valores para o MERGE
    const valores = solicitacoes.map(s => {
      const novaEscala = s.novaEscala ? `CAST('${escaparAspas(s.novaEscala)}' AS STRING)` : 'CAST(NULL AS STRING)';
      const novoGestor = s.novoGestor ? `CAST('${escaparAspas(s.novoGestor)}' AS STRING)` : 'CAST(NULL AS STRING)';
      const dataDesligamento = s.dataDesligamento ? `DATE('${s.dataDesligamento}')` : 'CAST(NULL AS DATE)';
      const descricao = s.descricao ? `CAST('${escaparAspas(s.descricao)}' AS STRING)` : 'CAST(NULL AS STRING)';
      const gestor = s.gestor ? `'${escaparAspas(s.gestor)}'` : 'CAST(NULL AS STRING)';
      const escala = s.escala ? `'${escaparAspas(s.escala)}'` : 'CAST(NULL AS STRING)';
      
      return `SELECT CAST(${s.colaboradorId} AS INT64) AS IDGROOT, CAST('${escaparAspas(s.colaboradorNome)}' AS STRING) AS COLABORADOR, ${gestor} AS GESTOR, ${escala} AS ESCALA, CAST('${s.tipo}' AS STRING) AS TIPO_ALTERACAO, ${novaEscala} AS NOVA_ESCALA, ${novoGestor} AS NOVO_GESTOR, ${dataDesligamento} AS DATA_DESLIGAMENTO, ${descricao} AS DESCRICAO, CAST('PENDENTE' AS STRING) AS STATUS, TIMESTAMP('${dataAtual}') AS DATA_SOLICITACAO, CAST('${email}' AS STRING) AS RESPONSAVEL`;
    }).join(' UNION ALL ');
    
    const query = `
      MERGE INTO \`${PROJECT_ID}.${DATASET_ID}.SOLICITACOES_ALTERACOES_BA01\` AS T
      USING (${valores}) AS S
      ON T.IDGROOT = S.IDGROOT 
         AND T.TIPO_ALTERACAO = S.TIPO_ALTERACAO 
         AND T.STATUS = 'PENDENTE'
         AND CAST(T.DATA_SOLICITACAO AS DATE) = CURRENT_DATE("America/Sao_Paulo")
      WHEN NOT MATCHED THEN
        INSERT (IDGROOT, COLABORADOR, GESTOR, ESCALA, TIPO_ALTERACAO, NOVA_ESCALA, NOVO_GESTOR, DATA_DESLIGAMENTO, DESCRICAO, STATUS, DATA_SOLICITACAO, RESPONSAVEL)
        VALUES (S.IDGROOT, S.COLABORADOR, S.GESTOR, S.ESCALA, S.TIPO_ALTERACAO, S.NOVA_ESCALA, S.NOVO_GESTOR, S.DATA_DESLIGAMENTO, S.DESCRICAO, S.STATUS, S.DATA_SOLICITACAO, S.RESPONSAVEL)
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
    
    // Contar quantas foram realmente inseridas verificando os IDGROOTs enviados
    const idsEnviados = solicitacoes.map(s => s.colaboradorId).join(',');
    const queryCount = `
      SELECT COUNT(DISTINCT IDGROOT) as total_inseridas
      FROM \`${PROJECT_ID}.${DATASET_ID}.SOLICITACOES_ALTERACOES_BA01\`
      WHERE RESPONSAVEL = '${email}'
        AND CAST(DATA_SOLICITACAO AS DATE) = CURRENT_DATE("America/Sao_Paulo")
        AND STATUS = 'PENDENTE'
        AND TIPO_ALTERACAO = '${solicitacoes[0].tipo}'
        AND IDGROOT IN (${idsEnviados})
    `;
    
    const optionsCount = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: queryCount, useLegacySql: false })
    };
    
    let totalInseridas = solicitacoes.length;
    try {
      const responseCount = UrlFetchApp.fetch(apiEndpoint, optionsCount);
      const resultCount = JSON.parse(responseCount.getContentText());
      
      if (!resultCount.error && resultCount.rows && resultCount.rows.length > 0) {
        totalInseridas = parseInt(resultCount.rows[0].f[0].v);
      } else if (resultCount.error) {
        Logger.log('Erro ao contar inseridas: ' + resultCount.error.message);
        // Se der erro na contagem, assumir que todas foram inseridas (melhor que assumir 0)
      }
    } catch (e) {
      Logger.log('Erro ao contar inseridas: ' + e.toString());
      // Se der erro na contagem, assumir que todas foram inseridas
    }
    
    Logger.log('Batch processado: ' + solicitacoes.length + ' enviadas, ' + totalInseridas + ' inseridas');
    
    const bloqueadas = solicitacoes.length - totalInseridas;
    const mensagem = bloqueadas === 0
      ? `${totalInseridas} solicitações enviadas com sucesso!`
      : `${totalInseridas} de ${solicitacoes.length} solicitações inseridas. ${bloqueadas} já existiam (mesmo colaborador + tipo + status PENDENTE no mesmo dia).`;
    
    return { 
      success: true, 
      message: mensagem, 
      total: solicitacoes.length,
      inseridas: totalInseridas,
      bloqueadas: bloqueadas
    };
    
  } catch (error) {
    Logger.log('Erro ao salvar batch: ' + error.toString());
    return { success: false, message: error.toString() };
  }
}

// UPDATE STATUS na tabela SOLICITACOES_ALTERACOES_BA01
function atualizarStatusSolicitacao(idgroot, dataSolicitacao, novoStatus, motivo) {
  try {
    const token = getTokenBigQuery();
    const email = getUsuarioEmail();
    
    const statusEscapado = escaparAspas(novoStatus);
    const motivoEscapado = motivo ? escaparAspas(motivo) : null;
    
    let query;
    if (novoStatus.toUpperCase() === 'VALIDAR') {
      query = `
        UPDATE \`${PROJECT_ID}.${DATASET_ID}.SOLICITACOES_ALTERACOES_BA01\`
        SET STATUS = 'VALIDAR', DATA_RESOLVIDA = CURRENT_TIMESTAMP(), RESPONSAVEL_TRATATIVA = '${email}'
        WHERE IDGROOT = ${idgroot} AND STATUS = 'PENDENTE'
      `;
    } else if (novoStatus.toUpperCase() === 'CANCELADO') {
      if (motivoEscapado) {
        query = `
          UPDATE \`${PROJECT_ID}.${DATASET_ID}.SOLICITACOES_ALTERACOES_BA01\`
          SET STATUS = 'CANCELADO', DATA_RESOLVIDA = CURRENT_TIMESTAMP(), RESPONSAVEL_TRATATIVA = '${email}', DESCRICAO = '${motivoEscapado}'
          WHERE IDGROOT = ${idgroot} AND STATUS IN ('PENDENTE', 'VALIDAR')
        `;
      } else {
        query = `
          UPDATE \`${PROJECT_ID}.${DATASET_ID}.SOLICITACOES_ALTERACOES_BA01\`
          SET STATUS = 'CANCELADO', DATA_RESOLVIDA = CURRENT_TIMESTAMP(), RESPONSAVEL_TRATATIVA = '${email}'
          WHERE IDGROOT = ${idgroot} AND STATUS IN ('PENDENTE', 'VALIDAR')
        `;
      }
    } else if (novoStatus.toUpperCase() === 'CONCLUÍDO' || novoStatus.toUpperCase() === 'CONCLUIDO') {
      query = `
        UPDATE \`${PROJECT_ID}.${DATASET_ID}.SOLICITACOES_ALTERACOES_BA01\`
        SET STATUS = 'CONCLUÍDO', DATA_RESOLVIDA = CURRENT_TIMESTAMP(), RESPONSAVEL_TRATATIVA = '${email}'
        WHERE IDGROOT = ${idgroot} AND STATUS IN ('PENDENTE', 'VALIDAR')
      `;
    } else {
      query = `
        UPDATE \`${PROJECT_ID}.${DATASET_ID}.SOLICITACOES_ALTERACOES_BA01\`
        SET STATUS = '${statusEscapado}', DATA_RESOLVIDA = CURRENT_TIMESTAMP(), RESPONSAVEL_TRATATIVA = '${email}'
        WHERE IDGROOT = ${idgroot} AND STATUS IN ('PENDENTE', 'VALIDAR')
      `;
    }
    
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
    
    Logger.log('Status atualizado: IDGROOT=' + idgroot + ', Status=' + novoStatus);
    return { success: true, message: 'Status atualizado com sucesso' };
    
  } catch (error) {
    Logger.log('Erro ao atualizar status: ' + error.toString());
    return { success: false, message: error.toString() };
  }
}
