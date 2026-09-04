import type { ModoObjetivo } from '../api/pipeline';

export interface InfoModelo {
  id: ModoObjetivo;
  etiqueta: string;
  descripcion: string;
}

/** Qué hace cada modelo y qué objetivo persigue -- mismo texto base que
 * "Qué pregunta responde este modelo" en MVP-Inchape/1.md §13, 2.md §8,
 * 3.md §8. Los 3 comparten optimizador y restricciones duras; solo
 * cambia el peso por SKU (ver backend/app/dominio/objetivo.py). Fuente
 * única -- la usan el selector de Carga, la etiqueta visual en SKU ·
 * Slotting/Mapas/Dashboard v2, y el export a .xlsx. */
export const MODELOS_SLOTTING: InfoModelo[] = [
  {
    id: 'velocidad',
    etiqueta: 'Modelo 1 · Velocidad',
    descripcion:
      'Minimiza tiempo de picking: los SKU que más se piden reales (no la rotación declarada) quedan en las zonas más cercanas a despacho.',
  },
  {
    id: 'valor',
    etiqueta: 'Modelo 2 · Valor',
    descripcion:
      'Prioriza valor económico: los SKU de mayor valor/margen ganan el espacio cercano, y el stock con riesgo de quedar obsoleto se relega a zonas más baratas (rack alto, mezzanine).',
  },
  {
    id: 'servicio',
    etiqueta: 'Modelo 3 · Servicio',
    descripcion:
      'Prioriza nivel de servicio: los SKU críticos o de demanda más irregular quedan accesibles para reposición rápida, aunque no sean los más pedidos.',
  },
];

export function etiquetaModelo(modo: ModoObjetivo): string {
  return MODELOS_SLOTTING.find((m) => m.id === modo)?.etiqueta ?? modo;
}
