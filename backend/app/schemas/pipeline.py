from typing import Literal

from pydantic import BaseModel


class SolicitudPipeline(BaseModel):
    pesos_score: dict[str, float] | None = None
    porcentaje_max_movimiento: float | None = None
    # "layout_cd" (default) = TIEMPO_MINUTOS declarado en el Excel.
    # "svg" = tiempo calibrado por regresión contra la distancia real
    # medida en el layout escaneado (ver app/dominio/distancia_svg.py) --
    # el optimizador puede recomendar zonas distintas en cada modo.
    modo_distancia: Literal["layout_cd", "svg"] = "layout_cd"


class RecomendacionSKU(BaseModel):
    RANKING_SCORE: int
    SKU: str
    MARCA: str
    FAMILIA: str
    ABC: str
    ROTACION_6M: float
    N_PEDIDOS: float
    N_LINEAS: float
    CANT_TOTAL: float
    VOLUMEN_M3: float
    PESO_KG: float
    ZONA_ACTUAL: str
    ZONA_RECOMENDADA: str
    TIEMPO_LAYOUT_ACTUAL: float
    TIEMPO_NUEVO_MIN: float
    COSTO_ACTUAL_MIN: float
    COSTO_NUEVO_MIN: float
    AHORRO_ESTIMADO_MIN: float
    AHORRO_PORCENTAJE: float
    SCORE_PRIORIDAD: float
    MOVIMIENTO: str
    JUSTIFICACION: str
    CLUSTER_ML: int
    PERFIL_ML: str
    PRIORIDAD_CLUSTER_RANK: int
    INDICE_IMPACTO_CLUSTER: float

    model_config = {"populate_by_name": True}


class Kpis(BaseModel):
    sku_analizados: int
    sku_movidos: int
    porcentaje_sku_movidos: float
    max_movimientos_permitidos: int
    tiempo_actual_min: float
    tiempo_optimizado_min: float
    ahorro_min: float
    reduccion_porcentaje: float
    productividad_actual_lineas_hh: float
    productividad_optimizada_lineas_hh: float
    tiempo_promedio_actual_min_pedido: float
    tiempo_promedio_optimizado_min_pedido: float


class DecisionRegla(BaseModel):
    sku: str
    regla_id: str
    motivo: str


class MetricasML(BaseModel):
    mejor_k: int
    silhouette: float
    interpretacion_silhouette: str
    variables_usadas: list[str]
    # dict, no un modelo rígido: las columnas son las medias por variable
    # de `variables_usadas`, que varían según qué atributos tengan
    # variación en el lote -- es justo el "perfil de centroide en
    # variables reales" que pide la explicabilidad (no una lista fija).
    perfil_clusters: list[dict]


class RespuestaPipeline(BaseModel):
    recomendaciones: list[RecomendacionSKU]
    kpis: Kpis
    banderas_activas: dict[str, bool]
    camino_decision_reglas: list[DecisionRegla]
    ml: MetricasML
    # Espacio total declarado por zona (CAPACIDAD_M3_MAX de LAYOUT_CD,
    # clave = ZONA/clave_excel) -- para que el frontend calcule ocupación
    # por volumen (suma de VOLUMEN_M3 de los SKU en la zona / esto) sin
    # tener que exponer un endpoint nuevo. Ausente del dict = esa zona no
    # trajo capacidad declarada en el Excel de este lote.
    capacidad_zonas: dict[str, float]
