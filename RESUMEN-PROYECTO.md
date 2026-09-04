# Resumen del proyecto — Sombra Digital / Reslotting CD Aldeas

> Documento generado para dar contexto completo a una nueva conversación. Escrito en 2026-09-02, sobre el estado real del código en ese momento (verificado archivo por archivo, no de memoria). Complementa a `PROCESO-DE-SLOTTING.md` (el detalle de cómo se calcula y decide el slotting) — este archivo es la vista de "todo el proyecto".

## 1. Qué es

MVP académico (IMPULSA UTP) de **re-slotting** (reasignación de ubicaciones de almacén) para un Centro de Distribución real ("CD Aldeas", Villa El Salvador, Perú). Parte de un notebook de análisis (`MVP_Reslotting_Inchcape.ipynb`, de "Valentino") portado a una arquitectura web de dos capas: un backend que corre el pipeline de análisis/optimización sobre datos reales del cliente, y un frontend que lo hace navegable, editable y explicable para una persona de Operaciones.

**Principio rector, citado en casi todos los módulos:** nunca fingir progreso ni datos. Si algo no tiene evidencia suficiente (estadística o de datos disponibles), se declara inactivo explícitamente (ver `core/flags.py`) en vez de simularlo. Ninguna recomendación se escribe automáticamente a un sistema de producción — siempre la aplica una persona.

## 2. Stack tecnológico

**Backend:** Python 3.11, FastAPI 0.115 + Pydantic 2, SQLAlchemy Core (no ORM) sobre SQLite (`mvp.db`), PuLP 2.x + solver CBC (optimización), scikit-learn 1.6 (KMeans), NetworkX 3 + python-louvain 0.16 + mlxtend 0.23 (afinidad), pandas/numpy/scipy. Entorno conda `IngenieriaPython` (`environment.yml` en la raíz). Lint/formato: ruff + black. Tests: pytest.

**Frontend:** React 19 + TypeScript + Vite 8. Sin router (una sola vista activa por estado, `App.tsx`). D3 (`d3-selection`, `d3-zoom`, `d3-transition` — paquetes modulares, no el meta-paquete `d3`) para el mapa interactivo de Dashboard v2. `xlsx` (SheetJS) para preview de Excel en el navegador. Lint: oxlint.

**Ejecución:**
```
# Backend (desde MVP-Inchape/backend, entorno conda IngenieriaPython activo)
python -m uvicorn app.main:app --reload --port 8000

# Frontend (desde MVP-Inchape/frontend)
npm run dev   # sirve en :5173 (único origen permitido por CORS)
```
CORS solo permite `localhost:5173`/`127.0.0.1:5173` por defecto; en despliegue se agregan orígenes extra vía la env var `CORS_ORIGINS_EXTRA` (coma-separada).

## 3. Estructura del repositorio

