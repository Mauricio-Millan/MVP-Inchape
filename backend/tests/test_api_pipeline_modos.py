"""Pruebas de integración de los 3 modos de slotting (`modo_objetivo`)
vía `POST /pipeline/ejecutar`, contra el dataset de práctica real.

Los valores esperados (20 movimientos exactos, ~6535.30 min de línea
base) están verificados empíricamente contra este dataset -- ver
`MVP-Inchape/1.md`/`2.md`/`3.md` para el detalle y por qué la capacidad
no ata (solo el tope de movimientos lo hace).
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app


def _ejecutar(client: TestClient, excel_practica_bytes: bytes, **body) -> dict:
    client.post(
        "/ingesta",
        files=[("archivos", ("dataset.xlsx", excel_practica_bytes, "application/octet-stream"))],
    )
    respuesta = client.post("/pipeline/ejecutar", json=body or None)
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


def test_los_tres_modos_respetan_el_tope_de_movimientos(excel_practica_bytes):
    with TestClient(app) as client:
        for modo in ("velocidad", "valor", "servicio"):
            cuerpo = _ejecutar(client, excel_practica_bytes, modo_objetivo=modo)
            assert len(cuerpo["recomendaciones"]) == 100
            assert cuerpo["kpis"]["max_movimientos_permitidos"] == 20
            # El tope ata en los 3 -- la capacidad no ata (26 m³ de
            # muestra vs. 180-500 m³ por zona), así que el óptimo siempre
            # usa el cupo completo de movimientos disponible.
            assert cuerpo["kpis"]["sku_movidos"] == 20
            assert cuerpo["modo_objetivo"] == modo


def test_velocidad_es_identico_al_default(excel_practica_bytes):
    """Regresión: agregar modo_objetivo no debe cambiar ni un bit el
    comportamiento de Modelo 1 cuando no se pide otra cosa."""
    with TestClient(app) as client:
        sin_body = _ejecutar(client, excel_practica_bytes)
        con_velocidad = _ejecutar(client, excel_practica_bytes, modo_objetivo="velocidad")

    assert sin_body["kpis"]["tiempo_optimizado_min"] == con_velocidad["kpis"]["tiempo_optimizado_min"]
    zonas_sin_body = {r["SKU"]: r["ZONA_RECOMENDADA"] for r in sin_body["recomendaciones"]}
    zonas_con_velocidad = {r["SKU"]: r["ZONA_RECOMENDADA"] for r in con_velocidad["recomendaciones"]}
    assert zonas_sin_body == zonas_con_velocidad


def test_la_linea_base_no_cambia_con_el_modo(excel_practica_bytes):
    """Protege la regla de diseño de 2.md/3.md §7: los KPI en minutos
    (tiempo actual, línea base) se calculan SIEMPRE con N_LINEAS, sin
    importar qué criterio decidió la propuesta."""
    with TestClient(app) as client:
        resultados = {
            modo: _ejecutar(client, excel_practica_bytes, modo_objetivo=modo)
            for modo in ("velocidad", "valor", "servicio")
        }

    tiempos_actuales = {modo: r["kpis"]["tiempo_actual_min"] for modo, r in resultados.items()}
    assert tiempos_actuales["velocidad"] == pytest.approx(6535.30, abs=0.5)
    assert tiempos_actuales["valor"] == pytest.approx(tiempos_actuales["velocidad"])
    assert tiempos_actuales["servicio"] == pytest.approx(tiempos_actuales["velocidad"])


def test_cada_modelo_gana_en_su_propia_metrica(excel_practica_bytes):
    """No se assertan SKU exactos -- con PENALIZACION_MOVIMIENTO=0.0 hay
    óptimos empatados y CBC puede desempatar distinto entre corridas.
    Se asserta el ORDEN entre modelos, que es la afirmación que sostiene
    la comparación completa."""
    with TestClient(app) as client:
        resultados = {
            modo: _ejecutar(client, excel_practica_bytes, modo_objetivo=modo)
            for modo in ("velocidad", "valor", "servicio")
        }

    reduccion = {modo: r["kpis"]["reduccion_porcentaje"] for modo, r in resultados.items()}
    # Modelo 1 optimiza minutos directamente -- nadie más puede ganarle en eso.
    assert reduccion["velocidad"] > reduccion["valor"]
    assert reduccion["velocidad"] > reduccion["servicio"]

    kpi_valor = resultados["valor"]["kpis"]["kpis_modelo"]
    kpi_velocidad_en_valor = resultados["velocidad"]["kpis"]["kpis_modelo"]
    assert kpi_velocidad_en_valor is None  # "velocidad" no tiene KPI propio
    assert kpi_valor is not None
    assert kpi_valor["valor_en_zona_rapida_pct"] > 0

    kpi_servicio = resultados["servicio"]["kpis"]["kpis_modelo"]
    assert kpi_servicio is not None
    assert kpi_servicio["cobertura_critica_pct"] > 0
    assert kpi_servicio["peor_caso_critico_min"] > 0


def test_los_tres_modelos_mueven_conjuntos_distintos(excel_practica_bytes):
    with TestClient(app) as client:
        resultados = {
            modo: _ejecutar(client, excel_practica_bytes, modo_objetivo=modo)
            for modo in ("velocidad", "valor", "servicio")
        }

    def movidos(cuerpo):
        return {r["SKU"] for r in cuerpo["recomendaciones"] if r["MOVIMIENTO"] == "MOVER"}

    movidos_velocidad = movidos(resultados["velocidad"])
    movidos_valor = movidos(resultados["valor"])
    movidos_servicio = movidos(resultados["servicio"])

    assert len(movidos_velocidad) == len(movidos_valor) == len(movidos_servicio) == 20
    assert movidos_velocidad != movidos_valor
    assert movidos_velocidad != movidos_servicio
    # Comparten algunos (mismo factor N_LINEAS x tiempo de zona subyacente
    # en los tres, ver 1.md hallazgo de capacidad holgada), pero no todos.
    assert len(movidos_velocidad & movidos_valor) < 20


def test_modo_objetivo_invalido_es_422(excel_practica_bytes):
    with TestClient(app) as client:
        client.post(
            "/ingesta",
            files=[("archivos", ("dataset.xlsx", excel_practica_bytes, "application/octet-stream"))],
        )
        respuesta = client.post("/pipeline/ejecutar", json={"modo_objetivo": "no_existe"})

    assert respuesta.status_code == 422, respuesta.text


def test_detalle_sku_respeta_modo_objetivo(excel_practica_bytes):
    """El drawer de explicabilidad debe mostrar la zona del modelo activo,
    no siempre Modelo 1 -- ver el bug que esto corrige en pipeline.py."""
    with TestClient(app) as client:
        client.post(
            "/ingesta",
            files=[("archivos", ("dataset.xlsx", excel_practica_bytes, "application/octet-stream"))],
        )
        tabla_valor = client.post("/pipeline/ejecutar", json={"modo_objetivo": "valor"}).json()
        sku = tabla_valor["recomendaciones"][0]["SKU"]
        zona_en_tabla = tabla_valor["recomendaciones"][0]["ZONA_RECOMENDADA"]

        detalle = client.get(f"/recomendaciones/{sku}", params={"modo_objetivo": "valor"})

    assert detalle.status_code == 200, detalle.text
    assert detalle.json()["recomendacion"]["ZONA_RECOMENDADA"] == zona_en_tabla
