import { apiFetch } from './config';
import type { DecisionRegla, ModoObjetivo, RecomendacionSKU } from './pipeline';

export interface DesgloseScore {
  ahorro: number;
  rotacion: number;
  abc: number;
  facilidad_movimiento: number;
  total: number;
}

export interface ExplicacionCluster {
  cluster: number;
  perfil: string;
  distancia_cluster_propio: number;
  distancia_segundo_mas_cercano: number;
  asignacion_ambigua: boolean;
  silhouette_individual: number;
  contribucion_por_variable: Record<string, number>;
}

export interface RespuestaRecomendacionSKU {
  recomendacion: RecomendacionSKU;
  desglose_score: DesgloseScore;
  reglas_aplicadas: DecisionRegla[];
  explicacion_cluster: ExplicacionCluster;
}

/** `modoObjetivo`: debe ser el modelo activo de la corrida vigente -- si
 * no, el drawer de detalle mostraría siempre Modelo 1 (velocidad)
 * mientras la tabla muestra Modelo 2/3 (ver backend `routers/recomendaciones.py`). */
export function fetchDetalleSku(
  sku: string,
  modoObjetivo: ModoObjetivo = 'velocidad',
): Promise<RespuestaRecomendacionSKU> {
  return apiFetch<RespuestaRecomendacionSKU>(
    `/recomendaciones/${encodeURIComponent(sku)}?modo_objetivo=${modoObjetivo}`,
  );
}
