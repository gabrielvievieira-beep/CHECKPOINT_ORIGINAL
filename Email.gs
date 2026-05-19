// EMAIL.GS

let COLABORADORES_SEM_SETOR = [];

// Exceção do gestor multiárea: idgroot -> setores que NÃO contam como divergência
const SETORES_POR_GESTOR_EXCLUIDO = {
  '148960': new Set(['PUTAWAY', 'REPLENISHMENT']),
  '1822407': new Set(['PUTAWAY', 'REPLENISHMENT']),
  '128644': new Set(['QUALIDADE', 'INSUMOS', 'ICQA']),
  '128553': new Set(['QUALIDADE', 'INSUMOS', 'ICQA']),
  '1846633': new Set(['PICKING', 'JOKER'])
};

// Equivalência de setores para normalização
const EQUIVALENCIAS_SETORES = {
  'Gate': 'Receiving',
  'Receiving': 'Gate',
  'Returns': 'Reversa',
  'Reversa': 'Returns',
  'LP FBM': 'Loss Prevention',
  'Loss Prevention': 'LP FBM',
  'Qualidade': 'Inventario',
  'Inventario': 'Qualidade'
};

// Normaliza nomes de setor para comparação (Gate=Receiving, Returns=Reversa, etc)
function normalizarSetor(setor) {
  if (!setor || typeof setor !== 'string') return '';
  const setorTrim = setor.trim().replace(/\s+/g, ' ');
  if (!setorTrim) return '';
  
  const setorUpper = setorTrim.toUpperCase();
  const setorNoSpace = setorUpper.replace(/\s+/g, '');

  if (setorUpper === 'GATE' || setorUpper === 'RECEIVING') return 'GATE';
  if (setorUpper === 'RETURNS' || setorUpper === 'REVERSA') return 'RETURNS';
  if (setorUpper === 'LP FBM' || setorUpper === 'LOSS PREVENTION') return 'LP FBM';
  if (setorUpper === 'QUALIDADE' || setorUpper === 'INVENTARIO') return 'QUALIDADE';

  if (setorNoSpace === 'PUTAWAY') return 'PUTAWAY';
  if (setorUpper === 'REPLENISHMENT') return 'REPLENISHMENT';
  if (setorUpper === 'INSUMOS' || setorUpper === 'ICQA') return setorUpper;

  return setorUpper;
}

