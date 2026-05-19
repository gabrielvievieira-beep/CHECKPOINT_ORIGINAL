// CHAMADA.GS - Funções da página de chamada
//
// SCHEMA CP_HISTORICO_ABS:
//   IDGROOT        INTEGER   ← sem underscore, sem aspas no SQL
//   COLABORADOR    STRING
//   DATA_ABS       DATE
//   STATUS_PRESENCA STRING
//   CLOCK_IN       TIME
//   AREA           STRING
//   SETOR          STRING
//   GESTOR         STRING
//   TURNO          STRING
//   RESPONSAVEL    STRING
//   CHAVE          INTEGER   ← formato DDMMYY + IDGROOT

function getGestores() {
  try {
    const query = `
      SELECT DISTINCT COLABORADOR as nome, AREA, SETOR
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE STATUS NOT IN ('Inativo', 'INATIVO')
      AND COLABORADOR IS NOT NULL
      AND ID_GROOT IS NOT NULL
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
    const result   = JSON.parse(response.getContentText());

    if (result.error) throw new Error(result.error.message);
    if (!result.rows) return [];

    return result.rows.map(row => {
      const obj = {};
      result.schema.fields.forEach((field, i) => { obj[field.name.toLowerCase()] = row.f[i].v; });
      return obj;
    });
  } catch (error) {
    Logger.log('Erro ao buscar gestores: ' + error.toString());
    return [];
  }
}

/**
 * Buscar colaboradores ativos do BigQuery (CP_LISTA_COLABORADORES)
 * Usa cache de 6h para evitar round-trips desnecessários.
 */
function getColaboradores() {
  try {
    const cached = getChunkedCache(CACHE_KEY_COLABORADORES);
    if (cached) {
      Logger.log('getColaboradores: cache hit (' + cached.length + ')');
      return cached;
    }

    const filtros = ['STATUS NOT IN (\'Inativo\', \'INATIVO\')'];
    filtros.push(...gerarFiltrosCargoSetor('CARGO', 'SETOR', 'AREA'));
    filtros.push('ID_GROOT IS NOT NULL');

    const query = `
      SELECT ID_GROOT, COLABORADOR, AREA, SETOR, GESTOR, TURNO, ESCALA, STATUS, CARGO
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE ${filtros.join(' AND ')}
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ID_GROOT ORDER BY COLABORADOR) = 1
      ORDER BY AREA, SETOR, GESTOR, COLABORADOR
    `;

    const token  = getTokenBigQuery();
    const result = _bqQuery(query, token, 60000, true);
    const rows   = _parseRows(result);

    if (rows.length > 0) putChunkedCache(CACHE_KEY_COLABORADORES, rows, CACHE_DURATION);
    Logger.log('getColaboradores: BQ (' + rows.length + ')');
    return rows;
  } catch (error) {
    Logger.log('Erro ao buscar colaboradores: ' + error.toString());
    throw error;
  }
}

// ─── Helper BQ ─────────────────────────────────────────────────────────────
function _bqQuery(sql, token, timeoutMs, useCache) {
  const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;
  const payload = {
    query:         sql,
    useLegacySql:  false,
    timeoutMs:     timeoutMs || 60000,
    useQueryCache: useCache !== false
  };
  const options = {
    method:      'POST',
    contentType: 'application/json',
    headers:     { 'Authorization': `Bearer ${token}` },
    payload:     JSON.stringify(payload)
  };
  const result = JSON.parse(UrlFetchApp.fetch(apiEndpoint, options).getContentText());
  if (result.error) throw new Error(result.error.message);
  return result;
}

function _parseRows(result) {
  if (!result.rows) return [];
  return result.rows.map(row => {
    const obj = {};
    result.schema.fields.forEach((f, i) => { obj[f.name.toLowerCase()] = row.f[i].v; });
    return obj;
  });
}

// ─── Cache em chunks ────────────────────────────────────────────────────────
const CHUNK_SIZE = 90000;

function putChunkedCache(key, data, duration) {
  try {
    const cache = CacheService.getScriptCache();
    const json  = JSON.stringify(data);
    const total = Math.ceil(json.length / CHUNK_SIZE);
    const pairs = {};
    pairs[key + '__meta'] = JSON.stringify({ total });
    for (let i = 0; i < total; i++) {
      pairs[key + '__' + i] = json.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    }
    cache.putAll(pairs, duration);
  } catch(e) {
    Logger.log('putChunkedCache erro: ' + e);
  }
}

function getChunkedCache(key) {
  try {
    const cache = CacheService.getScriptCache();
    const meta  = cache.get(key + '__meta');
    if (!meta) return null;
    const { total } = JSON.parse(meta);
    let json = '';
    for (let i = 0; i < total; i++) {
      const chunk = cache.get(key + '__' + i);
      if (chunk === null) return null;
      json += chunk;
    }
    return JSON.parse(json);
  } catch(e) {
    Logger.log('getChunkedCache erro: ' + e);
    return null;
  }
}

function invalidarCacheRegistros() {
  try {
    limparCache();
  } catch(e) { Logger.log('invalidarCache erro: ' + e); }
}

/**
 * Buscar registros do dia atual (CP_HISTORICO_ABS)
 * TURNO_GESTOR: agrupa cards pelo turno do gestor
 * Filtro de AREA: exclui Customer, Operations, Software e demais áreas bloqueadas
 */
function getRegistrosDiaAtual() {
  try {
    const cached = getChunkedCache(CACHE_KEY_REGISTROS_DIA);
    if (cached) {
      Logger.log('getRegistrosDiaAtual: retornando do cache (' + cached.length + ' registros)');
      return cached;
    }

    const hoje    = new Date();
    const dataStr = Utilities.formatDate(hoje, Session.getScriptTimeZone(), 'yyyy-MM-dd');

    const areasExcl  = (typeof AREAS_EXCLUIDAS !== 'undefined' && AREAS_EXCLUIDAS.length > 0)
                       ? AREAS_EXCLUIDAS
                       : ['Safety','Flow','Treinamento','Plant Engineering','Line Haul','People','Staff','Customer','Operations','Software','Loss Prevention'];
    const areasNOTIN = areasExcl.map(a => `'${a.toUpperCase()}'`).join(', ');

    // Whitelist — única fonte de verdade de cargos (mesmo padrão de getColaboradores)
    const cargosIncl = (typeof CARGOS_INCLUIDOS !== 'undefined' && CARGOS_INCLUIDOS.length > 0)
                       ? CARGOS_INCLUIDOS
                       : ['Representante de Envio 1','Representante de Envio 2','Representante de Envio 3',
                          'Problem Solver','Operador Logistico 1','Operador Logistico 2',
                          'Sr Team Leader - Shipping'];
    const cargosIN = cargosIncl.map(a => `'${a.toUpperCase()}'`).join(', ');

    const query = `
      SELECT
        h.IDGROOT,
        h.COLABORADOR,
        h.DATA_ABS,
        h.STATUS_PRESENCA,
        h.CLOCK_IN,
        h.AREA,
        h.SETOR,
        h.GESTOR,
        h.TURNO,
        h.RESPONSAVEL,
        h.CHAVE,
        COALESCE(c.ESCALA, '')       AS ESCALA,
        COALESCE(c.CARGO,  '')       AS CARGO_COLAB,
        COALESCE(g.TURNO, h.TURNO)  AS TURNO_GESTOR,
        COALESCE(g.CARGO, '')        AS CARGO_GESTOR
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\` h
      LEFT JOIN \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\` c
        ON CAST(h.IDGROOT AS INT64) = CAST(c.ID_GROOT AS INT64)
      LEFT JOIN (
        SELECT COLABORADOR, TURNO, CARGO
        FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
        WHERE STATUS NOT IN ('Inativo', 'INATIVO')
          AND COLABORADOR IS NOT NULL
        QUALIFY ROW_NUMBER() OVER (PARTITION BY UPPER(TRIM(COLABORADOR)) ORDER BY COLABORADOR) = 1
      ) g ON UPPER(TRIM(h.GESTOR)) = UPPER(TRIM(g.COLABORADOR))
      WHERE h.DATA_ABS = DATE '${dataStr}'
        AND (h.AREA IS NULL OR UPPER(TRIM(h.AREA)) NOT IN (${areasNOTIN}))
        AND UPPER(TRIM(c.CARGO)) IN (${cargosIN})
      ORDER BY COALESCE(g.TURNO, h.TURNO), h.AREA, h.SETOR, h.GESTOR, h.COLABORADOR
    `;

    const token  = getTokenBigQuery();
    const result = _bqQuery(query, token, 60000, true);
    const rows   = _parseRows(result);

    if (rows.length > 0) putChunkedCache(CACHE_KEY_REGISTROS_DIA, rows, CACHE_DURATION_REGISTROS);

    Logger.log('getRegistrosDiaAtual: ' + rows.length + ' registros do BQ → cache 2 min');
    return rows;

  } catch (error) {
    Logger.log('Erro ao buscar registros do dia: ' + error.toString());
    throw error;
  }
}

