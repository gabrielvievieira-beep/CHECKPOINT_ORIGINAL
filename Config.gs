// CONFIG.GS

// Conexão BigQuery: meli-sbox.BRBA01
const PROJECT_ID   = 'meli-sbox';
const DATASET_ID   = 'BRBA01';
// Region do dataset — necessário para DML (INSERT, DELETE, UPDATE)
// Confirmado via BigQuery Console: dataset BRBA01 está na multirregião US
const BQ_LOCATION  = 'US';
// IMPORTANTE: Se precisar reverter para a query antiga, trocar para 'LISTA_COLABORADORES_BA01'
// (e ajustar ID_GROOT para IDGROOT em Chamada.gs, Email.gs, People.gs, MailIdgrootDuplicado.gs, Ausencias.gs)
const TABLE_COLABORADORES = 'CP_LISTA_COLABORADORES';
const TABLE_HISTORICO     = 'CP_HISTORICO_ABS';
const TABLE_PERMISSOES    = 'CP_PERMISSOES_ABS';
const TABLE_AUSENCIAS     = 'CP_AUSENCIAS_PROGRAMADAS';
const TABLE_ESCALAS       = 'CP_ESCALAS_ROTATIVAS';

// Cache em segundos
const CACHE_DURATION           = 21600; // 6 horas — colaboradores (muda raramente)
const CACHE_DURATION_REGISTROS = 120;   // 2 minutos — presença do dia (atualizada pela catraca)
const CACHE_KEY_COLABORADORES  = 'colaboradores_cache';
const CACHE_KEY_REGISTROS_DIA  = 'registros_dia_cache';

// Cargos filtrados das queries (blacklist — só usada quando CARGOS_INCLUIDOS estiver vazio)
const CARGOS_EXCLUIDOS = [
  'Supervisor', 'Gerente', 'Analista', 'Analista Semi Senior',
  'Coordinator', 'Assistente', 'Gerente Senior', 'Analista Senior',
  'Analista Ssr', 'Analista Sr', 'Assistant', 'Analista Jr',
  'Gerente Sr', 'Analist', 'Specialist', 'Coordinator - Shipping',
  'Director', 'Gerente - IT', 'Analista Semi Senior - IT'
  // 'Sr Team Leader - Shipping' removido — agora está na whitelist (CARGOS_INCLUIDOS)
];

// Whitelist de cargos permitidos — ÚNICA fonte de verdade para Chamada, Flow e Histórico
// Se vazio, usa CARGOS_EXCLUIDOS como fallback (comportamento legado)
//
// Strings validadas diretamente no BigQuery Console (CP_LISTA_COLABORADORES, 2026-05-12).
// ATENÇÃO: BigQuery UPPER() preserva acentos — usar exatamente como está no banco.
const CARGOS_INCLUIDOS = [
  'Rep de Envio 1',          // confirmado no BD (era 'Representante de Envio 1' — ERRADO)
  'Rep de Envio 2',          // confirmado no BD
  'Rep de Envio 3',          // confirmado no BD
  'Operador Logístico 1',    // confirmado no BD — com acento (í)
  'Operador Logístico 2',    // presumido com acento por consistência
  'Operador Logístico 3',    // confirmado no BD — variante que existia sem número na whitelist
  'Sr Team Leader - Shipping',
  'Team Leader - Shipping',  // cargo de líder operacional — card LÍDERES
  'Team Leader',              // alias curto — também mapeado para card LÍDERES
  'Jovem Aprendiz'
];

// Setores filtrados das queries
const SETORES_EXCLUIDOS = [
  'Treinamento', 'STAFF', 'Staff', 'Flow',
  'People', 'Line Haul', 'Plant Engineering', 'Safety'
];

// Whitelist de setores permitidos — apenas esses entram na chamada
// Se vazio, usa SETORES_EXCLUIDOS como fallback
const SETORES_INCLUIDOS = [
  'Outbound', 'Inventario', 'ICQA', 'Qualidade', 'Inbound',
  'Retiro', 'Retiros', 'Returns'
];

// Áreas filtradas das queries
const AREAS_EXCLUIDAS = [
  'Safety', 'Flow', 'Treinamento', 'Plant Engineering', 'Line Haul', 'People', 'Staff',
  'Customer', 'Operations', 'Software', 'Loss Prevention',
  'CIE',          // área inválida confirmada — não representa nenhum grupo operacional
  'Almoxarifado', 'Maintenance', 'Gate'
];

// Áreas normalizadas (aliases → nome canônico)
// Usado como referência para o frontend; a normalização real fica em normalizarAreaCha / normalizarArea
// 'Inventario' | 'Qualidade'  → 'ICQA'
// 'Transfer MWH' | 'Transfer' → 'INBOUND'
// 'Retiros' | 'Returns'       → 'REVERSA'

// Pasta do Drive com fotos dos gestores
const FOLDER_FOTOS_GESTORES = '1easYGTRlGAYVkCUB5NIWnk3gCFc7l9xH';

// Autorização Matrix (Contratação): lista de e-mails com acesso apenas à página Matrix.
// Pode incluir e-mails externos; armazenada em Script Properties (chave abaixo).
// Fluxo independente das demais permissões (PERMISSOES_ABS_GESTORES_BA01).
const MATRIX_CONTRATACAO_EMAILS_KEY = 'MATRIX_CONTRATACAO_EMAILS';

// Lista de destinatários para emails de divergências
const EMAIL_DESTINATARIOS = [
  'lucas.leal@mercadolivre.com',
  'gabrielvie.vieira@mercadolivre.com']