// Compara SETOR do colaborador com SETOR do gestor na tabela V_MTX_COLABORADORES
// Retorna colaboradores onde setor diverge
function listarColaboradoresSetorDivergente() {
  try {
    const query = `
      WITH GESTORES_SETOR AS (
        SELECT DISTINCT
          COLABORADOR AS GESTOR,
          SETOR AS SETOR_GESTOR
        FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
        WHERE STATUS NOT IN ('Inativo', 'INATIVO')
          AND (CARGO IS NULL OR UPPER(CARGO) NOT IN (
            'SUPERVISOR', 'GERENTE', 'ANALISTA', 'ANALISTA SEMI SENIOR', 
            'COORDINATOR', 'ASSISTENTE', 'GERENTE SENIOR', 'ANALISTA SENIOR', 
            'ANALISTA SSR', 'ANALISTA SR', 'ASSISTANT', 'ANALISTA JR', 
            'GERENTE SR', 'ANALIST'
          ))
          AND (CARGO IS NULL OR CARGO NOT IN (
            'Supervisor', 'Gerente', 'Analista', 'Analista Semi Senior', 
            'Coordinator', 'Assistente', 'Gerente Senior', 'Analista Senior', 
            'Analista Ssr', 'Analista Sr', 'Assistant', 'Analista Jr', 
            'Gerente Sr', 'Analist'
          ))
          AND COLABORADOR IS NOT NULL
          AND TRIM(COLABORADOR) != ''
          AND SETOR IS NOT NULL
          AND TRIM(SETOR) != ''
          AND (TURNO IS NULL OR UPPER(TRIM(TURNO)) != 'T3')
      ),
      GESTORES_SETOR_FINAL AS (
        SELECT 
          GESTOR,
          SETOR_GESTOR,
          ROW_NUMBER() OVER (PARTITION BY GESTOR ORDER BY SETOR_GESTOR) AS rn
        FROM GESTORES_SETOR
      )
      SELECT 
        COALESCE(c.GESTOR, 'Sem gestor') AS GESTOR,
        c.COLABORADOR,
        c.ID_GROOT,
        c.ID_GROOT_GESTOR,
        c.AREA,
        c.SETOR AS SETOR_COLABORADOR,
        g.SETOR_GESTOR,
        c.CARGO
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\` c
      LEFT JOIN GESTORES_SETOR_FINAL g ON c.GESTOR = g.GESTOR AND g.rn = 1
      WHERE c.STATUS NOT IN ('Inativo', 'INATIVO')
        AND (c.CARGO IS NULL OR UPPER(c.CARGO) NOT IN (
          'SUPERVISOR', 'GERENTE', 'ANALISTA', 'ANALISTA SEMI SENIOR', 
          'COORDINATOR', 'ASSISTENTE', 'GERENTE SENIOR', 'ANALISTA SENIOR', 
          'ANALISTA SSR', 'ANALISTA SR', 'ASSISTANT', 'ANALISTA JR', 
          'GERENTE SR', 'ANALIST'
        ))
        AND (c.CARGO IS NULL OR c.CARGO NOT IN (
          'Supervisor', 'Gerente', 'Analista', 'Analista Semi Senior', 
          'Coordinator', 'Assistente', 'Gerente Senior', 'Analista Senior', 
          'Analista Ssr', 'Analista Sr', 'Assistant', 'Analista Jr', 
          'Gerente Sr', 'Analist'
        ))
        AND (c.TURNO IS NULL OR UPPER(TRIM(c.TURNO)) != 'T3')
        AND (
          (c.SETOR IS NULL OR TRIM(c.SETOR) = '')
          OR
          (g.SETOR_GESTOR IS NOT NULL 
           AND c.SETOR IS NOT NULL 
           AND TRIM(c.SETOR) != '')
        )
      ORDER BY 
        CASE WHEN c.GESTOR IS NULL OR TRIM(c.GESTOR) = '' THEN 1 ELSE 0 END,
        c.GESTOR,
        c.COLABORADOR
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
    if (!result.rows) return {};
    
    const colaboradores = result.rows.map(row => {
      const colaborador = {};
      result.schema.fields.forEach((field, index) => {
        colaborador[field.name.toLowerCase()] = row.f[index].v;
      });
      return colaborador;
    });
    
    const colaboradoresFiltrados = colaboradores.filter(colab => {
      const setorColab = (colab.setor_colaborador || '').trim();
      const setorGestor = (colab.setor_gestor || '').trim();

      const idGestor = String(colab.id_groot_gestor || '').replace(/\D/g, '');
      const setoresExcecao = SETORES_POR_GESTOR_EXCLUIDO[idGestor];
      if (setoresExcecao) {
        const setorColabNorm = normalizarSetor(setorColab);
        if (setoresExcecao.has(setorColabNorm)) {
          return false; // não considerar como divergência
        }
      }

      if (!setorColab) return true;
      if (!setorGestor) return true;

      const setorColabNormalizado = normalizarSetor(setorColab);
      const setorGestorNormalizado = normalizarSetor(setorGestor);

      return setorColabNormalizado !== setorGestorNormalizado;
    });
    
    const agrupadoPorGestor = {};
    colaboradoresFiltrados.forEach(colab => {
      const gestor = colab.gestor || 'Sem gestor';
      if (!agrupadoPorGestor[gestor]) agrupadoPorGestor[gestor] = [];
      agrupadoPorGestor[gestor].push(colab);
    });
    
    Logger.log(`Colaboradores com setor divergente encontrados: ${colaboradoresFiltrados.length}`);
    return agrupadoPorGestor;
    
  } catch (error) {
    Logger.log('Erro ao listar colaboradores com setor divergente: ' + error.toString());
    throw error;
  }
}

// Busca colaboradores onde SETOR é NULL ou vazio na tabela V_MTX_COLABORADORES
function listarColaboradoresSemSetor() {
  try {
    const query = `
      SELECT 
        COLABORADOR, ID_GROOT, AREA, SETOR, CARGO, GESTOR
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_COLABORADORES}\`
      WHERE STATUS NOT IN ('Inativo', 'INATIVO')
        AND (CARGO IS NULL OR UPPER(CARGO) NOT IN (
          'SUPERVISOR', 'GERENTE', 'ANALISTA', 'ANALISTA SEMI SENIOR', 
          'COORDINATOR', 'ASSISTENTE', 'GERENTE SENIOR', 'ANALISTA SENIOR', 
          'ANALISTA SSR', 'ANALISTA SR', 'ASSISTANT', 'ANALISTA JR', 
          'GERENTE SR', 'ANALIST'
        ))
        AND (CARGO IS NULL OR CARGO NOT IN (
          'Supervisor', 'Gerente', 'Analista', 'Analista Semi Senior', 
          'Coordinator', 'Assistente', 'Gerente Senior', 'Analista Senior', 
          'Analista Ssr', 'Analista Sr', 'Assistant', 'Analista Jr', 
          'Gerente Sr', 'Analist'
        ))
        AND (TURNO IS NULL OR UPPER(TRIM(TURNO)) != 'T3')
        AND (SETOR IS NULL OR TRIM(SETOR) = '')
      ORDER BY AREA, COLABORADOR
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
    
    const colaboradoresSemSetor = result.rows.map(row => {
      const colaborador = {};
      result.schema.fields.forEach((field, index) => {
        colaborador[field.name.toLowerCase()] = row.f[index].v;
      });
      return colaborador;
    });
    
    COLABORADORES_SEM_SETOR = colaboradoresSemSetor;
    Logger.log(`Colaboradores sem setor encontrados: ${colaboradoresSemSetor.length}`);
    return colaboradoresSemSetor;
    
  } catch (error) {
    Logger.log('Erro ao listar colaboradores sem setor: ' + error.toString());
    throw error;
  }
}

// Verifica colaboradores com setor divergente e envia email opcional
function verificarColaboradoresSemSetor(emailDestinatario) {
  try {
    if (typeof emailDestinatario === 'undefined') emailDestinatario = null;
    
    const agrupadoPorGestor = listarColaboradoresSetorDivergente();
    
    let totalColaboradores = 0;
    Object.keys(agrupadoPorGestor).forEach(gestor => {
      totalColaboradores += agrupadoPorGestor[gestor].length;
    });
    
    if (totalColaboradores === 0) {
      Logger.log('✓ Nenhum colaborador com setor divergente encontrado!');
      return { sucesso: true, mensagem: 'Nenhum colaborador com setor divergente', total: 0, lista: [] };
    }
    
    const gestoresOrdenados = Object.keys(agrupadoPorGestor).sort((a, b) => {
      if (a === 'Sem gestor') return 1;
      if (b === 'Sem gestor') return -1;
      return a.localeCompare(b);
    });
    
    // Mensagem texto simples para Logger
    let mensagemTexto = `Relatório de divergências na base de ABS\n\n`;
    gestoresOrdenados.forEach(gestor => {
      const colaboradores = agrupadoPorGestor[gestor];
      const total = colaboradores.length;
      const setorGestor = colaboradores[0]?.setor_gestor || 'Sem setor';
      
      if (gestor === 'Sem gestor') {
        mensagemTexto += `Sem gestor:\n`;
      } else {
        mensagemTexto += `${gestor} (${setorGestor})\n`;
      }
      
      colaboradores.forEach(colab => {
        const nome = colab.colaborador || 'N/A';
        const setorColaborador = colab.setor_colaborador || 'Sem setor';
        mensagemTexto += `  ${nome}\n`;
        mensagemTexto += `  Cadastrado como Setor ${setorColaborador}\n\n`;
      });
    });
    mensagemTexto += `\nTotal: ${totalColaboradores} colaborador(es) com setor divergente ou sem setor.\n\nAtenciosamente,\nTime ID/EA BA01`;
    
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
                  ⚠️ Colaboradores com Setor Divergente
                </div>
                <div style="opacity:.9;font-size:14px;line-height:1.2;">Relatório de divergências na base de ABS</div>
              </div>
        `;
        
        gestoresOrdenados.forEach(gestor => {
          const colaboradores = agrupadoPorGestor[gestor];
          const total = colaboradores.length;
          const setorGestor = colaboradores[0]?.setor_gestor || 'Sem setor';
          
          htmlBody += `
            <div style="background:#FFFFFF;border-radius:14px;padding:8px 12px;box-shadow:0 8px 18px rgba(46,116,181,.15);border:1px solid #E6EEF8;margin-top:16px;">
              <div style="margin-bottom:8px;">
                <div style="display:inline-block;width:20px;height:20px;background:#E6F0FA;border-radius:6px;text-align:center;line-height:20px;color:#2E74B5;font-size:12px;margin-right:6px;vertical-align:middle;">👤</div>
                <div style="display:inline-block;font-weight:600;color:#2E3A59;font-size:14px;vertical-align:middle;">
                  ${gestor === 'Sem gestor' ? 'Sem gestor' : `${gestor} <span style="color:#4B647A;font-weight:normal;">(${setorGestor})</span>`}
                </div>
              </div>
              <div style="margin-top:8px;border-top:1px dashed #D7E3F3;padding-top:8px;">
          `;
          
          colaboradores.forEach(colab => {
            const nome = colab.colaborador || 'N/A';
            const setorColaborador = colab.setor_colaborador || 'Sem setor';
            htmlBody += `
              <div style="margin-bottom:6px;padding:6px 0;">
                <div style="font-weight:600;color:#1F2937;font-size:13px;margin-bottom:2px;">${nome}</div>
                <div style="color:#4B647A;font-size:12px;">Cadastrado como Setor <strong style="color:#2E74B5;">${setorColaborador}</strong></div>
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
                  ${totalColaboradores} colaborador${totalColaboradores !== 1 ? 'es' : ''} com setor divergente ou sem setor
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
          subject: `Relatório de divergências na base de ABS`,
          body: mensagemTexto,
          htmlBody: htmlBody
        });
        Logger.log(`Email enviado para: ${emailDestinatario}`);
      } catch (emailError) {
        Logger.log('Erro ao enviar email: ' + emailError.toString());
      }
    }
    
    return { sucesso: true, mensagem: `${totalColaboradores} colaborador(es) com setor divergente`, total: totalColaboradores, lista: agrupadoPorGestor };
    
  } catch (error) {
    Logger.log('Erro ao verificar colaboradores sem setor: ' + error.toString());
    return { sucesso: false, mensagem: error.toString(), total: 0, lista: [] };
  }
}

// Envia email com colaboradores com setor divergente para a lista de destinatários
function enviarEmailColaboradoresSemSetor() {
  const emailDestinatarios = EMAIL_DESTINATARIOS.join(',');
  
  return verificarColaboradoresSemSetor(emailDestinatarios);
}
