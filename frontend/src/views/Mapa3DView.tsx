import { useEffect, useMemo, useRef, useState } from 'react';
import { Mapa3DEscena, type Escenario3D, type Mapa3DEscenaHandle, type ModoColor3D } from '../components/mapa3d/Mapa3DEscena';
import { construirEscena3D } from '../components/mapa3d/construirEscenas3D';
import { fetchZonas, type Zona } from '../api/zonas';
import { leerDatos3D, type Payload3D } from '../lib/mapa3dHandoff';
import './Mapa3DView.css';

/** Página standalone, montada en `#mapa3d` (ver `main.tsx`) -- se abre
 * en una ventana/pestaña NUEVA desde el botón de MapasView, nunca es
 * parte del árbol de `<App/>`. Lee los datos ya calculados de
 * `localStorage` (ver `mapa3dHandoff.ts`): es una foto del momento en
 * que se abrió, no una vista sincronizada en vivo con la ventana
 * principal -- si recalculás el pipeline ahí, hay que volver a abrir
 * esta ventana para verlo actualizado. */
export function Mapa3DView() {
  const [payload] = useState<Payload3D | null>(() => leerDatos3D());
  const [zonas, setZonas] = useState<Zona[] | null>(null);
  const [errorZonas, setErrorZonas] = useState<string | null>(null);
  const [escenario, setEscenario] = useState<Escenario3D>('antes');
  const [modoColor, setModoColor] = useState<ModoColor3D>('calor');

  const escenaRef = useRef<Mapa3DEscenaHandle>(null);
  const [terminoBusqueda, setTerminoBusqueda] = useState('');
  const [skuEnfocado, setSkuEnfocado] = useState<string | null>(null);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);

  function buscarSku(e: React.FormEvent) {
    e.preventDefault();
    const sku = terminoBusqueda.trim().toUpperCase();
    if (!sku) return;
    const encontrado = escenaRef.current?.enfocarSku(sku, true) ?? false;
    if (encontrado) {
      setSkuEnfocado(sku);
      setErrorBusqueda(null);
    } else {
      setSkuEnfocado(null);
      setErrorBusqueda(`"${sku}" no tiene un espacio real en la escena "${escenario === 'antes' ? 'Hoy' : 'Propuesta'}".`);
    }
  }

  // El SKU enfocado puede estar en otra zona en "Hoy" que en "Propuesta"
  // -- al cambiar de escenario, se vuelve a buscar y la cámara vuela a
  // la posición nueva sin que haga falta escribir el SKU otra vez.
  // Depende solo de `escenario`: el cambio de modo de color no mueve la
  // caja, `Mapa3DEscena` ya reengancha el contorno sola (ver `pintar`).
  useEffect(() => {
    if (!skuEnfocado) return;
    const encontrado = escenaRef.current?.enfocarSku(skuEnfocado, true) ?? false;
    setErrorBusqueda(
      encontrado ? null : `"${skuEnfocado}" no tiene un espacio real en la escena "${escenario === 'antes' ? 'Hoy' : 'Propuesta'}".`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe reaccionar a `escenario`, no a `skuEnfocado` (eso ya lo maneja `buscarSku` directamente al enviar el formulario).
  }, [escenario]);

  useEffect(() => {
    if (!payload) return;
    fetchZonas()
      .then((r) => setZonas(r.zonas))
      .catch(() => setErrorZonas('No se pudo conectar con el backend para cargar la geometría de las zonas.'));
  }, [payload]);

  const escena = useMemo(() => {
    if (!payload || !zonas) return null;
    return construirEscena3D(payload.recomendaciones, zonas);
  }, [payload, zonas]);

  // Los KPIs de la barra lateral dependen del modo de color activo --
  // "alto/bajo impacto" solo tiene sentido en el modo calor (es un
  // tercil de distancia), "se van/llegan" solo en el modo movimiento.
  // Se recalculan acá con el mismo criterio que usa `Mapa3DEscena` para
  // pintar, no se leen del color ya pintado (que ahora depende del modo).
  const kpisModo = useMemo(() => {
    if (!escena) return null;
    const cajas = escena[escenario];
    if (modoColor === 'calor') {
      const { rotMin, rotMax } = escena;
      const ocupados = cajas.filter((c) => c.sku);
      const t = (c: (typeof ocupados)[number]) =>
        rotMax > rotMin ? (c.sku!.ROTACION_6M - rotMin) / (rotMax - rotMin) : 0;
      return {
        etiquetaA: 'SKU de alta rotación',
        valorA: ocupados.filter((c) => t(c) > 0.66).length,
        etiquetaB: 'SKU de baja rotación',
        valorB: ocupados.filter((c) => t(c) <= 0.33).length,
      };
    }
    // "se_va" solo existe visto desde "Hoy" y "llega" solo desde
    // "Propuesta" (mismo criterio que `VistaAsientosReales.tsx`) -- se
    // muestra el que corresponda al escenario activo, no los dos juntos.
    return {
      etiquetaA: 'SKU que se mantienen',
      valorA: cajas.filter((c) => c.estado === 'ocupada').length,
      etiquetaB: escenario === 'antes' ? 'SKU que se van' : 'SKU que llegan',
      valorB: cajas.filter((c) => c.estado === (escenario === 'antes' ? 'se_va' : 'llega')).length,
    };
  }, [escena, escenario, modoColor]);

  if (!payload) {
    return (
      <div className="mapa3d-vacio">
        <p>
          Esta ventana necesita datos de una corrida del pipeline. Abrila con el botón <b>"Ver comparación 3D"</b> desde la
          sección <b>Mapas</b> de la app — no funciona si la abrís directamente por URL.
        </p>
      </div>
    );
  }

  return (
    <div className="mapa3d-pagina">
      <div id="mapa3d-canvas">
        {errorZonas && <p className="mapa3d-error">{errorZonas}</p>}
        {escena && <Mapa3DEscena ref={escenaRef} datos={escena} escenario={escenario} modoColor={modoColor} />}
      </div>

      <div className="mapa3d-panel">
        <h1>Reslotting — Antes / Después</h1>
        <p className="mapa3d-sub">
          CD Aldeas Inchcape · geometría real escaneada · {payload.recomendaciones.length} SKU ·{' '}
          {payload.modoObjetivo === 'velocidad' ? 'Modelo 1 · Velocidad' : payload.modoObjetivo === 'valor' ? 'Modelo 2 · Valor' : 'Modelo 3 · Servicio'}
        </p>

        <form className="mapa3d-buscador" onSubmit={buscarSku}>
          <input
            type="search"
            placeholder="Buscar SKU (ej. SKU00051)"
            value={terminoBusqueda}
            onChange={(e) => setTerminoBusqueda(e.target.value)}
          />
          <button type="submit">Enfocar</button>
        </form>
        {skuEnfocado && !errorBusqueda && (
          <p className="mapa3d-buscador-estado">
            Mostrando <b>{skuEnfocado}</b>{' '}
            <button
              className="mapa3d-buscador-limpiar"
              onClick={() => {
                setSkuEnfocado(null);
                setTerminoBusqueda('');
              }}
            >
              ✕
            </button>
          </p>
        )}
        {errorBusqueda && <p className="mapa3d-buscador-error">{errorBusqueda}</p>}

        <div className="mapa3d-toggle">
          <button className={escenario === 'antes' ? 'on' : ''} onClick={() => setEscenario('antes')}>
            Hoy
          </button>
          <button className={escenario === 'despues' ? 'on' : ''} onClick={() => setEscenario('despues')}>
            Propuesta
          </button>
        </div>

        <div className="mapa3d-toggle mapa3d-toggle-color">
          <button className={modoColor === 'movimiento' ? 'on' : ''} onClick={() => setModoColor('movimiento')}>
            Por movimiento
          </button>
          <button className={modoColor === 'calor' ? 'on' : ''} onClick={() => setModoColor('calor')}>
            Mapa de calor
          </button>
        </div>

        {modoColor === 'calor' ? (
          <>
            <div className="mapa3d-leyenda-fila">
              <span className="mapa3d-swatch" style={{ background: '#22c55e' }} /> Baja rotación
            </div>
            <div className="mapa3d-leyenda-fila">
              <span className="mapa3d-swatch" style={{ background: '#eab308' }} /> Media
            </div>
            <div className="mapa3d-leyenda-fila">
              <span className="mapa3d-swatch" style={{ background: '#ef4444' }} /> Alta
            </div>
            <div className="mapa3d-leyenda-fila">
              <span className="mapa3d-swatch" style={{ background: '#3a3d45', border: '1px solid #666' }} /> Disponible
            </div>
            <p className="mapa3d-nota">
              Color por rotación de 6 meses de cada SKU — misma escala que "Por rotación" en el mapa 2D. Es un dato por
              SKU, no por zona: dos SKU en la misma zona pueden salir con colores distintos.
            </p>
          </>
        ) : (
          <>
            <div className="mapa3d-leyenda-fila">
              <span className="mapa3d-swatch" style={{ background: '#0a84ff' }} /> Se mantiene
            </div>
            <div className="mapa3d-leyenda-fila">
              <span className="mapa3d-swatch" style={{ background: '#ff453a' }} /> Se va a mover
            </div>
            <div className="mapa3d-leyenda-fila">
              <span className="mapa3d-swatch" style={{ background: '#32d74b' }} /> Llega (nueva)
            </div>
            <div className="mapa3d-leyenda-fila">
              <span className="mapa3d-swatch" style={{ background: '#3a3d45', border: '1px solid #666' }} /> Disponible
            </div>
            <p className="mapa3d-nota">
              Mismo criterio de movimiento que el mapa 2D ("Por ocupación") — no indica qué tan lejos está la zona.
            </p>
          </>
        )}

        <div className="mapa3d-kpis">
          {kpisModo && (
            <>
              <div className="mapa3d-kpi-fila">
                <span>{kpisModo.etiquetaA}</span>
                <span className="mapa3d-kpi-val">{kpisModo.valorA}</span>
              </div>
              <div className="mapa3d-kpi-fila">
                <span>{kpisModo.etiquetaB}</span>
                <span className="mapa3d-kpi-val">{kpisModo.valorB}</span>
              </div>
            </>
          )}
          <div className="mapa3d-kpi-fila">
            <span>SKU que se mueven</span>
            <span className="mapa3d-kpi-val">{payload.kpis.sku_movidos}</span>
          </div>
          <div className="mapa3d-kpi-fila">
            <span>Ahorro estimado (este lote)</span>
            <span className="mapa3d-kpi-val">{payload.kpis.ahorro_min.toFixed(0)} min</span>
          </div>
        </div>
        <p className="mapa3d-nota mapa3d-nota-generado">
          Datos de la corrida abierta el {new Date(payload.generadoEn).toLocaleTimeString('es')} — recalculá en la ventana
          principal y volvé a abrir esta comparación para actualizarla.
        </p>
      </div>
    </div>
  );
}
