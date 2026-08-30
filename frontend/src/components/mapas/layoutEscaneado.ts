import datos from '../../data/layoutEscaneado.json';
import mapeo from '../../data/mapeoZonas.json';

/** Geometría real trazada a mano (Synoptic Designer) -- ver
 * `LAYOUT-SVG-V3.md` en la raíz del proyecto para el contrato completo
 * y cómo regenerar `data/layoutEscaneado.json` cuando llegue una nueva
 * versión (`scripts/extraer_layout_svg.py`). Nombre de archivo
 * deliberadamente sin número de versión -- se sobrescribe cada vez que
 * llega un escaneo más completo, no hay que renombrar nada en el
 * frontend cuando eso pase.
 *
 * A diferencia de `espaciosZona.ts` (forma ilustrativa + capacidad de
 * tu Excel), esto es la forma y posición REAL de cada espacio dentro
 * del polígono real de la zona -- pero solo cubre las zonas que ya
 * están trazadas, y sus totales NO coinciden todavía con los de Excel
 * (es un trazado en progreso, ver documentación).
 */

export interface EspacioReal {
  id: string;
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

export interface ZonaReal {
  titulo: string | null;
  boundary_d: string | null;
  espacios: EspacioReal[];
  /** El marcado SVG real de los espacios de esta zona (los <rect>/subgrupos
   * tal cual los dibujaste, sin el path del borde) -- se inyecta tal cual
   * en el DOM (`dangerouslySetInnerHTML`), nunca se reconstruye la forma
   * a partir de `espacios`. `espacios` sigue existiendo para calcular
   * capacidad/estado y para emparejar cada rect por `id`. */
  markup_svg: string;
}

interface LayoutEscaneado {
  view_box: string | null;
  /** Centro real de "Mesas de trabajo" (mismo sistema de coordenadas que
   * `espacios`) -- punto de referencia para ordenar el llenado
   * ilustrativo de más cerca a más lejos (ver `movimientoReal.ts`).
   * `null` si esta versión del SVG no trae esa forma trazada. */
  referencia_mesa_trabajo: { x: number; y: number } | null;
  /** Contorno completo del edificio (`Contorno_x20_Almacen` en el SVG,
   * fuera de cualquier zona) -- solo referencia visual/espacial para dar
   * contexto de dónde caen las zonas trazadas dentro del edificio
   * completo; nunca se rellena ni es clicable. `null` si esta versión
   * del SVG no lo trae. */
  contorno_d: string | null;
  zonas: Record<string, ZonaReal>;
}

export const LAYOUT_ESCANEADO = datos as LayoutEscaneado;

interface MapeoZona {
  nombreSvg: string;
  zonaId: string;
  claveExcel: string | null;
  _nota?: string;
}

/** Nombre de zona en el SVG trazado -> id de zona / clave_excel que ya
 * usa el resto de la app, para poder cruzar contra SKU reales. Editable
 * sin tocar código: ver `frontend/src/data/mapeoZonas.json` -- ese
 * archivo es la fuente de la verdad, esto solo lo tipa y lo re-exporta.
 * `claveExcel: null` = zona sin equivalente real en LAYOUT_CD o
 * no-primaria de una clave compartida (`balda22`, ver
 * `ocupacion.ts::esZonaPrimariaParaSuClave`) -- nunca tendrá SKU real,
 * pero se muestra igual (todo libre). */
export const ZONAS_ESCANEADAS: MapeoZona[] = (mapeo as { zonas: MapeoZona[] }).zonas;

export function zonaEscaneadaPorId(zonaId: string) {
  return ZONAS_ESCANEADAS.find((z) => z.zonaId === zonaId);
}
