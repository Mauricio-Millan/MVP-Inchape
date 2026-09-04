import { useEffect, useMemo, useRef, useState } from 'react';
import type { RecomendacionSKU } from '../../api/pipeline';
import { colorCalor } from '../../lib/colorCalor';
import { LAYOUT_ESCANEADO, type ZonaReal } from './layoutEscaneado';
import {
  asientosPorMovimiento,
  colorComunidad,
  descripcionAsiento,
  ETIQUETA_ESTADO,
  type AsientoMovimiento,
  type EstadoMovimiento,
} from './movimientoReal';
import './VistaAsientosReales.css';

type ModoColorAsientos = 'movimiento' | 'rotacion';

/** Estilo "asientos de cine" usando el marcado SVG REAL de la zona
 * (`zonaReal.markup_svg`) -- se inyecta tal cual en el DOM, nunca se
 * reconstruye la forma a partir de números. Solo se le cambia el color
 * a cada elemento (por su `id`, el mismo que ya trae del editor) según
 * su estado o su calor de rotación, y se le engancha el tooltip -- todo
 * lo demás (forma, bordes, sub-agrupaciones que hayas armado) es
 * exactamente lo que dibujaste en el SVG.
 *
 * `campo` es cuál mapa abrió este detalle -- "Hoy" (`ZONA_ACTUAL`) o
 * "Propuesta" (`ZONA_RECOMENDADA`). Decide qué SKU son los primarios
 * (ver `asientosPorMovimiento`): abrir desde "Situación actual" muestra
 * la ocupación de HOY tal cual es, sin rellenar los libres con llegadas
 * especulativas de la propuesta (eso hacía que el detalle pareciera
 * mostrar la propuesta en vez de la situación actual). */
