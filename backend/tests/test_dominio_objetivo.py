"""Pruebas de dominio/objetivo.py -- peso por SKU de los 3 modelos de
slotting, contra el dataset de práctica ya persistido en SQLite.
"""

import numpy as np
import pandas as pd
import pytest

from app.core.config import VARIABLES_MODELO2_JSON_PATH, VARIABLES_MODELO3_JSON_PATH
from app.core.db import engine
from app.dominio.impacto import construir_base_maestra
from app.dominio.indicadores import construir_pedidos_por_sku
from app.dominio.objetivo import (
    VariablesModeloNoDisponiblesError,
    cargar_variables_modelo,
    peso_por_sku,
    peso_servicio_crudo,
    peso_valor_crudo,
)
from app.ingesta.mapeo import cargar_config_mapeo
from app.ingesta.servicio import procesar_workbook


@pytest.fixture(scope="module")
def base_maestra(excel_practica_bytes):
    procesar_workbook(excel_practica_bytes, cargar_config_mapeo())
    with engine.connect() as conn:
        sku_maestro = pd.read_sql("SELECT * FROM sku_maestro", conn)
        rotacion = pd.read_sql("SELECT * FROM rotacion", conn)
        stock_actual = pd.read_sql("SELECT * FROM stock_actual", conn)
        layout_cd = pd.read_sql("SELECT * FROM layout_cd", conn)
        pedidos = pd.read_sql("SELECT * FROM pedidos", conn)
    pedidos_por_sku = construir_pedidos_por_sku(pedidos)
    return construir_base_maestra(sku_maestro, rotacion, stock_actual, pedidos_por_sku, layout_cd)


@pytest.fixture(scope="module")
def variables_m2():
    return cargar_variables_modelo(VARIABLES_MODELO2_JSON_PATH)


@pytest.fixture(scope="module")
def variables_m3():
    return cargar_variables_modelo(VARIABLES_MODELO3_JSON_PATH)


def test_peso_velocidad_es_n_lineas_sin_tocar(base_maestra):
    pesos = peso_por_sku(base_maestra, "velocidad")

    assert len(pesos) == 100
    assert sum(pesos.values()) == pytest.approx(1500.0)
    assert min(pesos.values()) == pytest.approx(6.0)
    assert max(pesos.values()) == pytest.approx(27.0)


def test_peso_valor_crudo_reproduce_la_escala_verificada(base_maestra, variables_m2):
    crudo = peso_valor_crudo(base_maestra, variables_m2)

    assert crudo.sum() == pytest.approx(37.2166, abs=1e-3)
    assert crudo.min() > 0


def test_peso_valor_reescala_a_la_masa_de_modelo_1(base_maestra, variables_m2):
    pesos = peso_por_sku(base_maestra, "valor", variables_m2)

    assert len(pesos) == 100
    assert sum(pesos.values()) == pytest.approx(1500.0)


def test_peso_servicio_crudo_reproduce_la_escala_verificada(base_maestra, variables_m3):
    crudo = peso_servicio_crudo(base_maestra, variables_m3)

    assert crudo.sum() == pytest.approx(59.6762, abs=1e-3)


def test_criticidad_suma_62_exacto(base_maestra, variables_m3):
    # 17 Crítico·1.00 + 40 Alto·0.75 + 17 Medio·0.50 + 26 Bajo·0.25 = 62.0
    from app.dominio.objetivo import CRITICIDAD_NUM_M3

    criticidades = pd.Series({sku: v["CRITICIDAD_M3"] for sku, v in variables_m3.items()})
    suma = criticidades.map(CRITICIDAD_NUM_M3).sum()
    assert suma == pytest.approx(62.0)


def test_peso_servicio_reescala_a_la_masa_de_modelo_1(base_maestra, variables_m3):
    pesos = peso_por_sku(base_maestra, "servicio", variables_m3)

    assert len(pesos) == 100
    assert sum(pesos.values()) == pytest.approx(1500.0)


@pytest.mark.parametrize("modo, fixture_variables", [("valor", "variables_m2"), ("servicio", "variables_m3")])
def test_reescalar_no_cambia_el_orden(base_maestra, modo, fixture_variables, request):
    """Multiplicar todo el vector por una constante no debe alterar el
    ranking de prioridad entre SKU -- la afirmación literal de 1.md §12."""
    variables = request.getfixturevalue(fixture_variables)
    crudo_fn = peso_valor_crudo if modo == "valor" else peso_servicio_crudo
    crudo = crudo_fn(base_maestra, variables)
    reescalado = pd.Series(peso_por_sku(base_maestra, modo, variables))

    orden_crudo = np.argsort(crudo.to_numpy())
    orden_reescalado = np.argsort(reescalado.reindex(crudo.index).to_numpy())
    assert np.array_equal(orden_crudo, orden_reescalado)


def test_sku_ausente_en_el_json_aborta(base_maestra, variables_m2):
    incompleto = dict(variables_m2)
    sku_quitado = next(iter(incompleto))
    del incompleto[sku_quitado]

    with pytest.raises(VariablesModeloNoDisponiblesError, match=sku_quitado):
        peso_por_sku(base_maestra, "valor", incompleto)


def test_modo_objetivo_invalido_lanza_value_error(base_maestra):
    with pytest.raises(ValueError, match="modo_objetivo desconocido"):
        peso_por_sku(base_maestra, "no_existe")


def test_cargar_variables_modelo_tolera_archivo_ausente(tmp_path):
    assert cargar_variables_modelo(tmp_path / "no_existe.json") == {}
