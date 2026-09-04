"""Configuración central del backend.

Ninguna ruta ni constante de negocio se hardcodea en los módulos de
dominio o en los routers -- todo pasa por aquí, siguiendo el principio
de "nunca hardcodear la escala del catálogo" de
`propuesta-mvp-dos-niveles-sintetico-vs-real.md` §4.3.
"""

import os
from pathlib import Path

# Raíz de MVP-Inchape/backend/
BASE_DIR = Path(__file__).resolve().parents[2]

DATA_DIR = BASE_DIR / "data"
# Override vía MVP_DB_PATH para pruebas -- nunca apuntar los tests a mvp.db real.
DB_PATH = Path(os.environ.get("MVP_DB_PATH", BASE_DIR / "mvp.db"))
CONFIG_MAPEO_DEFAULT_PATH = DATA_DIR / "config_mapeo.yaml"
ZONAS_JSON_PATH = DATA_DIR / "zonas.json"
# Distancia real (SVG, no metros) de cada zona de LAYOUT_CD a "Mesas de
# trabajo" -- generado por scripts/calcular_distancia_svg_zonas.py, ver
# app/dominio/distancia_svg.py.
DISTANCIA_SVG_JSON_PATH = DATA_DIR / "distancia_svg_por_zona.json"
# Variables de Modelo 2 (valor/rentabilidad) y Modelo 3 (nivel de
# servicio) por SKU -- generadas por scripts/extraer_variables_modelo.py
# desde las hojas VARIABLES_MODELO2/3 del Excel ampliado (ver MVP-Inchape/
# 2.md y 3.md para las fórmulas de peso que las consumen).
VARIABLES_MODELO2_JSON_PATH = DATA_DIR / "variables_modelo2.json"
VARIABLES_MODELO3_JSON_PATH = DATA_DIR / "variables_modelo3.json"

# CORS -- orígenes permitidos del frontend. Los de desarrollo local siempre
# están; en despliegue se agrega la URL real vía CORS_ORIGINS_EXTRA
# (coma-separada, ej. la URL de Azure Static Web Apps).
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    *[o.strip() for o in os.environ.get("CORS_ORIGINS_EXTRA", "").split(",") if o.strip()],
]

# Parámetros de negocio (no de infraestructura) -- ajustables sin tocar
# lógica de dominio; el optimizador y el ranking los leen de aquí.
PORCENTAJE_TOP_INICIAL = 0.20  # Fase 5.5 del notebook: 20% de SKU con mayor ahorro teórico
PORCENTAJE_MAX_MOVIMIENTO = 0.20  # Fase 10.7 del notebook: tope de SKU movidos por el optimizador
PENALIZACION_MOVIMIENTO = 0.0  # min. adicionales por mover un SKU -- 0 hasta que exista costo real validado
# Min. equivalentes por cada zona EXTRA en que queda repartida una
# comunidad de afinidad (Bloque E, dominio/afinidad.py) -- 0 hasta que
# exista un lote con señal real para calibrarlo. Solo se usa si el
# caller pide usar_afinidad=True Y el test de significancia de 200
# réplicas lo confirma (README.md §5.2) -- en el dataset de práctica
# usar_afinidad=False, así que este peso no cambia nada todavía aunque
# se active la bandera.
PESO_AFINIDAD = 0.0
# Peso usado SOLO cuando el caller pide `forzar_afinidad=True` (bypass del
# test de significancia, para demostrar en vivo cómo cambiaría la
# propuesta si hubiera señal -- ver pipeline.py). Valor elegido de forma
# empírica para que el efecto sea visible en el dataset de práctica (100
# SKU, comunidades chicas), no calibrado contra costo real -- a
# diferencia de PESO_AFINIDAD, que sigue en 0.0 hasta tener esa
# calibración real.
PESO_AFINIDAD_FORZADO = 60.0
ZONAS_NO_DESTINO: list[str] = (
    []
)  # zonas bloqueadas como destino nuevo (Fase 10.8) -- editable por Operaciones

# Fase 7.3 del notebook -- pesos del score ponderado. "Deben validarse
# posteriormente con Operaciones" (nota original del notebook, se mantiene).
PESOS_SCORE = {
    "ahorro": 0.55,
    "rotacion": 0.20,
    "abc": 0.10,
    "facilidad_movimiento": 0.15,
}
MAPA_ABC_SCORE = {"A": 1.00, "B": 0.60, "C": 0.30}

# Personal necesario -- jornada estándar para expresar el ahorro de
# tiempo como % de una jornada de picker, no como "personas" fraccionarias
# (el lote de práctica da <1 FTE, "0.62 personas" como titular sería
# ridículo -- ver dominio/kpis.py::calcular_personal_necesario).
# 8h × 22 días hábiles/mes.
JORNADA_MIN_POR_PERSONA_MES = 8 * 60 * 22  # 10560 min/persona-mes

# Metas declaradas en la hoja RESUMEN del Excel de práctica -- referencia
# fija para mostrar al lado de la línea base CALCULADA por el pipeline
# (que no coincide: ~15.02 min/pedido calculado vs. 12.64 declarado aquí).
# Ojo: las dos metas del Excel son mutuamente inconsistentes entre sí
# (-25% en tiempo implicaría +33% en productividad, no el +15% que
# declara), y el Excel mide SKU/HH mientras el pipeline mide líneas/HH --
# no es la misma unidad. Se muestran como referencia rotulada, nunca se
# fuerza el cálculo del pipeline para reproducirlas.
META_EXCEL_TIEMPO_ACTUAL_MIN_PEDIDO = 12.64
META_EXCEL_TIEMPO_OBJETIVO_MIN_PEDIDO = 9.48
META_EXCEL_PRODUCTIVIDAD_ACTUAL_SKU_HH = 11.64
META_EXCEL_PRODUCTIVIDAD_OBJETIVO_SKU_HH = 13.39
