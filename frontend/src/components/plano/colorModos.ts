import type { Zona } from '../../api/zonas';
import { colorCalor } from '../../lib/colorCalor';

// Misma matemática de color que V1 planta-cd-aldeas-vectorial.html --
// se porta el cálculo, no solo el resultado, para que siga funcionando
// cuando lleguen más zonas reales (nunca "13" hardcodeado).
export type Modo = 'tec' | 'den' | 'dis';

export const ETIQUETA_MODO: Record<Modo, string> = {
  tec: 'Color por técnica de almacenamiento',
  den: 'Color por densidad de picking',
  dis: 'Color por distancia al I/O',
};

function rangoDensidad(zonas: Zona[]) {
  return Math.max(...zonas.map((z) => z.lineas_picking)) || 1;
}

function rangoDistancia(zonas: Zona[]) {
  const distancias = zonas.map((z) => z.distancia_m);
  return { min: Math.min(...distancias), max: Math.max(...distancias) };
}

export function calcularFill(zona: Zona, modo: Modo, zonas: Zona[]): string {
  if (modo === 'tec') return zona.color;

  if (modo === 'den') {
    if (zona.lineas_picking === 0) return '#FFFFFF';
    const hmax = rangoDensidad(zonas);
    return colorCalor(zona.lineas_picking / hmax);
  }

  const { min, max } = rangoDistancia(zonas);
  const t = max === min ? 0 : (zona.distancia_m - min) / (max - min);
  const pct = Math.round(8 + t * 82);
  return `color-mix(in srgb, #BE3A1D ${pct}%, #FFE9C9)`;
}

export function esTextoClaro(zona: Zona, modo: Modo, zonas: Zona[]): boolean {
  if (modo === 'tec') return zona.texto_claro;

  if (modo === 'den') {
    // La escala verde/amarillo/rojo nunca es muy clara -- texto oscuro
    // sirve en casi todo el rango, solo el rojo más saturado del extremo
    // alto necesita texto blanco.
    const hmax = rangoDensidad(zonas);
    return zona.lineas_picking / hmax > 0.85;
  }

  const { min, max } = rangoDistancia(zonas);
  const t = max === min ? 0 : (zona.distancia_m - min) / (max - min);
  return t > 0.6;
}
