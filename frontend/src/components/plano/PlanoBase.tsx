import type { RefObject } from 'react';
import type { Zona } from '../../api/zonas';
import { LAYOUT_ESCANEADO } from '../mapas/layoutEscaneado';
import './PlanoSVG.css';

// Qué zona real (por nombre en layoutEscaneado.json) dibuja el contorno
// de cada zona esquemática de zonas.json -- "recepcion" (Recepción de
// aéreos) y "recibo" (Ubicación Recibo) son dos zonas REALES distintas
// (confirmado por posición: Recibido está abajo cerca de Bulk,
// Recepción de aéreos arriba) -- antes estaban mal fusionadas, ver
// mapeoZonas.json y `LAYOUT-SVG-ESCANEADO.md` §11.
//
// Dos de las 14 zonas de zonas.json no tienen todavía ninguna forma
// real trazada (Cluster (mezz.) y Zona de carpintería) -- no se les
// inventa un contorno, quedan fuera del dibujo (siguen apareciendo en
// la leyenda/tabla, que no dependen de geometría).
export const CONTORNO_REAL_POR_ZONA: Record<string, string> = {
  cluster: 'Cluster Multinivel',
  recepcion: 'Recepcion Aereos',
  recibo: 'Recibido',
  estanteria: 'Estanteria Multinivel',
  doble: 'Rack Doble',
  simple: 'Rack Simple',
  balda14: 'Rack Balda 1.4',
  balda22: 'Rack Balda 2.2',
  neumaticos: 'Llantas',
  bulk: 'Bulk',
  colgantes: 'Colgados',
  mesas: 'Mesa de Trabajo',
};

/** Caja delimitadora aproximada de un `d` de SVG cualquiera (M/L/C/Z...)
 * -- toma todos los números como pares x,y consecutivos. No hace falta
 * la forma exacta, alcanza para el viewBox y para centrar la etiqueta
 * de cada zona (mismo criterio que `centroide_de_d` en
 * `extraer_layout_svg.py`). */
function bboxDeD(d: string) {
  const nums = (d.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export interface PlanoBaseProps {
  zonas: Zona[];
  fill: (zona: Zona) => string;
  textoClaro: (zona: Zona) => boolean;
  activa: string | null;
  onHoverZona: (zona: Zona, e: React.MouseEvent) => void;
  onFocusZona: (zona: Zona, e: React.FocusEvent<SVGPathElement>) => void;
  onLeaveZona: () => void;
  onClickZona: (zona: Zona) => void;
  planoRef: RefObject<HTMLDivElement | null>;
  children?: React.ReactNode; // overlay posicionado (tooltip), lo decide cada consumidor
}

/** Solo geometría + interacción -- el color y el contenido del tooltip
 * los decide quien lo use (hoy solo `PlanoSVG`, con técnica/densidad/
 * distancia). Geometría 100% real, del layout escaneado
 * (`layoutEscaneado.json`: `contorno_d` del edificio completo,
 * `boundary_d` real de cada zona) -- el polígono aproximado que traía
 * `zonas.json` (`puntos_svg`) ya no se usa acá: se demostró que no era
 * fiel al escaneo real (ver `LAYOUT-SVG-ESCANEADO.md` §7). Por lo mismo
 * ya no hay muelles/grilla/escala dibujados -- eran geometría inventada
 * calibrada a mano para el polígono aproximado viejo, no hay un dato
 * real equivalente todavía (posición real de muelles, escala metros/
 * píxel) para dibujarlos sobre el escaneo real. */
export function PlanoBase({
  zonas,
  fill,
  textoClaro,
  activa,
  onHoverZona,
  onFocusZona,
  onLeaveZona,
  onClickZona,
  planoRef,
  children,
}: PlanoBaseProps) {
  const zonasReales = zonas
    .map((zona) => {
      const nombreSvg = CONTORNO_REAL_POR_ZONA[zona.id];
      const boundaryD = nombreSvg ? LAYOUT_ESCANEADO.zonas[nombreSvg]?.boundary_d : null;
      return boundaryD ? { zona, boundaryD } : null;
    })
    .filter((z): z is { zona: Zona; boundaryD: string } => z !== null);

  const contorno = LAYOUT_ESCANEADO.contorno_d;
  const viewBox = (() => {
    const bboxes = [...(contorno ? [bboxDeD(contorno)] : []), ...zonasReales.map((z) => bboxDeD(z.boundaryD))];
    if (bboxes.length === 0) return LAYOUT_ESCANEADO.view_box ?? '0 0 658 691';
    const margen = 14;
    const minX = Math.min(...bboxes.map((b) => b.minX)) - margen;
    const minY = Math.min(...bboxes.map((b) => b.minY)) - margen;
    const maxX = Math.max(...bboxes.map((b) => b.maxX)) + margen;
    const maxY = Math.max(...bboxes.map((b) => b.maxY)) + margen;
    return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  })();

  return (
    <div className="planwrap" ref={planoRef}>
      <svg
        className="plan"
        viewBox={viewBox}
        role="img"
        aria-label="Planta del centro de distribución con las zonas de almacenamiento, geometría real escaneada"
      >
        {contorno && <path d={contorno} className="plano-contorno" />}
        <g>
          {zonasReales.map(({ zona, boundaryD }) => (
            <path
              key={zona.id}
              className="zone"
              tabIndex={0}
              d={boundaryD}
              fill={fill(zona)}
              style={{ strokeWidth: activa === zona.id ? 4 : 1.6 }}
              onMouseMove={(e) => onHoverZona(zona, e)}
              onFocus={(e) => onFocusZona(zona, e)}
              onMouseLeave={onLeaveZona}
              onBlur={onLeaveZona}
              onClick={() => onClickZona(zona)}
            >
              <title>{zona.nombre}</title>
            </path>
          ))}
        </g>
        <g>
          {zonasReales.map(({ zona, boundaryD }) => {
            const b = bboxDeD(boundaryD);
            return (
              <text
                key={zona.id}
                className="lbl"
                x={(b.minX + b.maxX) / 2}
                y={(b.minY + b.maxY) / 2}
                fontSize={10}
                fill={textoClaro(zona) ? '#F5F3EE' : '#1B2025'}
                style={{ stroke: textoClaro(zona) ? '#1B2025' : '#FFFFFF' }}
                textAnchor="middle"
              >
                {zona.nombre}
              </text>
            );
          })}
        </g>
      </svg>
      {children}
    </div>
  );
}
