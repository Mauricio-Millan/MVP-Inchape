import type { RecomendacionSKU } from '../../api/pipeline';
import type { Zona } from '../../api/zonas';
import { LAYOUT_ESCANEADO, ZONAS_ESCANEADAS, type EspacioReal } from '../mapas/layoutEscaneado';
import { asientosPorMovimiento, type EstadoMovimiento } from '../mapas/movimientoReal';

export interface CajaEscena3D {
  id: string;
  x: number;
  z: number;
  ancho: number;
  profundidad: number;
  zona: string;
  distanciaM: number;
  sku: RecomendacionSKU | null;
  /** Estado real de movimiento (igual criterio que el mapa 2D, ver
   * `movimientoReal.ts`) -- lo colorea `Mapa3DEscena` según el modo
   * elegido ("Por movimiento" lo usa directo; "Mapa de calor" lo ignora
   * salvo para decidir disponible vs. ocupado). */
  estado: EstadoMovimiento;
}

export interface LineaBoundary3D {
  nombre: string;
  d: string | null;
}

export interface EscenaComparativa3D {
  antes: CajaEscena3D[];
  despues: CajaEscena3D[];
  contornoD: string | null;
  boundaries: LineaBoundary3D[];
  /** Rango de `ROTACION_6M` de TODO el catálogo del lote -- mismo
   * criterio que `PlanoEscaneado.tsx::rangoRotacion` en el mapa 2D (min-
   * max sobre `recomendaciones` completo, no por escena): un SKU tiene
   * la misma rotación la mire desde "Hoy" o desde "Propuesta", así que
   * un solo rango fijo alcanza y mantiene la escala idéntica a la del
   * mapa 2D en modo "Por rotación". */
  rotMin: number;
  rotMax: number;
}

function cajasDeZona(
  espacios: EspacioReal[],
  claveExcel: string | null,
  recomendaciones: RecomendacionSKU[],
  campo: 'ZONA_ACTUAL' | 'ZONA_RECOMENDADA',
  nombreZona: string,
  distanciaM: number,
): CajaEscena3D[] {
  const asientos = asientosPorMovimiento(espacios, claveExcel, recomendaciones, campo);
  return espacios.map((e, i) => {
    const asiento = asientos[i];
    return {
      id: asiento.id,
      x: e.x,
      z: e.y,
      ancho: e.ancho,
      profundidad: e.alto,
      zona: nombreZona,
      distanciaM,
      sku: asiento.sku ?? null,
      estado: asiento.estado,
    };
  });
}

/** Arma las dos escenas ("antes"/"después") 100% a partir de datos ya
 * reales y ya usados en el resto de la app -- misma geometría escaneada
 * (`layoutEscaneado.json`) y el mismo emparejamiento SKU-a-espacio que
 * `PlanoEscaneado.tsx` (`asientosPorMovimiento`), así que un SKU cae en
 * el mismo espacio ilustrativo en el mapa 2D y en la ventana 3D -- nunca
 * dos fuentes de verdad para la misma posición. El color NO se decide
 * acá (ver `Mapa3DEscena.tsx::calcularColorCaja`) porque hay más de un
 * modo de color seleccionable en la propia ventana 3D. */
export function construirEscena3D(recomendaciones: RecomendacionSKU[], zonas: Zona[]): EscenaComparativa3D {
  const distanciaPorZonaId = new Map(zonas.map((z) => [z.id, z.distancia_m]));

  const antes: CajaEscena3D[] = [];
  const despues: CajaEscena3D[] = [];

  for (const { nombreSvg, zonaId, claveExcel } of ZONAS_ESCANEADAS) {
    const zonaReal = LAYOUT_ESCANEADO.zonas[nombreSvg];
    if (!zonaReal) continue;
    const distanciaM = distanciaPorZonaId.get(zonaId) ?? 0;

    antes.push(...cajasDeZona(zonaReal.espacios, claveExcel, recomendaciones, 'ZONA_ACTUAL', nombreSvg, distanciaM));
    despues.push(...cajasDeZona(zonaReal.espacios, claveExcel, recomendaciones, 'ZONA_RECOMENDADA', nombreSvg, distanciaM));
  }

  const rotaciones = recomendaciones.map((r) => r.ROTACION_6M);

  const boundaries: LineaBoundary3D[] = ZONAS_ESCANEADAS.filter((z) => LAYOUT_ESCANEADO.zonas[z.nombreSvg]).map(
    (z) => ({ nombre: z.nombreSvg, d: LAYOUT_ESCANEADO.zonas[z.nombreSvg].boundary_d }),
  );

  return {
    antes,
    despues,
    contornoD: LAYOUT_ESCANEADO.contorno_d,
    boundaries,
    rotMin: rotaciones.length ? Math.min(...rotaciones) : 0,
    rotMax: rotaciones.length ? Math.max(...rotaciones) : 0,
  };
}
