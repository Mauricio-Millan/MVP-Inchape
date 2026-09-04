"""Extrae las variables de Modelo 2 (valor/rentabilidad) y Modelo 3
(nivel de servicio) desde las hojas VARIABLES_MODELO2/VARIABLES_MODELO3
del Excel de práctica ampliado, y las guarda como JSON por SKU.

Es un insumo para `app/dominio/objetivo.py` en el backend: ese módulo
calcula el peso por SKU de cada modelo (ver `MVP-Inchape/2.md` y `3.md`
para las fórmulas), nunca lee el Excel directamente.

Las dos hojas no son tablas planas -- tienen un título, un párrafo
explicativo y una tabla de parámetros de negocio antes de la tabla real
de 100 SKU (fila 13 en VARIABLES_MODELO2, fila 12 en VARIABLES_MODELO3,
1-indexado). Por eso `header=12`/`header=11` (0-indexado) más abajo, no
la fila 0.

Fuente: el Excel vive FUERA del repo, junto al de práctica original
(`Reto2 Inchape/data/`), no en `MVP-Inchape/data/`.

Uso (desde la raiz de MVP-Inchape):
    conda run -n IngenieriaPython python scripts/extraer_variables_modelo.py
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
EXCEL_ORIGEN = RAIZ.parent / "data" / "IMPULSA_CD_Práctico Estudiantes variables m2 -m3.xlsx"
SALIDA_M2 = RAIZ / "backend" / "data" / "variables_modelo2.json"
SALIDA_M3 = RAIZ / "backend" / "data" / "variables_modelo3.json"

COLUMNAS_M2 = ["VALOR_INVENTARIO_M2", "MARGEN_%_M2", "RIESGO_OBSOLESCENCIA_M2", "AGED_STOCK_DIAS_M2"]
COLUMNAS_M3 = [
    "CRITICIDAD_M3",
    "VARIABILIDAD_DEMANDA_M3",
    "FRECUENCIA_QUIEBRE_M3",
    "LEAD_TIME_M3",
    "FILL_RATE_OBJETIVO_M3",
    "MONTHS_OF_STOCK_M3",
]


def _extraer_hoja(hoja: str, header: int, columnas: list[str]) -> dict[str, dict]:
    df = pd.read_excel(EXCEL_ORIGEN, sheet_name=hoja, header=header).dropna(subset=["SKU"])
    return df.set_index("SKU")[columnas].to_dict("index")


def _guardar(datos: dict, salida: Path) -> None:
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(json.dumps(datos, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def main() -> None:
    if not EXCEL_ORIGEN.exists():
        raise SystemExit(
            f"No se encontró el Excel de origen en:\n  {EXCEL_ORIGEN}\n"
            "Poné 'IMPULSA_CD_Práctico Estudiantes variables m2 -m3.xlsx' en esa carpeta "
            "(junto al Excel de práctica original) y volvé a correr este script."
        )

    variables_m2 = _extraer_hoja("VARIABLES_MODELO2", header=12, columnas=COLUMNAS_M2)
    variables_m3 = _extraer_hoja("VARIABLES_MODELO3", header=11, columnas=COLUMNAS_M3)

    _guardar(variables_m2, SALIDA_M2)
    _guardar(variables_m3, SALIDA_M3)

    print(f"Modelo 2: {len(variables_m2)} SKU -> {SALIDA_M2}")
    print(f"Modelo 3: {len(variables_m3)} SKU -> {SALIDA_M3}")


if __name__ == "__main__":
    main()
