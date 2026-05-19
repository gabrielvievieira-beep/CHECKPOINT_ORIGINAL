// ACESSOS.GS
// isOwnerProtegido() e exigeOwnerMaster() definidos em Util.gs

// Busca todos os registros da tabela PERMISSOES_ABS_GESTORES_BA01
// Campos: EMAIL, PERFIL, DATA_CRIACAO, DATA_ATUALIZACAO, RESPONSAVEL
function getPermissoes() {
  try {
    const query = `
      SELECT EMAIL, PERFIL, DATA_CRIACAO, DATA_ATUALIZACAO, RESPONSAVEL
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_PERMISSOES}\`
      ORDER BY EMAIL
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
    
    return result.rows.map(row => ({
      email: row.f[0].v,
      perfil: row.f[1].v,
      data_criacao: row.f[2].v,
      data_atualizacao: row.f[3].v,
      responsavel: row.f[4].v
    }));
    
  } catch (error) {
    Logger.log('Erro ao buscar permissões: ' + error.toString());
    throw error;
  }
}

// INSERT na tabela PERMISSOES_ABS_GESTORES_BA01
// Verifica se email já existe antes de inserir
function adicionarPermissao(email, perfil) {
  exigeOwnerMaster('adicionarPermissao');
  try {
    const token = getTokenBigQuery();
    const responsavel = getUsuarioEmail();
    const agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm:ss');
    
    const verificaQuery = `
      SELECT COUNT(*) as total
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_PERMISSOES}\`
      WHERE UPPER(EMAIL) = UPPER('${email.replace(/'/g, "''")}')
    `;
    
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;
    
    const verificaOptions = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: verificaQuery, useLegacySql: false })
    };
    
    const verificaResponse = UrlFetchApp.fetch(apiEndpoint, verificaOptions);
    const verificaResult = JSON.parse(verificaResponse.getContentText());
    
    if (verificaResult.rows && verificaResult.rows[0].f[0].v > 0) {
      return { success: false, message: 'Este email já possui permissão cadastrada' };
    }
    
    const insertQuery = `
      INSERT INTO \`${PROJECT_ID}.${DATASET_ID}.${TABLE_PERMISSOES}\`
      (EMAIL, PERFIL, DATA_CRIACAO, DATA_ATUALIZACAO, RESPONSAVEL)
      VALUES ('${email.replace(/'/g, "''")}', '${perfil}', '${agora}', '${agora}', '${responsavel}')
    `;
    
    const insertOptions = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: insertQuery, useLegacySql: false })
    };
    
    const insertResponse = UrlFetchApp.fetch(apiEndpoint, insertOptions);
    const insertResult = JSON.parse(insertResponse.getContentText());
    
    if (insertResult.error) throw new Error(insertResult.error.message);
    
    Logger.log('Permissão adicionada: ' + email + ' - ' + perfil);
    return { success: true, message: 'Permissão adicionada com sucesso' };
    
  } catch (error) {
    Logger.log('Erro ao adicionar permissão: ' + error.toString());
    return { success: false, message: error.toString() };
  }
}

