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
 * #2), así que no sirve como proxy de velocidad.
 *
 * Cuando hay `COMUNIDAD_AFINIDAD` (afinidad real o forzada, ver
 * `PipelineContext.forzarAfinidad`), se ordena PRIMERO por comunidad --
 * como `espaciosCercanos` ya viene ordenado por distancia real a "Mesas
 * de trabajo", agrupar por comunidad antes que por velocidad hace que
 * los SKU de una misma comunidad caigan en índices contiguos, es decir,
 * en espacios ilustrativos cercanos entre sí. Sin comunidad (el caso de
 * siempre) todos comparten la misma clave primaria y el orden queda
 * idéntico al de antes (puro `N_LINEAS` descendente). */
function porVelocidadReal(skus: RecomendacionSKU[]): RecomendacionSKU[] {
  return [...skus].sort((a, b) => {
    const comunidadA = a.COMUNIDAD_AFINIDAD ?? Number.POSITIVE_INFINITY;
    const comunidadB = b.COMUNIDAD_AFINIDAD ?? Number.POSITIVE_INFINITY;
    if (comunidadA !== comunidadB) return comunidadA - comunidadB;
    return b.N_LINEAS - a.N_LINEAS;
  });
}

/** Asigna a cada espacio real de una zona su estado de movimiento, desde
 * la perspectiva de `campo` -- cuál mapa lo está mostrando, "Hoy" o
 * "Propuesta":
 * - `ZONA_ACTUAL` ("Hoy"/"Situación actual"): los SKU de HOY son los
 *   primarios; "se_va" marca cuáles de esos se van en la propuesta. No
 *   se inventan llegadas en las posiciones libres -- eso es especulación
 *   de la propuesta, no forma parte de "hoy".
 * - `ZONA_RECOMENDADA` ("Propuesta"): los SKU de la PROPUESTA son los
 *   primarios; "llega" marca cuáles son nuevos (no estaban hoy en esta
 *   zona). No hace falta marcar "se_va" -- ya estamos parados en el
 *   estado futuro, lo que se fue ya no está.
 *
 * Los SKU que se MANTIENEN en la zona (están en `hoy` y en `propuesta`)
 * se calculan UNA sola vez, con el mismo orden, y se colocan primero --
 * así ocupan el mismo espacio ilustrativo sin importar qué mapa los esté
 * pintando. Antes cada mapa ordenaba su propia lista (hoy vs. propuesta)
 * por separado; como esas listas tienen distinta composición (un SKU
 * ajeno entra o sale de la zona), el orden se corría y un SKU que en
 * realidad se quedaba en la zona "saltaba" de espacio entre un mapa y el
 * otro -- parecía un intercambio de posiciones que nunca ocurrió, porque
 * la posición exacta dentro de la zona es solo ilustrativa (STOCK_ACTUAL
 * no trae fila/columna/nivel) y el sistema no reordena SKUs dentro de
 * una misma zona, solo decide zona destino.
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
  const propuestaSkus = new Set(propuesta.map((r) => r.SKU));
  const hoySkus = new Set(hoy.map((r) => r.SKU));

  const mantienen = porVelocidadReal(hoy.filter((r) => propuestaSkus.has(r.SKU)));
  const entrantes = porVelocidadReal(
    campo === 'ZONA_ACTUAL' ? hoy.filter((r) => !propuestaSkus.has(r.SKU)) : propuesta.filter((r) => !hoySkus.has(r.SKU)),
  );
  const estadoEntrante: EstadoMovimiento = campo === 'ZONA_ACTUAL' ? 'se_va' : 'llega';

  const espaciosCercanos = porCercania(espacios);
  const skuPorEspacioId = new Map<string, { sku: RecomendacionSKU; estado: EstadoMovimiento }>();
  let cursor = 0;
  mantienen.forEach((sku) => {
    const e = espaciosCercanos[cursor++];
    if (e) skuPorEspacioId.set(e.id, { sku, estado: 'ocupada' });
  });
  entrantes.forEach((sku) => {
    const e = espaciosCercanos[cursor++];
    if (e) skuPorEspacioId.set(e.id, { sku, estado: estadoEntrante });
  });

  return espacios.map((e) => {
    const asiento = skuPorEspacioId.get(e.id);
    if (!asiento) return { id: e.id, estado: 'disponible' as const };
    return { id: e.id, estado: asiento.estado, sku: asiento.sku };
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
  const sufijoAfinidad =
    asiento.sku.COMUNIDAD_AFINIDAD != null ? ` · suele pedirse junto con el grupo #${asiento.sku.COMUNIDAD_AFINIDAD}` : '';
  if (asiento.estado === 'se_va' || asiento.estado === 'llega') {
    return `${base} — ${asiento.sku.JUSTIFICACION}${sufijoAfinidad}`;
  }
  return `${base} · rotación 6m: ${asiento.sku.ROTACION_6M}${sufijoAfinidad}`;
}

/** Color categórico determinista por comunidad -- no hace falta una
 * paleta fija de N colores (el número de comunidades varía por lote),
 * un hue espaciado por número áureo aproximado (137.5°) da colores bien
 * distinguibles entre comunidades consecutivas sin repetir para pocas
 * decenas de grupos. */
export function colorComunidad(comunidad: number): string {
  const hue = (comunidad * 137.5) % 360;
  return `hsl(${hue}, 65%, 42%)`;
}
