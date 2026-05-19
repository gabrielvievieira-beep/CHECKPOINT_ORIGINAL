// BACKUP.GS
// Rotina de backup automático diário às 22h.
// Salva todos os arquivos do projeto (.gs e .html) no Google Drive em:
//   BACKUP_CHECKPOINT / yyyy-MM-dd / <arquivo>
//
// SETUP (executar uma única vez):
//   1. clasp push
//   2. No editor GAS, execute: configurarTriggerBackup()
//   3. Autorize os escopos quando solicitado
//   4. Verifique em Gatilhos que o trigger foi criado

// ── Pasta raiz no Drive ──────────────────────────────────────────────────────
const BACKUP_ROOT_NAME = 'BACKUP_CHECKPOINT';

/**
 * Função principal de backup.
 * Lê todos os arquivos do projeto via Apps Script API
 * e salva no Drive em BACKUP_CHECKPOINT/yyyy-MM-dd/.
 * Pode ser chamada manualmente ou pelo trigger diário às 22h.
 */
function fazerBackup() {
  try {
    const scriptId = ScriptApp.getScriptId();
    const token    = ScriptApp.getOAuthToken();
    const hoje     = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
    const agora    = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss');

    // 1. Buscar conteúdo do projeto via Apps Script API
    const apiUrl  = `https://script.googleapis.com/v1/projects/${scriptId}/content`;
    const apiResp = UrlFetchApp.fetch(apiUrl, {
      headers: { 'Authorization': `Bearer ${token}` },
      muteHttpExceptions: true
    });

    if (apiResp.getResponseCode() !== 200) {
      throw new Error('Apps Script API retornou HTTP ' + apiResp.getResponseCode() + ': ' + apiResp.getContentText());
    }

    const content = JSON.parse(apiResp.getContentText());
    const files   = content.files || [];

    if (files.length === 0) {
      Logger.log('[BACKUP] Nenhum arquivo encontrado no projeto.');
      return { success: false, message: 'Nenhum arquivo encontrado.' };
    }

    // 2. Localizar ou criar pasta raiz BACKUP_CHECKPOINT
    const rootIter = DriveApp.getFoldersByName(BACKUP_ROOT_NAME);
    const backupRoot = rootIter.hasNext()
      ? rootIter.next()
      : DriveApp.createFolder(BACKUP_ROOT_NAME);

    // 3. Criar (ou reutilizar) subpasta do dia  yyyy-MM-dd
    const dayIter   = backupRoot.getFoldersByName(hoje);
    const dayFolder = dayIter.hasNext()
      ? dayIter.next()
      : backupRoot.createFolder(hoje);

    // 4. Salvar cada arquivo (sobrescreve se já existir)
    let salvos = 0;
    files.forEach(function(f) {
      if (!f.source && f.source !== '') return; // pula arquivos sem conteúdo

      // Determinar extensão correta
      const ext = f.type === 'HTML' ? '.html' : '.gs';
      // Evitar duplicar extensão (ex: index.html → index.html, não index.html.html)
      const nome = f.name.endsWith(ext) ? f.name : f.name + ext;

      // Remover versão anterior do mesmo nome
      const existentes = dayFolder.getFilesByName(nome);
      while (existentes.hasNext()) {
        existentes.next().setTrashed(true);
      }

      // Criar novo arquivo texto
      dayFolder.createFile(nome, f.source || '', MimeType.PLAIN_TEXT);
      salvos++;
    });

    // 5. Criar arquivo de manifesto com metadados do backup
    const manifesto = [
      'BACKUP CHECKPOINT BA01',
      '========================',
      'Data/Hora : ' + agora + ' (São Paulo)',
      'Pasta     : BACKUP_CHECKPOINT/' + hoje,
      'Arquivos  : ' + salvos,
      'Script ID : ' + scriptId,
      '',
      'Arquivos salvos:',
      files.map(f => '  - ' + f.name + ' (' + f.type + ')').join('\n')
    ].join('\n');

    // Sobrescrever manifesto anterior
    const mIter = dayFolder.getFilesByName('_manifesto.txt');
    while (mIter.hasNext()) mIter.next().setTrashed(true);
    dayFolder.createFile('_manifesto.txt', manifesto, MimeType.PLAIN_TEXT);

    Logger.log('[BACKUP] ✅ ' + salvos + ' arquivos salvos em Drive/BACKUP_CHECKPOINT/' + hoje);
    return { success: true, total: salvos, pasta: 'BACKUP_CHECKPOINT/' + hoje };

  } catch (error) {
    Logger.log('[BACKUP] ❌ Erro: ' + error.toString());
    // Notifica Gabriel por e-mail em caso de falha
    try {
      MailApp.sendEmail({
        to:      OWNER_MASTER_EMAIL,
        subject: '⚠️ [CHECKPOINT] Falha no backup automático',
        body:    'O backup automático falhou em ' +
                 Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss') +
                 '\n\nErro: ' + error.toString()
      });
    } catch(e) {}
    return { success: false, message: error.toString() };
  }
}

/**
 * Instala o trigger diário às 22h (horário de São Paulo).
 * Executar manualmente UMA VEZ pelo editor do GAS após o clasp push.
 */
function configurarTriggerBackup() {
  // Remove triggers anteriores de backup para evitar duplicatas
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'fazerBackup')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // Cria trigger diário entre 22h e 23h (GAS usa janelas de 1h)
  ScriptApp.newTrigger('fazerBackup')
    .timeBased()
    .everyDays(1)
    .atHour(22)
    .inTimezone('America/Sao_Paulo')
    .create();

  Logger.log('[BACKUP] ✅ Trigger configurado: backup diário às 22h (São Paulo).');
  return 'Trigger de backup criado com sucesso. Próximo backup: hoje às 22h.';
}

/**
 * Remove o trigger de backup.
 */
function removerTriggerBackup() {
  const triggers = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'fazerBackup');
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('[BACKUP] Trigger removido. Total removidos: ' + triggers.length);
}

/**
 * Lista todos os backups existentes no Drive.
 * Retorna array de { data, arquivos, url }
 */
function listarBackups() {
  try {
    const rootIter = DriveApp.getFoldersByName(BACKUP_ROOT_NAME);
    if (!rootIter.hasNext()) return [];

    const backupRoot = rootIter.next();
    const pastas     = backupRoot.getFolders();
    const resultado  = [];

    while (pastas.hasNext()) {
      const pasta  = pastas.next();
      const files  = pasta.getFiles();
      let   count  = 0;
      while (files.hasNext()) { files.next(); count++; }

      resultado.push({
        data:    pasta.getName(),
        arquivos: count,
        url:     pasta.getUrl()
      });
    }

    resultado.sort((a, b) => b.data.localeCompare(a.data)); // mais recente primeiro
    Logger.log('[BACKUP] Backups encontrados: ' + resultado.length);
    return resultado;

  } catch (error) {
    Logger.log('[BACKUP] Erro ao listar: ' + error.toString());
    return [];
  }
}
