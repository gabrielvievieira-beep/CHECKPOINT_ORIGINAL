// PRINCIPAL.GS

// doGet recebe parâmetro ?page=X e renderiza o HTML correspondente
function doGet(e) {
  try {
    let page = 'index';
    if (e && e.parameter && e.parameter.page) {
      page = e.parameter.page;
    }
    
    Logger.log('doGet chamado - page: ' + page);
    if (e && e.parameter) {
      Logger.log('e.parameter: ' + JSON.stringify(e.parameter));
    }
    
    let template;
    const scriptUrl = ScriptApp.getService().getUrl();
    
    switch(page) {
      case 'index':
        template = HtmlService.createTemplateFromFile('index');
        break;
      case 'chamada':
        template = HtmlService.createTemplateFromFile('chamada');
        break;
      case 'historico':
        template = HtmlService.createTemplateFromFile('historico');
        break;
      case 'pendencias':
        template = HtmlService.createTemplateFromFile('pendencias');
        break;
      case 'flow':
        template = HtmlService.createTemplateFromFile('flow');
        break;
      case 'ausencia':
        template = HtmlService.createTemplateFromFile('ausencia');
        break;
      case 'availabletime':
        template = HtmlService.createTemplateFromFile('availabletime');
        break;
      case 'people':
        template = HtmlService.createTemplateFromFile('people');
        break;
      case 'acessos':
        // Página de Acessos: exclusiva do Owner Master (Gabriel Vieira)
        if (!isOwnerMaster()) {
          return HtmlService.createHtmlOutput(
            '<html><body style="padding:40px;font-family:Arial;background:#111;color:#fff;">' +
            '<h2 style="color:#ef4444;">⛔ Acesso Negado</h2>' +
            '<p>Esta página é exclusiva do administrador master do sistema.</p>' +
            '<p>Para solicitar acesso, entre em contato com <strong>gabrielvie.vieira@mercadolivre.com</strong>.</p>' +
            '</body></html>'
          ).setTitle('Acesso Negado');
        }
        template = HtmlService.createTemplateFromFile('acessos');
        break;
      case 'matrix':
        template = HtmlService.createTemplateFromFile('matrix_contratacoes');
        break;
      case 'mapapresenca':
        template = HtmlService.createTemplateFromFile('mapa-presenca');
        break;
      case 'glossario':
        template = HtmlService.createTemplateFromFile('glossario');
        break;
      default:
        template = HtmlService.createTemplateFromFile('index');
    }
    
    template.scriptUrl = scriptUrl;
    
    return template.evaluate()
      .setTitle('Sistema de Absenteísmo')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
      
  } catch (error) {
    Logger.log('ERRO no doGet: ' + error.toString());
    return HtmlService.createHtmlOutput(
      '<html><body style="padding: 40px; font-family: Arial;">' +
      '<h1 style="color: red;">Erro ao carregar página</h1>' +
      '<p><strong>Erro:</strong> ' + error.toString() + '</p>' +
      '</body></html>'
    ).setTitle('Erro - Sistema de Absenteísmo');
  }
}

function getPageContent(pageName) {
  try {
    let fileName = 'index';
    switch(pageName) {
      case 'chamada': fileName = 'chamada'; break;
      case 'historico': fileName = 'historico'; break;
      case 'flow': fileName = 'flow'; break;
      case 'ausencia': fileName = 'ausencia'; break;
      case 'availabletime': fileName = 'availabletime'; break;
      case 'people': fileName = 'people'; break;
      case 'acessos': fileName = 'acessos'; break;
      case 'matrix': fileName = 'matrix_contratacoes'; break;
      case 'index': default: fileName = 'index'; break;
    }
    
    return HtmlService.createTemplateFromFile(fileName).evaluate().getContent();
  } catch (error) {
    Logger.log('ERRO getPageContent: ' + error.toString());
    return '<h1>Erro ao carregar página</h1><p>' + error.toString() + '</p>';
  }
}

// Inclui arquivos HTML parciais (style.html, etc)
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}


// Testa conexão com BigQuery, colaboradores, histórico
function testarConexaoBigQuery() {
  Logger.log('=== TESTE DE CONEXÃO BIGQUERY ===');
  
  try {
    Logger.log('\n1. Testando busca de colaboradores...');
    const colaboradores = getColaboradores();
    Logger.log('✓ Colaboradores encontrados: ' + colaboradores.length);
    
    Logger.log('\n2. Testando busca de histórico...');
    const historico = getHistorico();
    Logger.log('✓ Registros de histórico encontrados: ' + historico.length);
    
    Logger.log('\n3. Testando busca de registros do dia atual...');
    const registrosDia = getRegistrosDiaAtual();
    Logger.log('✓ Registros do dia encontrados: ' + registrosDia.length);
    
    Logger.log('\n4. Testando obtenção de email do usuário...');
    const email = getUsuarioEmail();
    Logger.log('✓ Email do usuário: ' + email);
    
    Logger.log('\n=== TODOS OS TESTES PASSARAM ===');
    return { sucesso: true, colaboradores: colaboradores.length, historico: historico.length, registrosDia: registrosDia.length, email: email };
    
  } catch (error) {
    Logger.log('\n❌ ERRO: ' + error.toString());
    return { sucesso: false, erro: error.toString() };
  }
}
