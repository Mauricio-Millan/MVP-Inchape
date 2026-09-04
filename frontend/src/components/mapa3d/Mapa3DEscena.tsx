import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { colorCalor } from '../../lib/colorCalor';
import type { CajaEscena3D, EscenaComparativa3D } from './construirEscenas3D';
import './Mapa3DEscena.css';

export type Escenario3D = 'antes' | 'despues';
export type ModoColor3D = 'movimiento' | 'calor';

// Mismos 4 colores del semáforo de movimiento del mapa 2D
// (`PlanoEscaneado.css`), tomados de la variante oscura de los tokens
// de la app (`--senal`/`--riesgo`/`--exito` en index.css) -- la ventana
// 3D es siempre oscura, no participa del claro/oscuro del resto de la
// app, así que se fijan acá en vez de leer variables CSS que no existen
// en este documento. El gris de "disponible" es el mismo que ya usaba
// el modo calor, no el gris claro del 2D (pensado para fondo blanco).
const AZUL_OCUPADA = '#0a84ff';
const ROJO_SE_VA = '#ff453a';
const VERDE_LLEGA = '#32d74b';
const GRIS_DISPONIBLE = '#3a3d45';

function colorPorMovimiento(estado: CajaEscena3D['estado']): string {
  if (estado === 'ocupada') return AZUL_OCUPADA;
  if (estado === 'se_va') return ROJO_SE_VA;
  if (estado === 'llega') return VERDE_LLEGA;
  return GRIS_DISPONIBLE;
}

/** "Mapa de calor" reusa la MISMA escala continua verde→amarillo→rojo
 * y el MISMO criterio (rotación de 6 meses, min-max sobre todo el
 * catálogo) que ya usa el mapa 2D en "Por rotación" (`PlanoEscaneado
 * .tsx::rangoRotacion` + `lib/colorCalor.ts`) -- no la distancia de la
 * zona: esa es una sola cifra por zona (`zonas.json::distancia_m`), así
 * que coloreaba TODA la zona de un solo color, sin distinguir SKU
 * dentro de ella. La rotación es un dato por SKU, da un color propio
 * por caja. Sin SKU, gris fijo, igual que el 2D nunca inventa color
 * para un espacio vacío. */
function colorPorCalor(caja: CajaEscena3D, rotMin: number, rotMax: number): string {
  if (!caja.sku) return GRIS_DISPONIBLE;
  const t = rotMax > rotMin ? (caja.sku.ROTACION_6M - rotMin) / (rotMax - rotMin) : 0;
  return colorCalor(t);
}

function calcularColorCaja(caja: CajaEscena3D, modo: ModoColor3D, rotMin: number, rotMax: number): string {
  return modo === 'movimiento' ? colorPorMovimiento(caja.estado) : colorPorCalor(caja, rotMin, rotMax);
}

// Las coordenadas de layoutEscaneado.json están en unidades de dibujo
// del SVG (viewBox ~1304x683, Synoptic Designer), no en metros -- se
// reescalan a un tamaño de escena manejable para la cámara/luces de
// Three.js. Puramente proporcional, no hace falta que sea "real" en
// metros para que la comparación 3D tenga sentido.
const ESCALA = 1 / 40;
// La altura de cada caja es un múltiplo de su propio ancho/profundidad
// YA escalados (no una constante absoluta) -- si no, con espacios de
// ~5 unidades SVG (mediana real) y una altura fija de una unidad de
// escena, las cajas salen como torres flacas en vez de bloques bajos
// como el plano 2D. Así el resultado es proporcional sin importar qué
// ESCALA se elija.
const FACTOR_ALTURA = 1.4;

/** Reusa el parser de paths SVG de Three.js (`SVGLoader`) sobre el
 * mismo string `d` que ya usa el mapa 2D (`<path d={boundary_d}>`) --
 * envuelto en un `<svg>` mínimo porque el loader espera un documento
 * completo, no un atributo suelto. Ningún dato nuevo: es el mismo
 * contorno ya trazado, solo convertido a puntos 3D. */
