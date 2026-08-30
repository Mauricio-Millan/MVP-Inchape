import { EstadoPipeline } from '../components/ui/EstadoPipeline';
import { TarjetaKpi } from '../components/ui/TarjetaKpi';
import { usePipeline } from '../context/PipelineContext';
import '../components/plano/PlanoSVG.css'; // .ctrl -- mismo toggle que el resto de los mapas

/** Los 2 KPIs que el caso ya declaró en RESUMEN (ver FEATURES-Y-KPIS.md).
 * Vista de diagnóstico: el número grande es el de HOY, no el optimizado
 * -- la propuesta aparece como nota de acento, es el incentivo para ir
 * a "SKU · Slotting", no el protagonista (ver DISENO-FRONTEND.md §1.2).
 *
 * El switch de abajo no cambia el "hoy" (siempre es el tiempo declarado
 * en el Excel, `TIEMPO_LAYOUT_ACTUAL` -- el "Actual Declarado" que pediste
 * como referencia fija) -- cambia CÓMO se calcula la propuesta: con el
 * tiempo declarado por zona en `LAYOUT_CD`, o con un tiempo calibrado
 * contra la distancia real medida en el layout escaneado del almacén.
 * El optimizador puede recomendar zonas distintas en cada modo, no es
 * solo un recálculo del mismo resultado (ver `LAYOUT-SVG-ESCANEADO.md` §9). */
export function KpisPrincipales() {
  const { resultado, cargando, modoDistancia, cambiarModoDistancia } = usePipeline();
  if (!resultado) return <EstadoPipeline mensaje="Ejecuta el pipeline para ver los KPIs del caso." />;

  const { kpis } = resultado;
  // El modo "svg" puede dar una propuesta peor que hoy (el optimizador
  // recomienda otras zonas bajo otro costo) -- reduccion_porcentaje
  // puede salir negativa, no siempre es una reducción real.
  const signoReduccion = kpis.reduccion_porcentaje >= 0 ? '−' : '+';
  const magnitudReduccion = Math.abs(kpis.reduccion_porcentaje).toFixed(1);

  return (
    <div>
      <div className="ctrl kpis-modo-distancia" role="group" aria-label="Cómo calcular la propuesta">
        <button
          aria-pressed={modoDistancia === 'layout_cd'}
          disabled={cargando}
          onClick={() => cambiarModoDistancia('layout_cd')}
        >
          Layout CD (Excel)
        </button>
        <button aria-pressed={modoDistancia === 'svg'} disabled={cargando} onClick={() => cambiarModoDistancia('svg')}>
          Distancia real (SVG)
        </button>
      </div>
      <p className="kpis-modo-distancia-nota">
        {modoDistancia === 'layout_cd'
          ? 'Propuesta calculada con el tiempo de acceso declarado por zona en tu Excel (LAYOUT_CD).'
          : 'Propuesta calculada con un tiempo estimado por cercanía real a Mesas de trabajo, medida sobre el layout escaneado y calibrado contra el tiempo declarado (no es una medición de campo). El "hoy" de abajo no cambia — sigue siendo el declarado en el Excel.'}
      </p>

      <div className="grid-kpi grid-kpi-principal">
        <TarjetaKpi
          etiqueta="Productividad hoy"
          valor={`${kpis.productividad_actual_lineas_hh.toFixed(2)} líneas/HH`}
          subtexto={`con la propuesta: ${kpis.productividad_optimizada_lineas_hh.toFixed(2)} líneas/HH`}
          subtextoAcento
        />
        <TarjetaKpi
          etiqueta="Tiempo promedio de picking hoy"
          valor={`${kpis.tiempo_promedio_actual_min_pedido.toFixed(2)} min/pedido`}
          subtexto={`con la propuesta: ${kpis.tiempo_promedio_optimizado_min_pedido.toFixed(2)} min/pedido (${signoReduccion}${magnitudReduccion}%)`}
          subtextoAcento
        />
      </div>
    </div>
  );
}
