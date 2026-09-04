import { apiFetch } from './config';

// Coincide 1:1 con app/schemas/pipeline.py del backend.
export interface RecomendacionSKU {
  RANKING_SCORE: number;
  SKU: string;
  MARCA: string;
  FAMILIA: string;
  ABC: string;
  ROTACION_6M: number;
  N_PEDIDOS: number;
  N_LINEAS: number;
  CANT_TOTAL: number;
  VOLUMEN_M3: number;
  PESO_KG: number;
  ZONA_ACTUAL: string;
  ZONA_RECOMENDADA: string;
  TIEMPO_LAYOUT_ACTUAL: number;
  TIEMPO_NUEVO_MIN: number;
  COSTO_ACTUAL_MIN: number;
  COSTO_NUEVO_MIN: number;
  AHORRO_ESTIMADO_MIN: number;
  AHORRO_PORCENTAJE: number;
  SCORE_PRIORIDAD: number;
  MOVIMIENTO: 'MOVER' | 'MANTENER';
  JUSTIFICACION: string;
  CLUSTER_ML: number;
  PERFIL_ML: string;
  PRIORIDAD_CLUSTER_RANK: number;
  INDICE_IMPACTO_CLUSTER: number;
  /** Comunidad de Louvain (SKU que suelen pedirse juntos) -- presente solo
   * si esta corrida usó afinidad, real o forzada (ver `forzarAfinidad` en
   * `PipelineContext`). `null` = SKU sin co-ocurrencia, o afinidad no usada. */
  COMUNIDAD_AFINIDAD: number | null;
  /** Peso efectivo que usó el optimizador para este SKU (N_LINEAS en
   * modo "velocidad", ya reescalado a esa misma masa en "valor"/"servicio"
   * -- ver `backend/app/dominio/objetivo.py`). */
  PESO_MODELO: number | null;
  // Insumos de Modelo 2 (valor/rentabilidad) -- presentes solo si
  // modeloSlotting="valor" en esta corrida.
  VALOR_INVENTARIO_M2: number | null;
  MARGEN_PORCENTAJE_M2: number | null;
  RIESGO_OBSOLESCENCIA_M2: 'Bajo' | 'Medio' | 'Alto' | null;
  // Insumos de Modelo 3 (nivel de servicio) -- presentes solo si
  // modeloSlotting="servicio" en esta corrida.
  CRITICIDAD_M3: 'Bajo' | 'Medio' | 'Alto' | 'Crítico' | null;
  VARIABILIDAD_DEMANDA_M3: number | null;
}

export interface Kpis {
  sku_analizados: number;
  sku_movidos: number;
  porcentaje_sku_movidos: number;
  max_movimientos_permitidos: number;
  tiempo_actual_min: number;
  tiempo_optimizado_min: number;
  ahorro_min: number;
  reduccion_porcentaje: number;
  productividad_actual_lineas_hh: number;
  productividad_optimizada_lineas_hh: number;
  tiempo_promedio_actual_min_pedido: number;
  tiempo_promedio_optimizado_min_pedido: number;
  /** Personal necesario -- horas-hombre (dato directo) + pedidos
   * atendibles con la misma dotación (el titular presentable, no asume
   * turno ni calendario) + FTE con el supuesto de jornada explícito
   * (nunca se redondea a "personas": con datos de muestra da <1). */
  horas_hombre_actual: number;
  horas_hombre_optimizado: number;
  pedidos_atendibles_con_misma_dotacion: number;
  fte_actual: number;
  fte_optimizado: number;
  /** KPI propio del modelo activo -- claves según `modeloSlotting`:
   * "valor" -> valor_en_zona_rapida_pct, sku_promovidos_a_zona_rapida,
   * sku_promovidos_riesgo_bajo. "servicio" -> cobertura_critica_pct,
   * peor_caso_critico_min. `null` si "velocidad" (ya cubierto arriba). */
  kpis_modelo: Record<string, number> | null;
}

export interface DecisionRegla {
  sku: string;
  regla_id: string;
  motivo: string;
}

export interface MetricasML {
  mejor_k: number;
  silhouette: number;
  interpretacion_silhouette: string;
  variables_usadas: string[];
  perfil_clusters: Record<string, number | string>[];
}

