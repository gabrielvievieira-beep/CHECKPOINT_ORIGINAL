
MERGE meli-sbox.BRBA01.CP_HISTORICO_ABS AS Destino

USING (
  WITH
  -- T3 Janela 1: bateu ponto entre 20:00 e 23:59 de hoje → registrar no MESMO DIA
  Presenca_T3_Hoje AS (
    SELECT DISTINCT
      CAST(EMPLOYEE_ID AS STRING) AS EMPLOYEE_ID
    FROM meli-bi-data.WHOWNER.BT_SHP_TYA_EMPLOYEE_TIMECARD,
    UNNEST(PUNCHES) AS Ponto
    WHERE DATETIME_ADD(WORK_START_DATE, INTERVAL 1 HOUR)
          BETWEEN DATETIME(CURRENT_DATE('America/Sao_Paulo'), TIME '19:00:00')
              AND DATETIME(CURRENT_DATE('America/Sao_Paulo'), TIME '23:59:59')
  ),
  -- T3 Janela 2: bateu ponto entre 20:00 de ontem e 18:00 de hoje → registrar em D-1
  -- Cobre o turno completo: quem entrou às 20:00-23:59 de ontem E quem entrou às 00:00-18:00 de hoje
  Presenca_T3_D1 AS (
    SELECT DISTINCT
      CAST(EMPLOYEE_ID AS STRING) AS EMPLOYEE_ID
    FROM meli-bi-data.WHOWNER.BT_SHP_TYA_EMPLOYEE_TIMECARD,
    UNNEST(PUNCHES) AS Ponto
    WHERE DATETIME_ADD(WORK_START_DATE, INTERVAL 1 HOUR)
          BETWEEN DATETIME(DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 1 DAY), TIME '19:00:00')
              AND DATETIME(CURRENT_DATE('America/Sao_Paulo'), TIME '17:00:00')
  ),
  -- Catraca não-T3: qualquer horário de hoje (lógica original)
  Presenca_Normal AS (
    SELECT DISTINCT
      CAST(EMPLOYEE_ID AS STRING) AS EMPLOYEE_ID
    FROM meli-bi-data.WHOWNER.BT_SHP_TYA_EMPLOYEE_TIMECARD,
    UNNEST(PUNCHES) AS Ponto
    WHERE DATE(DATETIME_ADD(WORK_START_DATE, INTERVAL 1 HOUR)) = CURRENT_DATE('America/Sao_Paulo')
  ),
  Base AS (
    SELECT
      CAST(C.ID_GROOT AS INT64)                               AS IDGROOT,
      C.COLABORADOR,
      C.AREA,
      C.SETOR,
      C.GESTOR,
      C.TURNO,
      -- T3: 20:00-23:59 → mesmo dia | 00:00-18:00 → D-1
      -- Não-T3: sempre hoje
      CASE
        WHEN C.TURNO = 'T3' AND T3H.EMPLOYEE_ID IS NOT NULL
          THEN CURRENT_DATE('America/Sao_Paulo')
        WHEN C.TURNO = 'T3'
          THEN DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 1 DAY)
        ELSE
          CURRENT_DATE('America/Sao_Paulo')
      END                                                     AS DATA_ABS,
      CASE
        WHEN C.TURNO = 'T3'  AND (T3H.EMPLOYEE_ID IS NOT NULL OR T3D.EMPLOYEE_ID IS NOT NULL) THEN 'P - Presente'
        WHEN C.TURNO != 'T3' AND PN.EMPLOYEE_ID IS NOT NULL                                   THEN 'P - Presente'
        ELSE NULL
      END                                                     AS STATUS_PRESENCA,
      CASE
        WHEN C.TURNO = 'T3'  AND (T3H.EMPLOYEE_ID IS NOT NULL OR T3D.EMPLOYEE_ID IS NOT NULL) THEN 'verdi-flow-auto'
        WHEN C.TURNO != 'T3' AND PN.EMPLOYEE_ID IS NOT NULL                                   THEN 'verdi-flow-auto'
        ELSE NULL
      END                                                     AS RESPONSAVEL,
      CAST(
        CONCAT(
          FORMAT_DATE('%d%m%y',
            CASE
              WHEN C.TURNO = 'T3' AND T3H.EMPLOYEE_ID IS NOT NULL
                THEN CURRENT_DATE('America/Sao_Paulo')
              WHEN C.TURNO = 'T3'
                THEN DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 1 DAY)
              ELSE
                CURRENT_DATE('America/Sao_Paulo')
            END
          ),
          CAST(CAST(C.ID_GROOT AS INT64) AS STRING)
        ) AS INT64
      )                                                       AS CHAVE,
      ROW_NUMBER() OVER (PARTITION BY CAST(C.ID_GROOT AS INT64) ORDER BY C.COLABORADOR) AS RN
    FROM meli-sbox.BRBA01.CP_LISTA_COLABORADORES AS C
    LEFT JOIN Presenca_T3_Hoje AS T3H ON CAST(C.ID_GROOT AS STRING) = T3H.EMPLOYEE_ID AND C.TURNO =  'T3'
    LEFT JOIN Presenca_T3_D1   AS T3D ON CAST(C.ID_GROOT AS STRING) = T3D.EMPLOYEE_ID AND C.TURNO =  'T3'
    LEFT JOIN Presenca_Normal   AS PN  ON CAST(C.ID_GROOT AS STRING) = PN.EMPLOYEE_ID  AND C.TURNO != 'T3'
    WHERE C.ID_GROOT IS NOT NULL
      AND TRIM(CAST(C.ID_GROOT AS STRING)) != ''
      AND C.STATUS NOT IN ('Inativo', 'INATIVO')
      AND UPPER(C.CARGO) NOT IN (
        'SUPERVISOR','GERENTE','ANALISTA','ANALISTA SEMI SENIOR',
        'COORDINATOR','ASSISTENTE','GERENTE SENIOR','ANALISTA SENIOR',
        'ANALISTA SSR','ANALISTA SR','ASSISTANT','ANALISTA JR','GERENTE SR',
        'ANALIST','ANALISTA - IT','ANALISTA SEMI SENIOR - IT','ASISTENTE',
        'ASISTENTE - IT','COORDINATOR - SHIPPING','DIRECTOR',
        'LÍDER DE PROYECTO - IT','SPECIALIST','SPECIALIST SADM'
      )
      AND UPPER(C.SETOR) NOT IN (
        'TREINAMENTO','STAFF','FLOW','PEOPLE','LINE HAUL','PLANT ENGINEERING','SAFETY'
      )
      AND UPPER(C.AREA) NOT IN ('SAFETY')
  )
  SELECT * EXCEPT(RN) FROM Base WHERE RN = 1
) AS Origem
ON  Destino.IDGROOT  = Origem.IDGROOT
AND Destino.DATA_ABS = Origem.DATA_ABS

-- Só atualiza para PRESENTE quando passou na catraca
-- e o registro ainda não foi tocado manualmente pelo gestor
WHEN MATCHED
  AND Origem.STATUS_PRESENCA = 'P - Presente'
  AND (Destino.STATUS_PRESENCA IS NULL OR Destino.STATUS_PRESENCA != 'P - Presente')
  AND Destino.RESPONSAVEL IS NULL
THEN
  UPDATE SET
    Destino.STATUS_PRESENCA = 'P - Presente',
    Destino.RESPONSAVEL     = 'verdi-flow-auto',
    Destino.GESTOR          = Origem.GESTOR,
    Destino.AREA            = Origem.AREA,
    Destino.SETOR           = Origem.SETOR,
    Destino.TURNO           = Origem.TURNO

-- WHEN NOT MATCHED removido intencionalmente.
-- A criação de novos registros é responsabilidade exclusiva de inicializarChamadaDia().
-- Ter dois pontos de INSERT (pipeline + inicialização) causava duplicatas por race condition.
