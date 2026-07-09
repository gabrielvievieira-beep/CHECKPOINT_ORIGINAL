# Documentação Técnica — Sistema Checkpoint BA01

## Visão Geral

**Checkpoint BA01** é uma aplicação web construída em Google Apps Script (GAS) para gerenciamento de absenteísmo, chamada e métricas de tempo disponível dos colaboradores do armazém BA01 (Barueri/Alvorada) da MercadoLibre Brasil. Integra Google Sheets, Google Drive, Gmail e BigQuery.

---

## Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML5 + JavaScript (templates GAS) |
| Backend | Google Apps Script (runtime JS) |
| Banco de dados | BigQuery — projeto `meli-sbox`, dataset `BRBA01` |
| Dados externos | `meli-bi-data.WHOWNER` (timecard/catraca) |
| Armazenamento | Google Drive (backup, fotos) |
| E-mail | Gmail API via `MailApp` |
| Autenticação BQ | JWT com Service Account (chave em Script Properties) |

---

## Modelo de Execução

- Ponto de entrada: `doGet(e)` em `Principal.gs` — recebe `?page=X` e renderiza o template HTML correspondente.
- Frontend se comunica com o backend via `google.script.run` (RPC assíncrono).
- Autenticação BigQuery: JWT gerado em runtime com `SERVICE_ACCOUNT_KEY` (Script Properties).
- Cache em `CacheService` com chunking para datasets grandes (máx 90 KB por chunk).
- Triggers automáticos gerenciam backup diário e limpeza de cache.

---

## Esquema de Banco de Dados (BigQuery — meli-sbox.BRBA01)

### CP_LISTA_COLABORADORES
| Campo | Tipo | Descrição |
|-------|------|-----------|
| ID_GROOT | INT64 | ID único do colaborador |
| COLABORADOR | STRING | Nome completo |
| CARGO | STRING | Cargo/função |
| AREA | STRING | Área (Outbound, Inbound, ICQA…) |
| SETOR | STRING | Setor/célula (Picking, Putaway…) |
| TURNO | STRING | Turno (T1, T2, T3…) |
| ESCALA | STRING | Código de escala rotativa |
| GESTOR | STRING | Nome do gestor direto |
| STATUS | STRING | Ativo / Inativo |
| TIPO | STRING | Tipo de contrato (CLT, PJ…) |

### CP_HISTORICO_ABS
| Campo | Tipo | Descrição |
|-------|------|-----------|
| IDGROOT | INT64 | ID do colaborador |
| COLABORADOR | STRING | Nome |
| DATA_ABS | DATE | Data do registro |
| STATUS_PRESENCA | STRING | Status (ver tabela de códigos) |
| CLOCK_IN | TIME | Horário de entrada (catraca) |
| AREA / SETOR / GESTOR / TURNO | STRING | Dados do colaborador na data |
| RESPONSAVEL | STRING | E-mail de quem atualizou |
| CHAVE | INT64 | Chave composta: DDMMYY + IDGROOT |

### CP_AUSENCIAS_PROGRAMADAS
| Campo | Tipo | Descrição |
|-------|------|-----------|
| IDGROOT | INT64 | ID do colaborador |
| CHAVE | INT64 | Chave composta: DDMMYY + IDGROOT |
| JUSTIFICATIVA | STRING | Tipo de ausência (AF, FE, DSR, FJ…) |
| DATA_INICIO / DATA_FIM | DATE | Período da ausência |
| RESPONSAVEL | STRING | Quem registrou |
| PROGRAMADO_EM | DATE | Data do registro |

### CP_PERMISSOES_ABS
| Campo | Tipo | Descrição |
|-------|------|-----------|
| EMAIL | STRING | E-mail do usuário (PK) |
| PERFIL | STRING | ADMIN, LIDER, OBSERVADOR, FLOW, PEOPLE |
| DATA_CRIACAO / DATA_ATUALIZACAO | TIMESTAMP | Controle |
| RESPONSAVEL | STRING | Quem criou/atualizou |

