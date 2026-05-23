// UTILS.GS

// ════════════════════════════════════════════════════════════════════════════
// OWNERS MASTER — Administradores absolutos do sistema Checkpoint BA01.
// Acesso garantido por código — independente da tabela de permissões.
// Nenhuma operação pode remover, rebaixar ou alterar esses acessos.
// ════════════════════════════════════════════════════════════════════════════
const OWNER_MASTER_EMAIL = 'gabrielvie.vieira@mercadolivre.com';
const OWNERS_MASTER_LIST = [
  'gabrielvie.vieira@mercadolivre.com',
  'lucas.leal@mercadolivre.com'
];
const OWNERS_PROTEGIDOS = OWNERS_MASTER_LIST;

/**
 * Retorna true se o e-mail pertence à lista de Owners Master.
 */
function isOwnerMaster(email) {
  try {
    const alvo = (email || getUsuarioEmail() || '').toLowerCase().trim();
    return OWNERS_MASTER_LIST.map(e => e.toLowerCase()).includes(alvo);
  } catch (e) {
    Logger.log('[SEGURANÇA] Erro em isOwnerMaster: ' + e.toString());
    return false;
  }
}

/**
 * Lança erro + envia alerta por e-mail se o usuário NÃO for o Owner Master.
 */
function exigeOwnerMaster(operacao) {
  const email = getUsuarioEmail();
  if (!isOwnerMaster(email)) {
    _alertarTentativaInvasao(operacao, email);
    Logger.log('[BLOQUEADO] "' + operacao + '" tentado por: ' + email);
    throw new Error('Acesso negado. A operação "' + operacao + '" é exclusiva do administrador master.');
  }
  Logger.log('[OWNER MASTER] Autorizado: "' + operacao + '" por ' + email);
}

/**
 * Retorna true se o e-mail é um Owner protegido (não pode ser removido/rebaixado).
 */
function isOwnerProtegido(email) {
  return OWNERS_PROTEGIDOS
    .map(e => e.toLowerCase())
    .includes((email || '').toLowerCase().trim());
}

/**
 * Envia alerta por e-mail para Gabriel quando uma operação crítica
 * é tentada por usuário não autorizado.
 */
function _alertarTentativaInvasao(operacao, emailTentativa) {
  try {
    const agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss');
    MailApp.sendEmail({
      to:      OWNER_MASTER_EMAIL,
      subject: '⚠️ [CHECKPOINT] Tentativa de acesso não autorizado — ' + operacao,
      body:
        '⚠️ ALERTA DE SEGURANÇA — Checkpoint BA01\n\n' +
        'Operação bloqueada : ' + operacao + '\n' +
        'Usuário que tentou : ' + emailTentativa + '\n' +
        'Data/Hora          : ' + agora + ' (São Paulo)\n\n' +
        'Nenhuma alteração foi feita. O acesso foi recusado automaticamente.\n' +
        'Se não reconhece essa atividade, revise os acessos em: https://script.google.com'
    });
  } catch (e) {
    Logger.log('[ALERTA] Falha ao enviar e-mail: ' + e.toString());
  }
}

