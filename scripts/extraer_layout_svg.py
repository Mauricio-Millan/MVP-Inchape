"""Extrae de un SVG exportado por Synoptic Designer (fondo trazado +
capa vectorial de zonas) la geometria real de cada zona ya dibujada: el
poligono de borde (el <path> con `title`) y los espacios individuales
dentro de su grupo, resolviendo las transformaciones SVG
(translate/matrix/rotate/scale) a coordenadas finales absolutas.

Un espacio no siempre es un <rect>: cuando el editor aplica una rotacion
u otra transformacion que no puede expresarse como atributos x/y/width/
height, exporta esa misma celda como un <path> (o <polygon>) de 4+
esquinas ya con las coordenadas resueltas (ver Rack Doble, Rack Balda,
Llantas, Rack Colgantes). Lo que distingue una ubicacion real de un
elemento decorativo/estructural (marco de rack, soporte) NO es la forma
(ambos pueden ser rectangulares) sino el `id`: el editor nombra cada
ubicacion real "rectN" sin importar si termino exportada como rect,
path o polygon. Se filtra por ese id, no por geometria.

Uso (desde la raiz de MVP-Inchape):
    conda run -n IngenieriaPython python scripts/extraer_layout_svg.py \
        "layout  inchape v3.svg" frontend/src/data/layoutV3.json

Ver `LAYOUT-SVG-V3.md` para el contrato completo: como debe estar
armado el SVG en el editor para que este script lo reconozca, y como
se integra el resultado en el frontend.
"""

from __future__ import annotations

import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

Matriz = tuple[float, float, float, float, float, float]
IDENTIDAD: Matriz = (1, 0, 0, 1, 0, 0)

# Sin esto, ET.tostring() re-serializa cada elemento con el prefijo
# "ns0:rect" en vez de "rect" -- inválido para pegarlo tal cual en un
# <g> de React vía dangerouslySetInnerHTML.
ET.register_namespace("", "http://www.w3.org/2000/svg")


def _local(tag: str) -> str:
    return tag.split("}")[-1]


def _mat_mul(m1: Matriz, m2: Matriz) -> Matriz:
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return (
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    )


def parse_transform(t: str | None) -> Matriz:
    """Combina translate/matrix/scale/rotate de un atributo `transform`,
    en el orden en que aparecen (izquierda a derecha == de afuera hacia
    adentro, como especifica SVG)."""
    if not t:
        return IDENTIDAD
    m = IDENTIDAD
    for nombre, args in re.findall(r"(\w+)\(([^)]+)\)", t):
        nums = [float(x) for x in re.split(r"[ ,]+", args.strip()) if x]
        if nombre == "translate":
            local_m: Matriz = (1, 0, 0, 1, nums[0], nums[1] if len(nums) > 1 else 0)
        elif nombre == "matrix":
            local_m = tuple(nums)  # type: ignore[assignment]
        elif nombre == "scale":
            sx = nums[0]
            sy = nums[1] if len(nums) > 1 else sx
            local_m = (sx, 0, 0, sy, 0, 0)
        elif nombre == "rotate":
            ang = math.radians(nums[0])
            cx, cy = (nums[1], nums[2]) if len(nums) > 2 else (0.0, 0.0)
            cos_a, sin_a = math.cos(ang), math.sin(ang)
            rot: Matriz = (cos_a, sin_a, -sin_a, cos_a, 0, 0)
            local_m = _mat_mul(_mat_mul((1, 0, 0, 1, cx, cy), rot), (1, 0, 0, 1, -cx, -cy))
        else:
            local_m = IDENTIDAD
        m = _mat_mul(m, local_m)
    return m


def _apply(m: Matriz, x: float, y: float) -> tuple[float, float]:
    a, b, c, d, e, f = m
    return (a * x + c * y + e, b * x + d * y + f)


_NUM = r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?"


def puntos_de_path(d: str) -> list[tuple[float, float]] | None:
    """Puntos de un `d` tipo "M x,y L x,y L x,y L x,y [L x,y] Z" -- una
    celda de espacio exportada como path en vez de rect (rotada/escesgada
    al punto de no poder describirse como rect+transform). None si trae
    curvas u otros comandos que no son M/L/Z (no es una celda simple)."""
    if re.search(r"[^MLZmlz\d.,\-+eE\s]", d):
        return None
    puntos = []
    for cmd, args in re.findall(rf"([MLZmlz])\s*((?:{_NUM}[,\s]+{_NUM}[,\s]*)*)", d):
        if cmd.upper() == "Z":
            continue
        nums = [float(n) for n in re.findall(_NUM, args)]
        for i in range(0, len(nums) - 1, 2):
            puntos.append((nums[i], nums[i + 1]))
    if len(puntos) >= 2 and puntos[0] == puntos[-1]:
        puntos = puntos[:-1]
    return puntos or None


def puntos_de_polygon(points_attr: str) -> list[tuple[float, float]]:
    pares = points_attr.strip().split()
    return [tuple(float(v) for v in p.split(",")) for p in pares]  # type: ignore[misc]


