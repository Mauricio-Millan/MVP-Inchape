import { EstadoActualView } from './EstadoActualView';
import { KpisPrincipales } from './KpisPrincipales';

/** Vista de aterrizaje (DISENO-FRONTEND.md §1.2): diagnóstico de hoy
 * primero (KPIs), mapa de calor de ocupación actual debajo. */
export function ResumenView() {
  return (
    <div>
      <KpisPrincipales />
      <EstadoActualView />
    </div>
  );
}
