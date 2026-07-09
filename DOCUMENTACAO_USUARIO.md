# Guia do Usuário — Sistema Checkpoint BA01

## O que é o Checkpoint?

O Checkpoint é um sistema web de controle de presença e absenteísmo dos colaboradores do armazém BA01. Ele permite registrar chamadas diárias, programar ausências, consultar histórico e acompanhar métricas de presença — tudo integrado ao BigQuery e ao ponto eletrônico.

---

## Acesso ao Sistema

O acesso é feito pelo navegador. Seu perfil determina quais páginas você pode ver e o que pode fazer.

| Perfil | O que pode fazer |
|--------|-----------------|
| **ADMIN** | Acesso total — ver, editar e gerenciar tudo |
| **LIDER** | Registrar chamada, programar ausências, ver histórico e flow |
| **OBSERVADOR** | Somente visualização (chamada, histórico, flow) |
| **FLOW** | Visualizar e editar flow e histórico |
| **PEOPLE** | Visualizar analytics de presenteísmo e tempo disponível |

> Caso apareça "Acesso Negado", solicite ao administrador que adicione seu e-mail ao sistema.

---

## Páginas do Sistema

### Chamada (Presença do Dia)

Exibe todos os colaboradores do seu turno com o status de presença em tempo real.

**Como funciona:**
- O sistema pré-popula a chamada automaticamente toda manhã com base na escala e ausências programadas.
- O ponto eletrônico (catraca) atualiza o status para "Presente" automaticamente.
- O líder pode ajustar manualmente o status de cada colaborador.

**Status possíveis:**

| Status | Significado |
|--------|-------------|
| P - Presente | Compareceu |
| FI | Falta injustificada |
| DSR - Escala | Folga de escala (não conta como falta) |
| FE - Férias | Em período de férias |
| AF - Licença | Em licença (maternidade, INSS…) |
| FJ - Atestado | Ausência com atestado médico |

**Para registrar/alterar status:**
1. Encontre o colaborador na lista.
2. Clique no status atual.
3. Selecione o novo status.
4. Clique em **Salvar**.

---

### Ausência (Ausências Programadas)

Permite registrar períodos de afastamento planejado (férias, licença, atestado, etc.).

**Para registrar uma ausência:**
1. Clique em **Nova Ausência**.
2. Digite o nome do colaborador (campo autocomplete).
3. Selecione a **data de início** e **data de fim**.
4. Escolha a **justificativa** (tipo de ausência).
5. Clique em **Salvar**.

> O sistema atualiza automaticamente o histórico de presença para o período informado quando a justificativa é do tipo AF, FE, DSR ou FJ-Atestado.

**Para editar ou excluir:** localize a ausência na lista e use os botões de ação correspondentes.

---

### Histórico

Exibe o registro de presença dos colaboradores em um período selecionado.

**Filtros disponíveis:**
- Mês/Ano ou últimos N dias
- Turno, Setor, Área, Gestor, Colaborador

**Exportar:** clique em **Exportar para Sheets** para gerar uma planilha com os dados filtrados.

**Indicadores calculados:**
- **% Presença**: dias presentes / dias úteis trabalhados
- **% Absenteísmo**: faltas injustificadas / total de dias úteis (exclui férias, licenças e folgas de escala)

---

### Flow (Calendário de Presença)

Exibe um calendário mensal com o status de cada colaborador em cada dia.

**Como usar:**
- Selecione o mês/ano.
- Filtre por gestor ou colaborador.
- As células coloridas indicam o status de cada dia (P = verde, FI = vermelho, DSR = cinza…).

> O painel de HC (Headcount) mostra as ausências planejadas para o dia atual.

---

### Available Time (Tempo Disponível)

Exibe o tempo ocioso (não produtivo) dos colaboradores durante o turno.

**Como usar:**
- Visualize o resumo dos últimos 7 dias por turno/setor.
- Pesquise por período e filtros.
- Líderes podem adicionar ou editar justificativas para o tempo ocioso (por que o colaborador não estava produzindo).

---

### People (Presenteísmo)

Exibe uma lista de todos os colaboradores ativos ordenada pelo menor índice de presença.

Útil para identificar colaboradores com alto absenteísmo e tomar ações preventivas.

---

### Acessos (apenas ADMIN)

Permite gerenciar quem tem acesso ao sistema e com qual perfil.

**Para adicionar acesso:**
1. Clique em **Novo Acesso**.
2. Informe o e-mail do usuário.
3. Selecione o perfil.
4. Clique em **Salvar**.

**Para alterar ou remover:** localize o usuário na lista e use os botões de ação.

> Os administradores master (gabrielvie.vieira e lucas.leal) não podem ser alterados.

---

### Glossário

Página de consulta com a definição de todos os códigos de status e abreviações utilizados no sistema.

---

## Fluxo Diário Típico

```
~5h      → Sistema inicializa a chamada do dia automaticamente
Manhã    → Catraca atualiza quem bateu ponto ("Presente")
Turno    → Líder abre a Chamada e corrige status pendentes
Fim do turno → Chamada fechada; dados alimentam histórico e relatórios
```

---

## Dúvidas Frequentes

**Por que um colaborador não aparece na Chamada?**
O cargo ou setor dele pode não estar na lista de inclusão do sistema. Fale com o administrador.

**Por que a Chamada está mostrando dados antigos?**
O sistema usa cache para performance. Os dados se atualizam a cada 2 minutos. Se persistir, solicite limpeza de cache ao administrador.

**Uma ausência registrada não apareceu no histórico. O que fazer?**
Verifique se a justificativa usada é do tipo AF, FE, DSR ou FJ-Atestado — somente essas retroagem automaticamente no histórico.

**Como solicitar acesso para um novo colaborador?**
Peça ao administrador do sistema para cadastrar o e-mail do usuário na página **Acessos**.

---

*Documentação gerada em 2026-07-09.*
