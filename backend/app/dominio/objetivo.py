"""Peso por SKU que usa el optimizador (`dominio/optimizador.py`) para
decidir la zona -- construcción nueva de este backend, no un puerto del
notebook original.

Los tres modelos de slotting (velocidad, valor, servicio) comparten el
mismo optimizador PuLP y las mismas restricciones duras; lo único que
cambia entre ellos es qué `peso(SKU)` multiplica a `TIEMPO_MINUTOS(zona)`
en la función objetivo. Diseño completo y verificación empírica en
`MVP-Inchape/1.md` §12, `2.md` §4 y `3.md` §4.

Los tres pesos se reescalan a la misma masa total que `N_LINEAS`
(Σ N_LINEAS = 1500 en el dataset de práctica) -- sin esto,
PENALIZACION_MOVIMIENTO y PESO_AFINIDAD_FORZADO (calibrados contra esa
escala) quedarían fuera de proporción en Modelo 2/3. Multiplicar todo el
vector por una constante no cambia el orden de prioridad entre SKU.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from app.dominio.scoring import normalizar_01

# Multiplicativo sobre el peso de valor -- un SKU con stock envejecido
# pierde prioridad por las zonas cercanas, sin necesidad de un término de
# repulsión aparte (ver 2.md §4.2).
FACTOR_RIESGO_M2 = {"Bajo": 1.00, "Medio": 0.60, "Alto": 0.25}
# Mapeo lineal de criticidad a número -- decisión de política, no técnica
# (ver 3.md §4.1 sobre por qué no es convexo).
CRITICIDAD_NUM_M3 = {"Bajo": 0.25, "Medio": 0.50, "Alto": 0.75, "Crítico": 1.00}
# Muy por debajo de cualquier peso crudo observado en el dataset de
# práctica (mínimo real: 0.0174 en Modelo 2, 0.1875 en Modelo 3) -- solo
# evita un 0 exacto si algún día dos componentes normalizados coinciden
# en su mínimo global para el mismo SKU. No perturba los datos reales.
PISO_PESO_CRUDO = 1e-3

MODOS_OBJETIVO = ("velocidad", "valor", "servicio")
# Insumos crudos de cada modelo que se muestran en la recomendación final
# (ver recomendaciones.py) -- "%" no es válido como nombre de columna
# Python/Pydantic, se renombra al anexar.
COLUMNAS_MODELO = {
    "valor": ["VALOR_INVENTARIO_M2", "MARGEN_%_M2", "RIESGO_OBSOLESCENCIA_M2"],
    "servicio": ["CRITICIDAD_M3", "VARIABILIDAD_DEMANDA_M3"],
}
_RENOMBRE_COLUMNA = {"MARGEN_%_M2": "MARGEN_PORCENTAJE_M2"}


class VariablesModeloNoDisponiblesError(ValueError):
    """A uno o más SKU del lote vigente les falta su fila en el JSON
    precalculado de este modelo, o trae una categoría no reconocida --
    nunca se les asigna un peso 0 silencioso, eso los mandaría a la peor
    zona sin que nadie se entere."""


def cargar_variables_modelo(ruta: Path) -> dict:
    """Tolerante como `distancia_svg.py::cargar_distancia_svg_por_zona`:
    archivo ausente -> {} (modo "valor"/"servicio" sin datos abortará
    recién al pedirse, no acá)."""
    if not ruta.exists():
        return {}
    return json.loads(ruta.read_text(encoding="utf-8"))


def peso_por_sku(base_maestra: pd.DataFrame, modo: str, variables: dict | None = None) -> dict[str, float]:
    """Peso por SKU para la función objetivo del optimizador.

    `modo="velocidad"` no toca `variables` -- devuelve `N_LINEAS` tal
    cual (es la escala de referencia, factor de reescalado = 1).
    """
    n_lineas = base_maestra.set_index("SKU")["N_LINEAS"].astype(float)
    if modo == "velocidad":
        return n_lineas.to_dict()
    if modo not in MODOS_OBJETIVO:
        raise ValueError(f"modo_objetivo desconocido: {modo!r} (válidos: {MODOS_OBJETIVO})")

    if modo == "valor":
        crudo = peso_valor_crudo(base_maestra, variables or {})
    else:
        crudo = peso_servicio_crudo(base_maestra, variables or {})

    crudo = crudo.clip(lower=PISO_PESO_CRUDO)
    factor = n_lineas.sum() / crudo.sum()
    return (crudo * factor).to_dict()


def anexar_columnas_modelo(base_maestra: pd.DataFrame, modo: str, variables: dict) -> pd.DataFrame:
    """Copia de `base_maestra` con las columnas de insumo del modelo
    activo anexadas (para mostrarlas en la recomendación final, ver
    `recomendaciones.py`) -- "velocidad" no tiene insumos propios más
    allá de `N_LINEAS`, que ya está en `base_maestra`, así que no anexa
    nada."""
    if modo == "velocidad":
        return base_maestra
    columnas = COLUMNAS_MODELO[modo]
    tabla = _tabla_variables(base_maestra, variables, modo)[columnas]
    resultado = base_maestra.copy()
    for columna in columnas:
        # .to_numpy(), no asignación directa de Series -- `tabla` está
        # indexada por SKU, `resultado` por posición; alinear por índice
        # acá pondría todo NaN.
        resultado[_RENOMBRE_COLUMNA.get(columna, columna)] = tabla[columna].to_numpy()
    return resultado


def _tabla_variables(base_maestra: pd.DataFrame, variables: dict, modo: str) -> pd.DataFrame:
    """Alinea `variables` (dict SKU -> {...}) al orden de SKU de
    `base_maestra`. Un SKU del lote sin fila en `variables` queda en
    blanco (NaN) tras el `reindex` -- se detecta acá."""
    tabla = pd.DataFrame.from_dict(variables, orient="index").reindex(base_maestra["SKU"])
    faltantes = tabla[tabla.isna().any(axis=1)].index.tolist()
    if faltantes:
        raise VariablesModeloNoDisponiblesError(
            f"Modelo '{modo}': faltan variables para {len(faltantes)} SKU del lote vigente "
            f"(ej. {faltantes[:5]}) -- regenerar con scripts/extraer_variables_modelo.py."
        )
    return tabla


def peso_valor_crudo(base_maestra: pd.DataFrame, variables: dict) -> pd.Series:
    """`(0.70·valor_norm + 0.30·margen_norm) × factor_riesgo`, SIN
    reescalar -- expuesto aparte de `peso_por_sku` para poder verificar
    la escala real (Σ ≈ 37.22 en el dataset de práctica, ver `2.md` §4.3)
    independientemente del reescalado, que por construcción siempre da
    Σ = Σ N_LINEAS sin importar si la fórmula de acá está bien."""
    t = _tabla_variables(base_maestra, variables, "valor")
    riesgo = t["RIESGO_OBSOLESCENCIA_M2"].map(FACTOR_RIESGO_M2)
    _validar_categorias(riesgo, t["RIESGO_OBSOLESCENCIA_M2"], "RIESGO_OBSOLESCENCIA_M2", "valor")
    return (0.70 * normalizar_01(t["VALOR_INVENTARIO_M2"]) + 0.30 * normalizar_01(t["MARGEN_%_M2"])) * riesgo


def peso_servicio_crudo(base_maestra: pd.DataFrame, variables: dict) -> pd.Series:
    """`0.75·criticidad_num + 0.25·variab_norm`, SIN reescalar (Σ ≈ 59.68
    en el dataset de práctica, ver `3.md` §4.1) -- mismo motivo de
    exposición que `peso_valor_crudo`."""
    t = _tabla_variables(base_maestra, variables, "servicio")
    criticidad = t["CRITICIDAD_M3"].map(CRITICIDAD_NUM_M3)
    _validar_categorias(criticidad, t["CRITICIDAD_M3"], "CRITICIDAD_M3", "servicio")
    return 0.75 * criticidad + 0.25 * normalizar_01(t["VARIABILIDAD_DEMANDA_M3"])


def _validar_categorias(mapeada: pd.Series, original: pd.Series, columna: str, modo: str) -> None:
    invalidas = original[mapeada.isna()].unique().tolist()
    if invalidas:
        raise VariablesModeloNoDisponiblesError(
            f"Modelo '{modo}': valor(es) no reconocido(s) en {columna}: {invalidas}."
        )
