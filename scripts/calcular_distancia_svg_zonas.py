"""Calcula, para cada zona de LAYOUT_CD (el Excel) que ya tiene
geometria real escaneada, la distancia real (en las unidades del dibujo
SVG, no metros) desde el centro de esa zona hasta "Mesas de trabajo".

Es un insumo para el modo de optimizacion "distancia real del SVG" (ver
`app/dominio/distancia_svg.py` en el backend): ese modulo calibra estas
distancias contra el TIEMPO_MINUTOS ya declarado en el Excel (regresion),
nunca inventa una escala metros/pixel.

Fuente: `frontend/src/data/layoutEscaneado.json` (espacios reales +
`referencia_mesa_trabajo`, ambos generados por `extraer_layout_svg.py`)
y `frontend/src/data/mapeoZonas.json` (que zona geometrica es cual clave
de LAYOUT_CD). No vuelve a tocar el SVG.

Uso (desde la raiz de MVP-Inchape):
    conda run -n IngenieriaPython python scripts/calcular_distancia_svg_zonas.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
LAYOUT_JSON = RAIZ / "frontend" / "src" / "data" / "layoutEscaneado.json"
MAPEO_JSON = RAIZ / "frontend" / "src" / "data" / "mapeoZonas.json"
SALIDA = RAIZ / "backend" / "data" / "distancia_svg_por_zona.json"


def centroide_zona(espacios: list[dict]) -> tuple[float, float]:
    """Promedio de los centros de todos los espacios reales de la zona --
    una zona grande y repartida (ej. Bulk) pesa por su forma real, no por
    un unico punto arbitrario (ej. la esquina del boundary)."""
    cxs = [e["x"] + e["ancho"] / 2 for e in espacios]
    cys = [e["y"] + e["alto"] / 2 for e in espacios]
    return sum(cxs) / len(cxs), sum(cys) / len(cys)


def main() -> None:
    layout = json.loads(LAYOUT_JSON.read_text(encoding="utf-8"))
    mapeo = json.loads(MAPEO_JSON.read_text(encoding="utf-8"))

    ref = layout.get("referencia_mesa_trabajo")
    if not ref:
        raise SystemExit(
            "layoutEscaneado.json no trae 'referencia_mesa_trabajo' -- "
            "regenera con una version del SVG que incluya 'Mesas de trabajo'."
        )

    distancias: dict[str, float] = {}
    for zona in mapeo["zonas"]:
        clave_excel = zona.get("claveExcel")
        if not clave_excel:
            continue  # sin equivalente en el Excel, o no primaria de su clave -- no aplica
        real = layout["zonas"].get(zona["nombreSvg"])
        if not real or not real["espacios"]:
            continue
        cx, cy = centroide_zona(real["espacios"])
        distancias[clave_excel] = round(math.dist((cx, cy), (ref["x"], ref["y"])), 2)

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text(json.dumps(distancias, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")

    print(f"{len(distancias)} zonas de LAYOUT_CD con distancia real calculada:")
    for clave, dist in sorted(distancias.items()):
        print(f"  {clave}: {dist}")
    print(f"\nGuardado en {SALIDA}")


if __name__ == "__main__":
    main()
