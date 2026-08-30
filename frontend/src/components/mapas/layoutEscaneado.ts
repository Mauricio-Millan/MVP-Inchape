import datos from '../../data/layoutEscaneado.json';

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
}

interface LayoutEscaneado {
  view_box: string | null;
  zonas: Record<string, ZonaReal>;
}

export const LAYOUT_ESCANEADO = datos as LayoutEscaneado;

/** Nombre de zona en el SVG trazado -> id de zona / clave_excel que ya
 * usa el resto de la app, para poder cruzar contra SKU reales.
 * `claveExcel: null` = zona sin equivalente real en LAYOUT_CD (`doble`)
 * o no-primaria de una clave compartida (`balda22`, ver
 * `ocupacion.ts::esZonaPrimariaParaSuClave`) -- nunca tendrá SKU real,
 * pero se muestra igual (todo libre). "Recibido" (Recepción de aéreos)
 * ya está trazado en el SVG pero queda fuera a propósito: no es una
 * zona de ubicación de almacenamiento (decisión explícita, ago 2026). */
export const ZONAS_ESCANEADAS: { nombreSvg: string; zonaId: string; claveExcel: string | null }[] = [
  { nombreSvg: 'Rack Doble', zonaId: 'doble', claveExcel: null },
  { nombreSvg: 'Rack Simple', zonaId: 'simple', claveExcel: '5. RACK SIMPLE' },
  { nombreSvg: 'Rack Balda 2.2', zonaId: 'balda22', claveExcel: null },
  { nombreSvg: 'Rack Balda 1.4', zonaId: 'balda14', claveExcel: '4. RACK BALDA' },
  { nombreSvg: 'Estanteria Multinivel', zonaId: 'estanteria', claveExcel: '7. MEZANNINE' },
  { nombreSvg: 'Bulk', zonaId: 'bulk', claveExcel: '2. PISO' },
  { nombreSvg: 'Llantas', zonaId: 'neumaticos', claveExcel: '1. LLANTAS' },
  { nombreSvg: 'Cluster Multinivel', zonaId: 'cluster', claveExcel: '8. CLUSTER' },
];

export function zonaEscaneadaPorId(zonaId: string) {
  return ZONAS_ESCANEADAS.find((z) => z.zonaId === zonaId);
}
