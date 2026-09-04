# Diseño Frontend v2 — Dashboard con arquitectura de barra lateral

Fecha: 2026-08-24. Este documento es el **prompt maestro** para la siguiente iteración del frontend: parte de las 4 ideas que planteaste, las refina con criterio de producto/arquitectura, y deja explícito qué se puede construir ya mismo vs. qué necesita trabajo de backend primero — para no descubrirlo a mitad de la implementación.

No repite el detalle de arquitectura/endpoints ya documentado en `backend/README.md` ni el análisis de KPIs de `FEATURES-Y-KPIS.md` — los referencia.

---

## 0. Principios y alcance de este ciclo

- **Nunca fingir progreso ni datos.** Si una funcionalidad pedida (ej. línea de tiempo del pipeline en vivo) no tiene un dato real detrás todavía, se declara la limitación explícitamente en este documento — no se simula con un timer falso.
- **Reutilizar antes que duplicar.** Cada punto de este documento indica qué componente/endpoint ya existe y se reutiliza, y qué es genuinamente nuevo.
- **Explícitamente fuera de alcance de este ciclo:** el rediseño visual del plano/geometría de zonas (lo abordas tú después) — nada en este documento toca `PlanoBase.tsx`, `colorModos.ts`, `plantillasZona.ts` ni el SVG del plano. Solo cambia CÓMO se navega hacia él y CÓMO se interactúa alrededor (modal de zona), no su apariencia.
- **El pivote visual "Apple" (tokens, tipografía, sombras) ya está aplicado** — este documento es de información/arquitectura/interacción, no vuelve a tocar la capa visual de `index.css`/`ui.css`.

---

## 1. Arquitectura de navegación: shell con barra lateral

Reemplaza el layout actual (scroll único largo + nav de píldoras con anclas `#href`) por un **shell de aplicación**: barra lateral fija a la izquierda con las secciones, panel de contenido a la derecha mostrando una sección a la vez (no todo en un solo scroll interminable).

### 1.1 Secciones y orden

| # | Sección | Contenido | Reemplaza / reutiliza |
|---|---|---|---|
| 1 | **Resumen** (vista de aterrizaje) | KPIs de HOY + mapa de calor de situación actual | `KpisPrincipales` + `EstadoActualView` (reutilizados, con un cambio de énfasis — ver §1.2) |
| 2 | **Carga de datos** | Subida Excel/CSV + previsualización + mapeo + ejecutar análisis + línea de tiempo del pipeline | `IngestaView` (se extiende) |
| 3 | **SKU · Slotting** | Tabla actual vs. recomendado + explicabilidad expandible + pesos del score | `SkusView` + `PuntuacionView` (se fusionan — ver §3) |
| 4 | **Reglas** | Mapa clicable → gestión de reglas por zona (activar/desactivar/eliminar/crear) + alerta de impacto | `MapasView` (solo el mapa "Hoy" para este propósito) + `DetalleZona` + `ReglasView` (se integran — ver §4) |

Nota: la sección "Mapas" (comparación Hoy/Propuesta de dos plantas lado a lado) y el plano de referencia técnica (`PlanoSVG` con modos Técnica/Densidad/Distancia) **no desaparecen** — quedan como una quinta sección "Mapas" para cuando quieras abordar su rediseño visual; mientras tanto siguen accesibles tal cual están.

### 1.2 Vista de aterrizaje ("Resumen") — cambio de énfasis en los KPIs

Pediste que los KPIs sean los de **hoy**, para diagnóstico — esto es un cambio real respecto a lo ya construido: hoy `KpisPrincipales` muestra el valor **optimizado** como número grande y "hoy" como nota secundaria. Se invierte:

- Número grande = `tiempo_promedio_actual_min_pedido` / `productividad_actual_lineas_hh` (el diagnóstico).
- Nota secundaria = "con la propuesta: X min/pedido (−Y%)" — el dato optimizado pasa a ser el incentivo para ir a la sección SKU·Slotting, no el protagonista.
- El mapa de calor debajo usa `MapaOcupacion` con `campo="ZONA_ACTUAL"` — ya construido, sin cambios visuales (respeta §0).

### 1.3 Mecanismo de navegación

No hace falta `react-router` para 4-5 secciones: un estado `vistaActiva` en `App.tsx` (como ya existe para las pestañas), solo que ahora se renderiza en una barra lateral vertical en vez de pestañas horizontales. Responsive: en pantallas angostas la barra colapsa a un menú hamburguesa — se deja como nota de implementación, no bloqueante para la demo en desktop.

---

## 2. Carga de datos

### 2.1 Subida con previsualización

- Input de archivo que acepta **Excel o CSV**.
- Antes de confirmar la ingesta, mostrar una previsualización:
  - Excel: hojas detectadas + primeras filas de cada una.
  - CSV: primeras filas del archivo.
