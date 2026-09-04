import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../api/config';
import {
  ejecutarPipeline,
  type ModoDistancia,
  type ModoObjetivo,
  type PesosScore,
  type RespuestaPipeline,
} from '../api/pipeline';

/** Los 3 parámetros "toggle" -- persisten como estado reactivo (la UI
 * necesita saber cuál está activo para resaltar el botón/checkbox
 * correspondiente) y se re-ejecutan preservando pesos/tope/afinidad de
 * la última corrida (ver `ultimaCorrida` + `reejecutar` abajo). */
interface ParametrosToggle {
  modoDistancia: ModoDistancia;
  forzarAfinidad: boolean;
  modeloSlotting: ModoObjetivo;
}

interface PipelineContextValue extends ParametrosToggle {
  resultado: RespuestaPipeline | null;
  // el resultado justo anterior a la última ejecución -- permite a la
  // vista "Puntuación" mostrar qué SKU cambiaron de zona recomendada al
  // ajustar los pesos, sin que cada vista tenga que guardar su propia copia.
  anterior: RespuestaPipeline | null;
  cargando: boolean;
  error: string | null;
  /** `usarAfinidad`: nunca por defecto -- paga ~15s del test de
   * significancia y solo tiene efecto real si ese test confirma señal
   * sobre el lote vigente (ver `RespuestaPipeline.afinidad_aplicada`). */
  ejecutar: (pesos?: PesosScore, porcentajeMaxMovimiento?: number, usarAfinidad?: boolean) => Promise<void>;
  /** "layout_cd" (Excel) o "svg" (distancia real del layout escaneado) --
   * ver `ejecutarPipeline`. Cambiarlo re-ejecuta el pipeline con los
   * mismos pesos/tope de la última corrida, si ya había un resultado. */
  cambiarModoDistancia: (modo: ModoDistancia) => void;
  /** Bypass deliberado del test de significancia de afinidad, solo para
   * demostrar en vivo el mecanismo (ver `RespuestaPipeline.afinidad_motivo`,
   * siempre deja explícito que fue forzado). */
  cambiarForzarAfinidad: (valor: boolean) => void;
  /** Modelo de slotting activo -- "velocidad" (Modelo 1, default),
   * "valor" (Modelo 2) o "servicio" (Modelo 3). Elegirlo re-ejecuta el
   * pipeline: mapas, SKU y KPIs pasan a mostrar esa propuesta. */
  cambiarModeloSlotting: (modelo: ModoObjetivo) => void;
}

const PipelineContext = createContext<PipelineContextValue | null>(null);

export function PipelineProvider({ children }: { children: ReactNode }) {
  const [resultado, setResultado] = useState<RespuestaPipeline | null>(null);
  const [anterior, setAnterior] = useState<RespuestaPipeline | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modoDistancia, setModoDistancia] = useState<ModoDistancia>('layout_cd');
  const [forzarAfinidad, setForzarAfinidad] = useState(false);
  const [modeloSlotting, setModeloSlotting] = useState<ModoObjetivo>('velocidad');
  // Últimos pesos/tope/afinidad usados -- para poder re-ejecutar con el
  // mismo criterio cuando solo cambia uno de los 3 toggles de arriba (no
  // deben resetear los sliders de puntuación que ya haya ajustado el usuario).
  const ultimaCorrida = useRef<{ pesos?: PesosScore; porcentajeMaxMovimiento?: number; usarAfinidad?: boolean }>({});

  const correr = useCallback(async (params: ParametrosToggle & typeof ultimaCorrida.current) => {
    setCargando(true);
    setError(null);
    try {
      const nuevo = await ejecutarPipeline(
        params.pesos,
        params.porcentajeMaxMovimiento,
        params.modoDistancia,
        params.usarAfinidad,
        params.forzarAfinidad,
        params.modeloSlotting,
      );
      setResultado((previo) => {
        setAnterior(previo);
        return nuevo;
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : 'No se pudo conectar con el backend.');
    } finally {
      setCargando(false);
    }
  }, []);

  const ejecutar = useCallback(
    (pesos?: PesosScore, porcentajeMaxMovimiento?: number, usarAfinidad?: boolean) => {
      ultimaCorrida.current = { pesos, porcentajeMaxMovimiento, usarAfinidad };
      return correr({ pesos, porcentajeMaxMovimiento, usarAfinidad, modoDistancia, forzarAfinidad, modeloSlotting });
    },
    [correr, modoDistancia, forzarAfinidad, modeloSlotting],
  );

  // Único punto que sabe re-ejecutar "lo mismo de antes, con un toggle
  // cambiado" -- antes esto eran 3 funciones casi idénticas
  // (cambiarModoDistancia/cambiarForzarAfinidad/cambiarModeloSlotting),
  // cada una repitiendo el mismo cálculo de valores actuales + reejecución.
  const cambiarToggle = useCallback(
    (cambios: Partial<ParametrosToggle>) => {
      const params: ParametrosToggle = {
        modoDistancia: cambios.modoDistancia ?? modoDistancia,
        forzarAfinidad: cambios.forzarAfinidad ?? forzarAfinidad,
        modeloSlotting: cambios.modeloSlotting ?? modeloSlotting,
      };
      if (cambios.modoDistancia !== undefined) setModoDistancia(cambios.modoDistancia);
      if (cambios.forzarAfinidad !== undefined) setForzarAfinidad(cambios.forzarAfinidad);
      if (cambios.modeloSlotting !== undefined) setModeloSlotting(cambios.modeloSlotting);
      // Sin resultado todavía -- el próximo "Ejecutar pipeline" ya toma
      // el valor nuevo, no hace falta disparar nada ahora.
      if (!resultado) return;
      correr({ ...params, ...ultimaCorrida.current });
    },
    [correr, resultado, modoDistancia, forzarAfinidad, modeloSlotting],
  );

  const cambiarModoDistancia = useCallback((modo: ModoDistancia) => cambiarToggle({ modoDistancia: modo }), [
    cambiarToggle,
  ]);
  const cambiarForzarAfinidad = useCallback((valor: boolean) => cambiarToggle({ forzarAfinidad: valor }), [
    cambiarToggle,
  ]);
  const cambiarModeloSlotting = useCallback((modelo: ModoObjetivo) => cambiarToggle({ modeloSlotting: modelo }), [
    cambiarToggle,
  ]);

  return (
    <PipelineContext.Provider
      value={{
        resultado,
        anterior,
        cargando,
        error,
        ejecutar,
        modoDistancia,
        cambiarModoDistancia,
        forzarAfinidad,
        cambiarForzarAfinidad,
        modeloSlotting,
        cambiarModeloSlotting,
      }}
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
