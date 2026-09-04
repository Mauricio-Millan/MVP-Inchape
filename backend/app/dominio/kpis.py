"""Fase 13 del notebook original -- KPI globales del escenario optimizado.

`layout_cd`/`modo_objetivo` son construcción nueva de este backend (no
del notebook): habilitan el KPI propio de Modelo 2/3 y la definición de
"zona rápida" que usa (ver `calcular_kpis_modelo`).
"""

from __future__ import annotations

import math

import pandas as pd

from app.core.config import JORNADA_MIN_POR_PERSONA_MES


def calcular_kpis(
    recomendaciones: pd.DataFrame,
    max_movimientos: int,
    n_pedidos: int,
    layout_cd: pd.DataFrame,
    modo_objetivo: str = "velocidad",
) -> dict:
    tiempo_total_actual = float(recomendaciones["COSTO_ACTUAL_MIN"].sum())
    tiempo_total_nuevo = float(recomendaciones["COSTO_NUEVO_MIN"].sum())
    ahorro_total = tiempo_total_actual - tiempo_total_nuevo
    ahorro_porcentaje = 100 * ahorro_total / tiempo_total_actual if tiempo_total_actual > 0 else 0

    cantidad_movimientos = int(recomendaciones["MOVIMIENTO"].eq("MOVER").sum())
    porcentaje_movimientos = 100 * cantidad_movimientos / len(recomendaciones)

    # Productividad = líneas completadas / horas-hombre (Σtiempo en horas).
    # Misma fórmula ya verificada contra PEDIDOS ACTUAL en FEATURES-Y-KPIS.md §3.
    # SIEMPRE con N_LINEAS, sin importar modo_objetivo -- es tiempo físico
    # real de picking, no el criterio que decidió la zona (ver 2.md §7 /
    # 3.md §7): así el número es comparable entre los 3 modelos.
    n_lineas = float(recomendaciones["N_LINEAS"].sum())
    productividad_actual = n_lineas / (tiempo_total_actual / 60) if tiempo_total_actual > 0 else 0
    productividad_optimizada = n_lineas / (tiempo_total_nuevo / 60) if tiempo_total_nuevo > 0 else 0

    # Tiempo promedio = Σtiempo / n_pedidos (no n_líneas -- ver FEATURES-Y-KPIS.md §2, el
    # error de método más frecuente es dividir entre líneas en vez de entre pedidos).
    tiempo_promedio_actual = tiempo_total_actual / n_pedidos if n_pedidos > 0 else 0
    tiempo_promedio_optimizado = tiempo_total_nuevo / n_pedidos if n_pedidos > 0 else 0

    return {
        "sku_analizados": len(recomendaciones),
        "sku_movidos": cantidad_movimientos,
        "porcentaje_sku_movidos": porcentaje_movimientos,
        "max_movimientos_permitidos": max_movimientos,
        "tiempo_actual_min": tiempo_total_actual,
        "tiempo_optimizado_min": tiempo_total_nuevo,
        "ahorro_min": ahorro_total,
        "reduccion_porcentaje": ahorro_porcentaje,
        "productividad_actual_lineas_hh": productividad_actual,
        "productividad_optimizada_lineas_hh": productividad_optimizada,
        "tiempo_promedio_actual_min_pedido": tiempo_promedio_actual,
        "tiempo_promedio_optimizado_min_pedido": tiempo_promedio_optimizado,
        **calcular_personal_necesario(tiempo_total_actual, tiempo_total_nuevo, n_pedidos),
        "kpis_modelo": calcular_kpis_modelo(recomendaciones, layout_cd, modo_objetivo),
    }


