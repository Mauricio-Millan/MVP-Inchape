from fastapi.testclient import TestClient

from app.main import app


def test_get_zonas_devuelve_las_14_zonas_geometricas():
    with TestClient(app) as client:
        respuesta = client.get("/zonas")

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    # 14, no 13 -- "recibo" se separó de "recepcion" en una sesión anterior
    # (Ubicación Recibo y Recepción de aéreos son zonas reales distintas,
    # antes conflacionadas por un clave_excel mal asignado en zonas.json).
    assert len(cuerpo["zonas"]) == 14
    assert cuerpo["distancia_absoluta_confirmada"] is False

    ids = {z["id"] for z in cuerpo["zonas"]}
    assert "cluster" in ids
    assert "bulk" in ids

    zona_bulk = next(z for z in cuerpo["zonas"] if z["id"] == "bulk")
    assert zona_bulk["color"] == "#3B3A48"
    assert zona_bulk["texto_claro"] is True


def test_get_zonas_es_idempotente_no_duplica_en_cada_arranque():
    with TestClient(app) as client:
        client.get("/zonas")
        respuesta_2 = client.get("/zonas")

    assert len(respuesta_2.json()["zonas"]) == 14