### CP_ESCALAS_ROTATIVAS
| Campo | Tipo | Descrição |
|-------|------|-----------|
| DATA | DATE | Data |
| ESCALA | STRING | Código da escala (A, B, C, D…) |
| FOLGA | BOOL | true = folga, false = trabalho |

### CP_SOLICITACOES_ALTERACOES
| Campo | Tipo | Descrição |
|-------|------|-----------|
| IDGROOT | INT64 | ID do colaborador |
| TIPO_ALTERACAO | STRING | desligamento, transferência… |
| STATUS | STRING | PENDENTE, VALIDAR, CONCLUÍDO, CANCELADO |
| RESPONSAVEL | STRING | Quem solicitou |
| RESPONSAVEL_TRATATIVA | STRING | Quem resolveu |

### HISTORICO_AVAILABLE_TIME_BA01 (meli-sbox.IDEABORNTOBEUAI)
| Campo | Tipo | Descrição |
|-------|------|-----------|
| TARGET_DURATION | FLOAT | Horas target |
| NET_WORK_DURATION | FLOAT | Horas trabalhadas |
| AVAILABLE_TIME_HORAS/MINUTOS | INT | Tempo ocioso |
| PERCENTUAL_APROVEITAMENTO | FLOAT | % de aproveitamento |
| JUSTIFICATIVA / DESCRICAO | STRING | Motivo do tempo ocioso |

---

## Sistema de Permissões

### Owner Master (hard-coded — não alterável via UI)
- `gabrielvie.vieira@mercadolivre.com`
- `lucas.leal@mercadolivre.com`

Sempre recebem ADMIN; não podem ser removidos ou rebaixados.

### Perfis e Acessos

| Perfil | Páginas visíveis | Pode editar |
|--------|-----------------|-------------|
| ADMIN | Todas | Todas |
| LIDER | index, chamada, ausencia, availabletime, historico, flow, matrix | chamada, ausencia, matrix |
| OBSERVADOR | index, chamada, availabletime, historico, flow, matrix | — |
| FLOW | index, flow, historico, matrix | flow, historico |
| PEOPLE | index, availabletime, people, matrix | — |

### Lógica de Autenticação
1. Verificar se é Owner Master → ADMIN automático.
2. Consultar `CP_PERMISSOES_ABS` pelo e-mail da sessão ativa.
3. Se não encontrado → acesso negado.

---

## Códigos de Status de Presença

| Código | Categoria | Conta no ABS% |
|--------|-----------|--------------|
| P - Presente | Presença | Não |
| FI | Falta injustificada | **Sim** |
| VAZIO - Justificativa não encontrada | Pendente | **Sim** |
| AF - Licença Maternidade / INSS | Ausência justificada | Não |
| FE - Férias | Ausência justificada | Não |
| DSR - Escala | Folga de escala | Não |
| FJ - Atestado | Ausência justificada | Não |

---

## Pipelines de Dados (n8n)

### pipeline_chamada.sql — Inicialização Diária
- **Trigger**: Diário (~5h)
- **Fluxo**:
  1. Lê ausências programadas do dia em `CP_AUSENCIAS_PROGRAMADAS`.
  2. Lê folgas de escala em `CP_ESCALAS_ROTATIVAS`.
  3. MERGE em `CP_HISTORICO_ABS`:
     - Ausência programada → STATUS = justificativa (AF, FE, DSR…)
     - Folga de escala → STATUS = "DSR - Escala"
     - Demais → STATUS = NULL (aguarda catraca ou lançamento manual)
  4. Aplica filtro de CARGOS_INCLUIDOS + SETORES_INCLUIDOS.
  5. QUALIFY deduplica por ID_GROOT.

