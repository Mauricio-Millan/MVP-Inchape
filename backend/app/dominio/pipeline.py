"""Orquesta las Fases 3-14 en una sola llamada: éste es el cuerpo de
`POST /pipeline/ejecutar`. Cada paso es una función pura de otro módulo
de `dominio/` -- este archivo solo encadena datos, no calcula nada.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from app.core.config import (
    MAPA_ABC_SCORE,
    PENALIZACION_MOVIMIENTO,
    PESO_AFINIDAD,
    PESO_AFINIDAD_FORZADO,
    PESOS_SCORE,
    PORCENTAJE_MAX_MOVIMIENTO,
    VARIABLES_MODELO2_JSON_PATH,
    VARIABLES_MODELO3_JSON_PATH,
    ZONAS_NO_DESTINO,
)
from app.dominio.afinidad import calcular_significancia_afinidad, comunidades_por_sku
from app.dominio.capacidad import calcular_capacidad
from app.dominio.distancia_svg import calcular_layout_cd_svg, cargar_distancia_svg_por_zona
from app.dominio.impacto import calcular_impacto_operativo, construir_base_maestra
from app.dominio.indicadores import construir_pedidos_por_sku
from app.dominio.kpis import calcular_kpis
from app.dominio.ml_perfil import ResultadoML, calcular_ml_perfil
from app.dominio.objetivo import anexar_columnas_modelo, cargar_variables_modelo, peso_por_sku
from app.dominio.optimizador import ejecutar_optimizador
from app.dominio.recomendaciones import construir_recomendaciones, validar_factibilidad
from app.dominio.reglas.evaluador import aplicar_reglas_atributo, pares_familias_incompatibles
from app.dominio.reglas.modelos import Regla
from app.dominio.scoring import calcular_score_prioridad

_JSON_VARIABLES_MODELO = {"valor": VARIABLES_MODELO2_JSON_PATH, "servicio": VARIABLES_MODELO3_JSON_PATH}


class SinLoteIngeridoError(ValueError):
    """No hay datos cargados -- llamar POST /ingesta antes del pipeline."""


def _peso_afinidad_efectivo(afinidad_aplicada: bool, peso_afinidad: float | None, forzada: bool) -> float:
    """0.0 si el test de significancia no confirmó señal (ver
    ejecutar_pipeline) -- nunca se usa un peso explícito sin esa
    confirmación, sin importar qué haya pedido el caller. `forzada=True`
    (bypass explícito del test, ver `forzar_afinidad`) usa
    `PESO_AFINIDAD_FORZADO` en vez de `PESO_AFINIDAD` -- este último sigue
    en 0.0 hasta tener costo real, pero forzar sin ningún peso no movería
    una sola zona, y el punto de forzar es justamente poder verlo."""
    if not afinidad_aplicada:
        return 0.0
    if peso_afinidad is not None:
        return peso_afinidad
    return PESO_AFINIDAD_FORZADO if forzada else PESO_AFINIDAD


@dataclass
class ResultadoPipeline:
    recomendaciones: pd.DataFrame
    kpis: dict
    camino_decision_reglas: list[dict]
    ml: ResultadoML
    afinidad_aplicada: bool
    afinidad_motivo: str
    modo_objetivo: str


def ejecutar_pipeline(
    datasets: dict[str, pd.DataFrame],
    pesos_score: dict[str, float] | None = None,
    porcentaje_max_movimiento: float | None = None,
    reglas: list[Regla] | None = None,
    modo_distancia: str = "layout_cd",
    usar_afinidad: bool = False,
    peso_afinidad: float | None = None,
    forzar_afinidad: bool = False,
    modo_objetivo: str = "velocidad",
) -> ResultadoPipeline:
    if datasets["sku_maestro"].empty or datasets["pedidos"].empty:
        raise SinLoteIngeridoError("No hay un lote ingerido. Llama POST /ingesta primero.")

    pesos_score = pesos_score or PESOS_SCORE
    porcentaje_max_movimiento = (
        PORCENTAJE_MAX_MOVIMIENTO if porcentaje_max_movimiento is None else porcentaje_max_movimiento
    )

    pedidos_por_sku = construir_pedidos_por_sku(datasets["pedidos"])
    base = construir_base_maestra(
        datasets["sku_maestro"],
        datasets["rotacion"],
        datasets["stock_actual"],
        pedidos_por_sku,
        datasets["layout_cd"],
    )
    # "Actual Declarado" -- SIEMPRE con el layout_cd original del Excel,
    # sin importar `modo_distancia`: es la referencia fija contra la que
    # se compara cualquiera de las dos propuestas (ver KPIs más abajo).
    impacto = calcular_impacto_operativo(base, datasets["layout_cd"])
    base_con_score = calcular_score_prioridad(impacto.base_maestra, pesos_score, MAPA_ABC_SCORE)

    resultado_ml = calcular_ml_perfil(base_con_score)
    base_con_score = resultado_ml.base_con_ml  # + CLUSTER_ML, PERFIL_ML, DISTANCIA_CENTROIDE, ...

    # Modelo 2 (valor) / Modelo 3 (servicio): variables propias,
    # precalculadas a JSON por scripts/extraer_variables_modelo.py (ver
    # dominio/objetivo.py y MVP-Inchape/2.md, 3.md). "velocidad" no
    # necesita ningún dato extra -- usa N_LINEAS, ya presente en la base.
    variables_modelo: dict = {}
    if modo_objetivo in _JSON_VARIABLES_MODELO:
        variables_modelo = cargar_variables_modelo(_JSON_VARIABLES_MODELO[modo_objetivo])
    pesos = peso_por_sku(base_con_score, modo_objetivo, variables_modelo)
    base_con_score = anexar_columnas_modelo(base_con_score, modo_objetivo, variables_modelo)

    capacidad = calcular_capacidad(base_con_score, datasets["ocupacion_zona"])

    reglas = reglas or []
    reglas_atributo = aplicar_reglas_atributo(base_con_score, reglas)
    pares_incompatibles = pares_familias_incompatibles(reglas)

    # Layout usado para OPTIMIZAR (decidir ZONA_RECOMENDADA) y para
    # costear esa propuesta -- este sí cambia con `modo_distancia`. Con
    # "svg" el optimizador puede recomendar zonas distintas: está
    # minimizando contra un tiempo estimado por cercanía real, no el
    # declarado.
    layout_cd_optimizacion = datasets["layout_cd"]
    if modo_distancia == "svg":
        layout_cd_optimizacion = calcular_layout_cd_svg(
            datasets["layout_cd"], cargar_distancia_svg_por_zona()
        )

    # Afinidad: nunca se activa por defecto ni por opinión -- solo si el
    # caller la pide explícitamente (usar_afinidad=True, paga los ~15s
    # del test de 200 réplicas) Y el test de significancia la confirma
    # sobre el lote vigente (dominio/afinidad.py, README.md §5.2). Si
    # cualquiera de las dos no se cumple, el pipeline corre exactamente
    # igual que si `usar_afinidad` no existiera -- comunidad_por_sku
    # queda vacío y `ejecutar_optimizador` no agrega ninguna variable de
    # más (ver optimizador.py).
    comunidad_por_sku: dict[str, int] = {}
    afinidad_aplicada = False
    if forzar_afinidad:
        # Bypass deliberado del test de significancia -- solo para
        # demostrar en vivo el mecanismo (botón "Forzar afinidad" del
        # frontend). Nunca se presenta como un hallazgo real: el motivo
        # siempre deja explícito que fue forzado, y GET /afinidad sigue
        # devolviendo el resultado real del test aparte.
        comunidad_por_sku = comunidades_por_sku(datasets["pedidos"])
        afinidad_aplicada = bool(comunidad_por_sku)
        afinidad_motivo = (
            "Afinidad FORZADA manualmente para esta corrida -- se omitió el test de "
            "significancia de 200 réplicas. No es un hallazgo estadístico confirmado sobre "
            "el lote vigente, es una demostración de cómo cambiaría la propuesta si hubiera "
            "señal real (ver GET /afinidad para el resultado real del test)."
            if afinidad_aplicada
            else "Se pidió forzar afinidad, pero no hay ninguna co-ocurrencia SKU-SKU en el lote vigente."
        )
    elif not usar_afinidad:
        afinidad_motivo = "No se pidió usar afinidad en esta corrida (usar_afinidad=False)."
    else:
        test_afinidad = calcular_significancia_afinidad(datasets["pedidos"])
        if test_afinidad.usar_afinidad:
            comunidad_por_sku = comunidades_por_sku(datasets["pedidos"])
            afinidad_aplicada = True
            afinidad_motivo = (
                f"Modularidad observada ({test_afinidad.modularidad_observada:.3f}) supera "
                f"el percentil 95 del nulo ({test_afinidad.percentil_95_nulo:.3f})."
            )
        else:
            afinidad_motivo = (
                f"Se pidió usar afinidad, pero no hay señal suficiente: modularidad observada "
                f"({test_afinidad.modularidad_observada:.3f}) no supera el percentil 95 del nulo "
                f"({test_afinidad.percentil_95_nulo:.3f}). El slotting corrió igual que sin afinidad."
            )

    if comunidad_por_sku:
        # Se expone en la recomendación (COMUNIDAD_AFINIDAD) para que el
        # frontend pueda agrupar/resaltar en el mapa los SKU de una misma
        # comunidad -- puramente informativo, no lo usa el optimizador
        # (que ya recibió `comunidad_por_sku` directo, ver abajo).
        comunidad_col = base_con_score["SKU"].map(comunidad_por_sku)
        base_con_score["COMUNIDAD_AFINIDAD"] = comunidad_col.where(comunidad_col.notna(), None)

    resultado_opt = ejecutar_optimizador(
        base_con_score,
        layout_cd_optimizacion,
        capacidad,
        porcentaje_max_movimiento,
        zonas_no_destino=ZONAS_NO_DESTINO,
        penalizacion_movimiento=PENALIZACION_MOVIMIENTO,
        zona_unica_por_sku=reglas_atributo.zona_unica_por_sku,
        zonas_excluidas_por_sku=reglas_atributo.zonas_excluidas_por_sku,
        pares_familias_incompatibles=pares_incompatibles,
        comunidad_por_sku=comunidad_por_sku,
        peso_afinidad=_peso_afinidad_efectivo(afinidad_aplicada, peso_afinidad, forzar_afinidad),
        pesos=pesos,
    )
    recomendaciones = construir_recomendaciones(
        base_con_score, resultado_opt.zona_asignada, layout_cd_optimizacion, modo_objetivo, pesos
    )
    validar_factibilidad(recomendaciones, capacidad, resultado_opt.max_movimientos)
    n_pedidos = datasets["pedidos"]["PEDIDO_ID"].nunique()
    kpis = calcular_kpis(
        recomendaciones, resultado_opt.max_movimientos, n_pedidos, layout_cd_optimizacion, modo_objetivo
    )

    return ResultadoPipeline(
        recomendaciones=recomendaciones,
        kpis=kpis,
        camino_decision_reglas=reglas_atributo.camino_decision,
        ml=resultado_ml,
        afinidad_aplicada=afinidad_aplicada,
        afinidad_motivo=afinidad_motivo,
        modo_objetivo=modo_objetivo,
    )
