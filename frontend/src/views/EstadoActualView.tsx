import { useState } from 'react';
import { DetalleZona } from '../components/mapas/DetalleZona';
import { PlanoEscaneado } from '../components/mapas/PlanoEscaneado';
import { EstadoPipeline } from '../components/ui/EstadoPipeline';
import { usePipeline } from '../context/PipelineContext';
import { useZonas, type Zona } from '../api/zonas';

export function EstadoActualView() {
  const { resultado } = usePipeline();
  const { zonas, error } = useZonas();
  const [zonaDetalle, setZonaDetalle] = useState<Zona | null>(null);

  if (!resultado) {
    return <EstadoPipeline mensaje="Ejecuta el pipeline para ver la situación actual del almacén." />;
  }
  if (error) return <p className="estado-error">No se pudo cargar el plano: {error}</p>;
  if (!zonas) return <p className="plano-cargando">Cargando geometría del plano…</p>;

  return (
    <>
      <PlanoEscaneado
        titulo="Situación actual del almacén"
        campo="ZONA_ACTUAL"
        recomendaciones={resultado.recomendaciones}
        onClickZona={(id) => setZonaDetalle(zonas.find((z) => z.id === id) ?? null)}
      />
      {zonaDetalle && (
        <DetalleZona
          zona={zonaDetalle}
          recomendaciones={resultado.recomendaciones}
          campo="ZONA_ACTUAL"
          onClose={() => setZonaDetalle(null)}
        />
      )}
    </>
  );
}