// UPDATE na tabela PERMISSOES_ABS_GESTORES_BA01
// Atualiza PERFIL, DATA_ATUALIZACAO e RESPONSAVEL pelo EMAIL
function atualizarPermissao(email, perfil) {
  exigeOwnerMaster('atualizarPermissao');
  if (isOwnerProtegido(email)) {
    return { success: false, message: 'Este usuário é owner do sistema e não pode ter o perfil alterado.' };
  }
  try {
    const token = getTokenBigQuery();
    const responsavel = getUsuarioEmail();
    const agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm:ss');
    
    const query = `
      UPDATE \`${PROJECT_ID}.${DATASET_ID}.${TABLE_PERMISSOES}\`
      SET PERFIL = '${perfil}',
          DATA_ATUALIZACAO = '${agora}',
          RESPONSAVEL = '${responsavel}'
      WHERE UPPER(EMAIL) = UPPER('${email.replace(/'/g, "''")}')
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
    
    Logger.log('Permissão atualizada: ' + email + ' - ' + perfil);
    return { success: true, message: 'Permissão atualizada com sucesso' };
    
  } catch (error) {
    Logger.log('Erro ao atualizar permissão: ' + error.toString());
    return { success: false, message: error.toString() };
  }
}

// DELETE na tabela PERMISSOES_ABS_GESTORES_BA01 pelo EMAIL
function removerPermissao(email) {
  exigeOwnerMaster('removerPermissao');
  if (isOwnerProtegido(email)) {
    return { success: false, message: 'Este usuário é owner do sistema e não pode ser removido.' };
  }
  try {
    const token = getTokenBigQuery();
    
    const query = `
      DELETE FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_PERMISSOES}\`
      WHERE UPPER(EMAIL) = UPPER('${email.replace(/'/g, "''")}')
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
    
    Logger.log('Permissão removida: ' + email);
    return { success: true, message: 'Permissão removida com sucesso' };
    
  } catch (error) {
    Logger.log('Erro ao remover permissão: ' + error.toString());
    return { success: false, message: error.toString() };
  }
}

// Retorna lista fixa de perfis disponíveis
function getPerfisDisponiveis() {
  return ['ADMIN', 'GESTOR', 'OBSERVADOR', 'FLOW'];
}

/**
 * Remove duplicatas da tabela de permissões.
 * Estratégia: lê tudo, deduplica por EMAIL (mantém o registro mais antigo),
 * apaga tudo no BQ e re-insere o conjunto limpo.
 * Retorna { success, total, removed }
 */
function limparPermissoesDuplicatas() {
  exigeOwnerMaster('limparPermissoesDuplicatas');
  try {
    const token      = getTokenBigQuery();
    const responsavel = getUsuarioEmail();
    const agora      = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm:ss');
    const endpoint   = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;

    const bqPost = (query) => {
      const r = UrlFetchApp.fetch(endpoint, {
        method: 'POST', contentType: 'application/json',
        headers: { 'Authorization': `Bearer ${token}` },
        payload: JSON.stringify({ query, useLegacySql: false, timeoutMs: 30000 }),
        muteHttpExceptions: true
      });
      const parsed = JSON.parse(r.getContentText());
      if (parsed.error) throw new Error(parsed.error.message);
      return parsed;
    };

    // 1. Buscar todos os registros atuais
    const todas = getPermissoes();
    if (!todas || todas.length === 0) return { success: true, total: 0, removed: 0 };

    // 2. Deduplicar client-side (mantém primeiro por EMAIL, ordem retornada pelo BQ = ORDER BY EMAIL)
    const seen   = {};
    const manter = [];
    todas.forEach(p => {
      const k = (p.email || '').toLowerCase().trim();
      if (k && !seen[k]) { seen[k] = true; manter.push(p); }
    });

    const removidos = todas.length - manter.length;

    if (removidos === 0) return { success: true, total: manter.length, removed: 0 };

    // 3. Apagar TODOS os registros
    bqPost(`DELETE FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_PERMISSOES}\` WHERE TRUE`);

    // 4. Aguardar propagação BQ (~2s)
    Utilities.sleep(2500);

    // 5. Re-inserir conjunto deduplicado
    const valores = manter.map(p =>
      `('${p.email.replace(/'/g,"''")}', '${p.perfil}', '${p.data_criacao || agora}', '${agora}', '${responsavel}')`
    ).join(',\n');

    bqPost(`
      INSERT INTO \`${PROJECT_ID}.${DATASET_ID}.${TABLE_PERMISSOES}\`
        (EMAIL, PERFIL, DATA_CRIACAO, DATA_ATUALIZACAO, RESPONSAVEL)
      VALUES ${valores}
    `);

    Logger.log(`Duplicatas removidas: ${removidos}. Mantidos: ${manter.length}`);
    return { success: true, total: manter.length, removed: removidos };

  } catch (error) {
    Logger.log('Erro ao limpar duplicatas: ' + error.toString());
    return { success: false, message: error.toString() };
  }
}