```
MVP-Inchape/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI app, registra routers, lifespan (init_db + seed_zonas)
│   │   ├── core/
│   │   │   ├── config.py           # TODAS las constantes de negocio (pesos, topes, penalizaciones)
│   │   │   ├── db.py               # Esquema SQLAlchemy Core completo (todas las tablas, Nivel 1 y 2)
│   │   │   └── flags.py            # Banderas de activación por módulo (Nivel 1 → Nivel 2)
│   │   ├── api/routers/            # 7 routers: ingesta, zonas, pipeline, reglas, ergonomia, recomendaciones, afinidad
│   │   ├── schemas/                # Pydantic: contratos request/response, 1:1 con lo que consume el frontend
│   │   ├── ingesta/                # mapeo.py (YAML configurable), validacion.py, servicio.py
│   │   ├── dominio/                # el "cerebro" -- funciones puras sobre DataFrames, sin HTTP ni SQL
│   │   │   ├── pipeline.py         # orquestador: encadena todas las fases, no calcula nada él mismo
│   │   │   ├── indicadores.py      # Fase 3: agrega pedidos a nivel SKU
│   │   │   ├── impacto.py          # Fase 4-6: Base Maestra, carga operativa, ahorro teórico
│   │   │   ├── scoring.py          # Fase 7: SCORE_PRIORIDAD (ranking/UI, NO decide zona)
│   │   │   ├── matriz_sku_zona.py  # Fase 8: producto cartesiano SKU×Zona -- NO conectado al pipeline
│   │   │   ├── capacidad.py        # Fase 9: capacidad máxima y ocupación base por zona
│   │   │   ├── optimizador.py      # Fase 10-11: EL MOTOR -- programación lineal entera (PuLP/CBC)
│   │   │   ├── recomendaciones.py  # Fase 12,14: ZONA_RECOMENDADA final + JUSTIFICACION + validación
│   │   │   ├── kpis.py             # Fase 13: KPIs agregados
│   │   │   ├── ml_perfil.py        # Fase 18-23: KMeans -- explicabilidad, NO decide zona
│   │   │   ├── ergonomia.py        # Banda de oro NIOSH -- standalone, no en el pipeline principal
│   │   │   ├── afinidad.py         # Bloque E: co-ocurrencia SKU-SKU, Louvain, test de significancia
│   │   │   ├── distancia_svg.py    # Modo alternativo de TIEMPO_MINUTOS calibrado por distancia real SVG
│   │   │   └── reglas/             # evaluador.py, modelos.py (Pydantic), repositorio.py (CRUD SQLite)
│   │   └── (tests/ está en backend/tests/, no en app/)
│   ├── data/                       # config_mapeo.yaml, zonas.json (geometría estática 14 zonas), distancia_svg_por_zona.json
│   ├── tests/                      # pytest -- ver §9
│   ├── mvp.db                      # SQLite -- se recrea con POST /ingesta
│   └── environment.yml / pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── App.tsx                 # shell con sidebar, 6 secciones (ver §6)
│   │   ├── context/PipelineContext.tsx  # único estado global: resultado del último POST /pipeline/ejecutar
│   │   ├── api/                    # un archivo por router del backend, tipado 1:1
│   │   ├── views/                  # una vista por sección del sidebar
│   │   ├── components/mapas/       # geometría real del almacén (SVG escaneado) + Dashboard v2 (D3)
│   │   ├── components/plano/       # plano esquemático de referencia (PlanoSVG, técnica/densidad/distancia)
│   │   ├── components/ui/          # Badge, EstadoPipeline, PipelineChecklist, TarjetaKpi
│   │   └── lib/colorCalor.ts       # escala de color compartida verde→amarillo→rojo (toda la app)
│   └── package.json
├── scripts/
│   ├── extraer_layout_svg.py       # extrae geometría real de zonas desde el SVG escaneado del almacén
│   ├── limpiar_layout_svg.py       # quita imagen de fondo embebida de un SVG (reduce tamaño)
│   └── calcular_distancia_svg_zonas.py  # distancia real (SVG) de cada zona a "Mesas de trabajo"
├── data/                           # config_mapeo.yaml, distancia_svg_por_zona.json, zonas.json (¡ojo, NO es backend/data!)
├── layout  inchape vfinal.svg      # SVG del layout real del almacén, escaneado a mano (Synoptic Designer)
├── LAYOUT-SVG-ESCANEADO.md         # contrato completo del pipeline de extracción del SVG
├── backend/README.md               # documentación técnica exhaustiva del backend (arquitectura, fórmulas, endpoints)
└── FEATURES-Y-KPIS.md              # qué feature/KPI está listo vs. pendiente de dato
```

**Ojo con la duplicación de `data/`:** hay `MVP-Inchape/data/` (raíz) y `MVP-Inchape/backend/data/` — son distintos. `backend/app/core/config.py::DATA_DIR` apunta a `backend/data/` (ahí vive el `zonas.json` que realmente sirve `GET /zonas`, con 14 entradas hoy — no 13, ver §8).

## 4. El dato: qué es el "lote" ingerido

`POST /ingesta` recibe un Excel (o CSVs por tabla) con **6 hojas/tablas**, mapeadas vía `data/config_mapeo.yaml` (columna-origen → columna-canónica, editable sin tocar código):

