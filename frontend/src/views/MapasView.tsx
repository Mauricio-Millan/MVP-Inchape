import { useState } from 'react';
import { DetalleZona } from '../components/mapas/DetalleZona';
import { PlanoEscaneado } from '../components/mapas/PlanoEscaneado';
import { agruparPorZonaExcel, zonasSinGeometria } from '../components/mapas/ocupacion';
import { PlanoSVG } from '../components/plano/PlanoSVG';
import { EstadoPipeline } from '../components/ui/EstadoPipeline';
import { EtiquetaModelo } from '../components/ui/EtiquetaModelo';
import { usePipeline } from '../context/PipelineContext';
import { useZonas, type Zona } from '../api/zonas';
import { entregarDatos3D } from '../lib/mapa3dHandoff';
import './MapasView.css';

export function MapasView() {
  const { resultado, cargando, forzarAfinidad, cambiarForzarAfinidad } = usePipeline();
  const { zonas, error: errorZonas } = useZonas();
  const [zonaDetalle, setZonaDetalle] = useState<Zona | null>(null);
  // Cuál de los dos mapas (Hoy/Propuesta) abrió el detalle -- decide si
  // VistaAsientosReales muestra la ocupación de hoy o la propuesta como
  // primaria, no siempre la misma sin importar desde dónde se hizo click.
  const [campoDetalle, setCampoDetalle] = useState<'ZONA_ACTUAL' | 'ZONA_RECOMENDADA'>('ZONA_ACTUAL');

  if (!resultado) {
    return <EstadoPipeline mensaje="Ejecuta el pipeline para comparar el slotting actual contra el recomendado." />;
  }
  if (errorZonas) {
    return <p className="estado-error">No se pudo cargar el plano: {errorZonas}</p>;
  }
  if (!zonas) {
    return <p className="plano-cargando">Cargando geometría del plano…</p>;
  }

  const zonasCargadas = zonas;
  function abrirPorId(zonaId: string, campo: 'ZONA_ACTUAL' | 'ZONA_RECOMENDADA') {
    const z = zonasCargadas.find((zona) => zona.id === zonaId);
    if (z) {
      setZonaDetalle(z);
      setCampoDetalle(campo);
    }
  }

  const abrirMapa3D = () => {
    entregarDatos3D({
      recomendaciones: resultado.recomendaciones,
      modoObjetivo: resultado.modo_objetivo,
      kpis: resultado.kpis,
      generadoEn: Date.now(),
    });
    window.open('/#mapa3d', '_blank');
  };

  const ocupacionActual = agruparPorZonaExcel(resultado.recomendaciones, 'ZONA_ACTUAL');
  const ocupacionPropuesta = agruparPorZonaExcel(resultado.recomendaciones, 'ZONA_RECOMENDADA');
  const sinGeometria = [
    ...zonasSinGeometria(ocupacionActual, zonas),
    ...zonasSinGeometria(ocupacionPropuesta, zonas),
  ];

  return (
    <div>
      {sinGeometria.length > 0 && (
        <p className="mapas-advertencia">
          <b>Aviso:</b>{' '}
          {[...new Map(sinGeometria.map((o) => [o.clave_excel, o])).values()]
            .map((o) => `${o.count} SKU en "${o.clave_excel}"`)
            .join(', ')}{' '}
          no tienen un polígono confirmado en el plano vectorial (ver <span className="mono">CLAUDE_1.md</span> #8)
          — no se muestran en el mapa, no se les inventa una posición.
        </p>
      )}

      <div className="mapas-ayuda-fila">
        <p className="mapas-ayuda">Haz click en una zona de cualquiera de los dos mapas para ver qué SKU hay ahí.</p>
        <button className="boton boton-secundario" onClick={abrirMapa3D}>
          Ver comparación 3D ↗
        </button>
      </div>

      <div className="mapas-afinidad">
        <label className="mapas-afinidad-check">
          <input
            type="checkbox"
            checked={forzarAfinidad}
            disabled={cargando}
            onChange={(e) => cambiarForzarAfinidad(e.target.checked)}
          />
          Forzar afinidad (demo)
        </label>
        <p className="mapas-afinidad-nota">
          {forzarAfinidad
            ? resultado.afinidad_motivo
            : 'Agrupa en la propuesta los SKU que suelen pedirse juntos (comunidades de Louvain), saltando el test de significancia -- el test real (GET /afinidad) hoy no confirma señal suficiente sobre este lote, así que esto es una demostración del mecanismo, no un hallazgo. Los SKU de la misma comunidad quedan resaltados con el mismo color de borde en el mapa de la propuesta.'}
        </p>
      </div>

      <div className="mapas-grid">
        <PlanoEscaneado
          titulo="Hoy"
          campo="ZONA_ACTUAL"
          recomendaciones={resultado.recomendaciones}
          onClickZona={(id) => abrirPorId(id, 'ZONA_ACTUAL')}
        />
        <PlanoEscaneado
          titulo={
            <>
              Propuesta de slotting <EtiquetaModelo modo={resultado.modo_objetivo} />
            </>
          }
          campo="ZONA_RECOMENDADA"
          recomendaciones={resultado.recomendaciones}
          onClickZona={(id) => abrirPorId(id, 'ZONA_RECOMENDADA')}
        />
      </div>

      {zonaDetalle && (
        <DetalleZona
          zona={zonaDetalle}
          recomendaciones={resultado.recomendaciones}
          campo={campoDetalle}
          onClose={() => setZonaDetalle(null)}
        />
      )}

      <h2 className="mapas-referencia-titulo">Referencia: geometría y técnica de almacenamiento</h2>
      <PlanoSVG />
    </div>
  );
}