// ─── DSR — Escala 6x2 ──────────────────────────────────────────────────────
// Delega para getTurmaFolgaData_() definida em Escalas.gs (mesma lógica, sem duplicação)
function getTurmaFolgaHoje_() {
  const dataStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return getTurmaFolgaData_(dataStr);
}

// Exposta ao frontend para consulta opcional
function getTurmaFolgaHoje() { return getTurmaFolgaHoje_(); }

/**
 * Atualiza para 'DSR - Escala' todos os registros de HOJE que:
 *  - tenham STATUS_PRESENCA nulo/vazio
 *  - pertençam a colaboradores cuja ESCALA é a turma de folga do dia
 * Idempotente — pode ser chamada várias vezes sem duplicar efeito.
 */
function registrarDSRDoDia() {
  try {
    const turma   = getTurmaFolgaHoje_();
    const token   = getTokenBigQuery();
    const agora   = new Date();
    const dataStr = Utilities.formatDate(agora, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const email   = getUsuarioEmail();

    const updateQuery = `
      UPDATE \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\` h
      SET STATUS_PRESENCA = 'DSR - Escala',
          RESPONSAVEL = '${email}'
      WHERE h.DATA_ABS = DATE '${dataStr}'
        AND (h.STATUS_PRESENCA IS NULL OR TRIM(h.STATUS_PRESENCA) = '')
        AND EXISTS (
          SELECT 1
          FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\` c
          WHERE CAST(c.ID_GROOT AS INT64) = CAST(h.IDGROOT AS INT64)
            AND UPPER(TRIM(COALESCE(c.ESCALA, ''))) = '${turma}'
            AND c.STATUS NOT IN ('Inativo', 'INATIVO')
        )
    `;

    const result   = _bqQuery(updateQuery, token, 60000, false);
    const affected = parseInt(result.numDmlAffectedRows || '0');

    if (affected > 0) invalidarCacheRegistros();

    Logger.log('registrarDSRDoDia: Turma ' + turma + ' → ' + affected + ' registro(s) marcado(s) como DSR');
    return { sucesso: true, turma: turma, atualizados: affected };
  } catch (error) {
    Logger.log('Erro em registrarDSRDoDia: ' + error.toString());
    return { sucesso: false, erro: error.toString() };
  }
}

/**
 * Inicializa os registros do dia para todos os colaboradores ativos.
 * Colaboradores cuja ESCALA coincide com a turma de folga do dia
 * já são inseridos com STATUS_PRESENCA = 'DSR - Escala'.
 */
function inicializarChamadaDia() {
  try {
    const agora      = new Date();
    const dataStr    = Utilities.formatDate(agora, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const ddmmyy     = Utilities.formatDate(agora, Session.getScriptTimeZone(), 'ddMMyy');
    const email      = getUsuarioEmail();
    const token      = getTokenBigQuery();
    const turmaFolga = getTurmaFolgaHoje_();

    const countResult = _bqQuery(
      `SELECT COUNT(1) AS n FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
       WHERE DATA_ABS = '${dataStr}'`,
      token, 15000, true
    );
    const jaExistem = parseInt(countResult.rows?.[0]?.f?.[0]?.v || '0');
    if (jaExistem > 0) {
      Logger.log('inicializarChamadaDia: já existem ' + jaExistem + ' registros para ' + dataStr);
      // Garante DSR nos registros já existentes (compatibilidade com dias já inicializados)
      registrarDSRDoDia();
      return { success: true, jaExistia: true, total: jaExistem };
    }

    const filtros = ['STATUS NOT IN (\'Inativo\', \'INATIVO\')'];
    filtros.push(...gerarFiltrosCargoSetor('CARGO', 'SETOR', 'AREA'));
    filtros.push('ID_GROOT IS NOT NULL');
    filtros.push("TRIM(CAST(ID_GROOT AS STRING)) != ''");

    const insertQuery = `
      INSERT INTO \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
        (DATA_ABS, IDGROOT, COLABORADOR, STATUS_PRESENCA, CLOCK_IN,
         AREA, SETOR, GESTOR, TURNO, CHAVE)
      SELECT
        DATE '${dataStr}',
        CAST(ID_GROOT AS INT64)                                                        AS IDGROOT,
        COLABORADOR,
        CASE WHEN UPPER(TRIM(COALESCE(ESCALA, ''))) = '${turmaFolga}'
             THEN 'DSR - Escala'
             ELSE CAST(NULL AS STRING)
        END                                                                            AS STATUS_PRESENCA,
        CAST(NULL AS TIME)                                                             AS CLOCK_IN,
        AREA,
        SETOR,
        GESTOR,
        TURNO,
        CAST(CONCAT('${ddmmyy}', CAST(CAST(ID_GROOT AS INT64) AS STRING)) AS INT64)   AS CHAVE
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE ${filtros.join('\n        AND ')}
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ID_GROOT ORDER BY COLABORADOR) = 1
    `;

    const insertResult = _bqQuery(insertQuery, token, 120000, false);
    const total = parseInt(insertResult.numDmlAffectedRows || '0');

    invalidarCacheRegistros();
    const registros = getRegistrosDiaAtual();

    Logger.log('inicializarChamadaDia: ' + total + ' registros inseridos para ' + dataStr);
    return { success: true, jaExistia: false, total: registros.length };

  } catch (error) {
    Logger.log('Erro ao inicializar chamada: ' + error.toString());
    return { success: false, message: error.toString() };
  }
}

/**
 * Atualizar status de um registro único
 */
function salvarRegistro(registro) {
  try {
    const token   = getTokenBigQuery();
    const email   = getUsuarioEmail();
    const agora   = new Date();
    const dataStr = Utilities.formatDate(agora, Session.getScriptTimeZone(), 'yyyy-MM-dd');

    const query = `
      UPDATE \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\`
      SET STATUS_PRESENCA = '${escaparAspas(registro.status)}',
          RESPONSAVEL = '${email}'
      WHERE IDGROOT = ${parseInt(registro.idgroot)}
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
    const result   = JSON.parse(response.getContentText());

    if (result.error) throw new Error(result.error.message);

    invalidarCacheRegistros();
    Logger.log('Registro atualizado: ' + JSON.stringify(registro));
    return { success: true };

  } catch (error) {
    Logger.log('Erro ao atualizar registro: ' + error.toString());
    return { success: false, message: error.toString() };
  }
}

/**
 * Salvar batch de registros com MERGE
 */
function salvarRegistroBatch(registros) {
  try {
    if (!registros || registros.length === 0) {
      return { success: false, message: 'Nenhum registro para salvar' };
    }

    const token   = getTokenBigQuery();
    const email   = getUsuarioEmail();
    const agora   = new Date();
    const dataStr = Utilities.formatDate(agora, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const ddmmyy  = Utilities.formatDate(agora, Session.getScriptTimeZone(), 'ddMMyy');

    const unicos = {};
    registros.forEach(r => { unicos[r.idgroot] = r; });
    const lista = Object.values(unicos);

    const valores = lista.map(r => {
      const idgroot = parseInt(String(r.idgroot || 0));
      const chave   = parseInt(`${ddmmyy}${idgroot}`);
      return `SELECT ${idgroot} AS IDGROOT,
                     '${escaparAspas(r.status)}' AS STATUS_PRESENCA,
                     '${escaparAspas(r.colaborador || '')}' AS COLABORADOR,
                     '${escaparAspas(r.area        || '')}' AS AREA,
                     '${escaparAspas(r.setor       || '')}' AS SETOR,
                     '${escaparAspas(r.gestor      || '')}' AS GESTOR,
                     '${escaparAspas(r.turno       || '')}' AS TURNO,
                     ${chave} AS CHAVE`;
    }).join(' UNION ALL ');

    const query = `
      MERGE INTO \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\` AS T
      USING (${valores}) AS S
      ON T.IDGROOT = S.IDGROOT AND T.DATA_ABS = DATE('${dataStr}')
      WHEN MATCHED THEN
        UPDATE SET
          STATUS_PRESENCA = S.STATUS_PRESENCA,
          RESPONSAVEL     = '${email}'
      WHEN NOT MATCHED THEN
        INSERT (DATA_ABS, IDGROOT, COLABORADOR, STATUS_PRESENCA, CLOCK_IN,
                AREA, SETOR, GESTOR, TURNO, RESPONSAVEL, CHAVE)
        VALUES (DATE '${dataStr}', S.IDGROOT, S.COLABORADOR, S.STATUS_PRESENCA, NULL,
                S.AREA, S.SETOR, S.GESTOR, S.TURNO, '${email}', S.CHAVE)
    `;

    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;
    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false })
    };

    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result   = JSON.parse(response.getContentText());

    if (result.error) throw new Error(result.error.message);

    invalidarCacheRegistros();
    Logger.log('Batch salvo: ' + lista.length + ' registros');
    return { success: true, total: lista.length };

  } catch (error) {
    Logger.log('Erro ao salvar batch: ' + error.toString());
    return { success: false, message: error.toString() };
  }
}

