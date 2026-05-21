
MERGE meli-sbox.BRBA01.CP_HISTORICO_ABS AS Destino

USING (
  WITH
  -- Catraca T3: janela das 18:00 de ontem até 17:59 de hoje (horário Brasil)
  Presenca_T3 AS (
    SELECT DISTINCT
      CAST(EMPLOYEE_ID AS STRING) AS EMPLOYEE_ID
    FROM meli-bi-data.WHOWNER.BT_SHP_TYA_EMPLOYEE_TIMECARD,
    UNNEST(PUNCHES) AS Ponto
    WHERE Ponto.TYPE = 'IN'
      AND DATETIME_ADD(WORK_START_DATE, INTERVAL 1 HOUR)
          BETWEEN DATETIME(DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 1 DAY), TIME '18:00:00')
              AND DATETIME(CURRENT_DATE('America/Sao_Paulo'), TIME '17:59:59')
  ),
  -- Catraca não-T3: qualquer horário de hoje (lógica original)
  Presenca_Normal AS (
    SELECT DISTINCT
      CAST(EMPLOYEE_ID AS STRING) AS EMPLOYEE_ID
    FROM meli-bi-data.WHOWNER.BT_SHP_TYA_EMPLOYEE_TIMECARD,
    UNNEST(PUNCHES) AS Ponto
    WHERE Ponto.TYPE = 'IN'
      AND DATE(DATETIME_ADD(WORK_START_DATE, INTERVAL 1 HOUR)) = CURRENT_DATE('America/Sao_Paulo')
  ),
  Base AS (
    SELECT
      CAST(C.ID_GROOT AS INT64)                               AS IDGROOT,
      C.COLABORADOR,
      C.AREA,
      C.SETOR,
      C.GESTOR,
      C.TURNO,
      -- T3: DATA_ABS = ontem (dia em que o turno começou)
      -- Demais: DATA_ABS = hoje
      CASE
        WHEN C.TURNO = 'T3'
          THEN DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 1 DAY)
        ELSE
          CURRENT_DATE('America/Sao_Paulo')
      END                                                     AS DATA_ABS,
      CASE
        WHEN C.TURNO = 'T3'  AND T3.EMPLOYEE_ID IS NOT NULL THEN 'P - Presente'
        WHEN C.TURNO != 'T3' AND PN.EMPLOYEE_ID IS NOT NULL THEN 'P - Presente'
        ELSE NULL
      END                                                     AS STATUS_PRESENCA,
      CASE
        WHEN C.TURNO = 'T3'  AND T3.EMPLOYEE_ID IS NOT NULL THEN 'verdi-flow-auto'
        WHEN C.TURNO != 'T3' AND PN.EMPLOYEE_ID IS NOT NULL THEN 'verdi-flow-auto'
        ELSE NULL
      END                                                     AS RESPONSAVEL,
      CAST(
        CONCAT(
          FORMAT_DATE('%d%m%y',
            CASE
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
    LEFT JOIN Presenca_T3     AS T3 ON CAST(C.ID_GROOT AS STRING) = T3.EMPLOYEE_ID AND C.TURNO =  'T3'
    LEFT JOIN Presenca_Normal AS PN ON CAST(C.ID_GROOT AS STRING) = PN.EMPLOYEE_ID AND C.TURNO != 'T3'
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
