import { EstadoActualView } from './EstadoActualView';
import { KpisPrincipales } from './KpisPrincipales';

/** Vista de aterrizaje (DISENO-FRONTEND.md §1.2): diagnóstico de hoy
 * primero (KPIs), mapa de calor de ocupación actual debajo (dentro de
 * `EstadoActualView`, que ya es el plano real escaneado -- ver
 * `LAYOUT-SVG-ESCANEADO.md` §7, no hace falta repetirlo aparte). */
export function ResumenView() {
  return (
    <div>
      <KpisPrincipales />
      <EstadoActualView />
    </div>
  );
}