/**
 * Buscar foto do gestor no Google Drive
 */
function getFotoGestor(nomeGestor) {
  try {
    const folder        = DriveApp.getFolderById(FOLDER_FOTOS_GESTORES);
    const files         = folder.getFiles();
    const nomeGestorLow = nomeGestor.toLowerCase().trim();

    while (files.hasNext()) {
      const file       = files.next();
      const nomeSemExt = file.getName().replace(/\.(jpg|jpeg|png|gif|webp)$/i, '').trim();
      if (nomeSemExt.toLowerCase() === nomeGestorLow) {
        return `https://drive.google.com/thumbnail?id=${file.getId()}&sz=w1000`;
      }
    }
    return null;
  } catch (error) {
    Logger.log('Erro ao buscar foto do gestor: ' + error.toString());
    return null;
  }
}

/**
 * Limpa todo o cache do script. Chamado pelo trigger horário automático.
 */
function limparCacheAgora() {
  try {
    limparCache();
    Logger.log('✅ Cache limpo com sucesso em ' + new Date().toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'}));
  } catch(e) {
    Logger.log('Erro ao limpar cache: ' + e);
  }
}

/**
 * Instala trigger automático que limpa o cache a cada hora.
 */
function configurarTriggerAutomatico() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'limparCacheAgora')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('limparCacheAgora')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('✅ Trigger automático instalado: cache será limpo a cada hora.');
}