- La previsualización se parsea **en el navegador** (librería ligera tipo `xlsx` o `papaparse`), sin gastar una llamada al backend solo para mirar el archivo antes de decidir subirlo.
- Mejora sobre lo pedido: en la previsualización, resaltar qué columnas SÍ reconoce el mapeo vigente (`GET /ingesta/mapeo`) y cuáles no calzan — feedback antes de enviar, no después de que falle.

**⚠️ Dependencia de backend, declarada explícita:** `POST /ingesta` hoy **solo acepta `.xlsx`/`.xls`** (`ingesta.py`, valida la extensión). Aceptar CSV sueltos por tabla es trabajo de backend nuevo, no cosmético — hay que decidir cómo se identifica a qué tabla canónica corresponde cada CSV (¿por nombre de archivo? ¿el usuario lo indica manualmente?). **No prometer CSV en el frontend hasta resolver esto en el backend.**

### 2.2 Mapeo de columnas

Ya construido (`IngestaView` actual): tabla editable canónico → origen, precargada desde `GET /ingesta/mapeo`, enviada junto con el archivo en `POST /ingesta`. Se mantiene tal cual.

### 2.3 Ejecutar análisis + línea de tiempo del pipeline

Botón "Ejecutar análisis" (ya existe, hoy encadena ingesta + `ejecutar()` del pipeline). Pediste una línea de tiempo que muestre qué está haciendo el pipeline en cada momento.

**Restricción real:** `POST /pipeline/ejecutar` es hoy una sola llamada síncrona — el backend no emite progreso intermedio, responde todo junto al final. Una línea de tiempo que marque etapas EN VIVO requeriría *streaming* real (Server-Sent Events o WebSocket) instrumentado fase por fase en el backend (`indicadores` → `impacto` → `score` → `capacidad` → `reglas` → `optimización` → `ML` → `KPIs`).

Dos caminos — elegir uno antes de construir, no asumir:

| Camino | Qué muestra | Costo |
|---|---|---|
| **(a) Checklist educativo** (recomendado para esta iteración) | Lista de las etapas conocidas del pipeline, todas en estado "pendiente" mientras se espera la respuesta, todas marcadas "completo" de golpe cuando vuelve — es honesto (no dice "ahora estoy en el paso 3"), pero sí educa sobre qué hace el sistema | Sin cambios de backend |
| (b) Streaming real | Cada etapa se marca completa en el momento real en que el backend la termina | Requiere endpoint SSE nuevo en el backend — el pipeline hoy corre en &lt;2s con 100 SKU, el streaming se justifica más cuando el catálogo crezca y el tiempo de espera sea perceptible |

**Recomendación: camino (a) ahora, (b) como mejora futura** cuando el volumen de datos justifique la espera.

---

## 3. SKU · Slotting (fusiona lo que hoy son dos vistas: SKUs + Puntuación)

### 3.1 Tabla con separación visual Actual | Recomendado

Se mantienen los filtros ya construidos (buscador, Todos/Mover/Mantener). Las columnas se agrupan en dos bloques con un separador visual (borde vertical + encabezado agrupado):

```
[ SKU · Familia · ABC ]  │  ACTUAL: Zona · Tiempo hoy  │  RECOMENDADO: Zona · Tiempo nuevo · % ahorro · Score · Acción
```

### 3.2 Explicabilidad expandible por fila (reemplaza el buscador de "Puntuación")

Cada fila tiene un botón de expandir (chevron) que despliega **inline**, debajo de la fila (no en modal — para no interrumpir el barrido de la tabla al revisar varios SKU seguidos), el mismo contenido que hoy vive en la vista "Puntuación": desglose de score por criterio + cluster ML explicado (distancias, contribución por variable, silhouette). Reutiliza `GET /recomendaciones/{sku}`, ya construido.

**Decisión de consolidación, explícita:** la exploración por SKU deja de ser una pestaña aparte con su propio buscador — vive directamente en la fila que ya estás mirando. Los **sliders de pesos del score** (que afectan a los 100 SKU a la vez, no a uno) sí quedan como su propia sub-sección, arriba de la tabla, dentro de esta misma vista — es una herramienta distinta (recalcula todo el pipeline), no algo que tenga sentido "por fila".

### 3.3 Botón de ayuda ("?") sobre las variables de explicabilidad

Ícono de ayuda junto al desglose que abre un glosario corto y estático (no depende de datos, vive en el frontend): qué es `AHORRO_NORM`, `ROTACION_NORM`, `ABC_SCORE`, `FACILIDAD_MOVIMIENTO`, y qué significan la "contribución por variable" del cluster y el silhouette individual. Contenido de referencia, una sola vez, reutilizable en cualquier fila.

### 3.4 "Existe una zona mejor, pero una regla la descarta"

Esto **requiere un dato que el backend ya calcula pero no expone todavía**:

