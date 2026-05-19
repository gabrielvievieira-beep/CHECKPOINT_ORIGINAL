
MERGE meli-sbox.BRBA01.CP_HISTORICO_ABS AS Destino

USING (
  WITH Presenca_Hoje AS (
    SELECT DISTINCT
      CAST(EMPLOYEE_ID AS STRING) AS EMPLOYEE_ID
    FROM meli-bi-data.WHOWNER.BT_SHP_TYA_EMPLOYEE_TIMECARD,
    UNNEST(PUNCHES) AS Ponto
    WHERE
      DATE(CAST(WORK_START_DATE AS TIMESTAMP), 'America/Sao_Paulo') = CURRENT_DATE('America/Sao_Paulo')
      AND Ponto.TYPE = 'IN'
  ),
  Base AS (
    SELECT
      CAST(C.ID_GROOT AS INT64)                               AS IDGROOT,
      C.COLABORADOR,
      C.AREA,
      C.SETOR,
      C.GESTOR,
      C.TURNO,
      CURRENT_DATE('America/Sao_Paulo')                       AS DATA_ABS,
      CASE
        WHEN P.EMPLOYEE_ID IS NOT NULL THEN 'P - Presente'
        ELSE NULL                          -- Não passou na catraca = PENDENTE (não FALTA)
      END                                                     AS STATUS_PRESENCA,
      CASE
        WHEN P.EMPLOYEE_ID IS NOT NULL THEN 'verdi-flow-auto'
        ELSE NULL
      END                                                     AS RESPONSAVEL,
      CAST(
        CONCAT(
          FORMAT_DATE('%d%m%y', CURRENT_DATE('America/Sao_Paulo')),
          CAST(CAST(C.ID_GROOT AS INT64) AS STRING)
        ) AS INT64
      )                                                       AS CHAVE,
      ROW_NUMBER() OVER (PARTITION BY CAST(C.ID_GROOT AS INT64) ORDER BY C.COLABORADOR) AS RN
    FROM meli-sbox.BRBA01.CP_LISTA_COLABORADORES AS C
    LEFT JOIN Presenca_Hoje AS P
      ON CAST(C.ID_GROOT AS STRING) = P.EMPLOYEE_ID
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

-- Insere registro para quem ainda não tem linha hoje (safety net)
WHEN NOT MATCHED THEN
  INSERT (IDGROOT, COLABORADOR, DATA_ABS, STATUS_PRESENCA, CLOCK_IN,
          AREA, SETOR, GESTOR, TURNO, RESPONSAVEL, CHAVE)
  VALUES (Origem.IDGROOT, Origem.COLABORADOR, Origem.DATA_ABS, Origem.STATUS_PRESENCA, NULL,
          Origem.AREA, Origem.SETOR, Origem.GESTOR, Origem.TURNO, Origem.RESPONSAVEL, Origem.CHAVE)