import type { RecomendacionSKU } from '../../api/pipeline';
import { LAYOUT_ESCANEADO, type EspacioReal } from './layoutEscaneado';

export type EstadoMovimiento = 'disponible' | 'ocupada' | 'se_va' | 'llega';

export interface AsientoMovimiento {
  id: string;
  estado: EstadoMovimiento;
  sku?: RecomendacionSKU;
}

/** Ninguno de estos dos "más cerca"/"más rápido" es un dato real de
 * posición -- STOCK_ACTUAL no trae fila/columna/nivel, así que el SKU
 * exacto en cada espacio siempre es ilustrativo (ver
 * LAYOUT-SVG-ESCANEADO.md §7). Esto solo hace que el llenado ilustrativo
 * sea *coherente* con cómo se sloteria un almacén real -- los SKU de
 * más movimiento caen en los espacios más cercanos a "Mesas de trabajo"
 * -- en vez de un emparejamiento arbitrario por índice. */

function distancia2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function centro(e: EspacioReal): { x: number; y: number } {
  return { x: e.x + e.ancho / 2, y: e.y + e.alto / 2 };
}

/** Espacios de la zona, más cerca de "Mesas de trabajo" primero. Sin
 * punto de referencia (SVG viejo sin esa forma trazada) se deja el
 * orden que ya traía `espacios` -- nunca se inventa una referencia. */
function porCercania(espacios: EspacioReal[]): EspacioReal[] {
  const ref = LAYOUT_ESCANEADO.referencia_mesa_trabajo;
  if (!ref) return espacios;
  return [...espacios].sort((a, b) => distancia2(centro(a), ref) - distancia2(centro(b), ref));
}

/** SKU de la zona, de más a menos movimiento real -- `N_LINEAS` (líneas
 * de pedido reales), no `ROTACION_6M`: la rotación declarada del Excel
 * no correlaciona con los hits reales (Pearson 0.028, ver CLAUDE_1.md
 * #2), así que no sirve como proxy de velocidad. */
function porVelocidadReal(skus: RecomendacionSKU[]): RecomendacionSKU[] {
  return [...skus].sort((a, b) => b.N_LINEAS - a.N_LINEAS);
}

/** Asigna a cada espacio real de una zona su estado de movimiento, desde
 * la perspectiva de `campo` -- cuál mapa lo está mostrando, "Hoy" o
 * "Propuesta":
 * - `ZONA_ACTUAL` ("Hoy"/"Situación actual"): los SKU de HOY son los
 *   primarios; "se_va" marca cuáles de esos se van en la propuesta. No
 *   se inventan llegadas en las posiciones libres -- eso es especulación
 *   de la propuesta, no forma parte de "hoy" (era la causa de que esta
 *   vista pareciera mostrar la propuesta: la mayoría de los espacios
 *   coloreados eran llegadas ilustrativas, no ocupación real de hoy).
 * - `ZONA_RECOMENDADA` ("Propuesta"): los SKU de la PROPUESTA son los
 *   primarios; "llega" marca cuáles son nuevos (no estaban hoy en esta
 *   zona). No hace falta marcar "se_va" -- ya estamos parados en el
 *   estado futuro, lo que se fue ya no está.
 *
 * Dentro de cada `campo`, el SKU con más movimiento real cae en el
 * espacio real más cercano a "Mesas de trabajo" (ver `porCercania`/
 * `porVelocidadReal` arriba) -- antes era un emparejamiento arbitrario
 * por índice (el SKU #i de la lista al espacio #i del SVG), sin ninguna
 * relación con cercanía real.
 *
 * `claveExcel: null` (zona sin equivalente en el Excel, o no primaria de
 * una clave compartida) -> todo disponible. */
export function asientosPorMovimiento(
  espacios: EspacioReal[],
  claveExcel: string | null,
  recomendaciones: RecomendacionSKU[],
  campo: 'ZONA_ACTUAL' | 'ZONA_RECOMENDADA',
): AsientoMovimiento[] {
  if (!claveExcel) return espacios.map((e) => ({ id: e.id, estado: 'disponible' }));

  const hoy = recomendaciones.filter((r) => r.ZONA_ACTUAL === claveExcel);
  const propuesta = recomendaciones.filter((r) => r.ZONA_RECOMENDADA === claveExcel);
  const principal = porVelocidadReal(campo === 'ZONA_ACTUAL' ? hoy : propuesta);
  const espaciosCercanos = porCercania(espacios);

  const skuPorEspacioId = new Map<string, RecomendacionSKU>();
  principal.forEach((sku, i) => {
    const e = espaciosCercanos[i];
    if (e) skuPorEspacioId.set(e.id, sku);
  });

  if (campo === 'ZONA_ACTUAL') {
    const propuestaSkus = new Set(propuesta.map((r) => r.SKU));
    return espacios.map((e) => {
      const sku = skuPorEspacioId.get(e.id);
      if (!sku) return { id: e.id, estado: 'disponible' as const };
      return { id: e.id, estado: propuestaSkus.has(sku.SKU) ? ('ocupada' as const) : ('se_va' as const), sku };
    });
  }

  const hoySkus = new Set(hoy.map((r) => r.SKU));
  return espacios.map((e) => {
    const sku = skuPorEspacioId.get(e.id);
    if (!sku) return { id: e.id, estado: 'disponible' as const };
    return { id: e.id, estado: hoySkus.has(sku.SKU) ? ('ocupada' as const) : ('llega' as const), sku };
  });
}

export const ETIQUETA_ESTADO: Record<EstadoMovimiento, string> = {
  disponible: 'Disponible',
  ocupada: 'Ocupada (se mantiene)',
  se_va: 'Se va a mover',
  llega: 'Llega (nueva)',
};

/** Texto de tooltip para un espacio -- en "se_va"/"llega" usa
 * `JUSTIFICACION` (ya la arma el backend: de dónde a dónde, cuántas
 * visitas tuvo, cuánto cambia el tiempo de acceso, ahorro estimado) en
 * vez de solo el SKU, para responder de una vez qué hay ahí, por qué se
 * mueve y hacia dónde -- sin eso, "se va a mover" no decía a dónde. */
export function descripcionAsiento(asiento: AsientoMovimiento): string {
  if (!asiento.sku) return ETIQUETA_ESTADO[asiento.estado];
  const base = `${asiento.sku.SKU} · ${asiento.sku.FAMILIA}`;
  if (asiento.estado === 'se_va' || asiento.estado === 'llega') {
    return `${base} — ${asiento.sku.JUSTIFICACION}`;
  }
  return `${base} · rotación 6m: ${asiento.sku.ROTACION_6M}`;
}