- `dominio/matriz_sku_zona.py::mejor_zona_teorica()` (Fase 8.5) ya calcula, por SKU, la zona de **menor costo sin restricciones** de reglas/capacidad/tope de movimientos — es exactamente el número a comparar contra `ZONA_RECOMENDADA` (la real, ya restringida) para saber si alguna regla "le costó" algo a ese SKU.
- **Pendiente de backend, antes de tocar el frontend:**
  1. Exponer `MEJOR_ZONA_TEORICA` (+ su ahorro teórico) en `POST /pipeline/ejecutar` o en `GET /recomendaciones/{sku}`.
  2. Confirmar que `camino_decision_reglas` (ya existe) distingue "esta regla te sacó de tu mejor opción teórica" de "esta regla simplemente describe dónde terminaste" — si no lo distingue hoy, es un ajuste pequeño en `aplicar_reglas_atributo`.
- Una vez exista ese dato: mostrar el aviso solo si `MEJOR_ZONA_TEORICA != ZONA_RECOMENDADA` **y** la causa registrada es una regla (no capacidad ni tope de movimientos) — para no mostrar el aviso quejándose de restricciones que no son reglas de negocio.

---

## 4. Reglas — gestión desde el mapa (no una lista suelta)

El modal `DetalleZona` (ya construido) ya muestra, al hacer click en una zona del mapa, qué reglas de atributo aplican ahí (`detalle-zona-restricciones`). Se amplía ese mismo modal para que sea el punto único de gestión — no se crea un modal nuevo:

- Cada regla listada con **toggle Activar/Desactivar** y **botón Eliminar** — son funciones que ya existen en `ReglasView` (`actualizarRegla`, `eliminarRegla`), se reutilizan aquí, no se reimplementan.
- **Botón "Agregar regla a esta zona"**: abre el mismo formulario de creación ya construido en `ReglasView`, con la zona **pre-cargada** (no hay que elegirla del selector) — evita el error de seleccionar la zona equivocada.
- **Alerta de impacto antes de guardar** (la pediste explícitamente, y es 100% construible ya mismo): antes de confirmar la creación o activación de una regla, calcular en el cliente cuántos SKU con `ZONA_ACTUAL === zona.clave_excel` violarían la condición de la nueva regla (los datos ya están en `recomendaciones`, cargados en el contexto), y mostrar algo como:

  > "Esto afecta a 4 SKU que hoy están en esta zona: SKU00012, SKU00045, SKU00061, SKU00088 — sus posiciones actuales quedarían prohibidas por esta regla."

  Es una validación puramente de cliente (comparar `PESO_KG`/`VOLUMEN_M3`/`FAMILIA` contra la condición propuesta) — **no requiere ningún cambio de backend.**

- La vista independiente "Reglas" (listado global sin contexto de zona) **no se elimina** — sigue siendo útil para reglas de incompatibilidad (que son entre dos familias, no "de una zona") y para altas/bajas masivas. Se complementa con el punto de entrada desde el mapa, no lo reemplaza.

---

## 5. Fuera de alcance de este ciclo (declarado explícitamente, no es un olvido)

| Punto | Por qué queda fuera |
|---|---|
| Rediseño visual del plano/geometría de zonas | Lo abordas tú en un ciclo posterior — ver §0 |
| Streaming real de progreso del pipeline (SSE/WebSocket) | Ver §2.3 — el pipeline corre en &lt;2s hoy, no se justifica todavía |
| CSV suelto por tabla en `POST /ingesta` | Ver §2.1 — requiere diseño de backend (cómo identificar la tabla), no es solo "aceptar la extensión" |
| Exponer `MEJOR_ZONA_TEORICA` | Ver §3.4 — pequeño trabajo de backend antes de que el frontend correspondiente tenga sentido construirlo |

## 6. Resumen de trabajo de backend que este diseño exige

Para que la implementación no se detenga a mitad de camino descubriendo esto:

| Requisito | Tamaño estimado | Bloquea a |
|---|---|---|
| Aceptar CSV por tabla en `POST /ingesta` | Medio | §2.1 (se puede lanzar sin CSV, solo Excel, y agregar después) |
| Endpoint de streaming de progreso del pipeline | Grande, y de valor dudoso hoy | §2.3 camino (b) — no bloquea el camino (a), que no necesita nada nuevo |
| Exponer `MEJOR_ZONA_TEORICA` + vincularla a la regla causante | Pequeño-mediano | §3.4 (el resto de la vista SKU·Slotting no depende de esto) |
| Alerta de impacto de reglas (§4) | Ninguno | Ya se puede construir con los datos que el frontend ya tiene |

**Orden de implementación sugerido** (de lo que no tiene dependencias de backend a lo que sí): §1 (shell) → §4 (reglas desde el mapa + alerta) → §3.1-3.3 (tabla fusionada + explicabilidad + glosario) → §2.1-2.2 (previsualización + mapeo, Excel primero) → §2.3 camino (a) → recién ahí evaluar si vale la pena §3.4 y §2.3 camino (b) con los cambios de backend que exigen.
