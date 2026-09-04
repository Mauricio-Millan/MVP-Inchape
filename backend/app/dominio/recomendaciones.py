"""Fases 12 y 14 del notebook original -- recomendación final por SKU y
validación de factibilidad del resultado del optimizador.

Puerto de `MVP_Reslotting_Inchcape.ipynb` (celdas 98-104, 110-112), con
una simplificación real: el notebook re-extrae `ZONA_RECOMENDADA` leyendo
las variables binarias de PuLP porque es un script plano; aquí ya viene
como `ResultadoOptimizador.zona_asignada` (ver `optimizador.py`), así que
no hay que releer el modelo.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


class FactibilidadError(ValueError):
    """El resultado del optimizador no cumple una restricción dura --
    no debería ocurrir si `optimizador.py` está bien planteado, pero se
    valida explícitamente antes de exponer el resultado (Fase 14)."""


def construir_recomendaciones(
    base_con_score: pd.DataFrame,
    zona_asignada: dict[str, str],
    layout_cd: pd.DataFrame,
    modo_objetivo: str = "velocidad",
    pesos: dict[str, float] | None = None,
) -> pd.DataFrame:
    """`modo_objetivo`/`pesos` solo cambian la `JUSTIFICACION` (en qué
    términos se explica el movimiento -- minutos, valor o criticidad,
    ver `_generar_justificacion`), el orden final de la tabla, y qué
    columnas de insumo del modelo se exponen. La decisión de zona ya
    vino hecha en `zona_asignada` -- este archivo nunca decide nada."""
    tiempos_zona = layout_cd.set_index("ZONA")["TIEMPO_MINUTOS"].to_dict()

    r = base_con_score.copy()
    r["ZONA_RECOMENDADA"] = r["SKU"].map(zona_asignada)
    r["TIEMPO_NUEVO_MIN"] = r["ZONA_RECOMENDADA"].map(tiempos_zona)
    r["COSTO_ACTUAL_MIN"] = r["N_LINEAS"] * r["TIEMPO_LAYOUT_ACTUAL"]
    r["COSTO_NUEVO_MIN"] = r["N_LINEAS"] * r["TIEMPO_NUEVO_MIN"]
    r["AHORRO_ESTIMADO_MIN"] = r["COSTO_ACTUAL_MIN"] - r["COSTO_NUEVO_MIN"]
    r["AHORRO_%"] = np.where(
        r["COSTO_ACTUAL_MIN"] > 0, 100 * r["AHORRO_ESTIMADO_MIN"] / r["COSTO_ACTUAL_MIN"], 0
    )
    r["MOVIMIENTO"] = np.where(r["ZONA_ACTUAL"] != r["ZONA_RECOMENDADA"], "MOVER", "MANTENER")

    if pesos is not None:
        r["PESO_MODELO"] = r["SKU"].map(pesos)
    if modo_objetivo == "valor" and "VALOR_INVENTARIO_M2" in r.columns:
        # Percentil solo para redactar la justificación -- no se expone
        # como columna propia (ver 2.md §6), por eso no entra a `columnas`.
        r["_PERCENTIL_VALOR"] = r["VALOR_INVENTARIO_M2"].rank(pct=True) * 100

    r["JUSTIFICACION"] = r.apply(lambda fila: _generar_justificacion(fila, modo_objetivo), axis=1)

    columnas = [
        "RANKING_SCORE",
        "SKU",
        "MARCA",
        "FAMILIA",
        "ABC",
        "ROTACION_6M",
        "N_PEDIDOS",
        "N_LINEAS",
        "CANT_TOTAL",
        "VOLUMEN_M3",
        "PESO_KG",
        "ZONA_ACTUAL",
        "ZONA_RECOMENDADA",
        "TIEMPO_LAYOUT_ACTUAL",
        "TIEMPO_NUEVO_MIN",
        "COSTO_ACTUAL_MIN",
        "COSTO_NUEVO_MIN",
        "AHORRO_ESTIMADO_MIN",
        "AHORRO_%",
        "SCORE_PRIORIDAD",
        "MOVIMIENTO",
        "JUSTIFICACION",
    ]
    columnas_ml = ["CLUSTER_ML", "PERFIL_ML", "PRIORIDAD_CLUSTER_RANK", "INDICE_IMPACTO_CLUSTER"]
    columnas += [c for c in columnas_ml if c in r.columns]  # solo si ml_perfil.py ya corrió antes
    # Afinidad/PESO_MODELO/insumos del modelo activo -- cada uno presente
    # solo si esta corrida efectivamente lo calculó (mismo criterio que
    # columnas_ml de arriba: nunca se inventa la columna si no hay dato).
    columnas_opcionales = [
        "COMUNIDAD_AFINIDAD",
        "PESO_MODELO",
        "VALOR_INVENTARIO_M2",
        "MARGEN_PORCENTAJE_M2",
        "RIESGO_OBSOLESCENCIA_M2",
        "CRITICIDAD_M3",
        "VARIABILIDAD_DEMANDA_M3",
    ]
    columnas += [c for c in columnas_opcionales if c in r.columns]

    # En Modelo 2/3 el criterio que decidió la zona fue el peso del
    # modelo, no el ahorro de minutos -- ordenar por ahorro haría que la
    # tabla y el export *parezcan* Modelo 1 aunque los datos sean de otro
    # modelo (la primera fila sería la que más minutos ahorró, no la más
    # valiosa/crítica).
    usa_peso_modelo = modo_objetivo != "velocidad" and "PESO_MODELO" in r.columns
    orden_por = "PESO_MODELO" if usa_peso_modelo else "AHORRO_ESTIMADO_MIN"
    return r[columnas].sort_values(orden_por, ascending=False).reset_index(drop=True)


def _generar_justificacion(fila: pd.Series, modo_objetivo: str) -> str:
    if modo_objetivo == "valor":
        return _justificacion_valor(fila)
    if modo_objetivo == "servicio":
        return _justificacion_servicio(fila)
    return _justificacion_velocidad(fila)


def _justificacion_velocidad(fila: pd.Series) -> str:
    if fila["MOVIMIENTO"] == "MOVER":
        return (
            f"Mover de {fila['ZONA_ACTUAL']} a {fila['ZONA_RECOMENDADA']}. "
            f"El SKU registró {int(fila['N_LINEAS'])} visitas. "
            f"El tiempo de acceso de zona pasa de {fila['TIEMPO_LAYOUT_ACTUAL']:.2f} a "
            f"{fila['TIEMPO_NUEVO_MIN']:.2f} min. "
            f"Ahorro estimado en la muestra: {fila['AHORRO_ESTIMADO_MIN']:.2f} min."
        )
    return (
        f"Mantener en {fila['ZONA_ACTUAL']}. Dentro de las restricciones actuales, "
        "el optimizador no seleccionó un cambio de zona."
    )


def _justificacion_valor(fila: pd.Series) -> str:
    detalle = (
        f"Valor movido en 6 meses: S/ {fila['VALOR_INVENTARIO_M2']:,.0f} "
        f"(percentil {fila['_PERCENTIL_VALOR']:.0f} del catálogo), "
        f"margen {fila['MARGEN_PORCENTAJE_M2'] * 100:.0f}%, "
        f"riesgo de obsolescencia {fila['RIESGO_OBSOLESCENCIA_M2']}."
    )
    if fila["MOVIMIENTO"] == "MOVER":
        return f"Mover de {fila['ZONA_ACTUAL']} a {fila['ZONA_RECOMENDADA']} por valor económico. {detalle}"
    return f"Mantener en {fila['ZONA_ACTUAL']}. {detalle}"


def _justificacion_servicio(fila: pd.Series) -> str:
    detalle = (
        f"Criticidad {fila['CRITICIDAD_M3']}, variabilidad de demanda "
        f"{fila['VARIABILIDAD_DEMANDA_M3']:.2f} (coeficiente de variación). "
        f"Frecuencia de picking real: {int(fila['N_LINEAS'])} líneas."
    )
    if fila["MOVIMIENTO"] == "MOVER":
        return (
            f"Mover de {fila['ZONA_ACTUAL']} a {fila['ZONA_RECOMENDADA']} por nivel de servicio "
            f"(no necesariamente por ser de los más pedidos). {detalle}"
        )
    return f"Mantener en {fila['ZONA_ACTUAL']}. {detalle}"


def validar_factibilidad(
    recomendaciones: pd.DataFrame, capacidad: pd.DataFrame, max_movimientos: int
) -> None:
    """Fase 14 -- repite, sobre el resultado ya extraído, las mismas tres
    comprobaciones duras que ya garantizan las restricciones del
    optimizador (cinturón y tirantes: si esto falla, hay un bug en
    `optimizador.py`, no un caso de negocio válido).
    """
    volumen_nuevo = (
        recomendaciones.groupby("ZONA_RECOMENDADA", as_index=False)["VOLUMEN_M3"]
        .sum()
        .rename(columns={"ZONA_RECOMENDADA": "ZONA", "VOLUMEN_M3": "VOLUMEN_SKU_ASIGNADOS"})
    )
    validacion = capacidad.merge(volumen_nuevo, on="ZONA", how="left")
    validacion["VOLUMEN_SKU_ASIGNADOS"] = validacion["VOLUMEN_SKU_ASIGNADOS"].fillna(0)
    validacion["VOLUMEN_FINAL_M3"] = (
        validacion["VOLUMEN_BASE_NO_MODELADO"] + validacion["VOLUMEN_SKU_ASIGNADOS"]
    )
    excedidas = validacion[validacion["VOLUMEN_FINAL_M3"] > validacion["CAPACIDAD_MAX_M3"] + 1e-9]
    if len(excedidas):
        raise FactibilidadError(f"Zonas que exceden capacidad: {excedidas['ZONA'].tolist()}")

    n_movidos = recomendaciones["MOVIMIENTO"].eq("MOVER").sum()
    if n_movidos > max_movimientos:
        raise FactibilidadError(f"Se superó el máximo de movimientos: {n_movidos} > {max_movimientos}")

    if recomendaciones["ZONA_RECOMENDADA"].isna().any():
        raise FactibilidadError("Hay SKU sin zona recomendada.")