| Tabla SQLite | Columnas clave | Para qué |
|---|---|---|
| `sku_maestro` | `SKU` (PK), `MARCA`, `FAMILIA`, `VOLUMEN_M3`, `PESO_KG` | Atributos físicos estáticos del SKU |
| `rotacion` | `SKU` (PK), `ROTACION_6M`, `ABC` | Clasificación declarada (⚠️ no correlaciona con demanda real, ver §8) |
| `stock_actual` | `UBICACION`, `SKU`, `ZONA_ACTUAL` | Dónde está cada SKU HOY |
| `pedidos` | `PEDIDO_ID`, `LINEA`, `SKU`, `CANTIDAD`, `ZONA_ACTUAL`, `TIEMPO_HOY_MIN` | Líneas de pedido reales -- la fuente de verdad de demanda |
| `layout_cd` | `ZONA` (PK), `DISTANCIA_METROS`, `TIEMPO_MINUTOS`, `CAPACIDAD_M3_MAX` | Tiempo de acceso y capacidad declarada por zona |
| `ocupacion_zona` | `ZONA` (PK), `CAPACIDAD_MAX_M3`, `VOLUMEN_USADO_M3`, `VOLUMEN_DISPONIBLE_M3`, `PORCENTAJE_USO` | Ocupación reportada aparte (para `capacidad.py`) |

`POST /ingesta` es todo-o-nada por archivo (rechaza el Excel completo si falta una hoja/columna entera, `IngestaFatalError`) pero fila-a-fila permisivo dentro de una hoja válida (rechaza filas individuales con motivo, nunca inventa un valor).

**El dataset de práctica actual** (`IMPULSA_CD_Práctico Estudiantes (1).xlsx`, referenciado por los tests pero no presente en el repo -- solo su resultado ya ingerido en `backend/mvp.db`): **100 SKU, exactamente 5 familias de 20 SKU cada una** (`Correas`, `Filtros`, `Lubricantes`, `Pastillas`, `Soportes`), **435 pedidos, 1500 líneas** (~3.45 líneas/pedido).

## 5. Backend en detalle

### 5.1 Capas
- `api/routers/` — HTTP puro, sin lógica de negocio. Traduce excepciones de dominio a códigos HTTP (422 datos faltantes, 409 conflicto/infactible).
- `dominio/` — funciones puras `DataFrame → DataFrame`, sin conocer HTTP ni SQL. Es lo único que un test unitario necesita importar.
- `schemas/` — contratos Pydantic, comentados como "coincide 1:1 con `frontend/src/api/*.ts`" -- cuando se cambia un schema hay que cambiar el `.ts` espejo a mano (no hay generación automática).

### 5.2 Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/salud` | Health check |
| `POST` | `/ingesta` | Sube Excel/CSV, valida, persiste el lote (reemplaza el anterior por completo) |
| `GET` | `/ingesta/mapeo` | Mapeo de columnas vigente |
| `GET` | `/zonas` | Geometría estática de las zonas (plano esquemático) |
| `POST` | `/pipeline/ejecutar` | **El endpoint central** -- corre todo el pipeline, ver `PROCESO-DE-SLOTTING.md` |
| `GET` | `/recomendaciones/{sku}` | Explicabilidad completa de un SKU (score desglosado + reglas + cluster ML) |
| `GET`/`POST`/`PUT`/`DELETE` | `/reglas` | CRUD del motor de reglas |
| `GET` | `/ergonomia` | Banda de oro NIOSH por SKU (standalone, no afecta slotting) |
| `GET` | `/afinidad` | Test de significancia de afinidad + pares + conjuntos frecuentes (~15s, no cacheado) |

### 5.3 Banderas de activación (`core/flags.py`)

Patrón "Nivel 1 → Nivel 2": cada capacidad que depende de un dato que hoy no existe se declara `False` explícitamente en vez de simularse. `POST /pipeline/ejecutar` devuelve `banderas_activas` en cada respuesta:

