import { useState } from 'react';
import { PlanoInteractivoD3 } from '../components/mapas/PlanoInteractivoD3';
import { EstadoPipeline } from '../components/ui/EstadoPipeline';
import { usePipeline } from '../context/PipelineContext';

export function DashboardV2View() {
  const { resultado } = usePipeline();
  const [campo, setCampo] = useState<'ZONA_ACTUAL' | 'ZONA_RECOMENDADA'>('ZONA_ACTUAL');

  if (!resultado) {
    return <EstadoPipeline mensaje="Ejecuta el pipeline para ver el mapa interactivo con datos reales." />;
  }

  return (
    <PlanoInteractivoD3
      recomendaciones={resultado.recomendaciones}
      capacidadZonas={resultado.capacidad_zonas}
      campo={campo}
      onCampoChange={setCampo}
      modoObjetivo={resultado.modo_objetivo}
    />
  );
}