### pipeline_catraca.sql — Sincronização de Ponto
- **Trigger**: Múltiplas vezes ao dia (quase tempo real)
- **Fonte**: `meli-bi-data.WHOWNER.BT_SHP_TYA_EMPLOYEE_TIMECARD`
- **Fluxo**:
  - **T3 (noturno)**: 20h–23h59 = hoje; 00h–18h = ontem.
  - **Demais**: qualquer horário = hoje.
  - MERGE: atualiza STATUS_PRESENCA → "P - Presente" apenas se STATUS = NULL e RESPONSAVEL = NULL (gestor não tocou).
  - Define RESPONSAVEL = "verdi-flow-auto".

### Reconciliação de Ausências
- **Acionada por**: `salvarAusencia()` / `atualizarAusencia()` em `Ausencia.gs`.
- **Lógica**:
  - Apenas justificativas "exceção" (AF-*, FE-*, DSR-*, FJ-Atestado) retroagem no histórico.
  - Non-exception: mantém FI-Falta (preserva rastreabilidade de ausência injustificada).
  - UPDATE em `CP_HISTORICO_ABS` para datas entre DATA_INICIO e min(DATA_FIM, hoje) onde STATUS = FI, NULL ou VAZIO.

---

## Estratégia de Cache

| Chave | Duração | Conteúdo | Estratégia |
|-------|---------|---------|-----------|
| `colaboradores_cache` | 6 horas | Lista de colaboradores | Chunked (90 KB/chunk) |
| `registros_dia_cache` | 2 minutos | Chamada do dia | Chunked |
| `historico_cache_M_Y` | 1 hora | Histórico mês/ano | Simples |
| `idgroots_incluidos_flow` | 6 horas | IDs para filtro Flow | Simples |

**Invalidação**: Qualquer INSERT/UPDATE/DELETE chama `limparCache()`. Trigger automático limpa a cada hora.

---

## Padrões de Query BigQuery

### Autenticação OAuth2
```javascript
// JWT gerado com SERVICE_ACCOUNT_KEY (Script Properties)
// POST → OAuth2 token endpoint → access_token
// Header: Authorization: Bearer {token}
```

### Query Síncrona (< 30s)
```
POST /projects/{PROJECT}/queries
{ query, useLegacySql: false, timeoutMs: 30000 }
```

### Query Assíncrona (Jobs API — fallback)
```
POST /jobs → jobId
Poll /jobs/{jobId} até state=DONE
GET /queries/{jobId} → results
```

### Padrões comuns
- `QUALIFY ROW_NUMBER()` — deduplicação por ID_GROOT
- `LEFT JOIN` com whitelist/blacklist de cargos e setores
- `STRING_AGG()` — agrega múltiplos valores (diagnósticos)
- `PARTITION BY / ORDER BY` — funções de janela para ranking

---

## Arquivos do Projeto

| Arquivo | Função |
|---------|--------|
| `Principal.gs` | Ponto de entrada (doGet), roteamento de páginas |
| `Config.gs` | Constantes de configuração (tabelas, whitelists) |
| `Util.gs` | OAuth, cache, export, Owner Master |
| `Chamada.gs` | Backend da chamada diária + helpers BigQuery |
| `Historico.gs` | Relatórios históricos + Flow + Jobs API async |
| `People.gs` | Analytics de presenteísmo |
| `Acessos.gs` | CRUD de permissões |
| `Permissoes.gs` | Lookups de perfil e matriz de acesso |
| `Ausencia.gs` | Registro e reconciliação de ausências |
| `Available Time.gs` | Tempo ocioso + justificativas |
| `Escalas.gs` | Calendário de escalas rotativas |
| `Alteracoes.gs` | Workflow de alterações (transferência, desligamento) |
| `Email.gs` | Alertas de divergência de setor |
| `Backup.gs` | Backup diário automático para Drive |
| `DiagnosticoDuplicidade.gs` | Auditoria completa do sistema |
| `MailGrootDuplicado.gs` | Alertas de duplicidade de ID_GROOT |
| `pipeline_catraca.sql` | Sync ponto → histórico (n8n) |
| `pipeline_chamada.sql` | Inicialização diária (n8n) |
| `appsscript.json` | Manifest (escopos OAuth, timezone, runtime) |
| `bigquery_config.json` | Referência de configuração (datasets, tabelas) |