| Bandera | Hoy | Se activa cuando |
|---|---|---|
| `usar_incompatibilidad_geometrica` | `False` (fija) | Exista cota real del plano + punto I/O confirmado |
| `usar_triage` | `False` | `slotting_inicial` tenga filas |
| `usar_payback_real` | `False` | `historico_mensual` tenga filas |
| `usar_fifo` | `False` | `stock_actual` tenga columna `FECHA_LOTE` |

`usar_afinidad` **no** vive acá (corre ~15s, se calcula solo cuando se pide explícitamente -- ver `PROCESO-DE-SLOTTING.md` §7).

### 5.4 Motor de reglas (`dominio/reglas/`)

Motor propio (no una librería tipo `business-rules`), sin `eval`, operadores fijos (`==`,`!=`,`>`,`>=`,`<`,`<=`). Dos tipos:
- **Atributo**: condición sobre `PESO_KG`/`VOLUMEN_M3`/`ABC`/`FAMILIA` que fuerza (`zona_permitida`) o prohíbe (`zona_prohibida`) una zona.
- **Incompatibilidad**: dos familias no pueden compartir zona (`modo="misma_zona_prohibida"`).

Se aplican como **restricciones duras** en el optimizador (variables fijadas a 0/1), nunca como término del objetivo -- ninguna regla de seguridad es negociable por un buen score.

### 5.5 Módulos NO conectados al pipeline en vivo (hallazgo importante, verificado con grep)

- `dominio/matriz_sku_zona.py` (incluye `mejor_zona_teorica()`, la función que respondería "¿existe una zona mejor que una regla descartó?") -- escrito, sin `import` en `pipeline.py`.
- `dominio/impacto.py::ranking_preliminar`, `identificar_top_sku`, `analisis_abc`, `distribucion_top_abc` -- escritas, no llamadas desde ningún router.
- `dominio/ergonomia.py` -- tiene su propio endpoint (`GET /ergonomia`) pero no se cruza con la decisión de zona.

## 6. Frontend en detalle

### 6.1 Secciones (sidebar, `App.tsx`)

| Sección | Vista | Qué muestra |
|---|---|---|
| Resumen | `ResumenView` | KPIs de hoy + mapa de calor de situación actual |
| Carga de datos | `IngestaView` | Subida Excel + preview + mapeo + ejecutar pipeline |
| SKU · Slotting | `SkuSlottingView` | Tabla Hoy vs. Propuesta, sliders de pesos del score, explicabilidad expandible por fila, toggle de afinidad |
| Reglas | `ReglasView` | CRUD de reglas |
| Mapas | `MapasView` | Comparación lado a lado Hoy/Propuesta con geometría real + plano de referencia técnica |
| Dashboard v2 | `DashboardV2View` | Mapa interactivo D3 (zoom/pan real), barra de áreas, panel de SKU por zona con ocupación por volumen |

Estado global único: `PipelineContext` -- guarda el último `RespuestaPipeline` (y el anterior, para diffs) y el `modoDistancia`/`usarAfinidad` de la última corrida.

### 6.2 Geometría real del almacén (`components/mapas/`)

El plano NO es esquemático -- viene de un SVG escaneado a mano del almacén real (`layout  inchape vfinal.svg`, herramienta "Synoptic Designer"), procesado por `scripts/extraer_layout_svg.py` a `frontend/src/data/layoutEscaneado.json`. Contrato completo en `LAYOUT-SVG-ESCANEADO.md`. Estado actual: **12 de 13 zonas trazadas** (falta el equivalente geométrico de "14. LATERALES"), más el contorno completo del edificio (`contorno_d`).

- `PlanoEscaneado.tsx` -- el mapa de ocupación "oficial" de la app (usado en Resumen y Mapas).
- `VistaAsientosReales.tsx` -- detalle "asientos de cine" al hacer click en una zona (dentro de `DetalleZona.tsx`).
- `movimientoReal.ts` -- único cálculo compartido de estado por espacio (disponible/ocupada/se_va/llega).
- `PlanoInteractivoD3.tsx` -- **Dashboard v2**, construido en esta sesión (ver §10): zoom/pan con D3, contorno del edificio, barra lateral de áreas, panel de SKU por zona con ocupación por volumen real.