// Monta cláusulas WHERE para excluir CARGO, SETOR e AREA definidos em Config.gs
function gerarFiltrosCargoSetor(campoCargo, campoSetor, campoArea) {
  if (typeof campoCargo === 'undefined') campoCargo = 'CARGO';
  if (typeof campoSetor === 'undefined') campoSetor = 'SETOR';
  if (typeof campoArea === 'undefined') campoArea = 'AREA';
  
  const filtros = [];
  const escaparAspas = (str) => str.replace(/'/g, "''");
  
  // Whitelist tem prioridade sobre blacklist (mesmo padrão de SETORES_INCLUIDOS)
  if (typeof CARGOS_INCLUIDOS !== 'undefined' && CARGOS_INCLUIDOS.length > 0) {
    const cargosIN = CARGOS_INCLUIDOS.map(c => `'${escaparAspas(c.toUpperCase())}'`).join(', ');
    filtros.push(`UPPER(TRIM(${campoCargo})) IN (${cargosIN})`);
  } else {
    const cargosUpper = CARGOS_EXCLUIDOS.map(c => `'${escaparAspas(c.toUpperCase())}'`).join(', ');
    const cargosNormal = CARGOS_EXCLUIDOS.map(c => `'${escaparAspas(c)}'`).join(', ');
    filtros.push(`(${campoCargo} IS NULL OR UPPER(${campoCargo}) NOT IN (${cargosUpper}))`);
    filtros.push(`(${campoCargo} IS NULL OR ${campoCargo} NOT IN (${cargosNormal}))`);
  }
  
  filtros.push(`${campoSetor} IS NOT NULL`);
  filtros.push(`TRIM(${campoSetor}) != ''`);

  // Whitelist tem prioridade: filtra por AREA (os valores de SETORES_INCLUIDOS são nomes de área)
  if (typeof SETORES_INCLUIDOS !== 'undefined' && SETORES_INCLUIDOS.length > 0) {
    const setoresIN = SETORES_INCLUIDOS.map(s => `'${escaparAspas(s.toUpperCase())}'`).join(', ');
    filtros.push(`UPPER(${campoArea}) IN (${setoresIN})`);
  } else {
    const setoresUpper = SETORES_EXCLUIDOS.map(s => `'${escaparAspas(s.toUpperCase())}'`).join(', ');
    const setoresNormal = SETORES_EXCLUIDOS.map(s => `'${escaparAspas(s)}'`).join(', ');
    filtros.push(`(${campoSetor} IS NULL OR UPPER(${campoSetor}) NOT IN (${setoresUpper}))`);
    filtros.push(`(${campoSetor} IS NULL OR ${campoSetor} NOT IN (${setoresNormal}))`);
  }
  
  if (AREAS_EXCLUIDAS && AREAS_EXCLUIDAS.length > 0) {
    const areasUpper = AREAS_EXCLUIDAS.map(a => `'${escaparAspas(a.toUpperCase())}'`).join(', ');
    const areasNormal = AREAS_EXCLUIDAS.map(a => `'${escaparAspas(a)}'`).join(', ');
    filtros.push(`(${campoArea} IS NULL OR UPPER(${campoArea}) NOT IN (${areasUpper}))`);
    filtros.push(`(${campoArea} IS NULL OR ${campoArea} NOT IN (${areasNormal}))`);
  }
  
  return filtros;
}

// Gera token OAuth2 via JWT usando SERVICE_ACCOUNT_KEY das Script Properties
// Scopes: bigquery, drive.readonly
function getTokenBigQuery() {
  const keyJson = PropertiesService.getScriptProperties().getProperty('SERVICE_ACCOUNT_KEY');
  if (!keyJson) {
    throw new Error('SERVICE_ACCOUNT_KEY não encontrada nas Propriedades do Script. Configure em Projeto > Propriedades do Script.');
  }
  let KEY;
  try {
    KEY = JSON.parse(keyJson);
  } catch (parseErr) {
    throw new Error('SERVICE_ACCOUNT_KEY inválida (JSON malformado): ' + parseErr.message + '. Verifique as Propriedades do Script.');
  }
  if (!KEY || !KEY.private_key || !KEY.client_email) {
    throw new Error('SERVICE_ACCOUNT_KEY incompleta — faltam campos private_key ou client_email.');
  }
  const now = Math.floor(Date.now() / 1000);
  
  const jwtHeader = { alg: 'RS256', typ: 'JWT' };
  const jwtClaim = {
    iss: KEY.client_email,
    scope: 'https://www.googleapis.com/auth/bigquery https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  
  const headerB64 = Utilities.base64EncodeWebSafe(JSON.stringify(jwtHeader));
  const claimB64 = Utilities.base64EncodeWebSafe(JSON.stringify(jwtClaim));
  const signature = Utilities.computeRsaSha256Signature(headerB64 + '.' + claimB64, KEY.private_key);
  const signatureB64 = Utilities.base64EncodeWebSafe(signature);
  const jwt = headerB64 + '.' + claimB64 + '.' + signatureB64;
  
  const tokenResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    payload: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt,
    muteHttpExceptions: true
  });

  const rawToken = tokenResponse.getContentText();
  if (rawToken.trimStart().startsWith('<')) {
    throw new Error('OAuth2 retornou resposta HTML (HTTP ' + tokenResponse.getResponseCode() + '). Verifique SERVICE_ACCOUNT_KEY nas propriedades do script.');
  }
  const tokenResult = JSON.parse(rawToken);
  if (tokenResult.error) {
    throw new Error('Erro OAuth2 (' + tokenResult.error + '): ' + (tokenResult.error_description || 'sem detalhes'));
  }

  return tokenResult.access_token;
}

// Retorna email do usuário logado na sessão
function getUsuarioEmail() {
  try {
    return Session.getActiveUser().getEmail();
  } catch (error) {
    Logger.log('Erro ao obter email: ' + error.toString());
    return 'Usuário';
  }
}

