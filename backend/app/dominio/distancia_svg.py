"""Modo de optimización alternativo: en vez del `TIEMPO_MINUTOS`
declarado en el Excel (`LAYOUT_CD`), usa una distancia real (medida
sobre el layout escaneado del almacén, `layout inchape vfinal.svg`) desde
cada zona hasta "Mesas de trabajo".

La distancia real está en las unidades del dibujo SVG, no en metros --
no hay una escala metros/píxel conocida para ese archivo. Para poder
usarla en el mismo optimizador (que necesita minutos, no píxeles) se
calibra por regresión lineal contra las zonas que sí tienen ambos datos:
el `TIEMPO_MINUTOS` declarado y la distancia real del SVG
(`data/distancia_svg_por_zona.json`, generado por
`scripts/calcular_distancia_svg_zonas.py`). Es una aproximación
calibrada contra datos reales, no un factor inventado -- pero sigue
siendo una aproximación, nunca una medición de campo.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from app.core.config import DISTANCIA_SVG_JSON_PATH


class DistanciaSvgNoDisponibleError(ValueError):
    """No hay suficientes zonas con distancia real del SVG para calibrar
    una regresión confiable (hacen falta al menos 2 para ajustar una
    recta)."""


def cargar_distancia_svg_por_zona() -> dict[str, float]:
    if not DISTANCIA_SVG_JSON_PATH.exists():
        return {}
    return json.loads(DISTANCIA_SVG_JSON_PATH.read_text(encoding="utf-8"))


def calcular_layout_cd_svg(layout_cd: pd.DataFrame, distancia_svg_por_zona: dict[str, float]) -> pd.DataFrame:
    """Devuelve una copia de `layout_cd` con `TIEMPO_MINUTOS` reemplazado
    por el tiempo calibrado a partir de la distancia real del SVG.

    Zonas sin distancia real conocida (SVG todavía no trazado para esa
    zona) conservan su `TIEMPO_MINUTOS` declarado tal cual -- nunca se
    inventa una posición ni una distancia para lo que no está medido.
    """
    layout_cd = layout_cd.copy()
    layout_cd["DISTANCIA_SVG"] = layout_cd["ZONA"].map(distancia_svg_por_zona)

    calibracion = layout_cd.dropna(subset=["DISTANCIA_SVG"])
    if len(calibracion) < 2:
        raise DistanciaSvgNoDisponibleError(
            f"Solo {len(calibracion)} zona(s) de LAYOUT_CD tienen distancia real del SVG -- "
            "hacen falta al menos 2 para calibrar la regresión."
        )

    # Recta tiempo ≈ a·distancia_svg + b, ajustada por mínimos cuadrados
    # contra el TIEMPO_MINUTOS ya declarado -- calibra la escala
    # desconocida del dibujo (píxeles) contra el único dato real que sí
    # tenemos (los minutos declarados en el Excel), no inventa un factor.
    pendiente, ordenada = np.polyfit(calibracion["DISTANCIA_SVG"], calibracion["TIEMPO_MINUTOS"], 1)

    tiempo_svg = pendiente * layout_cd["DISTANCIA_SVG"] + ordenada
    layout_cd["TIEMPO_MINUTOS"] = tiempo_svg.where(
        layout_cd["DISTANCIA_SVG"].notna(), layout_cd["TIEMPO_MINUTOS"]
    )
    # Nunca un tiempo negativo/cero por extrapolación de la recta en una
    # zona muy cercana -- el optimizador lo tomaría como "gratis".
    layout_cd["TIEMPO_MINUTOS"] = layout_cd["TIEMPO_MINUTOS"].clip(lower=0.01)

    return layout_cd.drop(columns=["DISTANCIA_SVG"])