### 6.3 Reutilización de estilos/color

`lib/colorCalor.ts` -- única escala de color (verde→amarillo→rojo) usada en TODOS los mapas de calor de la app (ocupación, rotación, perfil ML, dispersión de comunidades de afinidad).

## 7. Convenciones y filosofía del proyecto (importante para seguir el mismo estilo)

- **Nunca fingir datos.** Si falta evidencia, se declara explícitamente inactivo (banderas) o se documenta el hallazgo negativo (afinidad sin señal, en vez de forzarla).
- **Todo parámetro de negocio vive en `core/config.py`**, nunca hardcodeado en `dominio/`.
- **N×M nunca hardcodeado** -- siempre `len(df) * len(otro_df)`, nunca un número fijo tipo "900" o "20 SKU".
- **Reglas de seguridad = restricciones duras, nunca términos del objetivo.** Un buen score no puede "comprar" una violación de regla.
- **Cambios estadísticamente delicados requieren test de significancia**, no una opinión (patrón validado con afinidad, generalizado en `core/flags.py`).
- **Comentarios en español, explican el PORQUÉ no el QUÉ.** Casi todos citan un documento fuente (`CLAUDE_1.md #N`, `FEATURES-Y-KPIS.md §N`) o un hallazgo validado.
- **Nombres de archivo de datos derivados sin número de versión** (`layoutEscaneado.json`, no `layoutEscaneadoV3.json`) -- se sobreescriben, no se versionan en el nombre.

## 8. Hallazgos ya validados (fundamentan varias decisiones de diseño)

- **`ROTACION_6M`/`ABC` declarados NO correlacionan con demanda real** (Pearson ≈ 0.028 rotación vs. `N_LINEAS`; χ² ABC vs. `ZONA_ACTUAL` p=0.646). Por eso el pipeline usa `N_LINEAS` (visitas reales) como proxy de velocidad, no la rotación del Excel.
- **Sin señal de afinidad de pedidos en el dataset de práctica**: modularidad observada 0.132 vs. percentil 95 del nulo 0.147 (`N_COOCURRENCIA` máximo entre SKU = 4). Confirmado también que agregar a nivel FAMILIA (solo 5 categorías) da modularidad 0.0 -- el catálogo es demasiado chico para que emerja estructura real a cualquier granularidad razonable.
- **`zonas.json` (backend/data) tiene 14 zonas hoy, no 13** -- 2 tests de `test_api_zonas.py` fallan por esto (`assert len == 13`), pre-existente, sin relación con el trabajo de esta sesión.
- **`GET /afinidad` tarda ~10-15s** (200 réplicas de permutación) -- deliberado, "mismo protocolo que la demo, no una versión recortada" (comentario del test). Recién en esta sesión se identificó que se podría paralelizar con `joblib` (ya es dependencia, 16 cores disponibles en la máquina de desarrollo) y cachear por lote -- **no implementado todavía**, quedó como propuesta.

## 9. Testing

```
cd backend
python -m pytest -q          # 51 tests pasan, 2 fallan (zonas.json, ver §8, no relacionado)
```
Fixture central: `tests/conftest.py::excel_practica_bytes` (session-scoped, carga el Excel de práctica desde `MVP-Inchape/data/IMPULSA_CD_Práctico Estudiantes (1).xlsx` -- **este archivo no está en el repo actual**, así que los tests que lo requieren fallarían en un checkout limpio hasta que se agregue). Un detalle de fragilidad conocido: los tests de `test_dominio_afinidad.py` (llaman a `dominio/` directo, sin `TestClient`) dependen de que OTRO archivo de test ya haya inicializado el schema SQLite vía `TestClient(app)` -- correr ese archivo aislado falla con "no such table"; correr la suite completa no tiene el problema.

Frontend: `npx tsc -b` (type-check), `npx oxlint src/` (lint), `npx vite build` (build de producción). No hay tests automatizados de frontend (Playwright se usó manualmente durante desarrollo para verificar UI, no quedó como suite).

## 10. Qué se hizo en la sesión más reciente (para continuidad inmediata)

