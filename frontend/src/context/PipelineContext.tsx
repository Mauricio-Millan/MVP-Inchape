import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../api/config';
import { ejecutarPipeline, type ModoDistancia, type PesosScore, type RespuestaPipeline } from '../api/pipeline';

interface PipelineContextValue {
  resultado: RespuestaPipeline | null;
  // el resultado justo anterior a la última ejecución -- permite a la
  // vista "Puntuación" mostrar qué SKU cambiaron de zona recomendada al
  // ajustar los pesos, sin que cada vista tenga que guardar su propia copia.
  anterior: RespuestaPipeline | null;
  cargando: boolean;
  error: string | null;
  ejecutar: (pesos?: PesosScore, porcentajeMaxMovimiento?: number) => Promise<void>;
  /** "layout_cd" (Excel) o "svg" (distancia real del layout escaneado) --
   * ver `ejecutarPipeline`. Cambiarlo re-ejecuta el pipeline con los
   * mismos pesos/tope de la última corrida, si ya había un resultado. */
  modoDistancia: ModoDistancia;
  cambiarModoDistancia: (modo: ModoDistancia) => void;
}

const PipelineContext = createContext<PipelineContextValue | null>(null);

export function PipelineProvider({ children }: { children: ReactNode }) {
  const [resultado, setResultado] = useState<RespuestaPipeline | null>(null);
  const [anterior, setAnterior] = useState<RespuestaPipeline | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modoDistancia, setModoDistancia] = useState<ModoDistancia>('layout_cd');
  // Últimos pesos/tope usados -- para poder re-ejecutar con el mismo
  // criterio cuando solo cambia el modo de distancia (el switch no debe
  // resetear los sliders de puntuación que ya haya ajustado el usuario).
  const ultimaCorrida = useRef<{ pesos?: PesosScore; porcentajeMaxMovimiento?: number }>({});

  const ejecutar = useCallback(
    async (pesos?: PesosScore, porcentajeMaxMovimiento?: number) => {
      ultimaCorrida.current = { pesos, porcentajeMaxMovimiento };
      setCargando(true);
      setError(null);
      try {
        const nuevo = await ejecutarPipeline(pesos, porcentajeMaxMovimiento, modoDistancia);
        setResultado((previo) => {
          setAnterior(previo);
          return nuevo;
        });
      } catch (e) {
        setError(e instanceof ApiError ? e.detail : 'No se pudo conectar con el backend.');
      } finally {
        setCargando(false);
      }
    },
    [modoDistancia],
  );

  const cambiarModoDistancia = useCallback(
    (modo: ModoDistancia) => {
      setModoDistancia(modo);
      // Sin resultado todavía -- el próximo "Ejecutar pipeline" ya toma
      // el modo nuevo, no hace falta disparar nada ahora.
      if (!resultado) return;
      setCargando(true);
      setError(null);
      const { pesos, porcentajeMaxMovimiento } = ultimaCorrida.current;
      ejecutarPipeline(pesos, porcentajeMaxMovimiento, modo)
        .then((nuevo) => setResultado((previo) => { setAnterior(previo); return nuevo; }))
        .catch((e: unknown) => setError(e instanceof ApiError ? e.detail : 'No se pudo conectar con el backend.'))
        .finally(() => setCargando(false));
    },
    [resultado],
  );

  return (
    <PipelineContext.Provider
      value={{ resultado, anterior, cargando, error, ejecutar, modoDistancia, cambiarModoDistancia }}
    >
      {children}
    </PipelineContext.Provider>
  );
}

export function usePipeline(): PipelineContextValue {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error('usePipeline debe usarse dentro de <PipelineProvider>');
  return ctx;
}