def calcular_personal_necesario(tiempo_actual_min: float, tiempo_nuevo_min: float, n_pedidos: int) -> dict:
    """Tres cifras, ninguna inventada:

    - Horas-hombre: dato directo, cero supuestos.
    - Pedidos atendibles con la misma dotación: cuántos pedidos más se
      despacharían con las mismas horas-hombre de hoy -- responde
      "personal necesario" sin asumir turno, calendario ni headcount.
    - FTE, con el supuesto de jornada explícito (`JORNADA_MIN_POR_PERSONA_MES`):
      nunca se redondea a "personas" -- con 100 SKU de muestra da <1,
      se presenta como % de una jornada, no como "0.62 personas".
    """
    horas_actual = tiempo_actual_min / 60
    horas_nuevo = tiempo_nuevo_min / 60
    if tiempo_nuevo_min > 0:
        pedidos_atendibles = n_pedidos * (tiempo_actual_min / tiempo_nuevo_min)
    else:
        pedidos_atendibles = float(n_pedidos)
    return {
        "horas_hombre_actual": horas_actual,
        "horas_hombre_optimizado": horas_nuevo,
        "pedidos_atendibles_con_misma_dotacion": pedidos_atendibles,
        "fte_actual": tiempo_actual_min / JORNADA_MIN_POR_PERSONA_MES,
        "fte_optimizado": tiempo_nuevo_min / JORNADA_MIN_POR_PERSONA_MES,
    }


def _zonas_rapidas(layout_cd: pd.DataFrame) -> set[str]:
    """El tercio de zonas con menor `TIEMPO_MINUTOS` -- `ceil`, no
    `round`, para no perder una zona cuando el catálogo no es múltiplo de
    3 (con las 9 zonas de `LAYOUT_CD` del dataset de práctica: 3 zonas)."""
    n = max(1, math.ceil(len(layout_cd) / 3))
    return set(layout_cd.nsmallest(n, "TIEMPO_MINUTOS")["ZONA"])


def calcular_kpis_modelo(
    recomendaciones: pd.DataFrame, layout_cd: pd.DataFrame, modo_objetivo: str
) -> dict | None:
    """KPI propio del modelo activo -- `None` si "velocidad" (ese modelo
    ya está cubierto por los KPI de tiempo/productividad de arriba, que
    son exactamente lo que optimiza).

    Con capacidad holgada (ver 1.md/2.md/3.md, hallazgo verificado: la
    muestra de 100 SKU no ata contra la capacidad declarada) nada sale
    nunca de una zona rápida -- por eso el KPI de Modelo 2 es composición
    de riesgo de los SKU PROMOVIDOS, no "m³ liberado" (que daría 0
    siempre y parecería un bug).
    """
    if modo_objetivo == "velocidad":
        return None

    zonas_rapidas = _zonas_rapidas(layout_cd)
    en_zona_rapida = recomendaciones["ZONA_RECOMENDADA"].isin(zonas_rapidas)

    if modo_objetivo == "valor":
        valor_total = recomendaciones["VALOR_INVENTARIO_M2"].sum()
        valor_en_rapida = recomendaciones.loc[en_zona_rapida, "VALOR_INVENTARIO_M2"].sum()
        promovidos = recomendaciones[recomendaciones["MOVIMIENTO"].eq("MOVER") & en_zona_rapida]
        return {
            "valor_en_zona_rapida_pct": 100 * valor_en_rapida / valor_total if valor_total > 0 else 0.0,
            "sku_promovidos_a_zona_rapida": float(len(promovidos)),
            "sku_promovidos_riesgo_bajo": float(promovidos["RIESGO_OBSOLESCENCIA_M2"].eq("Bajo").sum()),
        }

    # servicio
    criticos = recomendaciones["CRITICIDAD_M3"].isin(["Alto", "Crítico"])
    n_criticos = int(criticos.sum())
    criticos_en_rapida = int((criticos & en_zona_rapida).sum())
    peor_caso = recomendaciones.loc[recomendaciones["CRITICIDAD_M3"].eq("Crítico"), "TIEMPO_NUEVO_MIN"]
    return {
        "cobertura_critica_pct": 100 * criticos_en_rapida / n_criticos if n_criticos > 0 else 0.0,
        "peor_caso_critico_min": float(peor_caso.max()) if len(peor_caso) else 0.0,
    }
