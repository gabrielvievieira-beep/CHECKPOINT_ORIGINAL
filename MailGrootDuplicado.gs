// EMAILIDGROOTDUPLICADO.GS
// Email de teste para verificar ID_GROOTs duplicados (apenas ativos)


// Lista colaboradores com ID_GROOT duplicado (apenas ativos)
function listarColaboradoresIdgrootDuplicado() {
  try {
    const query = `
      WITH ID_GROOT_DUPLICADOS AS (
        SELECT ID_GROOT, COUNT(*) as QTD
        FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
        WHERE STATUS NOT IN ('Inativo', 'INATIVO')
        GROUP BY ID_GROOT
        HAVING COUNT(*) > 1
      )
      SELECT 
        c.ID_GROOT,
        c.COLABORADOR,
        c.AREA,
        c.SETOR,
        c.CARGO,
        c.GESTOR,
        c.STATUS,
        c.TURNO,
        d.QTD
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\` c
      INNER JOIN ID_GROOT_DUPLICADOS d ON c.ID_GROOT = d.ID_GROOT
      WHERE c.STATUS NOT IN ('Inativo', 'INATIVO')
      ORDER BY c.ID_GROOT, c.COLABORADOR
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
    
    const colaboradores = result.rows.map(row => {
      const colaborador = {};
      result.schema.fields.forEach((field, index) => {
        colaborador[field.name.toLowerCase()] = row.f[index].v;
      });
      return colaborador;
    });
    
    Logger.log(`Colaboradores com IDGROOT duplicado encontrados: ${colaboradores.length}`);
    return colaboradores;
    
  } catch (error) {
    Logger.log('Erro ao listar colaboradores com IDGROOT duplicado: ' + error.toString());
    throw error;
  }
}

// Verifica colaboradores com IDGROOT duplicado e envia email
function verificarColaboradoresIdgrootDuplicado(emailDestinatario) {
  try {
    if (typeof emailDestinatario === 'undefined') emailDestinatario = null;
    
    const colaboradores = listarColaboradoresIdgrootDuplicado();
    
    if (colaboradores.length === 0) {
      Logger.log('✓ Nenhum colaborador com IDGROOT duplicado encontrado!');
      return { sucesso: true, mensagem: 'Nenhum colaborador com IDGROOT duplicado', total: 0, lista: [] };
    }
    
    // Agrupa por IDGROOT
    const agrupadoPorIdgroot = {};
    colaboradores.forEach(colab => {
      const idgroot = colab.idgroot || 'N/A';
      if (!agrupadoPorIdgroot[idgroot]) agrupadoPorIdgroot[idgroot] = [];
      agrupadoPorIdgroot[idgroot].push(colab);
    });
    
    const idgrootsOrdenados = Object.keys(agrupadoPorIdgroot).sort((a, b) => {
      return parseInt(a) - parseInt(b);
    });
    
    // Mensagem texto simples para Logger
    // Avisos no início
    let mensagemTexto = `Relatório de IDGROOTs duplicados na base de ABS\n\n`;
    mensagemTexto += `⚠️ AVISOS IMPORTANTES:\n\n`;
    mensagemTexto += `1. Impacto no Absenteísmo:\n`;
    mensagemTexto += `O Time de ID/EA faz apenas o reporte. Devido à regra do absenteísmo que utiliza o campo IDGROOT como chave única, caso existam colaboradores com o mesmo IDGROOT, um deles não aparecerá no absenteísmo, prejudicando a base de colaboradores como um todo.\n\n`;
    mensagemTexto += `2. Responsabilidade pelo Cadastro:\n`;
    mensagemTexto += `Não nos responsabilizamos pelo cadastro indevido dos colaboradores devido a ser um dado único, sendo assim, não haverá função para alteração do mesmo no aplicativo Checkpoint BA01.\n\n`;
    mensagemTexto += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    // Dados dos colaboradores
    idgrootsOrdenados.forEach(idgroot => {
      const colaboradores = agrupadoPorIdgroot[idgroot];
      mensagemTexto += `IDGROOT: ${idgroot} (${colaboradores.length} ocorrências)\n`;
      
      colaboradores.forEach(colab => {
        const nome = colab.colaborador || 'N/A';
        const area = colab.area || 'N/A';
        const setor = colab.setor || 'N/A';
        const cargo = colab.cargo || 'N/A';
        const gestor = colab.gestor || 'N/A';
        const status = colab.status || 'N/A';
        mensagemTexto += `  - ${nome} | ${area} | ${setor} | ${cargo} | Gestor: ${gestor} | Status: ${status}\n`;
      });
      mensagemTexto += `\n`;
    });
    
    mensagemTexto += `Total: ${colaboradores.length} registro(s) com IDGROOT duplicado.\n\n`;
    mensagemTexto += `Atenciosamente,\nTime ID/EA BA01`;
    
    Logger.log(mensagemTexto);
    
    if (emailDestinatario) {
      try {
        // HTML formatado para o email
        let htmlBody = `
          <div style="font-family:Segoe UI,Arial,sans-serif;background:#F5F7FB;padding:70px 20px;color:#1F2937;width:100%;min-height:100vh;">
            <div style="max-width:700px;margin:0;width:100%;">
              
              <!-- Título -->
              <div style="background:linear-gradient(90deg,#2E74B5,#2A5FA0);color:#fff;padding:8px 20px;border-radius:12px;box-shadow:0 4px 10px rgba(46,116,181,.2);margin-bottom:16px;">
                <div style="font-size:24px;font-weight:600;margin-bottom:0;line-height:1.2;">
                  ⚠️ Colaboradores com IDGROOT Duplicado
                </div>
                <div style="opacity:.9;font-size:14px;line-height:1.2;">Relatório de duplicidades na base de ABS</div>
              </div>

              <!-- Avisos -->
              <div style="background:#FFF4E6;border-left:4px solid #F59E0B;border-radius:8px;padding:16px;margin-bottom:20px;box-shadow:0 2px 6px rgba(245,158,11,.1);">
                <div style="font-size:14px;font-weight:600;color:#92400E;margin-bottom:12px;">⚠️ Avisos Importantes:</div>
                <div style="font-size:13px;color:#78350F;line-height:1.6;margin-bottom:10px;">
                  <strong>1. Impacto no Absenteísmo:</strong><br>
                  O Time de ID/EA faz apenas o reporte. Devido à regra do absenteísmo que utiliza o campo IDGROOT como chave única, caso existam colaboradores com o mesmo IDGROOT, um deles não aparecerá no absenteísmo, prejudicando a base de colaboradores como um todo.
                </div>
                <div style="font-size:13px;color:#78350F;line-height:1.6;">
                  <strong>2. Responsabilidade pelo Cadastro:</strong><br>
                  Não nos responsabilizamos pelo cadastro indevido dos colaboradores devido a ser um dado único, sendo assim, não haverá função para alteração do mesmo no aplicativo Checkpoint BA01.
                </div>
              </div>
        `;
        
        idgrootsOrdenados.forEach(idgroot => {
          const colaboradores = agrupadoPorIdgroot[idgroot];
          
          htmlBody += `
            <div style="background:#FFFFFF;border-radius:14px;padding:8px 12px;box-shadow:0 8px 18px rgba(46,116,181,.15);border:1px solid #E6EEF8;margin-top:16px;">
              <div style="margin-bottom:8px;">
                <div style="display:inline-block;width:20px;height:20px;background:#E6F0FA;border-radius:6px;text-align:center;line-height:20px;color:#2E74B5;font-size:12px;margin-right:6px;vertical-align:middle;">🔢</div>
                <div style="display:inline-block;font-weight:600;color:#2E3A59;font-size:14px;vertical-align:middle;">
                  IDGROOT: <span style="color:#2E74B5;">${idgroot}</span> <span style="color:#4B647A;font-weight:normal;">(${colaboradores.length} ocorrências)</span>
                </div>
              </div>
              <div style="margin-top:8px;border-top:1px dashed #D7E3F3;padding-top:8px;">
          `;
          
          colaboradores.forEach(colab => {
            const nome = colab.colaborador || 'N/A';
            const area = colab.area || 'N/A';
            const setor = colab.setor || 'N/A';
            const cargo = colab.cargo || 'N/A';
            const gestor = colab.gestor || 'N/A';
            const status = colab.status || 'N/A';
            const turno = colab.turno || 'N/A';
            
            htmlBody += `
              <div style="margin-bottom:6px;padding:6px 0;">
                <div style="font-weight:600;color:#1F2937;font-size:13px;margin-bottom:4px;">${nome}</div>
                <div style="color:#4B647A;font-size:12px;line-height:1.6;">
                  <strong>Área:</strong> ${area} | <strong>Setor:</strong> ${setor}<br>
                  <strong>Cargo:</strong> ${cargo} | <strong>Turno:</strong> ${turno}<br>
                  <strong>Gestor:</strong> ${gestor} | <strong>Status:</strong> ${status}
                </div>
              </div>
            `;
          });
          
          htmlBody += `
              </div>
            </div>
          `;
        });
        
        htmlBody += `
              <!-- Total -->
              <div style="background:#FFFFFF;border-radius:8px;padding:12px;box-shadow:0 2px 6px rgba(23,43,77,.06);border:1px solid #E6EEF8;margin-top:16px;text-align:center;">
                <div style="font-size:13px;color:#4B647A;margin-bottom:4px;font-weight:500;">Total</div>
                <div style="font-size:18px;font-weight:600;color:#2E74B5;line-height:1.3;">
                  ${colaboradores.length} registro${colaboradores.length !== 1 ? 's' : ''} com IDGROOT duplicado
                </div>
              </div>

              <!-- Assinatura -->
              <div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #E6EEF8;">
                <div style="font-size:14px;color:#4B647A;margin-bottom:4px;">Atenciosamente,</div>
                <div style="font-size:16px;color:#2E74B5;font-weight:600;">Time ID/EA BA01</div>
              </div>

            </div>
          </div>
        `;
        
        MailApp.sendEmail({
          to: emailDestinatario,
          subject: `Relatório de IDGROOTs duplicados na base de ABS`,
          body: mensagemTexto,
          htmlBody: htmlBody
        });
        Logger.log(`Email enviado para: ${emailDestinatario}`);
      } catch (emailError) {
        Logger.log('Erro ao enviar email: ' + emailError.toString());
      }
    }
    
    return { sucesso: true, mensagem: `${colaboradores.length} registro(s) com IDGROOT duplicado`, total: colaboradores.length, lista: agrupadoPorIdgroot };
    
  } catch (error) {
    Logger.log('Erro ao verificar colaboradores com IDGROOT duplicado: ' + error.toString());
    return { sucesso: false, mensagem: error.toString(), total: 0, lista: [] };
  }
}

// Envia email com colaboradores com IDGROOT duplicado para teste
function enviarEmailIdgrootDuplicado() {
  const destinatarios = EMAIL_DESTINATARIOS.join(',');
  return verificarColaboradoresIdgrootDuplicado(destinatarios);
}



