import { useMemo, useState } from 'react';
import { Badge } from '../components/ui/Badge';
import { EstadoPipeline } from '../components/ui/EstadoPipeline';
import { usePipeline } from '../context/PipelineContext';
import { ApiError } from '../api/config';
import { fetchDetalleSku, type RespuestaRecomendacionSKU } from '../api/recomendaciones';
import type { RecomendacionSKU } from '../api/pipeline';
import { colorCalor } from '../lib/colorCalor';
import { exportarPropuestaSlotting } from '../lib/exportarSlotting';
import { EtiquetaModelo } from '../components/ui/EtiquetaModelo';
import './SkuSlottingView.css';

/** `SCORE_PRIORIDAD` (fórmula ponderada editable, ver `CRITERIOS`/pesos
 * arriba) y `PERFIL_ML`/`PRIORIDAD_CLUSTER_RANK` (ranking de clusters
 * de KMeans por impacto promedio, `ml_perfil.py`) son dos criterios de
 * prioridad DISTINTOS que el backend ya calcula y devuelve juntos en
 * cada `RecomendacionSKU` -- nunca hizo falta tocar el backend para
 * mostrarlos ambos. No se fusionan en un solo número: mezclar un score
 * ponderado interpretable con un rank de cluster no-supervisado
 * perdería la interpretabilidad de ambos sin aportar nada que el score
 * (ajustable con los sliders de arriba) no cubra ya. Se muestran uno al
 * lado del otro para que se pueda comparar -- y sirven además para
 * ver cuándo *no* coinciden (un SKU con score bajo pero en un cluster
 * de "Impacto alto" es una señal de que vale la pena revisarlo aparte). */
function colorPerfilML(perfil: string): string {
  if (perfil.includes('alto')) return colorCalor(1);
  if (perfil.includes('medio')) return colorCalor(0.5);
  return colorCalor(0);
}

const CRITERIOS = [
  { clave: 'ahorro', etiqueta: 'Ahorro potencial' },
  { clave: 'rotacion', etiqueta: 'Rotación' },
  { clave: 'abc', etiqueta: 'Clasificación ABC' },
  { clave: 'facilidad_movimiento', etiqueta: 'Facilidad de movimiento' },
] as const;

const GLOSARIO = [
  {
    termino: 'Ahorro potencial',
    texto: 'Cuánto tiempo se ahorraría moviendo el SKU a la zona más rápida del CD, comparado contra el resto del catálogo.',
    calculo: 'Primero se calcula el ahorro en minutos: N° de líneas del SKU × (tiempo de acceso de su zona actual − tiempo de acceso de la zona más rápida del CD), sin bajar de 0. Ese valor se normaliza min-max entre 0 y 1 contra todo el catálogo: el SKU con más minutos de ahorro posible queda en 1.0, el que no ahorra nada queda en 0.0.',
  },
  {
    termino: 'Rotación',
    texto: 'Qué tan seguido sale el SKU en pedidos — a más rotación, más conviene tenerlo cerca de despacho.',
    calculo: 'N° de veces que el SKU aparece en pedidos de los últimos 6 meses, normalizado min-max (0 a 1) contra el resto del catálogo.',
  },
  {
    termino: 'Clasificación ABC',
    texto: 'Categoría de importancia del SKU por volumen de venta.',
    calculo: 'Mapeo fijo desde la categoría ABC ya calculada: A = 1.00, B = 0.60, C = 0.30.',
  },
  {
    termino: 'Facilidad de movimiento',
    texto: 'Qué tan barato es reubicar el SKU — los livianos y pequeños son más fáciles de mover que uno voluminoso.',
    calculo: '1 menos el volumen del SKU normalizado min-max (0 a 1) contra el catálogo. A menor volumen relativo, más cerca de 1.0.',
  },
];

