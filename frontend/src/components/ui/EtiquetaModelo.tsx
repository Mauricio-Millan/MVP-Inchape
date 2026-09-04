import type { ModoObjetivo } from '../../api/pipeline';
import { etiquetaModelo } from '../../lib/modelosSlotting';
import { Badge } from './Badge';

/** Rótulo visual de qué modelo de slotting produjo la propuesta que se
 * está mostrando -- siempre a partir de `modo` (que debe venir de
 * `RespuestaPipeline.modo_objetivo`, el eco del backend), nunca del
 * estado `modeloSlotting` de `PipelineContext`: ese es lo que se PIDIÓ,
 * puede quedar un instante desincronizado del resultado en pantalla
 * mientras una corrida anterior todavía está en vuelo. */
export function EtiquetaModelo({ modo }: { modo: ModoObjetivo }) {
  return <Badge tono="modelo">{etiquetaModelo(modo)}</Badge>;
}
