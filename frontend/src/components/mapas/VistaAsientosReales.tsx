import { useMemo, useState } from 'react';
import type { RecomendacionSKU } from '../../api/pipeline';
import { LAYOUT_ESCANEADO, type ZonaReal } from './layoutEscaneado';
import './VistaAsientosReales.css';

type EstadoAsiento = 'disponible' | 'ocupada' | 'se_va' | 'llega';

interface Asiento {
  id: string;
  x: number;
  y: number;
  ancho: number;
  alto: number;
  estado: EstadoAsiento;
  sku?: RecomendacionSKU;
}

const ETIQUETA_ESTADO: Record<EstadoAsiento, string> = {
  disponible: 'Disponible',
  ocupada: 'Ocupada',
  se_va: 'Se va a mover',
  llega: 'Llega (propuesta)',
};

/** Estilo "asientos de cine": la posición real de cada espacio (no una
 * grilla aproximada), un círculo por espacio, color según su estado.
 * Reutiliza exactamente la misma comparación Hoy-vs-Propuesta que ya
 * usa `GrillaSkus`/`DetalleZona` (entranSet/salenSet) -- solo cambia
 * cómo se dibuja: un solo mapa con 4 estados en vez de dos grillas
 * lado a lado. */
export function VistaAsientosReales({
  zonaReal,
  claveExcel,
  recomendaciones,
}: {
  zonaReal: ZonaReal;
  /** null = zona sin equivalente real en el Excel (ej. Rack Doble) --
   * nunca tiene SKU real, se muestra igual pero todo "disponible". */
  claveExcel: string | null;
  recomendaciones: RecomendacionSKU[];
}) {
  const [hover, setHover] = useState<Asiento | null>(null);

  const asientos = useMemo(() => {
    const hoy = claveExcel ? recomendaciones.filter((r) => r.ZONA_ACTUAL === claveExcel) : [];
    const propuestaSkus = new Set(
      claveExcel ? recomendaciones.filter((r) => r.ZONA_RECOMENDADA === claveExcel).map((r) => r.SKU) : [],
    );
    const hoySkus = new Set(hoy.map((r) => r.SKU));
    const salenSet = new Set([...hoySkus].filter((s) => !propuestaSkus.has(s)));
    const nLlegan = [...propuestaSkus].filter((s) => !hoySkus.has(s)).length;

    return zonaReal.espacios.map((e, i): Asiento => {
      const sku = hoy[i];
      if (sku) {
        return { ...e, estado: salenSet.has(sku.SKU) ? 'se_va' : 'ocupada', sku };
      }
      const indiceEntreLibres = i - hoy.length;
      return { ...e, estado: indiceEntreLibres < nLlegan ? 'llega' : 'disponible' };
    });
  }, [zonaReal, claveExcel, recomendaciones]);

  const resumen = asientos.reduce(
    (acc, a) => {
      acc[a.estado] += 1;
      return acc;
    },
    { disponible: 0, ocupada: 0, se_va: 0, llega: 0 } as Record<EstadoAsiento, number>,
  );

  // Recorta el viewBox a la caja de esta zona (con margen) en vez de
  // mostrar el plano completo -- si no, una zona angosta como "Rack
  // Doble" se vería como una línea diminuta en la esquina del canvas.
  const viewBox = useMemo(() => {
    if (asientos.length === 0) return LAYOUT_ESCANEADO.view_box ?? '0 0 1304 683';
    const xs = asientos.flatMap((a) => [a.x, a.x + a.ancho]);
    const ys = asientos.flatMap((a) => [a.y, a.y + a.alto]);
    const margen = 8;
    const minX = Math.min(...xs) - margen;
    const minY = Math.min(...ys) - margen;
    const w = Math.max(...xs) - minX + margen;
    const h = Math.max(...ys) - minY + margen;
    return `${minX} ${minY} ${w} ${h}`;
  }, [asientos]);

  return (
    <div className="asientos-reales">
      <p className="asientos-reales-resumen">
        <b>{resumen.ocupada}</b> ocupadas (se mantienen) · <b>{resumen.se_va}</b> se van · <b>{resumen.llega}</b>{' '}
        llegan (ilustrativo) · <b>{resumen.disponible}</b> disponibles · {asientos.length} espacios reales
      </p>
      <div className="asientos-reales-wrap">
        <svg
          className="asientos-reales-svg"
          viewBox={viewBox}
          role="img"
          aria-label="Espacios reales de la zona, estilo asientos de cine"
        >
          <path d={zonaReal.boundary_d ?? undefined} className="asientos-reales-borde" />
          {asientos.map((a) => (
            <circle
              key={a.id}
              cx={a.x + a.ancho / 2}
              cy={a.y + a.alto / 2}
              r={Math.min(a.ancho, a.alto) / 2.3}
              className={`asientos-reales-punto estado-${a.estado}`}
              onMouseEnter={() => setHover(a)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        {hover && (
          <div className="asientos-reales-tip">
            {hover.sku ? `${hover.sku.SKU} · ${hover.sku.FAMILIA}` : ETIQUETA_ESTADO[hover.estado]}
          </div>
        )}
      </div>
      <ul className="asientos-reales-leyenda">
        {(Object.keys(ETIQUETA_ESTADO) as EstadoAsiento[]).map((estado) => (
          <li key={estado}>
            <span className={`asientos-reales-chip estado-${estado}`} aria-hidden="true" />
            {ETIQUETA_ESTADO[estado]}
          </li>
        ))}
      </ul>
    </div>
  );
}