const FORMULA_SCORE =
  'Score (0–100) = 100 × (peso_ahorro × Ahorro potencial + peso_rotación × Rotación + peso_abc × Clasificación ABC + peso_facilidad × Facilidad de movimiento)';

type Columna = keyof Pick<
  RecomendacionSKU,
  | 'SKU'
  | 'FAMILIA'
  | 'ABC'
  | 'ZONA_ACTUAL'
  | 'TIEMPO_LAYOUT_ACTUAL'
  | 'ZONA_RECOMENDADA'
  | 'TIEMPO_NUEVO_MIN'
  | 'AHORRO_PORCENTAJE'
  | 'SCORE_PRIORIDAD'
  | 'PRIORIDAD_CLUSTER_RANK'
>;
type FiltroMovimiento = 'TODOS' | 'MOVER' | 'MANTENER';

export function SkuSlottingView() {
  const { resultado, anterior, cargando, ejecutar } = usePipeline();
  const [pesos, setPesos] = useState({ ahorro: 55, rotacion: 20, abc: 10, facilidad_movimiento: 15 });
  // 20% -- mismo default que PORCENTAJE_MAX_MOVIMIENTO en config.py del
  // backend; acá solo se refleja, nunca se hardcodea un valor distinto.
  const [porcentajeMaxMovimiento, setPorcentajeMaxMovimiento] = useState(20);
  // Nunca por defecto -- paga ~15s del test de significancia y solo
  // tiene efecto real si ese test confirma señal sobre el lote vigente
  // (ver resultado.afinidad_aplicada/afinidad_motivo más abajo).
  const [usarAfinidad, setUsarAfinidad] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [filtroMovimiento, setFiltroMovimiento] = useState<FiltroMovimiento>('TODOS');
  const [orden, setOrden] = useState<{ columna: Columna; asc: boolean }>({ columna: 'SCORE_PRIORIDAD', asc: false });
  const [expandido, setExpandido] = useState<string | null>(null);
  const [detalles, setDetalles] = useState<Map<string, RespuestaRecomendacionSKU>>(new Map());
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState<string | null>(null);

  const sumaPesos = pesos.ahorro + pesos.rotacion + pesos.abc + pesos.facilidad_movimiento;

  const cambios = useMemo(() => {
    if (!resultado || !anterior) return null;
    const zonaAnteriorPorSku = new Map(anterior.recomendaciones.map((r) => [r.SKU, r.ZONA_RECOMENDADA]));
    return resultado.recomendaciones.filter((r) => zonaAnteriorPorSku.get(r.SKU) !== undefined && zonaAnteriorPorSku.get(r.SKU) !== r.ZONA_RECOMENDADA);
  }, [resultado, anterior]);

  async function recalcular() {
    if (sumaPesos === 0) return;
    await ejecutar(
      {
        ahorro: pesos.ahorro / sumaPesos,
        rotacion: pesos.rotacion / sumaPesos,
        abc: pesos.abc / sumaPesos,
        facilidad_movimiento: pesos.facilidad_movimiento / sumaPesos,
      },
      porcentajeMaxMovimiento / 100,
      usarAfinidad,
    );
  }

  const filas = useMemo(() => {
    if (!resultado) return [];
    const texto = busqueda.trim().toUpperCase();
    return resultado.recomendaciones
      .filter((r) => filtroMovimiento === 'TODOS' || r.MOVIMIENTO === filtroMovimiento)
      .filter((r) => !texto || r.SKU.includes(texto) || r.FAMILIA.toUpperCase().includes(texto) || r.MARCA.toUpperCase().includes(texto))
      .sort((a, b) => {
        const va = a[orden.columna];
        const vb = b[orden.columna];
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
        return orden.asc ? cmp : -cmp;
      });
  }, [resultado, busqueda, filtroMovimiento, orden]);

  if (!resultado) {
    return <EstadoPipeline mensaje="Ejecuta el pipeline para ver el estado de slotting por SKU." />;
  }

  function alternarOrden(columna: Columna) {
    setOrden((actual) => (actual.columna === columna ? { columna, asc: !actual.asc } : { columna, asc: true }));
  }

  async function alternarExpandido(sku: string) {
    if (expandido === sku) {
      setExpandido(null);
      return;
    }
    setExpandido(sku);
    if (!detalles.has(sku)) {
      setCargandoDetalle(sku);
      setErrorDetalle(null);
      try {
        const d = await fetchDetalleSku(sku, resultado?.modo_objetivo);
        setDetalles((m) => new Map(m).set(sku, d));
      } catch (e) {
        setErrorDetalle(e instanceof ApiError ? e.detail : 'No se pudo consultar el SKU.');
      } finally {
        setCargandoDetalle(null);
      }
    }
  }

  return (
    <div>
      <section className="panel">
        <header>
          <h2>Pesos del score ponderado</h2>
          <span className="note">Suma normalizada a 100%</span>
        </header>
        <div className="panel-body">
          {resultado && resultado.modo_objetivo !== 'velocidad' && (
            <p className="peso-nota" style={{ marginBottom: 14 }}>
              La columna <span className="mono">Score</span> de la tabla sigue midiendo <b>ahorro de minutos</b> (ver
              fórmula abajo) aunque la propuesta activa se haya decidido por{' '}
              {resultado.modo_objetivo === 'valor' ? 'valor económico (Modelo 2)' : 'nivel de servicio (Modelo 3)'} —
              es un criterio de prioridad distinto al que realmente asignó la zona, no un error. Al expandir una fila
              (▼) la justificación explica, en texto, el criterio real que usó el optimizador para esa recomendación.
            </p>
          )}
          {CRITERIOS.map((c) => (
            <label key={c.clave} className="peso-fila">
              <span className="peso-etiqueta">{c.etiqueta}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={pesos[c.clave]}
                onChange={(e) => setPesos((p) => ({ ...p, [c.clave]: Number(e.target.value) }))}
              />
              <span className="mono peso-valor">
                {sumaPesos > 0 ? ((pesos[c.clave] / sumaPesos) * 100).toFixed(0) : 0}%
              </span>
            </label>
          ))}
          <hr className="peso-separador" />

          <label className="peso-fila">
            <span className="peso-etiqueta">Tope de SKU a mover</span>
            <input
              type="range"
              min={1}
              max={100}
              value={porcentajeMaxMovimiento}
              onChange={(e) => setPorcentajeMaxMovimiento(Number(e.target.value))}
            />
            <span className="mono peso-valor">{porcentajeMaxMovimiento}%</span>
          </label>
          <p className="peso-nota">
            Restricción dura del optimizador (`porcentaje_max_movimiento`), no un criterio de puntuación — sube o baja
            cuántos SKU como máximo puede reubicar por corrida.
            {resultado && (
              <>
                {' '}
                Con el tope actual: <b>{resultado.kpis.max_movimientos_permitidos}</b> de{' '}
                <b>{resultado.kpis.sku_analizados}</b> SKU ({resultado.kpis.sku_movidos} movidos en esta corrida).
              </>
            )}
          </p>

          <label className="peso-fila">
            <span className="peso-etiqueta">Afinidad de pedidos</span>
            <input
              type="checkbox"
              checked={usarAfinidad}
              onChange={(e) => setUsarAfinidad(e.target.checked)}
              style={{ justifySelf: 'start' }}
            />
            <span className="mono peso-valor">{usarAfinidad ? 'Sí' : 'No'}</span>
          </label>
          <p className="peso-nota">
            Agrupa SKU que suelen pedirse juntos en el mismo pedido y premia concentrarlos en menos zonas --
            corre un test de significancia por remuestreo (~15s extra) antes de decidir si hay señal real; si
            no la hay, el resultado sale idéntico a no usarla. Nunca fuerza nada por opinión.
            {' '}<b>{resultado.afinidad_aplicada ? 'Aplicada en la última corrida:' : 'No aplicada en la última corrida:'}</b>{' '}
            {resultado.afinidad_motivo}
          </p>

          <button className="boton" disabled={cargando || sumaPesos === 0} onClick={recalcular}>
            {cargando ? 'Recalculando…' : 'Recalcular con estos pesos'}
          </button>

          {cambios && (
            <p className="peso-resultado">
              {cambios.length === 0
                ? 'Ningún SKU cambió de zona recomendada con este ajuste.'
                : `${cambios.length} SKU cambiaron de zona recomendada respecto al cálculo anterior.`}
            </p>
          )}
        </div>
      </section>

      <section className="panel">
        <header>
          <h2>
            SKU · estado y recomendación de slotting <EtiquetaModelo modo={resultado.modo_objetivo} />
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="note">{filas.length} de {resultado.recomendaciones.length}</span>
            <button className="boton boton-secundario" onClick={() => exportarPropuestaSlotting(resultado)}>
              Exportar propuesta slotting
            </button>
          </div>
        </header>
        <div className="panel-body">
          <div className="skus-filtros">
            <input
              className="skus-buscar"
              type="search"
              placeholder="Buscar SKU, familia o marca…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            <div className="ctrl" role="group" aria-label="Filtrar por movimiento">
              {(['TODOS', 'MOVER', 'MANTENER'] as const).map((f) => (
                <button key={f} aria-pressed={filtroMovimiento === f} onClick={() => setFiltroMovimiento(f)}>
                  {f === 'TODOS' ? 'Todos' : f === 'MOVER' ? 'Mover' : 'Mantener'}
                </button>
              ))}
            </div>
          </div>

          <div className="scroll">
            <table className="skus-tabla">
              <thead>
                <tr>
                  <th rowSpan={2} className="skus-th" onClick={() => alternarOrden('SKU')}>SKU{orden.columna === 'SKU' ? (orden.asc ? ' ▲' : ' ▼') : ''}</th>
                  <th rowSpan={2} className="skus-th" onClick={() => alternarOrden('FAMILIA')}>Familia{orden.columna === 'FAMILIA' ? (orden.asc ? ' ▲' : ' ▼') : ''}</th>
                  <th rowSpan={2} className="skus-th" onClick={() => alternarOrden('ABC')}>ABC{orden.columna === 'ABC' ? (orden.asc ? ' ▲' : ' ▼') : ''}</th>
                  <th colSpan={2} className="skus-grupo skus-grupo-actual">Hoy</th>
                  <th colSpan={5} className="skus-grupo skus-grupo-recomendado">Propuesta</th>
                  <th rowSpan={2}></th>
                </tr>
                <tr>
                  <th className="skus-th skus-grupo-actual" onClick={() => alternarOrden('ZONA_ACTUAL')}>Zona{orden.columna === 'ZONA_ACTUAL' ? (orden.asc ? ' ▲' : ' ▼') : ''}</th>
                  <th className="skus-th skus-grupo-actual" style={{ textAlign: 'right' }} onClick={() => alternarOrden('TIEMPO_LAYOUT_ACTUAL')}>Tiempo (min){orden.columna === 'TIEMPO_LAYOUT_ACTUAL' ? (orden.asc ? ' ▲' : ' ▼') : ''}</th>
                  <th className="skus-th skus-grupo-recomendado" onClick={() => alternarOrden('ZONA_RECOMENDADA')}>Zona{orden.columna === 'ZONA_RECOMENDADA' ? (orden.asc ? ' ▲' : ' ▼') : ''}</th>
                  <th className="skus-th skus-grupo-recomendado" style={{ textAlign: 'right' }} onClick={() => alternarOrden('TIEMPO_NUEVO_MIN')}>Tiempo (min){orden.columna === 'TIEMPO_NUEVO_MIN' ? (orden.asc ? ' ▲' : ' ▼') : ''}</th>
                  <th className="skus-th skus-grupo-recomendado" style={{ textAlign: 'right' }} onClick={() => alternarOrden('AHORRO_PORCENTAJE')}>Ahorro{orden.columna === 'AHORRO_PORCENTAJE' ? (orden.asc ? ' ▲' : ' ▼') : ''}</th>
                  <th className="skus-th skus-grupo-recomendado" style={{ textAlign: 'right' }} onClick={() => alternarOrden('SCORE_PRIORIDAD')} title="Score ponderado (ver sliders arriba)">Score{orden.columna === 'SCORE_PRIORIDAD' ? (orden.asc ? ' ▲' : ' ▼') : ''}</th>
                  <th className="skus-th skus-grupo-recomendado" onClick={() => alternarOrden('PRIORIDAD_CLUSTER_RANK')} title="Ranking de impacto del cluster ML al que pertenece este SKU (ver ml_perfil.py)">Perfil ML{orden.columna === 'PRIORIDAD_CLUSTER_RANK' ? (orden.asc ? ' ▲' : ' ▼') : ''}</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((r) => (
                  <FilaSku
                    key={r.SKU}
                    r={r}
                    expandido={expandido === r.SKU}
                    cargando={cargandoDetalle === r.SKU}
                    error={expandido === r.SKU ? errorDetalle : null}
                    detalle={detalles.get(r.SKU) ?? null}
                    onToggle={() => alternarExpandido(r.SKU)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function FilaSku({
  r,
  expandido,
  cargando,
  error,
  detalle,
  onToggle,
}: {
  r: RecomendacionSKU;
  expandido: boolean;
  cargando: boolean;
  error: string | null;
  detalle: RespuestaRecomendacionSKU | null;
  onToggle: () => void;
}) {
  return (
    <>
      <tr>
        <td className="mono">{r.SKU}</td>
        <td>{r.FAMILIA}</td>
        <td>{r.ABC}</td>
        <td className="mono skus-grupo-actual">{r.ZONA_ACTUAL}</td>
        <td className="num skus-grupo-actual">{r.TIEMPO_LAYOUT_ACTUAL.toFixed(2)}</td>
        <td className="mono skus-grupo-recomendado">{r.ZONA_RECOMENDADA}</td>
        <td className="num skus-grupo-recomendado">{r.TIEMPO_NUEVO_MIN.toFixed(2)}</td>
        <td className="num skus-grupo-recomendado">{r.AHORRO_PORCENTAJE.toFixed(0)}%</td>
        <td className="num skus-grupo-recomendado">{r.SCORE_PRIORIDAD.toFixed(1)}</td>
        <td className="skus-grupo-recomendado">
          <span
            className="badge"
            style={{ background: colorPerfilML(r.PERFIL_ML), color: '#fff' }}
            title={`Cluster ${r.CLUSTER_ML} · índice de impacto del cluster: ${r.INDICE_IMPACTO_CLUSTER.toFixed(2)}`}
          >
            {r.PERFIL_ML}
          </span>
        </td>
        <td>
          <Badge tono={r.MOVIMIENTO === 'MOVER' ? 'mover' : 'mantener'}>{r.MOVIMIENTO}</Badge>
          <button className="skus-expandir" onClick={onToggle} aria-expanded={expandido} aria-label="Ver explicación del score">
            {expandido ? '▲' : '▼'}
          </button>
        </td>
      </tr>
      {expandido && (
        <tr className="skus-fila-detalle">
          <td colSpan={11}>
            {cargando && <p>Consultando…</p>}
            {error && <p className="estado-error">{error}</p>}
            {detalle && <DetalleSku detalle={detalle} />}
          </td>
        </tr>
      )}
    </>
  );
}

function DetalleSku({ detalle }: { detalle: RespuestaRecomendacionSKU }) {
  const { recomendacion: r, desglose_score: score, reglas_aplicadas: reglas, explicacion_cluster: cluster } = detalle;
  const maxContribucion = Math.max(...Object.values(cluster.contribucion_por_variable), 1e-9);
  const [glosarioAbierto, setGlosarioAbierto] = useState(false);

  return (
    <div className="detalle-sku">
      <p style={{ fontSize: 12.5, color: 'var(--grafito2)', marginBottom: 14 }}>{r.JUSTIFICACION}</p>

      <h3 className="detalle-subtitulo">
        Score desglosado por criterio (total {score.total.toFixed(1)})
        <button className="skus-ayuda" onClick={() => setGlosarioAbierto(true)} aria-label="Qué son estas variables y cómo se calculan">
          ?
        </button>
      </h3>
      {glosarioAbierto && <ModalGlosarioScore onClose={() => setGlosarioAbierto(false)} />}
      {CRITERIOS.map((c) => (
        <BarraScore key={c.clave} etiqueta={c.etiqueta} valor={score[c.clave]} max={score.total || 1} />
      ))}

      <h3 className="detalle-subtitulo">Reglas que afectaron este SKU</h3>
      {reglas.length === 0 ? (
        <p style={{ fontSize: 12.5, color: 'var(--grafito2)' }}>Ninguna regla activa lo afectó.</p>
      ) : (
        <ul className="peso-lista-cambios">
          {reglas.map((d, i) => (
            <li key={i}>
              <b className="mono">{d.regla_id}</b>: {d.motivo}
            </li>
          ))}
        </ul>
      )}

      <h3 className="detalle-subtitulo">
        Cluster ML: {cluster.perfil} (cluster {cluster.cluster})
        {cluster.asignacion_ambigua && <span className="badge badge-mover" style={{ marginLeft: 8 }}>Asignación ambigua</span>}
      </h3>
      <p style={{ fontSize: 12.5, color: 'var(--grafito2)', marginBottom: 8 }}>
        Distancia al centroide propio: {cluster.distancia_cluster_propio.toFixed(3)} · al 2º más cercano:{' '}
        {cluster.distancia_segundo_mas_cercano.toFixed(3)} · silhouette individual: {cluster.silhouette_individual.toFixed(3)}
      </p>
      {Object.entries(cluster.contribucion_por_variable).map(([variable, valor]) => (
        <BarraScore key={variable} etiqueta={variable} valor={valor} max={maxContribucion} />
      ))}
    </div>
  );
}

function ModalGlosarioScore({ onClose }: { onClose: () => void }) {
  return (
    <div className="detalle-zona-overlay" onClick={onClose}>
      <div className="skus-modal-glosario" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Qué significa cada variable del score">
        <header className="detalle-zona-header">
          <h2>Cómo se arma el score</h2>
          <button className="detalle-zona-cerrar" onClick={onClose} aria-label="Cerrar">✕</button>
        </header>
        <p className="mono skus-formula-total">{FORMULA_SCORE}</p>
        <dl>
          {GLOSARIO.map((g) => (
            <div key={g.termino} className="skus-glosario-item">
              <dt>{g.termino}</dt>
              <dd>{g.texto}</dd>
              <dd className="skus-glosario-calculo">
                <b>Cómo se calcula:</b> {g.calculo}
              </dd>
            </div>
          ))}
        </dl>
        <p className="skus-glosario-nota">
          Los pesos (peso_ahorro, peso_rotación…) son los que ajustas arriba con los sliders — se normalizan para
          sumar 100% antes de aplicarse.
        </p>
      </div>
    </div>
  );
}

function BarraScore({ etiqueta, valor, max }: { etiqueta: string; valor: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (valor / max) * 100) : 0;
  return (
    <div className="barra-score">
      <span className="barra-etiqueta">{etiqueta}</span>
      <div className="barra-pista">
        <div className="barra-relleno" style={{ width: `${pct}%` }} />
      </div>
      <span className="mono barra-valor">{valor.toFixed(2)}</span>
    </div>
  );
}
