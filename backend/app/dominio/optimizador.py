"""Fases 10 y 11 del notebook original -- Configuración y ejecución del
optimizador de asignación factible.

Puerto directo de `MVP_Reslotting_Inchcape.ipynb` (celdas 80-96). Variable
binaria x(sku, zona) = 1 si el SKU se asigna a esa zona. Minimiza
Σ peso(SKU) × TIEMPO_MINUTOS(zona) + penalización de movimiento +
(opcional) penalización de afinidad dispersa, sujeto a:

  `pesos` decide QUÉ modelo de slotting es esta corrida (velocidad, valor
  o servicio, ver `dominio/objetivo.py` y `MVP-Inchape/1.md`/`2.md`/
  `3.md`) -- por defecto (`pesos=None`) es `N_LINEAS`, igual que siempre.
  Las restricciones de abajo son IDÉNTICAS sin importar qué peso se use.

  - una zona por SKU,
  - capacidad de cada zona (ocupación base no modelada + volumen asignado),
  - tope de SKU movidos (`porcentaje_max_movimiento`),
  - zonas bloqueadas como destino nuevo (`zonas_no_destino`),
  - reglas duras del motor de reglas (`zona_unica_por_sku`,
    `zonas_excluidas_por_sku`, `pares_familias_incompatibles`) --
    ninguna regla de seguridad es negociable por un buen score, así que
    se aplican como variables fijadas, no como término del objetivo.

La afinidad (`comunidad_por_sku`/`peso_afinidad`, Bloque E,
`dominio/afinidad.py`) es la única pieza de este archivo que SÍ entra
como término del objetivo, nunca como restricción dura -- a diferencia
de las reglas de negocio, es una preferencia estadística, no una regla
de seguridad, así que solo puede hacerle "más barata" al solver una
asignación, jamás prohibirla o forzarla.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

import pandas as pd
import pulp


class OptimizadorInfactibleError(RuntimeError):
    """El solver no encontró una solución óptima -- revisar capacidades
    y restricciones antes de confiar en el resultado."""


@dataclass
class ResultadoOptimizador:
    estado: str
    valor_objetivo: float
    zona_asignada: dict[str, str]  # SKU -> ZONA (nueva asignación óptima)
    max_movimientos: int


def ejecutar_optimizador(
    base_maestra: pd.DataFrame,
    layout_cd: pd.DataFrame,
    capacidad: pd.DataFrame,
    porcentaje_max_movimiento: float,
    zonas_no_destino: list[str] | None = None,
    penalizacion_movimiento: float = 0.0,
    zona_unica_por_sku: dict[str, str] | None = None,
    zonas_excluidas_por_sku: dict[str, set[str]] | None = None,
    pares_familias_incompatibles: list[tuple[str, str]] | None = None,
    comunidad_por_sku: dict[str, int] | None = None,
    peso_afinidad: float = 0.0,
    pesos: dict[str, float] | None = None,
) -> ResultadoOptimizador:
    zonas_no_destino = zonas_no_destino or []
    zona_unica_por_sku = zona_unica_por_sku or {}
    zonas_excluidas_por_sku = zonas_excluidas_por_sku or {}
    pares_familias_incompatibles = pares_familias_incompatibles or []
    comunidad_por_sku = comunidad_por_sku or {}

    lista_skus = base_maestra["SKU"].tolist()
    lista_zonas = layout_cd["ZONA"].tolist()

    volumen_sku = base_maestra.set_index("SKU")["VOLUMEN_M3"].to_dict()
    # `pesos` = peso por SKU que multiplica TIEMPO_MINUTOS abajo -- Modelo
    # 1 (velocidad) usa N_LINEAS por defecto (dominio/objetivo.py con
    # modo="velocidad" hace exactamente esto); Modelo 2/3 pasan su propio
    # peso ya reescalado a la misma masa total (ver 1.md §12).
    pesos = pesos if pesos is not None else base_maestra.set_index("SKU")["N_LINEAS"].to_dict()
    zona_actual_sku = base_maestra.set_index("SKU")["ZONA_ACTUAL"].to_dict()
    tiempo_zona = layout_cd.set_index("ZONA")["TIEMPO_MINUTOS"].to_dict()
    capacidad_max = capacidad.set_index("ZONA")["CAPACIDAD_MAX_M3"].to_dict()
    ocupacion_no_modelada = capacidad.set_index("ZONA")["VOLUMEN_BASE_NO_MODELADO"].to_dict()

    max_movimientos = max(1, round(len(base_maestra) * porcentaje_max_movimiento))

    modelo = pulp.LpProblem("Optimizacion_Reslotting_CD_Aldeas", pulp.LpMinimize)
    x = pulp.LpVariable.dicts("Asignacion", (lista_skus, lista_zonas), lowBound=0, upBound=1, cat="Binary")

    costo_picking = pulp.lpSum(
        pesos[sku] * tiempo_zona[zona] * x[sku][zona] for sku in lista_skus for zona in lista_zonas
    )
    costo_movimientos = pulp.lpSum(
        penalizacion_movimiento * x[sku][zona]
        for sku in lista_skus
        for zona in lista_zonas
        if zona != zona_actual_sku[sku]
    )

    # Afinidad: premia concentrar en pocas zonas a los SKU que Louvain
    # agrupó como "suelen pedirse juntos" (ver dominio/afinidad.py) --
    # p[comunidad][zona] = 1 si algún SKU de esa comunidad cae en esa
    # zona (mismo patrón que y[familia][zona] de incompatibilidad, pero
    # el objetivo es minimizar EN CUÁNTAS zonas distintas queda repartida
    # cada comunidad, no prohibir que compartan). Solo se arma si hay
    # comunidades reales (2+ SKU) y un peso configurado -- si
    # `peso_afinidad` es 0 (default, ver core/config.py::PESO_AFINIDAD)
    # no se crean variables de más para un término que de todos modos
    # contribuiría 0 al objetivo.
    costo_afinidad = 0
    if comunidad_por_sku and peso_afinidad:
        conteo_comunidad = Counter(comunidad_por_sku[sku] for sku in lista_skus if sku in comunidad_por_sku)
        comunidades_multi = {com for com, n in conteo_comunidad.items() if n > 1}
        if comunidades_multi:
            p = pulp.LpVariable.dicts(
                "ComunidadEnZona", (list(comunidades_multi), lista_zonas), lowBound=0, upBound=1, cat="Binary"
            )
            for sku in lista_skus:
                com = comunidad_por_sku.get(sku)
                if com not in comunidades_multi:
                    continue
                for zona in lista_zonas:
                    modelo += x[sku][zona] <= p[com][zona]
            costo_afinidad = peso_afinidad * pulp.lpSum(
                p[com][zona] for com in comunidades_multi for zona in lista_zonas
            )

    modelo += costo_picking + costo_movimientos + costo_afinidad

    # Una zona por SKU
    for sku in lista_skus:
        modelo += pulp.lpSum(x[sku][zona] for zona in lista_zonas) == 1

    # Capacidad por zona
    for zona in lista_zonas:
        modelo += (
            ocupacion_no_modelada.get(zona, 0)
            + pulp.lpSum(volumen_sku[sku] * x[sku][zona] for sku in lista_skus)
            <= capacidad_max[zona]
        )

    # Tope de movimientos
    modelo += (
        pulp.lpSum(x[sku][zona] for sku in lista_skus for zona in lista_zonas if zona != zona_actual_sku[sku])
        <= max_movimientos
    )

    # Zonas bloqueadas como destino nuevo (un SKU ya presente puede quedarse)
    for zona in zonas_no_destino:
        if zona not in lista_zonas:
            continue
        for sku in lista_skus:
            if zona_actual_sku[sku] != zona:
                modelo += x[sku][zona] == 0

    # Regla de atributo: zona única forzada por una condición del SKU
    for sku, zona in zona_unica_por_sku.items():
        if sku in lista_skus and zona in lista_zonas:
            modelo += x[sku][zona] == 1

    # Regla de atributo: zona explícitamente prohibida para el SKU
    for sku, zonas_prohibidas in zonas_excluidas_por_sku.items():
        for zona in zonas_prohibidas & set(lista_zonas):
            if sku in lista_skus:
                modelo += x[sku][zona] == 0

    # Regla de incompatibilidad: dos familias no pueden compartir zona.
    # y[familia][zona] = 1 si algún SKU de esa familia queda en esa zona;
    # se fuerza vía x[sku][zona] <= y[familia][zona], y luego se prohíbe
    # que dos familias incompatibles tengan ambas y=1 en la misma zona.
    if pares_familias_incompatibles:
        familia_sku = base_maestra.set_index("SKU")["FAMILIA"].to_dict()
        familias_en_conflicto = {f for par in pares_familias_incompatibles for f in par}
        y = pulp.LpVariable.dicts(
            "FamiliaEnZona", (list(familias_en_conflicto), lista_zonas), lowBound=0, upBound=1, cat="Binary"
        )
        for sku in lista_skus:
            familia = familia_sku.get(sku)
            if familia not in familias_en_conflicto:
                continue
            for zona in lista_zonas:
                modelo += x[sku][zona] <= y[familia][zona]

        for familia_a, familia_b in pares_familias_incompatibles:
            for zona in lista_zonas:
                modelo += y[familia_a][zona] + y[familia_b][zona] <= 1

    solver = pulp.PULP_CBC_CMD(msg=False)
    modelo.solve(solver)
    estado = pulp.LpStatus[modelo.status]

    if estado != "Optimal":
        raise OptimizadorInfactibleError(
            f"El optimizador no encontró una solución óptima (estado: {estado}). "
            "Revisar capacidades y restricciones."
        )

    zona_asignada = {sku: zona for sku in lista_skus for zona in lista_zonas if x[sku][zona].value() == 1}

    return ResultadoOptimizador(
        estado=estado,
        valor_objetivo=pulp.value(modelo.objective),
        zona_asignada=zona_asignada,
        max_movimientos=max_movimientos,
    )