// ─── Helper: remove uma chave chunked corretamente ──────────────────────────
// O sistema de cache usa chunks: key__meta + key__0, key__1, …
// cache.remove(key) apaga só a chave base e NÃO os chunks — gerando cache stale.
function _limparChunkedKey_(cache, key) {
  // 1. Tenta ler o meta para saber quantos chunks existem
  const meta = cache.get(key + '__meta');
  if (meta) {
    try {
      const { total } = JSON.parse(meta);
      const keys = [key + '__meta'];
      for (let i = 0; i < total; i++) keys.push(key + '__' + i);
      cache.removeAll(keys);
    } catch(e) {
      // meta corrompido — remove manualmente até 50 chunks como fallback
      const keys = [key + '__meta'];
      for (let i = 0; i < 50; i++) keys.push(key + '__' + i);
      cache.removeAll(keys);
    }
  }
  cache.remove(key); // limpa também a chave base (legado)
}

// Limpa todas as chaves de cache usadas pelo sistema
function limparCache() {
  const cache = CacheService.getScriptCache();

  // Caches chunked — precisam do helper para remover __meta + __0, __1, …
  _limparChunkedKey_(cache, CACHE_KEY_COLABORADORES);
  _limparChunkedKey_(cache, CACHE_KEY_REGISTROS_DIA);

  // Cache do histórico (chaves simples, não chunked)
  for (let m = 1; m <= 12; m++) {
    for (let a = 2020; a <= 2030; a++) {
      cache.remove(`historico_cache_${m}_${a}`);
    }
  }
  cache.remove('historico_cache_all_all');

  // Cache de idgroots do Flow (Historico.gs)
  cache.remove('idgroots_incluidos_flow');
  cache.remove('idgroots_excluidos_flow'); // chave legada

  Logger.log('Cache limpo com sucesso (chunks incluídos)');
  return true;
}

function escaparAspas(str) {
  return (str || '').replace(/'/g, "''");
}

// ─── Exportar para Google Sheets ───────────────────────────────────────────
/**
 * Cria uma Google Planilha formatada a partir de um payload de dados.
 *
 * Payload esperado:
 *   {
 *     title:   string          // nome do arquivo no Drive
 *     sheet:   string          // nome da aba
 *     headers: string[]        // cabeçalhos das colunas
 *     rows:    any[][]         // linhas de dados (mesmo número de colunas que headers)
 *     freeze:  number          // (opcional) número de colunas para congelar (padrão 0)
 *   }
 *
 * Retorna: URL da planilha criada.
 */
function exportarParaGoogleSheets(payload) {
  try {
    const ss    = SpreadsheetApp.create(payload.title || 'Exportação BA01');
    const sheet = ss.getActiveSheet();
    sheet.setName(payload.sheet || 'Dados');

    const headers = payload.headers || [];
    const rows    = payload.rows    || [];
    const ncols   = headers.length;

    // ── Cabeçalho ────────────────────────────────────────────
    if (ncols > 0) {
      const hRange = sheet.getRange(1, 1, 1, ncols);
      hRange.setValues([headers]);
      hRange.setFontWeight('bold');
      hRange.setFontColor('#FFFFFF');
      hRange.setBackground('#0f172a');
      hRange.setHorizontalAlignment('center');
      hRange.setFontSize(10);
    }

    // ── Dados ─────────────────────────────────────────────────
    if (rows.length > 0) {
      const dRange = sheet.getRange(2, 1, rows.length, ncols);
      dRange.setValues(rows);
      dRange.setFontSize(9);

      // Linhas alternadas em cinza clarinho
      for (let i = 0; i < rows.length; i++) {
        if (i % 2 === 1) {
          sheet.getRange(i + 2, 1, 1, ncols).setBackground('#f1f5f9');
        }
      }
    }

    // ── Formatação geral ──────────────────────────────────────
    sheet.setFrozenRows(1);
    if (payload.freeze && payload.freeze > 0) {
      sheet.setFrozenColumns(payload.freeze);
    }
    sheet.autoResizeColumns(1, ncols);

    // Bordas na tabela completa
    if (rows.length > 0) {
      sheet.getRange(1, 1, rows.length + 1, ncols)
        .setBorder(true, true, true, true, true, true,
                   '#d1d5db', SpreadsheetApp.BorderStyle.SOLID);
    }

    // Filtro automático no cabeçalho
    if (ncols > 0 && rows.length > 0) {
      sheet.getRange(1, 1, rows.length + 1, ncols).createFilter();
    }

    Logger.log('exportarParaGoogleSheets: criada "' + payload.title + '" → ' + ss.getUrl());
    return { success: true, url: ss.getUrl() };

  } catch (err) {
    Logger.log('exportarParaGoogleSheets erro: ' + err.toString());
    return { success: false, message: err.toString() };
  }
}