function puntosDePath(d: string | null): { x: number; y: number }[] {
  if (!d) return [];
  try {
    const datos = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`);
    const shapes = datos.paths.flatMap((p) => p.toShapes(true));
    if (shapes.length === 0) return [];
    return shapes[0].getPoints().map((p) => ({ x: p.x, y: p.y }));
  } catch {
    return [];
  }
}

function textoTooltip(caja: CajaEscena3D): string {
  if (!caja.sku) return `<i>${caja.zona}</i><br>Disponible`;
  const s = caja.sku;
  const base = `<b>${s.SKU}</b><br>${s.FAMILIA}<br>${caja.zona} (${caja.distanciaM.toFixed(0)} m)<br>Líneas de pedido: ${s.N_LINEAS}`;
  return s.MOVIMIENTO === 'MOVER' ? `${base}<br><span style="color:#7fb3e8">${s.JUSTIFICACION}</span>` : base;
}

// Color del contorno de resalte del buscador -- una cifra que no se
// confunde con ninguno de los dos modos de color de las cajas (ni el
// semáforo de movimiento, ni el degradado verde-amarillo-rojo de calor).
const COLOR_FOCO = 0x22d3ee;
const DURACION_VUELO_MS = 700;

export interface Mapa3DEscenaHandle {
  /** Busca `sku` en la escena/modo actuales, resalta su caja con un
   * contorno y (si `volar`) anima la cámara hacia ella preservando el
   * ángulo/zoom que el usuario ya tenía -- solo re-centra, no cambia la
   * vista. `volar=false` se usa al cambiar de modo de color (la caja no
   * se movió, solo hace falta reubicar el contorno en la malla nueva).
   * Devuelve `false` si ese SKU no tiene espacio en la escena activa. */
  enfocarSku: (sku: string, volar?: boolean) => boolean;
}

export const Mapa3DEscena = forwardRef<Mapa3DEscenaHandle, { datos: EscenaComparativa3D; escenario: Escenario3D; modoColor: ModoColor3D }>(
  function Mapa3DEscena({ datos, escenario, modoColor }, ref) {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{
    pintar: (nombre: Escenario3D, modo: ModoColor3D) => void;
    enfocar: (sku: string, volar: boolean) => boolean;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
  } | null>(null);
  const [hover, setHover] = useState<{ clientX: number; clientY: number; texto: string } | null>(null);

  useImperativeHandle(ref, () => ({
    enfocarSku: (sku, volar = true) => apiRef.current?.enfocar(sku, volar) ?? false,
  }));

  // Escena/cámara/luces/contorno se crean UNA sola vez -- solo cambian
  // las cajas cuando cambia `datos` (nuevo resultado del pipeline) o
  // `escenario` (toggle Hoy/Propuesta), sin reconstruir todo lo demás.
  useEffect(() => {
    const contenedor = contenedorRef.current;
    if (!contenedor) return;

    const contornoPts = puntosDePath(datos.contornoD);
    const xs = contornoPts.map((p) => p.x * ESCALA);
    const zs = contornoPts.map((p) => p.y * ESCALA);
    const centerX = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
    const centerZ = zs.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0;
    const spanX = xs.length ? Math.max(...xs) - Math.min(...xs) : 40;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x12141a);

    const camera = new THREE.PerspectiveCamera(50, contenedor.clientWidth / contenedor.clientHeight, 0.1, 5000);
    camera.position.set(centerX + spanX * 0.7, spanX * 0.8, centerZ + spanX * 0.7);

    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    renderer.setSize(contenedor.clientWidth, contenedor.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    contenedor.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(centerX, 0, centerZ);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.update();

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dl = new THREE.DirectionalLight(0xffffff, 0.55);
    dl.position.set(centerX + 40, 60, centerZ + 20);
    scene.add(dl);

    const grid = new THREE.GridHelper(Math.max(10, Math.ceil(spanX * 1.4)), 30, 0x2a2d36, 0x1c1e24);
    grid.position.set(centerX, 0, centerZ);
    scene.add(grid);

    if (contornoPts.length > 1) {
      const puntos = contornoPts.map((p) => new THREE.Vector3(p.x * ESCALA, 0.01, p.y * ESCALA));
      scene.add(
        new THREE.Line(new THREE.BufferGeometry().setFromPoints(puntos), new THREE.LineBasicMaterial({ color: 0x3a3d45 })),
      );
    }
    for (const b of datos.boundaries) {
      const pts = puntosDePath(b.d);
      if (pts.length < 2) continue;
      const vec = pts.map((p) => new THREE.Vector3(p.x * ESCALA, 0.03, p.y * ESCALA));
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(vec), new THREE.LineBasicMaterial({ color: 0x5b6470 })));
    }

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    let meshes: THREE.Mesh[] = [];
    let focoHelper: THREE.BoxHelper | null = null;
    let skuEnfocadoActual: string | null = null;
    let animacionFoco: {
      desdePos: THREE.Vector3;
      haciaPos: THREE.Vector3;
      desdeTarget: THREE.Vector3;
      haciaTarget: THREE.Vector3;
      inicio: number;
    } | null = null;

    function limpiarCajas() {
      for (const m of meshes) {
        scene.remove(m);
        (m.material as THREE.Material).dispose();
      }
      meshes = [];
      if (focoHelper) {
        scene.remove(focoHelper);
        focoHelper.dispose();
        focoHelper = null;
      }
    }

    function pintar(nombre: Escenario3D, modo: ModoColor3D) {
      limpiarCajas();
      for (const c of datos[nombre]) {
        const ancho = (c.ancho || 8) * ESCALA;
        const profundidad = (c.profundidad || 8) * ESCALA;
        const altura = ((ancho + profundidad) / 2) * FACTOR_ALTURA;
        const color = calcularColorCaja(c, modo, datos.rotMin, datos.rotMax);
        const mesh = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color }));
        mesh.scale.set(ancho, altura, profundidad);
        mesh.position.set(c.x * ESCALA, altura / 2 + 0.01, c.z * ESCALA);
        mesh.userData = c;
        scene.add(mesh);
        meshes.push(mesh);
      }
      // Repintar (cambio de escenario/modo) reconstruye las mallas desde
      // cero -- si había un SKU enfocado, el contorno debe reengancharse
      // a la malla nueva, nunca quedar apuntando a una ya descartada.
      if (skuEnfocadoActual) enfocar(skuEnfocadoActual, false);
    }

    function enfocar(sku: string, volar: boolean): boolean {
      const mesh = meshes.find((m) => (m.userData as CajaEscena3D).sku?.SKU === sku);
      if (focoHelper) {
        scene.remove(focoHelper);
        focoHelper.dispose();
        focoHelper = null;
      }
      if (!mesh) {
        skuEnfocadoActual = null;
        return false;
      }
      skuEnfocadoActual = sku;
      focoHelper = new THREE.BoxHelper(mesh, COLOR_FOCO);
      scene.add(focoHelper);

      if (volar) {
        // Mantiene el ángulo/zoom relativo que ya tenía la cámara --
        // solo recentra hacia la caja encontrada, no impone una vista
        // nueva ni resetea lo que el usuario ya venía explorando.
        const haciaTarget = mesh.position.clone();
        const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
        if (offset.lengthSq() < 1e-6) offset.set(4, 4, 4);
        const haciaPos = haciaTarget.clone().add(offset);
        animacionFoco = {
          desdePos: camera.position.clone(),
          haciaPos,
          desdeTarget: controls.target.clone(),
          haciaTarget,
          inicio: performance.now(),
        };
      }
      return true;
    }

    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const onMouseMove = (e: MouseEvent) => {
      const rect = contenedor.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObjects(meshes);
      if (hits.length) setHover({ clientX: e.clientX, clientY: e.clientY, texto: textoTooltip(hits[0].object.userData as CajaEscena3D) });
      else setHover(null);
    };
    contenedor.addEventListener('mousemove', onMouseMove);

    const onResize = () => {
      camera.aspect = contenedor.clientWidth / contenedor.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(contenedor.clientWidth, contenedor.clientHeight);
    };
    window.addEventListener('resize', onResize);

    let vivo = true;
    function animar() {
      if (!vivo) return;
      requestAnimationFrame(animar);
      if (animacionFoco) {
        const t = Math.min(1, (performance.now() - animacionFoco.inicio) / DURACION_VUELO_MS);
        const ease = 1 - (1 - t) ** 3; // easeOutCubic -- desacelera al llegar, no corta en seco
        camera.position.lerpVectors(animacionFoco.desdePos, animacionFoco.haciaPos, ease);
        controls.target.lerpVectors(animacionFoco.desdeTarget, animacionFoco.haciaTarget, ease);
        if (t >= 1) animacionFoco = null;
      }
      if (focoHelper) focoHelper.update();
      controls.update();
      renderer.render(scene, camera);
    }
    animar();

    apiRef.current = { pintar, enfocar, camera, controls };
    pintar('antes', 'calor');

    return () => {
      vivo = false;
      apiRef.current = null;
      window.removeEventListener('resize', onResize);
      contenedor.removeEventListener('mousemove', onMouseMove);
      limpiarCajas();
      boxGeo.dispose();
      controls.dispose();
      renderer.dispose();
      contenedor.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `datos` es la única dependencia real; el pintado inicial usa un modo fijo, el efecto de abajo repinta con `escenario`/`modoColor` reales apenas monta.
  }, [datos]);

  useEffect(() => {
    apiRef.current?.pintar(escenario, modoColor);
  }, [escenario, modoColor]);

  function zoom(factor: number) {
    const api = apiRef.current;
    if (!api) return;
    const dir = new THREE.Vector3().subVectors(api.camera.position, api.controls.target).multiplyScalar(factor);
    api.camera.position.copy(api.controls.target).add(dir);
    api.controls.update();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === '+' || e.key === '=') zoom(0.85);
      if (e.key === '-' || e.key === '_') zoom(1.18);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="mapa3d-lienzo-wrap">
      <div ref={contenedorRef} className="mapa3d-lienzo" />
      {hover && (
        <div className="mapa3d-tooltip" style={{ left: hover.clientX + 14, top: hover.clientY + 14 }} dangerouslySetInnerHTML={{ __html: hover.texto }} />
      )}
      <div className="mapa3d-zoom">
        <button onClick={() => zoom(1.18)} aria-label="Alejar">
          −
        </button>
        <button onClick={() => zoom(0.85)} aria-label="Acercar">
          +
        </button>
      </div>
      <div className="mapa3d-ayuda">Arrastra para rotar · botones +/− para zoom · click derecho para desplazar</div>
    </div>
  );
  },
);
