import { useMemo, useState } from 'react';
import type { RecomendacionSKU } from '../../api/pipeline';
import { colorCalor } from '../../lib/colorCalor';
import { LAYOUT_ESCANEADO, ZONAS_ESCANEADAS } from './layoutEscaneado';
import { asientosPorMovimiento, descripcionAsiento } from './movimientoReal';
import './PlanoEscaneado.css';

type ModoColorEscaneado = 'ocupacion' | 'rotacion';

/** Plano con la geometría real trazada (Synoptic Designer) -- dibuja las
 * zonas ya escaneadas con su polígono y posiciones de espacio reales (no
 * una grilla CSS aproximada ni un plano esquemático estirado), coloreadas
 * por movimiento (ocupada/se va/llega, ver `movimientoReal.ts`) o por
 * calor de rotación, contra los SKU reales del pipeline (`campo` decide
 * si es la foto de "hoy" o de la "propuesta"). Click en una zona abre el
 * mismo detalle que el resto de los mapas. Único mapa real de la app --
 * reemplaza al viejo plano esquemático aproximado (`zonas.json`) para
 * Situación actual/Propuesta de slotting, ver `LAYOUT-SVG-ESCANEADO.md` §7. */
export function PlanoEscaneado({
  titulo,
  campo,
  recomendaciones,
  onClickZona,
}: {
  titulo: string;
  campo: 'ZONA_ACTUAL' | 'ZONA_RECOMENDADA';
  recomendaciones: RecomendacionSKU[];
  onClickZona?: (zonaId: string) => void;
}) {
  const [hover, setHover] = useState<{ id: string; texto: string } | null>(null);
  const [modo, setModo] = useState<ModoColorEscaneado>('rotacion');

  const porZona = useMemo(() => {
    return ZONAS_ESCANEADAS.map(({ nombreSvg, zonaId, claveExcel }) => {
      const zona = LAYOUT_ESCANEADO.zonas[nombreSvg];
      const asientos = zona ? asientosPorMovimiento(zona.espacios, claveExcel, recomendaciones, campo) : [];
      return { nombreSvg, zonaId, zona, asientos };
    }).filter((z) => z.zona);
  }, [recomendaciones, campo]);

  const rangoRotacion = useMemo(() => {
    const valores = recomendaciones.map((r) => r.ROTACION_6M);
    return { min: Math.min(...valores), max: Math.max(...valores) };
  }, [recomendaciones]);

  const totalEspacios = porZona.reduce((acc, z) => acc + z.asientos.length, 0);
  const totalOcupados = porZona.reduce((acc, z) => acc + z.asientos.filter((a) => a.estado !== 'disponible').length, 0);

  // El viewBox del SVG original cubre TODO el edificio (0 0 1304 683),
  // pero las zonas trazadas hasta ahora solo ocupan una porción -- si se
  // usa ese viewBox completo, el contenido real se ve chico rodeado de
  // espacio en blanco. Se recorta al bounding box real (con margen).
  const viewBox = useMemo(() => {
    const espacios = porZona.flatMap((z) => z.zona?.espacios ?? []);
    if (espacios.length === 0) return LAYOUT_ESCANEADO.view_box ?? '0 0 1304 683';
    const margen = 14;
    const minX = Math.min(...espacios.map((e) => e.x)) - margen;
    const minY = Math.min(...espacios.map((e) => e.y)) - margen * 2; // más arriba para la etiqueta de zona
    const maxX = Math.max(...espacios.map((e) => e.x + e.ancho)) + margen;
    const maxY = Math.max(...espacios.map((e) => e.y + e.alto)) + margen;
    return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  }, [porZona]);

  return (
    <section className="panel plano-esc">
      <header>
        <h2>{titulo}</h2>
        <span className="note">{porZona.length} de 14 zonas trazadas</span>
      </header>
      <div className="panel-body">
        <p className="plano-esc-nota">
          Geometría real escaneada del plano — polígonos y posiciones de espacio reales, no una aproximación.
          Trazado en progreso: {totalOcupados} ocupados de {totalEspacios} espacios definidos hasta ahora.
          {onClickZona && ' Click en una zona para ver el detalle.'}
          {' '}
          <i>
            El SKU exacto en cada espacio es ilustrativo (Excel no registra fila/columna/nivel): se ordena por
            cercanía real a Mesas de trabajo y por líneas de pedido, no es la ubicación registrada.
          </i>
        </p>

        <div className="ctrl" role="group" aria-label="Color del plano real">
          <button aria-pressed={modo === 'ocupacion'} onClick={() => setModo('ocupacion')}>
            Por ocupación
          </button>
          <button aria-pressed={modo === 'rotacion'} onClick={() => setModo('rotacion')}>
            Por rotación
          </button>
        </div>

        <div className="planwrap plano-esc-wrap">
          <svg className="plan" viewBox={viewBox} role="img" aria-label="Plano real trazado">
            {porZona.map(({ zonaId, zona, asientos }) => {
              if (!zona) return null;
              return (
                <g
                  key={zonaId}
                  className={onClickZona ? 'plano-esc-zona-click' : undefined}
                  onClick={() => onClickZona?.(zonaId)}
                >
                  {/* Solo el borde -- nunca se rellena el polígono de la
                   * zona, únicamente los espacios individuales de abajo. */}
                  <path d={zona.boundary_d ?? undefined} className="plano-esc-borde" />
                  {zona.espacios.map((e, i) => {
                    const asiento = asientos[i];
                    const estilo =
                      asiento.sku && modo === 'rotacion' && rangoRotacion.max > rangoRotacion.min
                        ? { fill: colorCalor((asiento.sku.ROTACION_6M - rangoRotacion.min) / (rangoRotacion.max - rangoRotacion.min)) }
                        : undefined;
                    return (
                      <rect
                        key={e.id}
                        x={e.x}
                        y={e.y}
                        width={e.ancho}
                        height={e.alto}
                        style={estilo}
                        className={`plano-esc-espacio estado-${asiento.estado}`}
                        onMouseEnter={() => setHover({ id: e.id, texto: descripcionAsiento(asiento) })}
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  })}
                  <text x={zona.espacios[0]?.x ?? 0} y={(zona.espacios[0]?.y ?? 0) - 4} className="plano-esc-etiqueta">
                    {zona.titulo}
                  </text>
                </g>
              );
            })}
          </svg>
          {hover && <div className="plano-esc-tip">{hover.texto}</div>}
        </div>
      </div>
    </section>
  );
}