// ── DIAGNÓSTICO TEMPORÁRIO — remover após confirmar o card LÍDERES ──────────
function diagnosticarLideres() {
  const hoje    = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const token   = getTokenBigQuery();

  // 1. Líderes no CP_HISTORICO_ABS de hoje
  const q1 = `
    SELECT h.IDGROOT, h.COLABORADOR, COALESCE(c.CARGO,'(sem cargo)') AS CARGO
    FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_HISTORICO}\` h
    LEFT JOIN \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\` c
      ON CAST(h.IDGROOT AS INT64) = CAST(c.ID_GROOT AS INT64)
    WHERE h.DATA_ABS = DATE '${hoje}'
      AND UPPER(TRIM(COALESCE(c.CARGO,''))) = 'SR TEAM LEADER - SHIPPING'
    LIMIT 20
  `;
  const r1 = _bqQuery(q1, token, 15000, false);
  const lidHoje = _parseRows(r1);
  Logger.log('=== LÍDERES NO HISTÓRICO DE HOJE (' + hoje + ') ===');
  Logger.log('Total encontrado: ' + lidHoje.length);
  lidHoje.forEach(r => Logger.log('  ' + r.idgroot + ' | ' + r.colaborador + ' | ' + r.cargo));

  // 2. Líderes na tabela de colaboradores (ativos)
  const q2 = `
    SELECT ID_GROOT, COLABORADOR, CARGO, STATUS
    FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
    WHERE UPPER(TRIM(CARGO)) = 'SR TEAM LEADER - SHIPPING'
      AND STATUS NOT IN ('Inativo','INATIVO')
    LIMIT 20
  `;
  const r2 = _bqQuery(q2, token, 15000, false);
  const lidAtivos = _parseRows(r2);
  Logger.log('=== LÍDERES ATIVOS EM ' + TABLE_COLABORADORES + ' ===');
  Logger.log('Total encontrado: ' + lidAtivos.length);
  lidAtivos.forEach(r => Logger.log('  ' + r.id_groot + ' | ' + r.colaborador + ' | ' + r.cargo + ' | ' + r.status));

  // 3. Estado do cache
  const cacheMeta = CacheService.getScriptCache().get(CACHE_KEY_REGISTROS_DIA + '__meta');
  Logger.log('=== CACHE REGISTROS DIA ===');
  Logger.log(cacheMeta ? 'Cache ATIVO — dados antigos podem estar sendo servidos' : 'Cache VAZIO — próxima chamada vai ao BQ');

  return {
    lideresHoje:   lidHoje.length,
    lideresAtivos: lidAtivos.length,
    cacheAtivo:    !!cacheMeta
  };
}
// ── FIM DIAGNÓSTICO ──────────────────────────────────────────────────────────

/**
 * Remove o trigger automático de limpeza de cache.
 */
function removerTriggerAutomatico() {
  const triggers = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'limparCacheAgora');
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('✅ ' + triggers.length + ' trigger(s) de limpeza removido(s).');
}
