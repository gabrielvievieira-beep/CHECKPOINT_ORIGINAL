// PERMISSOES.GS
//
// Perfis disponíveis:
//   ADMIN      – Acesso total (ver + editar + adicionar em tudo)
//   LIDER      – Ver: Chamada, Ausências, Available Time, Matrix, Início
//                Editar/Adicionar: Chamada, Ausências, Matrix
//   OBSERVADOR – Ver: Chamada, Available Time, Matrix, Início  (somente leitura)
//   FLOW       – Ver: Flow, Histórico, Matrix, Início
//                Editar: Flow, Histórico  |  Não adiciona nada
//   PEOPLE     – Ver: Available Time, Matrix, People, Início  (somente leitura)

// ── Owners master — acesso ADMIN garantido e imutável ───────────────────────
// Acesso ADMIN garantido por código, independente da tabela BQ.
// Nenhuma operação do sistema pode remover, rebaixar ou alterar esses acessos.
const OWNER_EMAILS = [
  'gabrielvie.vieira@mercadolivre.com',
  'lucas.leal@mercadolivre.com'
];

function getPermissoesUsuario() {
  try {
    const email = getUsuarioEmail();

    // Owner bypass: garante ADMIN sem depender da tabela de permissões
    if (OWNER_EMAILS.includes((email || '').toLowerCase().trim())) {
      return { perfil: 'ADMIN', areas: ['*'] };
    }

    const query = `SELECT EMAIL, PERFIL FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_PERMISSOES}\` WHERE EMAIL = '${email}'`;

    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;

    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false, location: BQ_LOCATION })
    };

    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result = JSON.parse(response.getContentText());

    if (result.error) throw new Error(result.error.message);
    if (!result.rows || result.rows.length === 0) return null;

    const permissoes = result.rows.map(row => {
      const permissao = {};
      result.schema.fields.forEach((field, index) => {
        permissao[field.name.toLowerCase()] = row.f[index].v;
      });
      return permissao;
    });

    // Se tem perfil ADMIN, libera acesso total
    const temAdmin = permissoes.some(p => p.perfil && p.perfil.toUpperCase() === 'ADMIN');
    if (temAdmin) {
      return { perfil: 'ADMIN', areas: ['*'] };
    }

    return { perfil: permissoes[0].perfil, areas: ['*'] };
  } catch (error) {
    Logger.log('Erro ao buscar permissões: ' + error.toString());
    return null;
  }
}

