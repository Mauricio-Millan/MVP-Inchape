import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import 'd3-transition';
import type { RecomendacionSKU } from '../../api/pipeline';
import { colorCalor } from '../../lib/colorCalor';
import { LAYOUT_ESCANEADO, ZONAS_ESCANEADAS } from './layoutEscaneado';
import { asientosPorMovimiento, descripcionAsiento } from './movimientoReal';
import './PlanoInteractivoD3.css';

type Modo = 'ocupacion' | 'rotacion';

/** Bounding box aproximado de un `d` de SVG -- toma TODOS los números
 * del string como pares x,y sin distinguir comandos (M/L/C/Z...), así
 * que sobreestima un poco en paths con curvas (los puntos de control
 * quedan incluidos). Alcanza para encuadrar la cámara del zoom-a-sector,
 * no hace falta la forma exacta -- a diferencia de `espacios`, que sí
 * necesita el bounding box real para calcular capacidad. */
function bboxDePath(d: string | null): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!d) return null;
  const nums = d.match(/-?\d+\.?\d*/g)?.map(Number);
  if (!nums || nums.length < 4) return null;
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Dashboard v2: mismo dato real (`layoutEscaneado.json`) y la misma
 * lógica de color/estado que `PlanoEscaneado`/`movimientoReal.ts` -- lo
 * nuevo acá es la interacción: zoom/pan real con D3 (`d3-zoom`, en vez
 * del plano estático), el contorno completo del edificio como
 * referencia espacial, una barra lateral con todas las áreas para
 * saltar entre ellas, y que un click en un sector (mapa o lista) hace
 * zoom-to-bounds hacia esa zona y llena un panel con sus SKU (familia,
 * volumen, peso, rotación) sin abrir un modal -- se puede seguir
 * navegando el mapa con el panel abierto. Heurísticas de Nielsen
 * aplicadas explícitamente, ver comentarios inline: #1 visibilidad del
 * estado (leyenda + nivel de zoom siempre visibles), #3 control y
 * libertad (Escape/botón × deseleccionan sin perder el mapa), #6
 * reconocer antes que recordar (barra de áreas con nombre + color
 * siempre a la vista, no hay que memorizar dónde está cada zona). */
