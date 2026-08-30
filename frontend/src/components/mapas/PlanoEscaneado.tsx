import { useMemo, useState } from 'react';
import type { RecomendacionSKU } from '../../api/pipeline';
import { colorCalor } from './GrillaSkus';
import { LAYOUT_ESCANEADO, ZONAS_ESCANEADAS } from './layoutEscaneado';
import './PlanoEscaneado.css';

type ModoColorEscaneado = 'ocupacion' | 'rotacion';

/** Plano con la geometría real trazada (Synoptic Designer) -- muestra
 * las zonas ya escaneadas con su polígono y posiciones de espacio
 * reales (no una grilla CSS aproximada), coloreadas por ocupado/libre o
 * por calor de rotación, contra los SKU reales del pipeline. Click en
 * una zona abre el mismo detalle que el resto de los mapas. Trazado en
 * progreso -- ver `LAYOUT-SVG-V3.md`. */
export function PlanoEscaneado({
  recomendaciones,
  onClickZona,
}: {
  recomendaciones: RecomendacionSKU[];
  onClickZona?: (zonaId: string) => void;
}) {
  const [hover, setHover] = useState<{ id: string; texto: string } | null>(null);
  const [modo, setModo] = useState<ModoColorEscaneado>('ocupacion');

  const porZona = useMemo(() => {
    return ZONAS_ESCANEADAS.map(({ nombreSvg, zonaId, claveExcel }) => {
      const zona = LAYOUT_ESCANEADO.zonas[nombreSvg];
      const skus = claveExcel ? recomendaciones.filter((r) => r.ZONA_ACTUAL === claveExcel) : [];
      return { nombreSvg, zonaId, zona, skus };
    }).filter((z) => z.zona);
  }, [recomendaciones]);

  const rangoRotacion = useMemo(() => {
    const valores = recomendaciones.map((r) => r.ROTACION_6M);
    return { min: Math.min(...valores), max: Math.max(...valores) };
  }, [recomendaciones]);

  const totalEspacios = porZona.reduce((acc, z) => acc + (z.zona?.espacios.length ?? 0), 0);
  const totalOcupados = porZona.reduce((acc, z) => acc + Math.min(z.skus.length, z.zona?.espacios.length ?? 0), 0);

  return (
    <section className="panel plano-esc">
      <header>
        <h2>Plano real (escaneado)</h2>
        <span className="note">{porZona.length} de 13 zonas trazadas</span>
      </header>
      <div className="panel-body">
        <p className="plano-esc-nota">
          Geometría real escaneada del plano — polígonos y posiciones de espacio reales, no una aproximación.
          Trazado en progreso: {totalOcupados} ocupados de {totalEspacios} espacios definidos hasta ahora.
          {onClickZona && ' Click en una zona para ver el detalle.'}
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
          <svg className="plan" viewBox={LAYOUT_ESCANEADO.view_box ?? '0 0 1304 683'} role="img" aria-label="Plano real trazado">
            {porZona.map(({ zonaId, zona, skus }) => {
              if (!zona) return null;
              return (
                <g
                  key={zonaId}
                  className={onClickZona ? 'plano-esc-zona-click' : undefined}
                  onClick={() => onClickZona?.(zonaId)}
                >
                  <path d={zona.boundary_d ?? undefined} className="plano-esc-borde" />
                  {zona.espacios.map((e, i) => {
                    const sku = skus[i];
                    const ocupado = Boolean(sku);
                    const estilo =
                      ocupado && modo === 'rotacion' && rangoRotacion.max > rangoRotacion.min
                        ? { fill: colorCalor((sku.ROTACION_6M - rangoRotacion.min) / (rangoRotacion.max - rangoRotacion.min)) }
                        : undefined;
                    return (
                      <rect
                        key={e.id}
                        x={e.x}
                        y={e.y}
                        width={e.ancho}
                        height={e.alto}
                        style={estilo}
                        className={ocupado ? 'plano-esc-espacio ocupado' : 'plano-esc-espacio libre'}
                        onMouseEnter={() =>
                          setHover({
                            id: e.id,
                            texto: ocupado ? `${sku.SKU} · ${sku.FAMILIA} · rotación 6m: ${sku.ROTACION_6M}` : 'Espacio libre',
                          })
                        }
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