---

## Configuração (Config.gs)

```javascript
PROJECT_ID            = 'meli-sbox'
DATASET_ID            = 'BRBA01'
BQ_LOCATION           = 'US'

TABLE_COLABORADORES   = 'CP_LISTA_COLABORADORES'
TABLE_HISTORICO       = 'CP_HISTORICO_ABS'
TABLE_PERMISSOES      = 'CP_PERMISSOES_ABS'
TABLE_AUSENCIAS       = 'CP_AUSENCIAS_PROGRAMADAS'
TABLE_ESCALAS         = 'CP_ESCALAS_ROTATIVAS'

FOLDER_FOTOS_GESTORES = '1easYGTRlGAYVkCUB5NIWnk3gCFc7l9xH'

EMAIL_DESTINATARIOS   = [
  'lucas.leal@mercadolivre.com',
  'gabrielvie.vieira@mercadolivre.com'
]

CARGOS_INCLUIDOS = [
  'Rep de Envio 1', 'Rep de Envio 2', 'Rep de Envio 3',
  'Operador Logístico 1', 'Operador Logístico 2', 'Operador Logístico 3',
  'Sr Team Leader - Shipping', 'Team Leader - Shipping', 'Team Leader',
  'Jovem Aprendiz'
]

SETORES_INCLUIDOS = [
  'Outbound', 'Inventario', 'ICQA', 'Qualidade',
  'Inbound', 'Retiro', 'Retiros', 'Returns'
]
```

---

## Scopes OAuth (appsscript.json)

| Scope | Uso |
|-------|-----|
| `spreadsheets` | Google Sheets (export) |
| `drive` | Backup + fotos de gestores |
| `bigquery` + `bigquery.readonly` | Leitura e escrita no BQ |
| `gmail.send` | Alertas por e-mail |
| `script.external_request` | Chamadas HTTP (BigQuery REST API) |
| `userinfo.email` | Identificação do usuário ativo |

---

## Diagnóstico e Troubleshooting

| Problema | Causa provável | Solução |
|----------|---------------|---------|
| "Acesso Negado" na página Acessos | Usuário não é Owner Master | Verificar `OWNERS_MASTER_LIST` em `Util.gs` |
| Colaboradores não aparecem na Chamada | Cargo ou setor fora da whitelist | Verificar `CARGOS_INCLUIDOS` / `SETORES_INCLUIDOS` em `Config.gs` |
| Dados desatualizados na Chamada | Cache servindo dados antigos | Executar `limparCache()` no editor GAS |
| Timeout de query BigQuery | Query muito grande ou BQ sobrecarregado | Jobs API async é acionado automaticamente como fallback |
| Duplicatas no diagnóstico | IDs duplicados nas tabelas | Executar `limparPermissoesDuplicatas()` ou `diagnosticoCompleto()` |

---

## Funções de Diagnóstico

- `diagnosticoCompleto()` — Auditoria geral: duplicatas, registros órfãos, divergências de nome entre tabelas.
- `diagnosticarLideres()` — Troubleshoot visibilidade de cards de líder na Chamada.
- `listarColaboradoresSetorDivergente()` — Colaboradores com setor/gestor divergente.
- `verificarColaboradoresSemSetor()` — Colaboradores sem setor atribuído.

---

## Backup

- **Horário**: Diariamente às 22h (trigger automático).
- **Destino**: Google Drive → pasta `BACKUP_CHECKPOINT/YYYY-MM-DD/`.
- **Conteúdo**: Todos os arquivos `.gs` e `.html` + manifesto de metadados.

---

*Documentação gerada em 2026-07-09 — reflete o estado atual do código-fonte.*
