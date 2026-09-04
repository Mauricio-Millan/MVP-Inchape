from typing import Literal

from pydantic import BaseModel

# "velocidad" (default, Modelo 1) = peso N_LINEAS, minimiza tiempo de
# picking. "valor" (Modelo 2) / "servicio" (Modelo 3) = peso por
# valor/rentabilidad o por criticidad de servicio (ver
# app/dominio/objetivo.py y MVP-Inchape/1.md, 2.md, 3.md) -- mismo
# optimizador y mismas restricciones duras en los tres, solo cambia el
# peso por SKU. Nunca se combina con modo_distancia="svg" (fuera de
# alcance para Modelo 2/3, ver 1.md nota inicial).
ModoObjetivo = Literal["velocidad", "valor", "servicio"]


class SolicitudPipeline(BaseModel):
    pesos_score: dict[str, float] | None = None
    porcentaje_max_movimiento: float | None = None
    # "layout_cd" (default) = TIEMPO_MINUTOS declarado en el Excel.
    # "svg" = tiempo calibrado por regresión contra la distancia real
    # medida en el layout escaneado (ver app/dominio/distancia_svg.py) --
    # el optimizador puede recomendar zonas distintas en cada modo.
    modo_distancia: Literal["layout_cd", "svg"] = "layout_cd"
    modo_objetivo: ModoObjetivo = "velocidad"
    # Nunca por defecto -- paga ~15s (test de significancia de 200
    # réplicas, dominio/afinidad.py) y solo tiene efecto real si ese
    # test confirma señal sobre el lote vigente (ver RespuestaPipeline
    # .afinidad_aplicada/.afinidad_motivo). None = usa PESO_AFINIDAD de
    # core/config.py (0.0 hasta que exista un lote con señal real).
    usar_afinidad: bool = False
    peso_afinidad: float | None = None
    # Salta el test de significancia y aplica las comunidades de Louvain
    # igual, sin importar si hay señal real -- SOLO para demostrar en vivo
    # el mecanismo (ver dominio/pipeline.py). `afinidad_motivo` en la
    # respuesta siempre deja explícito que fue forzado, nunca lo presenta
    # como un hallazgo confirmado.
    forzar_afinidad: bool = False


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
    # Comunidad de Louvain (SKU que suelen pedirse juntos, dominio/afinidad.py)
    # -- presente solo si esta corrida usó afinidad (real o forzada, ver
    # `SolicitudPipeline.forzar_afinidad`). None = SKU sin co-ocurrencia con
    # otro, o afinidad no usada en esta corrida.
    COMUNIDAD_AFINIDAD: int | None = None
    # Peso efectivo que usó el optimizador para este SKU en la corrida
    # activa (N_LINEAS si modo_objetivo="velocidad", ya reescalado a esa
    # misma masa si es "valor"/"servicio" -- ver dominio/objetivo.py).
    # Sirve para ordenar/mostrar prioridad en el modelo que sea.
    PESO_MODELO: float | None = None
    # Insumos de Modelo 2 (VARIABLES_MODELO2) -- presentes solo si
    # modo_objetivo="valor" en esta corrida.
    VALOR_INVENTARIO_M2: float | None = None
    MARGEN_PORCENTAJE_M2: float | None = None
    RIESGO_OBSOLESCENCIA_M2: str | None = None
    # Insumos de Modelo 3 (VARIABLES_MODELO3) -- presentes solo si
    # modo_objetivo="servicio" en esta corrida.
    CRITICIDAD_M3: str | None = None
    VARIABILIDAD_DEMANDA_M3: float | None = None

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
    # Personal necesario -- horas-hombre (dato directo, sin supuestos) +
    # equivalente en pedidos atendibles con la misma dotación (el
    # titular presentable) + FTE con el supuesto de jornada explícito.
    # Ver dominio/kpis.py::calcular_personal_necesario.
    horas_hombre_actual: float
    horas_hombre_optimizado: float
    pedidos_atendibles_con_misma_dotacion: float
    fte_actual: float
    fte_optimizado: float
    # dict libre, no un modelo rígido por modelo (mismo criterio que
    # MetricasML.perfil_clusters) -- las claves varían según
    # modo_objetivo: valor -> {"valor_en_zona_rapida_%": ..., ...},
    # servicio -> {"cobertura_critica_%": ..., "peor_caso_critico_min": ...}.
    # None si modo_objetivo="velocidad" (no tiene KPI propio, ya está
    # cubierto por los de arriba).
    kpis_modelo: dict[str, float] | None = None


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
    # Eco de qué modelo produjo esta respuesta -- fuente de verdad para
    # el rótulo en el frontend, nunca el estado de React (que puede
    # cambiar a destiempo mientras una corrida anterior todavía está en
    # vuelo).
    modo_objetivo: ModoObjetivo
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
    # Si la afinidad de pedidos (Bloque E) realmente influyó en
    # ZONA_RECOMENDADA de esta corrida, y por qué sí o por qué no --
    # siempre presente, aunque `usar_afinidad` no se haya pedido (en ese
    # caso `afinidad_aplicada=False` con motivo "no se pidió").
    afinidad_aplicada: bool
    afinidad_motivo: str
