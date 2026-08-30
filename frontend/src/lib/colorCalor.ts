/** Escala de color compartida para todos los "mapas de calor" de la app
 * (ocupación por zona, rotación por SKU, densidad de picking, vista de
 * cada zona) -- verde (frío/bajo) a rojo (caliente/alto), pasando por
 * amarillo (estilo semáforo / ColorBrewer "RdYlGn" invertido).
 *
 * Los espacios sin dato (disponible/vacío) siguen pintándose de blanco
 * explícito en cada consumidor (no llaman a esta función) -- esta
 * escala es solo para valores con dato real, del más bajo al más alto. */
const PARADAS: [number, [number, number, number]][] = [
  [0, [34, 197, 94]], // verde
  [0.5, [234, 179, 8]], // amarillo
  [1, [239, 68, 68]], // rojo
];

export function colorCalor(intensidad: number): string {
  const t = Math.max(0, Math.min(1, intensidad));

  let i = 0;
  while (i < PARADAS.length - 2 && t > PARADAS[i + 1][0]) i++;
  const [t0, c0] = PARADAS[i];
  const [t1, c1] = PARADAS[i + 1];
  const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);

  const [r, g, b] = c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
  return `rgb(${r}, ${g}, ${b})`;
}
