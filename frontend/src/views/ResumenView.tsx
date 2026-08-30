import { useState } from 'react';
import { useZonas, type Zona } from '../api/zonas';
import { DetalleZona } from '../components/mapas/DetalleZona';
import { PlanoEscaneado } from '../components/mapas/PlanoEscaneado';
import { usePipeline } from '../context/PipelineContext';
import { EstadoActualView } from './EstadoActualView';
import { KpisPrincipales } from './KpisPrincipales';

/** Vista de aterrizaje (DISENO-FRONTEND.md §1.2): diagnóstico de hoy
 * primero (KPIs), mapa de calor de ocupación actual debajo. */
export function ResumenView() {
  const { resultado } = usePipeline();
  const { zonas } = useZonas();
  const [zonaDetalle, setZonaDetalle] = useState<Zona | null>(null);

  return (
    <div>
      <KpisPrincipales />
      <EstadoActualView />
      {resultado && (
        <PlanoEscaneado
          recomendaciones={resultado.recomendaciones}
          onClickZona={(id) => setZonaDetalle(zonas?.find((z) => z.id === id) ?? null)}
        />
      )}
      {resultado && zonaDetalle && (
        <DetalleZona zona={zonaDetalle} recomendaciones={resultado.recomendaciones} onClose={() => setZonaDetalle(null)} />
      )}
    </div>
  );
}