export interface BanderasActivas {
  usar_incompatibilidad_geometrica: boolean;
  usar_triage: boolean;
  usar_payback_real: boolean;
  usar_fifo: boolean;
}

export interface RespuestaPipeline {
  /** Eco de qué modelo produjo esta respuesta -- fuente de verdad para
   * el rótulo en pantalla, nunca el estado de React (que puede cambiar a
   * destiempo mientras una corrida anterior todavía está en vuelo). */
  modo_objetivo: ModoObjetivo;
  recomendaciones: RecomendacionSKU[];
  kpis: Kpis;
  banderas_activas: BanderasActivas;
  camino_decision_reglas: DecisionRegla[];
  ml: MetricasML;
  /** Espacio total declarado por zona en m³ (`CAPACIDAD_M3_MAX` de
   * LAYOUT_CD, clave = `clave_excel`) -- para calcular ocupación por
   * volumen (suma de `VOLUMEN_M3` de los SKU de la zona / esto), no
   * conteo de posiciones. Ausente = esa zona no trajo capacidad
   * declarada en el Excel de este lote. */
  capacidad_zonas: Record<string, number>;
  /** Si la afinidad de pedidos (SKU que suelen pedirse juntos) influyó
   * realmente en esta corrida -- siempre presente, con `afinidad_motivo`
   * explicando por qué sí o por qué no (nunca se activa sola: hace
   * falta pedirla explícitamente Y que el test de significancia de 200
   * réplicas confirme señal sobre el lote vigente). */
  afinidad_aplicada: boolean;
  afinidad_motivo: string;
}

export interface PesosScore {
  ahorro: number;
  rotacion: number;
  abc: number;
  facilidad_movimiento: number;
}

/** "layout_cd" (default) = TIEMPO_MINUTOS declarado en el Excel. "svg" =
 * tiempo calibrado por regresión contra la distancia real medida en el
 * layout escaneado del almacén -- el optimizador puede recomendar zonas
 * distintas en cada modo, no es solo un recálculo de KPI (ver
 * `LAYOUT-SVG-ESCANEADO.md` §9 / `app/dominio/distancia_svg.py`). */
export type ModoDistancia = 'layout_cd' | 'svg';

/** "velocidad" (default, Modelo 1) minimiza tiempo de picking.
 * "valor" (Modelo 2) prioriza SKU de mayor valor económico/margen,
 * relegando stock con riesgo de obsolescencia. "servicio" (Modelo 3)
 * prioriza SKU críticos/de demanda variable, aunque no sean los más
 * pedidos. Mismo optimizador y mismas restricciones duras en los 3 --
 * ver `MVP-Inchape/1.md`/`2.md`/`3.md`. Nunca se combina con
 * `modo_distancia="svg"` (fuera de alcance para Modelo 2/3). */
export type ModoObjetivo = 'velocidad' | 'valor' | 'servicio';

export function ejecutarPipeline(
  pesos_score?: PesosScore,
  porcentaje_max_movimiento?: number,
  modo_distancia?: ModoDistancia,
  /** Nunca por defecto -- paga ~15s del test de significancia de 200
   * réplicas, y solo tiene efecto real si ese test confirma señal sobre
   * el lote vigente (ver `RespuestaPipeline.afinidad_aplicada`). */
  usar_afinidad?: boolean,
  /** Salta el test de significancia y aplica las comunidades de Louvain
   * igual, sin importar si hay señal real -- SOLO para demostrar en vivo
   * el mecanismo (botón "Forzar afinidad"). `afinidad_motivo` en la
   * respuesta siempre deja explícito que fue forzado. */
  forzar_afinidad?: boolean,
  modo_objetivo?: ModoObjetivo,
): Promise<RespuestaPipeline> {
  return apiFetch<RespuestaPipeline>('/pipeline/ejecutar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pesos_score: pesos_score ?? null,
      porcentaje_max_movimiento: porcentaje_max_movimiento ?? null,
      modo_distancia: modo_distancia ?? 'layout_cd',
      usar_afinidad: usar_afinidad ?? false,
      forzar_afinidad: forzar_afinidad ?? false,
      modo_objetivo: modo_objetivo ?? 'velocidad',
    }),
  });
}