export function PlanoInteractivoD3({
  recomendaciones,
  capacidadZonas,
  campo,
  onCampoChange,
}: {
  recomendaciones: RecomendacionSKU[];
  /** `CAPACIDAD_M3_MAX` por `clave_excel` (LAYOUT_CD del Excel del lote
   * vigente) -- el "espacio total de cada zona" contra el que se mide
   * la ocupación por volumen del panel (ver `ocupacionVolumen` abajo). */
  capacidadZonas: Record<string, number>;
  campo: 'ZONA_ACTUAL' | 'ZONA_RECOMENDADA';
  onCampoChange: (campo: 'ZONA_ACTUAL' | 'ZONA_RECOMENDADA') => void;
}) {
  const [modo, setModo] = useState<Modo>('rotacion');
  const [hover, setHover] = useState<string | null>(null);
  const [zonaSeleccionada, setZonaSeleccionada] = useState<string | null>(null);
  const [escala, setEscala] = useState(1);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomGRef = useRef<SVGGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const porZona = useMemo(() => {
    return ZONAS_ESCANEADAS.map(({ nombreSvg, zonaId, claveExcel }) => {
      const zona = LAYOUT_ESCANEADO.zonas[nombreSvg];
      const asientos = zona ? asientosPorMovimiento(zona.espacios, claveExcel, recomendaciones, campo) : [];
      return { nombreSvg, zonaId, claveExcel, zona, asientos };
    }).filter((z) => z.zona);
  }, [recomendaciones, campo]);

  const rangoRotacion = useMemo(() => {
    const valores = recomendaciones.map((r) => r.ROTACION_6M);
    return { min: Math.min(...valores), max: Math.max(...valores) };
  }, [recomendaciones]);

  // El "mundo" del viewBox es el edificio completo (no solo el recorte
  // de lo trazado) -- ahora que se dibuja `contorno_d` de fondo, mostrar
  // el edificio entero da contexto real en vez de verse como espacio en
  // blanco (match con el edificio real, heurística #2). Si esta versión
  // del SVG no trajera `view_box` (no debería pasar), se cae al bbox de
  // lo trazado como antes.
  const [vbX, vbY, vbW, vbH] = useMemo(() => {
    const partes = LAYOUT_ESCANEADO.view_box?.split(/\s+/).map(Number);
    if (partes?.length === 4 && partes.every((n) => Number.isFinite(n))) {
      return partes as [number, number, number, number];
    }
    const espacios = porZona.flatMap((z) => z.zona?.espacios ?? []);
    if (espacios.length === 0) return [0, 0, 1304, 683];
    const margen = 14;
    const minX = Math.min(...espacios.map((e) => e.x)) - margen;
    const minY = Math.min(...espacios.map((e) => e.y)) - margen * 2;
    const maxX = Math.max(...espacios.map((e) => e.x + e.ancho)) + margen;
    const maxY = Math.max(...espacios.map((e) => e.y + e.alto)) + margen;
    return [minX, minY, maxX - minX, maxY - minY];
  }, [porZona]);

  // d3-zoom atado directamente al <svg> con viewBox: d3.pointer usa
  // getScreenCTM().inverse() sobre un nodo SVG, así que las coordenadas
  // del gesto ya vienen en unidades del viewBox -- el transform que
  // produce se puede aplicar tal cual al <g> hijo sin reconvertir nada,
  // y sirve igual para el zoom-a-sector programático de abajo.
  useEffect(() => {
    if (!svgRef.current || !zoomGRef.current) return;
    const svg = select(svgRef.current);
    const g = select(zoomGRef.current);
    const comportamientoZoom = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 10])
      .on('zoom', (event) => {
        g.attr('transform', event.transform.toString());
        setEscala(event.transform.k);
      });
    svg.call(comportamientoZoom);
    zoomRef.current = comportamientoZoom;
    return () => {
      svg.on('.zoom', null);
    };
  }, [vbX, vbY, vbW, vbH]);

  function zoomBy(factor: number) {
    if (!svgRef.current || !zoomRef.current) return;
    select(svgRef.current).transition().duration(200).call(zoomRef.current.scaleBy, factor);
  }

  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    select(svgRef.current).transition().duration(300).call(zoomRef.current.transform, zoomIdentity);
    setZonaSeleccionada(null);
  }, []);

  function seleccionarZona(zonaId: string) {
    setZonaSeleccionada(zonaId);
    const entrada = porZona.find((z) => z.zonaId === zonaId);
    if (!svgRef.current || !zoomRef.current || !entrada?.zona) return;
    const espacios = entrada.zona.espacios;
    // Zonas sin subdivisión trazada (Mesa de Trabajo, Recepción Aéreos:
    // 0 espacios) igual se pueden enfocar -- se usa el bbox del propio
    // contorno en vez del de los espacios (ver bboxDePath arriba).
    const caja =
      espacios.length > 0
        ? {
            minX: Math.min(...espacios.map((e) => e.x)),
            minY: Math.min(...espacios.map((e) => e.y)),
            maxX: Math.max(...espacios.map((e) => e.x + e.ancho)),
            maxY: Math.max(...espacios.map((e) => e.y + e.alto)),
          }
        : bboxDePath(entrada.zona.boundary_d);
    if (!caja) return;
    const cx = (caja.minX + caja.maxX) / 2;
    const cy = (caja.minY + caja.maxY) / 2;
    const anchoCaja = Math.max(caja.maxX - caja.minX, 1);
    const altoCaja = Math.max(caja.maxY - caja.minY, 1);
    const nuevaEscala = Math.max(1, Math.min(10, (0.8 * vbW) / anchoCaja, (0.8 * vbH) / altoCaja));
    const transform = zoomIdentity
      .translate(vbX + vbW / 2, vbY + vbH / 2)
      .scale(nuevaEscala)
      .translate(-cx, -cy);
    select(svgRef.current).transition().duration(500).call(zoomRef.current.transform, transform);
  }

  // Control y libertad (heurística #3): Escape deselecciona y vuelve a
  // la vista completa sin tener que buscar el botón -- comportamiento
  // estándar de "salir" en cualquier overlay/selección de la app.
  useEffect(() => {
    if (!zonaSeleccionada) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') resetZoom();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zonaSeleccionada, resetZoom]);

  const skusSector = useMemo(() => {
    const entrada = porZona.find((z) => z.zonaId === zonaSeleccionada);
    if (!entrada?.claveExcel) return null;
    return recomendaciones
      .filter((r) => r[campo] === entrada.claveExcel)
      .sort((a, b) => b.ROTACION_6M - a.ROTACION_6M);
  }, [porZona, zonaSeleccionada, recomendaciones, campo]);

  const entradaSeleccionada = porZona.find((z) => z.zonaId === zonaSeleccionada);

  // Ocupación por VOLUMEN (no por conteo de espacios): suma el
  // VOLUMEN_M3 real de cada SKU de la zona (ya es el volumen total de
  // su stock, no por-unidad -- así lo calcula el backend, ver
  // `capacidad.py`) contra `CAPACIDAD_M3_MAX` declarada en LAYOUT_CD
  // para esa `clave_excel` -- el "espacio total de cada zona" del
  // Excel que pediste, distinto del % de espacios ocupados de la barra
  // lateral (ese cuenta posiciones trazadas en el SVG, no m³ reales).
  const ocupacionVolumen = useMemo(() => {
    const entrada = porZona.find((z) => z.zonaId === zonaSeleccionada);
    if (!entrada?.claveExcel || !skusSector) return null;
    const capacidad = capacidadZonas[entrada.claveExcel];
    if (!capacidad || capacidad <= 0) return null;
    const volumenUsado = skusSector.reduce((acc, r) => acc + r.VOLUMEN_M3, 0);
    return { volumenUsado, capacidad, pct: Math.min(999, (volumenUsado / capacidad) * 100) };
  }, [porZona, zonaSeleccionada, skusSector, capacidadZonas]);

  return (
    <section className="panel plano-d3">
      <header>
        <h2>Dashboard v2 · Mapa interactivo</h2>
        <span className="note">{porZona.length} de 14 zonas trazadas · arrastra para mover, rueda para zoom</span>
      </header>
      <div className="panel-body">
        <div className="plano-d3-toolbar">
          <div className="ctrl" role="group" aria-label="Ocupación mostrada">
            <button aria-pressed={campo === 'ZONA_ACTUAL'} onClick={() => onCampoChange('ZONA_ACTUAL')} title="Ver la ocupación de hoy">
              Hoy
            </button>
            <button
              aria-pressed={campo === 'ZONA_RECOMENDADA'}
              onClick={() => onCampoChange('ZONA_RECOMENDADA')}
              title="Ver la propuesta de slotting"
            >
              Propuesta
            </button>
          </div>
          <div className="ctrl" role="group" aria-label="Color del plano">
            <button aria-pressed={modo === 'ocupacion'} onClick={() => setModo('ocupacion')} title="Colorear por estado de movimiento">
              Por ocupación
            </button>
            <button aria-pressed={modo === 'rotacion'} onClick={() => setModo('rotacion')} title="Colorear por rotación (verde=baja, rojo=alta)">
              Por rotación
            </button>
          </div>
          <div className="ctrl plano-d3-zoom-ctrl" role="group" aria-label="Zoom">
            <button onClick={() => zoomBy(1.4)} aria-label="Acercar" title="Acercar (o rueda del mouse)">
              ＋
            </button>
            <button onClick={() => zoomBy(1 / 1.4)} aria-label="Alejar" title="Alejar (o rueda del mouse)">
              －
            </button>
            <button onClick={resetZoom} aria-label="Restablecer vista" title="Volver a la vista completa (Esc)">
              ⤢
            </button>
            {/* Visibilidad del estado del sistema (heurística #1): el
             * nivel de zoom actual siempre a la vista, no hay que
             * adivinarlo por el tamaño del dibujo. */}
            <span className="plano-d3-zoom-nivel mono">{Math.round(escala * 100)}%</span>
          </div>
        </div>

        {/* Reconocer antes que recordar (heurística #6): la escala de
         * color queda siempre visible, no hay que memorizar qué
         * significa cada tono al mirar el mapa. */}
        <div className="plano-d3-legend">
          {modo === 'rotacion' ? (
            <>
              <span className="plano-d3-legend-barra" aria-hidden="true" />
              <span>Rotación: baja</span>
              <span className="plano-d3-legend-sep">→</span>
              <span>alta</span>
            </>
          ) : (
            <>
              <span className="plano-d3-legend-chip estado-disponible" aria-hidden="true" />
              <span>Disponible</span>
              <span className="plano-d3-legend-chip estado-ocupada" aria-hidden="true" />
              <span>Se mantiene</span>
              {campo === 'ZONA_ACTUAL' && (
                <>
                  <span className="plano-d3-legend-chip estado-se_va" aria-hidden="true" />
                  <span>Se va</span>
                </>
              )}
              {campo === 'ZONA_RECOMENDADA' && (
                <>
                  <span className="plano-d3-legend-chip estado-llega" aria-hidden="true" />
                  <span>Llega</span>
                </>
              )}
            </>
          )}
        </div>

        <div className="plano-d3-layout">
          {/* Barra lateral de áreas -- reconocer antes que recordar
           * (heurística #6) y flexibilidad de uso (heurística #7): sirve
           * como atajo para saltar directo a cualquier zona sin tener
           * que ubicarla visualmente primero en el mapa. */}
          <nav className="plano-d3-areas" aria-label="Áreas del almacén">
            <button
              className={!zonaSeleccionada ? 'plano-d3-area-item activa' : 'plano-d3-area-item'}
              onClick={resetZoom}
            >
              <span className="plano-d3-area-dot plano-d3-area-dot-todo" aria-hidden="true" />
              <span className="plano-d3-area-nombre">Vista completa</span>
            </button>
            {porZona.map(({ zonaId, zona, asientos }) => {
              if (!zona) return null;
              const total = zona.espacios.length;
              const ocupados = asientos.filter((a) => a.estado !== 'disponible').length;
              const pct = total > 0 ? Math.round((ocupados / total) * 100) : null;
              return (
                <button
                  key={zonaId}
                  className={zonaId === zonaSeleccionada ? 'plano-d3-area-item activa' : 'plano-d3-area-item'}
                  onClick={() => seleccionarZona(zonaId)}
                  title={total > 0 ? `${ocupados} de ${total} espacios ocupados` : 'Sin ubicaciones individuales trazadas todavía'}
                >
                  <span
                    className="plano-d3-area-dot"
                    style={{ background: pct === null ? '#c7c7cc' : colorCalor(pct / 100) }}
                    aria-hidden="true"
                  />
                  <span className="plano-d3-area-nombre">{zona.titulo}</span>
                  <span className="plano-d3-area-pct mono">{pct === null ? '—' : `${pct}%`}</span>
                </button>
              );
            })}
          </nav>

          <div className="plano-d3-wrap">
            <svg ref={svgRef} className="plan" viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} role="img" aria-label="Mapa interactivo del almacén">
              <g ref={zoomGRef}>
                {/* Contorno completo del edificio -- solo referencia
                 * espacial (match con el mundo real, heurística #2),
                 * nunca se rellena ni reacciona a clicks. */}
                {LAYOUT_ESCANEADO.contorno_d && (
                  <path d={LAYOUT_ESCANEADO.contorno_d} className="plano-d3-contorno" />
                )}
                {porZona.map(({ zonaId, zona, asientos }) => {
                  if (!zona) return null;
                  return (
                    <g
                      key={zonaId}
                      className="plano-d3-zona"
                      role="button"
                      tabIndex={0}
                      aria-label={`Ver SKU de ${zona.titulo}`}
                      onClick={() => seleccionarZona(zonaId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') seleccionarZona(zonaId);
                      }}
                    >
                      <path
                        d={zona.boundary_d ?? undefined}
                        className={
                          (zonaId === zonaSeleccionada ? 'plano-d3-borde seleccionada' : 'plano-d3-borde') +
                          (zona.espacios.length === 0 ? ' sin-espacios' : '')
                        }
                      />
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
                            className={`plano-d3-espacio estado-${asiento.estado}`}
                            onMouseEnter={() => setHover(descripcionAsiento(asiento))}
                            onMouseLeave={() => setHover(null)}
                          />
                        );
                      })}
                      <text x={zona.espacios[0]?.x ?? 0} y={(zona.espacios[0]?.y ?? 0) - 4} className="plano-d3-etiqueta">
                        {zona.titulo}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
            {hover && <div className="plano-d3-tip">{hover}</div>}
          </div>

          <aside className="plano-d3-panel">
            {!entradaSeleccionada ? (
              <p className="plano-d3-panel-vacio">Haz click en un sector del mapa o de la lista de áreas para ver sus SKU (familia, volumen, peso y rotación).</p>
            ) : (
              <>
                <div className="plano-d3-panel-header">
                  <h3>{entradaSeleccionada.zona?.titulo ?? entradaSeleccionada.nombreSvg}</h3>
                  {/* Control y libertad (heurística #3): salir de la
                   * selección sin depender de encontrar el botón de
                   * reset del zoom, arriba del todo. */}
                  <button className="plano-d3-panel-cerrar" onClick={resetZoom} aria-label="Cerrar detalle de zona" title="Cerrar (Esc)">
                    ✕
                  </button>
                </div>
                {!skusSector ? (
                  <p className="plano-d3-panel-vacio">Esta zona no tiene equivalente en el Excel -- ningún SKU real cae aquí.</p>
                ) : skusSector.length === 0 ? (
                  <p className="plano-d3-panel-vacio">Ningún SKU está aquí en esta vista ({campo === 'ZONA_ACTUAL' ? 'Hoy' : 'Propuesta'}).</p>
                ) : (
                  <>
                    {/* Ocupación por volumen real (m³ usados / espacio
                     * total declarado en el Excel) -- distinto del % de
                     * la barra lateral, que solo cuenta posiciones. */}
                    {ocupacionVolumen && (
                      <div className="plano-d3-ocupacion-vol">
                        <div className="plano-d3-ocupacion-vol-header">
                          <span>Ocupación por volumen</span>
                          <span className="mono">{ocupacionVolumen.pct.toFixed(1)}%</span>
                        </div>
                        <div className="plano-d3-ocupacion-vol-barra">
                          <div
                            className="plano-d3-ocupacion-vol-fill"
                            style={{
                              width: `${Math.min(100, ocupacionVolumen.pct)}%`,
                              background: colorCalor(Math.min(100, ocupacionVolumen.pct) / 100),
                            }}
                          />
                        </div>
                        <span className="plano-d3-ocupacion-vol-detalle mono">
                          {ocupacionVolumen.volumenUsado.toFixed(2)} m³ usados de {ocupacionVolumen.capacidad.toFixed(0)} m³ totales
                        </span>
                      </div>
                    )}
                    <p className="note">
                      {skusSector.length} SKU
                      {(() => {
                        const movers = skusSector.filter((r) => r.MOVIMIENTO === 'MOVER').length;
                        return movers > 0 ? ` · ${movers} se mueven` : '';
                      })()}
                    </p>
                    <div className="plano-d3-tabla-wrap">
                      <table className="plano-d3-tabla">
                        <thead>
                          <tr>
                            <th>SKU</th>
                            <th>Familia</th>
                            <th>Vol. m³</th>
                            <th>Peso kg</th>
                            <th>Rotación 6m</th>
                            <th>Movimiento</th>
                          </tr>
                        </thead>
                        <tbody>
                          {skusSector.map((r) => {
                            const seMueve = r.MOVIMIENTO === 'MOVER';
                            // Viendo "Hoy": el SKU se va hacia ZONA_RECOMENDADA. Viendo
                            // "Propuesta": llegó desde ZONA_ACTUAL. Misma fila, misma
                            // relación, solo cambia la dirección de la flecha según
                            // desde qué foto temporal se está mirando (ver movimientoReal.ts).
                            const otraZona = campo === 'ZONA_ACTUAL' ? r.ZONA_RECOMENDADA : r.ZONA_ACTUAL;
                            const flecha = campo === 'ZONA_ACTUAL' ? '→' : '←';
                            return (
                              <tr key={r.SKU} title={seMueve ? r.JUSTIFICACION : undefined}>
                                <td className="mono">{r.SKU}</td>
                                <td>{r.FAMILIA}</td>
                                <td>{r.VOLUMEN_M3.toFixed(2)}</td>
                                <td>{r.PESO_KG.toFixed(1)}</td>
                                <td>{r.ROTACION_6M}</td>
                                <td>
                                  <span className={seMueve ? 'badge badge-mover' : 'badge badge-mantener'}>
                                    {seMueve ? 'Mover' : 'Mantener'}
                                  </span>
                                  {seMueve && (
                                    <div className="plano-d3-tabla-destino">
                                      {flecha} {otraZona}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
