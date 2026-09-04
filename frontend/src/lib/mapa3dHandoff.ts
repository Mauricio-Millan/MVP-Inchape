import type { Kpis, ModoObjetivo, RecomendacionSKU } from '../api/pipeline';

const CLAVE_LOCALSTORAGE = 'mapa3d:datos';

export interface Payload3D {
  recomendaciones: RecomendacionSKU[];
  modoObjetivo: ModoObjetivo;
  kpis: Kpis;
  generadoEn: number;
}

/** Entrega el `resultado` ya calculado a la ventana 3D vía `localStorage`
 * -- mismo origen, así que la ventana nueva lo lee al instante al
 * cargar, sin volver a llamar al backend ni recalcular nada. Nunca
 * se guarda en el contexto de React ni se pasa por URL (1190 espacios x
 * 100 SKU no entra en una query string, y la ventana 3D no necesita
 * re-renderizar cuando cambia la principal -- es una foto al momento de
 * abrir, no una vista sincronizada en vivo). */
export function entregarDatos3D(payload: Payload3D): void {
  localStorage.setItem(CLAVE_LOCALSTORAGE, JSON.stringify(payload));
}

export function leerDatos3D(): Payload3D | null {
  const crudo = localStorage.getItem(CLAVE_LOCALSTORAGE);
  if (!crudo) return null;
  try {
    return JSON.parse(crudo) as Payload3D;
  } catch {
    return null;
  }
}