En orden cronológico:
1. **Dashboard v2** (`PlanoInteractivoD3.tsx` + `DashboardV2View.tsx`): mapa interactivo con D3 (zoom/pan real, no CSS transform manual), coloreado por id igual que `PlanoEscaneado`, barra lateral de áreas para saltar entre zonas, panel de SKU por zona sin modal.
2. **Extendido `scripts/extraer_layout_svg.py`** para capturar `Mesa de Trabajo`/`Recepción Aéreos` (formas sueltas sin subdivisión, antes descartadas) y el `contorno_d` del edificio completo (`Contorno_x20_Almacen`) -- ahora 12/13 zonas trazadas en vez de 10/13. Actualizado `mapeoZonas.json` y `LAYOUT-SVG-ESCANEADO.md`.
3. **Heurísticas de Nielsen aplicadas** al Dashboard v2: leyenda de color siempre visible, indicador de nivel de zoom, botón de cerrar + tecla Escape, navegación por teclado en las zonas del mapa.
4. **Ocupación por volumen real**: nuevo campo `capacidad_zonas` en `RespuestaPipeline` (backend expone `CAPACIDAD_M3_MAX` de `LAYOUT_CD` por zona), el panel de zona en Dashboard v2 suma `VOLUMEN_M3` real de los SKU y calcula % de ocupación -- distinto del % de espacios ocupados (conteo) que ya existía.
5. **Columna "Movimiento" con destino y justificación** en la tabla de SKU del Dashboard v2 (badge Mover/Mantener, flecha hacia la zona origen/destino según se mire Hoy o Propuesta, tooltip con la `JUSTIFICACION` completa).
6. **Unificación visual de los dos "scores"**: nueva columna "Perfil ML" en `SkuSlottingView.tsx`, junto a "Score" -- mismos datos que ya devolvía el backend (`PERFIL_ML`/`PRIORIDAD_CLUSTER_RANK`), simplemente no se mostraban. Se decidió explícitamente NO fusionarlos en un solo número (perderían interpretabilidad ambos).
7. **Integración de afinidad al optimizador** (la pieza más grande): `comunidades_por_sku()` nueva en `afinidad.py`, término suave de objetivo en `optimizador.py` (premia concentrar comunidades de Louvain en pocas zonas, nunca restricción dura), gateado en `pipeline.py` por el test de significancia -- solo se activa si se pide explícitamente (`usar_afinidad=True`) Y el test confirma señal. Verificado con datos reales de `mvp.db`: (a) no rompe el comportamiento por defecto, (b) el gate bloquea correctamente cuando no hay señal (resultado idéntico con/sin pedirlo), (c) el mecanismo LP funciona cuando se fuerza un peso >0 (dispersión de comunidades baja medible mente).
8. **Toggle "Afinidad de pedidos" en el frontend** (`SkuSlottingView.tsx`), verificado en vivo contra el backend real -- corre el test de 200 réplicas y muestra el motivo exacto.

**Estado al cierre de la sesión:** backend corriendo en `:8000` con `--reload` (recoge cambios de código en caliente), frontend en `:5173`. Todo verificado en navegador real contra datos reales del Excel de práctica ya ingerido en `mvp.db`.

## 11. Pendientes conocidos (declarados, no urgentes)

- Confirmar (o corregir) la hipótesis "14. LATERALES" = zona geométrica "Rack Doble" (`mapeoZonas.json`, nota explícita de "sin confirmar").
- `usar_afinidad` en el pipeline principal paga ~15s cuando se activa -- paralelización con `joblib` y caché por lote, propuestas pero no implementadas.
- `PESO_AFINIDAD` está en `0.0` -- no hay datos con señal real para calibrarlo todavía; haría falta un dataset sintético con afinidad real inyectada para probar ese camino end-to-end.
- Exponer `MEJOR_ZONA_TEORICA` (`matriz_sku_zona.py`, ya calculado pero no conectado) para responder "¿una regla le costó algo a este SKU?" en la UI de explicabilidad.
- Reconciliar los 2 tests de `test_api_zonas.py` (esperan 13 zonas, hay 14).