export function VistaAsientosReales({
  zonaReal,
  claveExcel,
  recomendaciones,
  campo,
}: {
  zonaReal: ZonaReal;
  /** null = zona sin equivalente real en el Excel (ej. Rack Doble) --
   * nunca tiene SKU real, se muestra igual pero todo "disponible". */
  claveExcel: string | null;
  recomendaciones: RecomendacionSKU[];
  campo: 'ZONA_ACTUAL' | 'ZONA_RECOMENDADA';
}) {
  const grupoRef = useRef<SVGGElement>(null);
  const [hover, setHover] = useState<{ id: string; texto: string } | null>(null);
  // Por movimiento por defecto -- al hacer click en un sector desde
  // "Situación actual"/"Propuesta" lo que se quiere ver primero es qué
  // se mueve ahí, no el calor de rotación.
  const [modo, setModo] = useState<ModoColorAsientos>('movimiento');

  // Memorizado por el VALOR de markup_svg, no un objeto literal nuevo en
  // cada render -- si no, cualquier re-render ajeno (ej. el fetch de
  // reglas resolviendo async) hace que React vuelva a pegar el marcado
  // original y borre los colores/eventos que el efecto de abajo ya puso.
  const htmlProp = useMemo(() => ({ __html: zonaReal.markup_svg }), [zonaReal.markup_svg]);

  const asientos = useMemo(
    () => asientosPorMovimiento(zonaReal.espacios, claveExcel, recomendaciones, campo),
    [zonaReal, claveExcel, recomendaciones, campo],
  );

  const rangoRotacion = useMemo(() => {
    const valores = recomendaciones.map((r) => r.ROTACION_6M);
    return { min: Math.min(...valores), max: Math.max(...valores) };
  }, [recomendaciones]);

  // El marcado inyectado es DOM crudo, no controlado por React -- se
  // recorren sus nodos por id para pintarlos y engancharles el tooltip
  // cada vez que cambian los datos (SKU), el marcado (zona), el modo de
  // color, o el elemento inyectado en sí (htmlProp, por si algo lo
  // reinyecta).
  useEffect(() => {
    const contenedor = grupoRef.current;
    if (!contenedor) return;
    const limpiezas: (() => void)[] = [];

    for (const asiento of asientos) {
      const el = contenedor.querySelector<SVGElement>(`#${CSS.escape(asiento.id)}`);
      if (!el) continue;

      if (modo === 'rotacion' && asiento.sku && rangoRotacion.max > rangoRotacion.min) {
        el.setAttribute('class', 'asientos-reales-punto');
        el.style.fill = colorCalor((asiento.sku.ROTACION_6M - rangoRotacion.min) / (rangoRotacion.max - rangoRotacion.min));
      } else {
        el.setAttribute('class', `asientos-reales-punto estado-${asiento.estado}`);
        el.style.fill = '';
      }

      // Borde de color por comunidad de afinidad -- mismo mecanismo que
      // PlanoEscaneado.tsx, ver MapasView "Forzar afinidad".
      const comunidad = asiento.sku?.COMUNIDAD_AFINIDAD;
      if (comunidad != null) {
        el.style.stroke = colorComunidad(comunidad);
        el.style.strokeWidth = '1.8';
      } else {
        el.style.stroke = '';
        el.style.strokeWidth = '';
      }

      const onEnter = () => setHover({ id: asiento.id, texto: descripcionAsiento(asiento) });
      const onLeave = () => setHover(null);
      el.addEventListener('mouseenter', onEnter);
      el.addEventListener('mouseleave', onLeave);
      limpiezas.push(() => {
        el.removeEventListener('mouseenter', onEnter);
        el.removeEventListener('mouseleave', onLeave);
      });
    }

    return () => limpiezas.forEach((f) => f());
  }, [asientos, htmlProp, modo, rangoRotacion]);

  // Resalta en la grilla el espacio de la lista lateral que se está
  // pasando el mouse -- para ubicar visualmente dónde está ese SKU sin
  // tener que buscarlo entre todos los cuadros.
  function resaltarEnGrilla(id: string, activo: boolean) {
    grupoRef.current?.querySelector(`#${CSS.escape(id)}`)?.classList.toggle('asientos-reales-resaltado', activo);
  }

  const resumen = asientos.reduce(
    (acc, a) => {
      acc[a.estado] += 1;
      return acc;
    },
    { disponible: 0, ocupada: 0, se_va: 0, llega: 0 } as Record<EstadoMovimiento, number>,
  );

  // Estados que de verdad pueden aparecer en este `campo` -- "se_va" no
  // existe visto desde la propuesta (ya estamos en el estado futuro) y
  // "llega" no existe visto desde hoy (no se inventan posiciones).
  const estadosPosibles: EstadoMovimiento[] =
    campo === 'ZONA_ACTUAL' ? ['disponible', 'ocupada', 'se_va'] : ['disponible', 'ocupada', 'llega'];

  // Lista lateral: los SKU reales de esta zona, con los que se mueven
  // (según `campo`) primero y destacados -- ver ese dato requería antes
  // pasar el mouse cuadro por cuadro, poco intuitivo con cientos de
  // espacios por zona.
  const ocupados = useMemo(() => asientos.filter((a): a is AsientoMovimiento & { sku: RecomendacionSKU } => Boolean(a.sku)), [asientos]);
  const enMovimiento = ocupados.filter((a) => a.estado === 'se_va' || a.estado === 'llega');
  const seMantienen = ocupados.filter((a) => a.estado === 'ocupada');

  // Recorta el viewBox a la caja de esta zona (con margen) en vez de
  // mostrar el plano completo -- si no, una zona angosta como "Rack
  // Doble" se vería como una línea diminuta en la esquina del canvas.
  const viewBox = useMemo(() => {
    const espacios = zonaReal.espacios;
    if (espacios.length === 0) return LAYOUT_ESCANEADO.view_box ?? '0 0 1304 683';
    const xs = espacios.flatMap((a) => [a.x, a.x + a.ancho]);
    const ys = espacios.flatMap((a) => [a.y, a.y + a.alto]);
    const margen = 8;
    const minX = Math.min(...xs) - margen;
    const minY = Math.min(...ys) - margen;
    const w = Math.max(...xs) - minX + margen;
    const h = Math.max(...ys) - minY + margen;
    return `${minX} ${minY} ${w} ${h}`;
  }, [zonaReal]);

  return (
    <div className="asientos-reales">
      <p className="asientos-reales-resumen">
        <b>{resumen.ocupada}</b> ocupadas (se mantienen)
        {campo === 'ZONA_ACTUAL' && (
          <>
            {' '}
            · <b>{resumen.se_va}</b> se van
          </>
        )}
        {campo === 'ZONA_RECOMENDADA' && (
          <>
            {' '}
            · <b>{resumen.llega}</b> llegan
          </>
        )}{' '}
        · <b>{resumen.disponible}</b> disponibles · {asientos.length} espacios reales
      </p>
      <p className="asientos-reales-aviso">
        El SKU exacto en cada espacio es ilustrativo — el Excel no registra fila/columna/nivel, así que no existe una
        posición real por SKU. Se ordena por cercanía real a Mesas de trabajo y por líneas de pedido reales (no por
        rotación declarada, que no correlaciona con los hits reales).
      </p>

      <div className="ctrl" role="group" aria-label="Color de los espacios">
        <button aria-pressed={modo === 'movimiento'} onClick={() => setModo('movimiento')}>
          Por movimiento
        </button>
        <button aria-pressed={modo === 'rotacion'} onClick={() => setModo('rotacion')}>
          Por rotación
        </button>
      </div>

      <div className="asientos-reales-cuerpo">
        <div className="asientos-reales-mapa">
          <div className="asientos-reales-wrap">
            <svg
              className="asientos-reales-svg"
              viewBox={viewBox}
              role="img"
              aria-label="Espacios reales de la zona, estilo asientos de cine"
            >
              <path d={zonaReal.boundary_d ?? undefined} className="asientos-reales-borde" />
              {/* Marcado real del SVG que armaste -- se pega tal cual, no se
               * reconstruye. Contenido de confianza: viene de tu propio
               * archivo, generado por el script de extracción del proyecto. */}
              <g ref={grupoRef} dangerouslySetInnerHTML={htmlProp} />
            </svg>
            {hover && <div className="asientos-reales-tip">{hover.texto}</div>}
          </div>

          {modo === 'movimiento' ? (
            <ul className="asientos-reales-leyenda">
              {estadosPosibles.map((estado) => (
                <li key={estado}>
                  <span className={`asientos-reales-chip estado-${estado}`} aria-hidden="true" />
                  {ETIQUETA_ESTADO[estado]}
                </li>
              ))}
            </ul>
          ) : (
            <p className="asientos-reales-leyenda-calor">
              Color por rotación de 6 meses de cada SKU (verde = baja, amarillo = media, rojo = alta) — los espacios
              disponibles quedan en gris, sin dato de rotación.
            </p>
          )}
        </div>

        <div className="asientos-reales-lista">
          <h4>SKU en esta zona</h4>
          {ocupados.length === 0 ? (
            <p className="asientos-reales-lista-vacio">Ningún SKU real aquí.</p>
          ) : (
            <ul>
              {enMovimiento.map((a) => (
                <li
                  key={a.id}
                  className={`asientos-reales-item destacado estado-${a.estado}`}
                  onMouseEnter={() => resaltarEnGrilla(a.id, true)}
                  onMouseLeave={() => resaltarEnGrilla(a.id, false)}
                >
                  <p className="asientos-reales-item-sku">
                    <b>{a.sku.SKU}</b> · {a.sku.FAMILIA}
                  </p>
                  <p className="asientos-reales-item-detalle">{a.sku.JUSTIFICACION}</p>
                </li>
              ))}
              {seMantienen.map((a) => (
                <li
                  key={a.id}
                  className="asientos-reales-item"
                  onMouseEnter={() => resaltarEnGrilla(a.id, true)}
                  onMouseLeave={() => resaltarEnGrilla(a.id, false)}
                >
                  <p className="asientos-reales-item-sku">
                    <b>{a.sku.SKU}</b> · {a.sku.FAMILIA}
                  </p>
                  <p className="asientos-reales-item-detalle">Rotación 6m: {a.sku.ROTACION_6M}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