def centroide_de_d(d: str) -> tuple[float, float] | None:
    """Centro aproximado (bbox) de un `d` cualquiera, con curvas u otros
    comandos incluidos -- se usa solo como punto de referencia (ej.
    "Mesas de trabajo"), no hace falta la forma exacta, alcanza con
    tomar todos los numeros como pares x,y."""
    nums = [float(n) for n in re.findall(_NUM, d)]
    if len(nums) < 4:
        return None
    xs, ys = nums[0::2], nums[1::2]
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def bbox_de_puntos(puntos: list[tuple[float, float]]) -> tuple[float, float, float, float, bool]:
    """(x, y, ancho, alto, es_axial) -- es_axial = el bounding box ES la
    forma real (solo 2 valores unicos de x y de y entre los puntos)."""
    xs = [p[0] for p in puntos]
    ys = [p[1] for p in puntos]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    es_axial = len({round(x, 2) for x in xs}) <= 2 and len({round(y, 2) for y in ys}) <= 2
    return (x0, y0, x1 - x0, y1 - y0, es_axial)


# "rectN" y "pathN" son los dos nombres automaticos que pone el editor
# segun como haya terminado exportando la celda (ver Rack Doble/Llantas/
# Rack Colgantes en LAYOUT-SVG-ESCANEADO.md) -- ambos son ubicaciones
# reales. Un id descriptivo (el borde con su `title`, o su fallback por
# nombre) nunca matchea esto, asi que sigue quedando afuera solo.
_ID_UBICACION = re.compile(r"^(rect|path)\d+$")