// Insere nova permissão na tabela de permissões
function criarPermissao(email, area, perfil) {
  exigeOwnerMaster('criarPermissao');
  if (isOwnerMaster(email)) {
    return { sucesso: false, mensagem: 'O owner master não pode ser modificado.' };
  }
  try {
    const responsavel = getUsuarioEmail();
    const query = `
      INSERT INTO \`${PROJECT_ID}.${DATASET_ID}.${TABLE_PERMISSOES}\`
      (EMAIL, AREA, PERFIL, RESPONSAVEL, DATA_CRIACAO, DATA_ATUALIZACAO)
      VALUES
      ('${email}', '${area}', '${perfil}', '${responsavel}', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
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
    const result = JSON.parse(response.getContentText());

    if (result.error) throw new Error(result.error.message);

    Logger.log('Permissão criada: ' + email + ' - ' + perfil);
    return { sucesso: true };
  } catch (error) {
    Logger.log('Erro ao criar permissão: ' + error.toString());
    throw error;
  }
}

// Lista todas as permissões cadastradas
function listarPermissoes() {
  try {
    const query = `SELECT EMAIL, AREA, PERFIL, RESPONSAVEL, DATA_CRIACAO, DATA_ATUALIZACAO FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_PERMISSOES}\` ORDER BY EMAIL, AREA`;

    const token = getTokenBigQuery();
    const apiEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;

    const options = {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${token}` },
      payload: JSON.stringify({ query: query, useLegacySql: false, location: BQ_LOCATION })
    };

    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const result = JSON.parse(response.getContentText());

    if (result.error) throw new Error(result.error.message);
    if (!result.rows) return [];

    return result.rows.map(row => {
      const permissao = {};
      result.schema.fields.forEach((field, index) => {
        permissao[field.name.toLowerCase()] = row.f[index].v;
      });
      return permissao;
    });
  } catch (error) {
    Logger.log('Erro ao listar permissões: ' + error.toString());
    throw error;
  }
}

// Retorna perfil do usuário logado (ADMIN | LIDER | OBSERVADOR | FLOW | PEOPLE)
function getPerfilUsuario() {
  const permissoes = getPermissoesUsuario();
  if (!permissoes) return null;
  return permissoes.perfil ? permissoes.perfil.toUpperCase() : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Matriz de permissões por perfil
//
//  Páginas válidas: index | chamada | flow | historico | ausencia |
//                  availabletime | people | matrix | acessos
//
//  ADMIN      → tudo
//  LIDER      → ver: index, chamada, ausencia, availabletime, matrix
//               editar/adicionar: chamada, ausencia, matrix
//  OBSERVADOR → ver: index, chamada, availabletime, matrix  (só leitura)
//  FLOW       → ver: index, flow, historico, matrix
//               editar: flow, historico  |  não adiciona
//  PEOPLE     → ver: index, availabletime, people, matrix  (só leitura)
// ─────────────────────────────────────────────────────────────────────────────

const _PAGINAS_VER = {
  ADMIN:      ['index', 'chamada', 'flow', 'historico', 'ausencia', 'availabletime', 'people', 'matrix', 'acessos'],
  LIDER:      ['index', 'chamada', 'ausencia', 'availabletime', 'matrix', 'historico', 'flow'],
  OBSERVADOR: ['index', 'chamada', 'availabletime', 'matrix', 'historico', 'flow'],
  FLOW:       ['index', 'flow', 'historico', 'matrix'],
  PEOPLE:     ['index', 'availabletime', 'people', 'matrix'],
};

const _PAGINAS_EDITAR = {
  ADMIN:      ['index', 'chamada', 'flow', 'historico', 'ausencia', 'availabletime', 'people', 'matrix', 'acessos'],
  LIDER:      ['chamada', 'ausencia', 'matrix'],
  OBSERVADOR: [],
  FLOW:       ['flow', 'historico'],
  PEOPLE:     [],
};

const _PAGINAS_ADICIONAR = {
  ADMIN:      ['index', 'chamada', 'flow', 'historico', 'ausencia', 'availabletime', 'people', 'matrix', 'acessos'],
  LIDER:      ['chamada', 'ausencia', 'matrix'],
  OBSERVADOR: [],
  FLOW:       [],
  PEOPLE:     [],
};

// Verifica se o usuário pode visualizar a página
function podeVerPagina(nomePagina) {
  const perfil = getPerfilUsuario();
  if (!perfil) return false;

  // Acessos: exclusivo ADMIN
  if (nomePagina === 'acessos') return perfil === 'ADMIN';

  const lista = _PAGINAS_VER[perfil];
  if (!lista) return false;
  return lista.includes(nomePagina.toLowerCase());
}

// Verifica se o usuário pode editar na página
function podeEditar(nomePagina) {
  const perfil = getPerfilUsuario();
  if (!perfil) return false;

  const lista = _PAGINAS_EDITAR[perfil];
  if (!lista) return false;
  return lista.includes(nomePagina.toLowerCase());
}

// Verifica se o usuário pode adicionar na página
function podeAdicionar(nomePagina) {
  const perfil = getPerfilUsuario();
  if (!perfil) return false;

  const lista = _PAGINAS_ADICIONAR[perfil];
  if (!lista) return false;
  return lista.includes(nomePagina.toLowerCase());
}