def extraer(ruta_svg: Path) -> dict:
    tree = ET.parse(ruta_svg)
    root = tree.getroot()
    view_box = root.get("viewBox")

    grupos = [el for el in root.iter() if _local(el.tag) == "g" and (el.get("id") or "").startswith("Grupo_x20_")]

    # Punto de referencia real para el orden "mas cerca primero" del
    # llenado ilustrativo (ver movimientoReal.ts) -- no es una zona con
    # ubicaciones, es la forma suelta "Mesa_x20_de_x20_Trabajo" (fuera de
    # cualquier Grupo_x20_...). null si esta version del SVG no la trae
    # (v3/v4/v6) -- el frontend cae a un orden sin preferencia en ese caso.
    mesa_trabajo = next((el for el in root if el.get("id") == "Mesa_x20_de_x20_Trabajo"), None)
    referencia_mesa_trabajo = centroide_de_d(mesa_trabajo.get("d", "")) if mesa_trabajo is not None else None

    # Contorno completo del edificio -- un <path> suelto (id
    # "Contorno_x20_Almacen"), fuera de cualquier Grupo_x20_... Da
    # contexto espacial a los mapas interactivos (dónde caen las zonas
    # trazadas dentro del edificio completo, no solo su propio recorte).
    # None si esta version del SVG no lo trae.
    contorno = next((el for el in root if el.get("id") == "Contorno_x20_Almacen"), None)

    resultado: dict = {
        "view_box": view_box,
        "contorno_d": contorno.get("d") if contorno is not None else None,
        "referencia_mesa_trabajo": (
            {"x": round(referencia_mesa_trabajo[0], 2), "y": round(referencia_mesa_trabajo[1], 2)}
            if referencia_mesa_trabajo
            else None
        ),
        "zonas": {},
    }

    # Zonas sin subdivision interna: formas sueltas (fuera de cualquier
    # Grupo_x20_...) que son solo el borde, sin `rectN`/`pathN` adentro
    # -- Mesa de Trabajo y Recepcion de Aereos no se trazaron con
    # ubicaciones individuales todavia (ver LAYOUT-SVG-ESCANEADO.md #3,
    # "Proximos pasos" #2). Se listan igual que cualquier zona trazada
    # (mismo `boundary_d`), con `espacios: []` -- el frontend ya sabe
    # mostrar una zona sin ubicaciones (el poligono nomas, sin relleno
    # individual ni SKU). Se filtra por id exacto, no por "cualquier
    # path suelto", para no levantar accidentalmente algun elemento
    # decorativo del editor que tambien haya quedado fuera de un grupo.
    for eid in ("Mesa_x20_de_x20_Trabajo", "Recepcion_x20_Aereos"):
        el = next((e for e in root if e.get("id") == eid), None)
        if el is None:
            continue
        nombre = eid.replace("_x20_", " ")
        resultado["zonas"][nombre] = {
            "titulo": el.get("title") or nombre,
            "boundary_d": el.get("d"),
            "espacios": [],
            "markup_svg": "",
        }
    for g in grupos:
        gid = g.get("id", "")
        nombre = gid.replace("Grupo_x20_", "").replace("_x20_", " ")
        hijos = list(g.iter())
        paths = [e for e in hijos if _local(e.tag) == "path"]
        rects = [e for e in hijos if _local(e.tag) == "rect"]
        polygons = [e for e in hijos if _local(e.tag) == "polygon"]

        # El borde de la zona normalmente es el <path title="..."> -- pero
        # algunas zonas (ej. "Rack Colgantes"/Colgados) no le pusieron
        # title en el editor. Si no hay ninguno con title, se cae al path
        # cuyo id coincide con el nombre de la zona (el editor lo nombra
        # asi por default al dibujar el borde).
        boundary = next((p for p in paths if p.get("title")), None)
        if boundary is None:
            boundary = next((p for p in paths if (p.get("id") or "").replace("_x20_", " ") == nombre), None)

        espacios = []
        no_axial = 0
        ignorados = 0
        for r in rects:
            if not _ID_UBICACION.match(r.get("id") or ""):
                continue
            m = parse_transform(r.get("transform"))
            if abs(m[1]) > 1e-6 or abs(m[2]) > 1e-6:
                no_axial += 1
            x, y = float(r.get("x", 0)), float(r.get("y", 0))
            w, h = float(r.get("width", 0)), float(r.get("height", 0))
            x0, y0 = _apply(m, x, y)
            x1, y1 = _apply(m, x + w, y + h)
            espacios.append(
                {
                    "id": r.get("id"),
                    "x": round(min(x0, x1), 2),
                    "y": round(min(y0, y1), 2),
                    "ancho": round(abs(x1 - x0), 2),
                    "alto": round(abs(y1 - y0), 2),
                }
            )

        # Espacios exportados como path/polygon en vez de rect -- el
        # editor los "aplana" asi cuando la celda queda rotada/escesgada
        # y ya no puede describirse como rect+transform (ver Rack Doble,
        # Rack Balda, Llantas, Rack Colgantes). Vienen con las coordenadas
        # ya resueltas (nunca traen su propio `transform`), asi que solo
        # se calcula su bounding box -- exacto si la celda es axial,
        # aproximado si quedo rotada (mismo aviso que los rects no-axiales).
        # Se filtra por id (`rectN`) igual que los rects: un path/polygon
        # sin ese id es un elemento estructural (marco, soporte), no una
        # ubicacion, aunque tambien sea rectangular.
        for p in paths:
            if p is boundary or not _ID_UBICACION.match(p.get("id") or ""):
                continue
            puntos = puntos_de_path(p.get("d", ""))
            if not puntos or len(puntos) < 3:
                ignorados += 1
                continue
            x, y, w, h, es_axial = bbox_de_puntos(puntos)
            if not es_axial:
                no_axial += 1
            espacios.append({"id": p.get("id"), "x": round(x, 2), "y": round(y, 2), "ancho": round(w, 2), "alto": round(h, 2)})

        for pol in polygons:
            if not _ID_UBICACION.match(pol.get("id") or ""):
                continue
            puntos = puntos_de_polygon(pol.get("points", ""))
            if len(puntos) < 3:
                ignorados += 1
                continue
            x, y, w, h, es_axial = bbox_de_puntos(puntos)
            if not es_axial:
                no_axial += 1
            espacios.append({"id": pol.get("id"), "x": round(x, 2), "y": round(y, 2), "ancho": round(w, 2), "alto": round(h, 2)})

        if no_axial:
            print(
                f"AVISO: {nombre} tiene {no_axial} espacios con rotacion/escesgo no-axial -- "
                "sus x/y/ancho/alto son solo el bounding box, no la forma real.",
                file=sys.stderr,
            )
        if ignorados:
            print(f"AVISO: {nombre} tiene {ignorados} elementos con id de ubicacion que no se pudieron leer.", file=sys.stderr)

        # Marcado real tal cual lo dibujaste -- se serializan los hijos
        # DIRECTOS del grupo, EXCEPTO el path del borde (ese se sigue
        # dibujando aparte con el estilo propio de la app, no el
        # fill/opacity original de la herramienta -- ver boundary_d).
        # Cada hijo mantiene todo su propio subárbol (por si armaste
        # sub-grupos dentro de una zona), su orden original y su
        # transform intacto. El frontend lo pega tal cual
        # (`dangerouslySetInnerHTML`) y solo cambia el `fill` de cada
        # rect por id -- nunca reconstruye la forma a partir de números.
        markup_svg = "".join(ET.tostring(hijo, encoding="unicode") for hijo in g if hijo is not boundary)

        resultado["zonas"][nombre] = {
            # Si el borde no trajo `title` (ver fallback arriba), se usa el
            # nombre de la zona derivado del id del grupo -- nunca queda
            # una etiqueta vacia en el frontend por un detalle del editor.
            "titulo": (boundary.get("title") if boundary is not None else None) or nombre,
            "boundary_d": boundary.get("d") if boundary is not None else None,
            "espacios": espacios,
            "markup_svg": markup_svg,
        }
    return resultado


def main() -> None:
    if len(sys.argv) != 3:
        print("Uso: python extraer_layout_svg.py <entrada.svg> <salida.json>", file=sys.stderr)
        raise SystemExit(1)
    entrada, salida = Path(sys.argv[1]), Path(sys.argv[2])
    datos = extraer(entrada)
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")
    for nombre, z in datos["zonas"].items():
        print(f"{nombre}: {len(z['espacios'])} espacios")
    print(f"\nGuardado en {salida}")


if __name__ == "__main__":
    main()
