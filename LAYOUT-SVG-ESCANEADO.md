# Layout SVG escaneado — cómo aprovechar el trazado real del almacén

Fecha: 2026-08-27 (v3/v4), actualizado 2026-08-30 (vfinal). Documenta los SVG "layout inchape v3/v4/vfinal.svg" (raíz del proyecto): qué son, qué contrato deben cumplir para que el pipeline los entienda, cómo regenerar los datos cuando subas una versión más completa, y dónde se usan hoy.

Nombres de archivo de datos/código deliberadamente **sin número de versión** (`layoutEscaneado.json`, `layoutEscaneado.ts`, `PlanoEscaneado.tsx`) — se sobrescriben cada vez que llega un escaneo más completo, no hay que renombrar nada en el frontend cuando eso pase. Los SVG crudos sí quedan versionados por nombre (`layout  inchape v3.svg`, `v4.svg`, `vfinal.svg`, ...) porque son snapshots reales de cada entrega.

---

## 1. Qué es el archivo

Exportado de una herramienta tipo SCADA/sinóptico ("Synoptic Designer", `data-synoptic-designer-version="2.0.5"` en el `<svg>` raíz). La v3 traía además una imagen de fondo trazada embebida (ver §5); de la v4 en adelante ya no la trae (exportada directo sin esa capa). Lo que sí importa es la **capa vectorial**: grupos `<g id="Grupo_x20_<Nombre de Zona>">`, cada uno con:

- Un `<path>` (normalmente con `title="<Nombre de Zona>"`) — el **polígono real del borde de la zona**. Si el editor no le puso `title` (pasó con "Rack Colgantes"/`Grupo_x20_Colgados` en vfinal), el script cae a buscar el `<path>` cuyo `id` coincide con el nombre de la zona.
- Varios `<rect>` (o, si el editor tuvo que "aplanar" una celda rotada, `<path>`/`<polygon>`) con **id `rectN` o `pathN`** — cada uno es **una posición de espacio real**. Ver §2, el `id` es lo que decide si algo cuenta como ubicación, no el tag ni la forma.

`_x20_` es el espacio codificado como en una URL — así nombra los ids el editor cuando el nombre de la zona tiene espacios.

## 2. Contrato para que el script lo reconozca

`scripts/extraer_layout_svg.py` busca exactamente esto — si sigues dibujando zonas nuevas en el mismo editor con la misma convención, el script las levanta solas, sin tocar código:

- Un `<g id="Grupo_x20_...">` por zona.
- Dentro, el borde: un `<path>` con `title` = nombre de la zona, o si no hay ninguno con `title`, uno cuyo `id` coincida con el nombre de la zona.
- Dentro, **una ubicación real = un elemento (`<rect>`, `<path>` o `<polygon>`) cuyo `id` es `rectN` o `pathN`** (un número pegado al nombre del tag, sin guion — así nombra el editor cualquier forma nueva por default, sea cual sea el tag en el que termine exportada). Cualquier otro elemento con un `id` descriptivo — el borde con su `title`, o su fallback por nombre — se trata como el contorno de la zona, nunca como ubicación.

**Por qué por `id` y no por forma:** al principio el script intentaba adivinar "¿esto es una celda?" mirando si la forma era un rectángulo, y después (una vuelta más) solo aceptaba `id="rectN"` asumiendo que "pathN" era siempre estructural — ambas resultaron insuficientes: un marco de rack también puede ser rectangular, y varias ubicaciones reales (la mitad de Rack Doble, todo Rack Colgantes) terminan exportadas como `pathN` en vez de `rectN` sin ninguna diferencia de fondo. El criterio final — `rectN` **o** `pathN`, cualquier otra cosa es el contorno — es el que coincide con el trazado real; ver la tabla de §3.

No importa el orden interno de los elementos, ni si tienen `transform` o no, ni si armaste sub-grupos dentro de la zona — el script guarda dos cosas por zona:
1. `espacios`: x/y/ancho/alto ya resueltos (`translate`/`matrix`/`scale`/`rotate` si es `<rect>`; puntos del `d`/`points` si es `<path>`/`<polygon>`) de cada elemento con `id` `rectN`/`pathN`, para capacidad/estado. Si alguno queda con rotación o escala no-axial, el script lo avisa por consola (no lo descarta, pero su bounding box no es la forma exacta).
2. `markup_svg`: el XML original de todos los hijos del grupo (menos el `<path>` del borde) tal cual los dibujaste. Es lo que el frontend renderiza de verdad (ver §6), `espacios` solo alimenta cálculos.

## 3. Estado actual (vfinal, ago 2026)

| Zona trazada | Espacios en el SVG (filtrado por `id rectN`/`pathN`) | Total ya definido en `espaciosZona.ts` (tu Excel) |
|---|---|---|
| Rack Doble | 72 | 50 |
| Rack Simple | 35 | 84 |
| Rack Balda 2.2 | 48 | 162 |
| Rack Balda 1.4 | 42 | 96 |
| Estantería Multinivel | 278 | 211 |
| Bulk | 344 | 154 |
| Rack Neumáticos / Llantas | 160 | 72 |
| Cluster Multinivel | 30 | 32 |
| Ubicación Recibo (`Recibido` en el SVG) | 144 | — |
| Rack Colgantes (`Colgados` en el SVG) *(nuevo en vfinal)* | 37 | — |
| Mesa de Trabajo (`Mesa_x20_de_x20_Trabajo`, forma suelta fuera de cualquier `Grupo_x20_...`) | 0 (sin subdivisión) | — |
| Recepción Aéreos (`Recepcion_x20_Aereos`, forma suelta fuera de cualquier `Grupo_x20_...`) | 0 (sin subdivisión) | — |

**12 de 13 zonas trazadas.** Mesa de Trabajo y Recepción Aéreos aportan solo su `boundary_d` (sin `espacios`, ver §2/§8) — se muestran como polígono sin ubicaciones individuales para colorear. Sigue sin resolver el equivalente geométrico de **"14. LATERALES"** (ver nota abajo) — esa es la 13ª zona pendiente.

El script también extrae `contorno_d` (top-level, fuera de `zonas`): el `<path id="Contorno_x20_Almacen">` con el perímetro completo del edificio, `null` en versiones del SVG que no lo traigan. Solo referencia visual/espacial (nunca se rellena ni es clicable) — lo usa `PlanoInteractivoD3.tsx` (Dashboard v2, ver §6) para dar contexto de dónde caen las zonas trazadas dentro del edificio completo.

Los conteos de este SVG siguen sin coincidir con los de Excel en la mayoría de zonas. Por decisión explícita, mientras tanto:
- El **plano/forma** de estas zonas se usa tal cual, tanto en el panel comparativo como en el detalle de zona (ver §6).
- La **capacidad oficial de espacios** (para "ocupados/libres" agregados) sigue siendo la de `espaciosZona.ts`, no la de este SVG.

### Sobre "14. LATERALES"

Es una clave de `LAYOUT_CD` sin geometría confirmada (ver `ocupacion.ts::zonasSinGeometria`). En `mapeoZonas.json` quedó asignada — **a modo de hipótesis, sin confirmar** — a la zona geométrica **Rack Doble**: es la única zona de `LAYOUT_CD` y la única zona geométrica que quedaban sin pareja después de ubicar las otras 8, y ambas comparten un dato llamativo — cero líneas de picking hoy (`zonas.json` trae `Rack Doble` con `lineas_picking: 0`, y `FEATURES-Y-KPIS.md` §2 documenta que "14. LATERALES" no aparece en ninguna línea de pedido). Si no es así, corregir `claveExcel` para `"Rack Doble"` en `mapeoZonas.json`.

## 4. Cómo regenerar los datos cuando subas una versión nueva

Desde `MVP-Inchape/`, con el entorno `IngenieriaPython` activo:

```
conda run -n IngenieriaPython python scripts/extraer_layout_svg.py "<nombre del nuevo svg>.svg" frontend/src/data/layoutEscaneado.json
```

Sobrescribe `frontend/src/data/layoutEscaneado.json` — el frontend lo recoge automáticamente. No hace falta tocar código **salvo que agregues una zona con un nombre nuevo** — en ese caso, agrégala en `frontend/src/data/mapeoZonas.json` (no en `.ts`, es la única fuente de esta asignación):

```json
{ "nombreSvg": "<nombre de la zona tal cual queda en layoutEscaneado.json>", "zonaId": "<id que ya usa zonas.json/espaciosZona.ts>", "claveExcel": "<nombre exacto de LAYOUT_CD, o null>" }
```

`claveExcel: null` si la zona no tiene equivalente en el Excel, o si comparte clave con otra zona y no es la primaria (ver README backend §3.1 y `ocupacion.ts::esZonaPrimariaParaSuClave`). `frontend/src/components/mapas/layoutEscaneado.ts` solo tipa y re-exporta este JSON — no hace falta tocarlo.

## 5. Limpieza de SVG con imagen de fondo embebida

Si una futura versión vuelve a traer la imagen de fondo trazada (como la v3), pesa cientos de KB de más y no se usa para nada en el frontend. `scripts/limpiar_layout_svg.py` genera una copia sin esa capa, sin tocar ninguna zona/path/rect real:

```
conda run -n IngenieriaPython python scripts/limpiar_layout_svg.py "<archivo>.svg" "<archivo>-limpio.svg"
```

v3: 782 KB → 156 KB (verificado: misma extracción exacta). v4 no trae esa capa — el script no encuentra nada que quitar y no hace falta correrlo. Sigue editando el archivo **original** (con la imagen de fondo, si la trae) en Synoptic Designer si necesitas la referencia visual para seguir trazando.

## 6. Dónde se usa hoy

- `frontend/src/data/layoutEscaneado.json` — salida cruda del script (no editar a mano).
- `frontend/src/components/mapas/layoutEscaneado.ts` — tipos + mapeo nombre-de-zona-en-el-SVG → `zonaId`/`claveExcel` de la app (`ZONAS_ESCANEADAS`, `zonaEscaneadaPorId`).
- `frontend/src/components/mapas/PlanoEscaneado.tsx` — **el mapa de ocupación de la app** (ver §7): dibuja el polígono real de cada zona trazada y sus espacios reales, con un toggle **Por ocupación / Por rotación**, contra `ZONA_ACTUAL` o `ZONA_RECOMENDADA` según el prop `campo`. Click en una zona abre el mismo `DetalleZona` que el resto de los mapas. Se renderiza como "Situación actual del almacén" en **Resumen** y como "Hoy"/"Propuesta de slotting" en **Mapas** — misma geometría real, tres títulos/`campo` distintos, nunca tres copias del mismo dato.
- `frontend/src/components/mapas/VistaAsientosReales.tsx` — **estilo "asientos de cine"**: al hacer click en cualquier zona que ya tenga geometría real (desde cualquier mapa de la app, no solo `PlanoEscaneado`), `DetalleZona` muestra esta vista en vez de la grilla CSS ilustrativa.
- `frontend/src/components/mapas/PlanoInteractivoD3.tsx` — **Dashboard v2**: mismo dato real y misma lógica de color/estado que `PlanoEscaneado`/`movimientoReal.ts`, pero con zoom/pan real (`d3-zoom`) en vez de un plano estático, el `contorno_d` del edificio de fondo, una barra lateral con las 12 zonas para saltar entre ellas, y un panel que lista los SKU de la zona clickeada (familia, volumen, peso, rotación) sin modal.

  **Usa el marcado SVG real, no una reconstrucción.** `markup_svg` (nuevo campo en `layoutEscaneado.json`) es el XML original de los hijos del grupo de la zona (todo lo que dibujaste ahí, tal cual — cualquier sub-agrupación, forma o divisor que hayas armado), capturado por `extraer_layout_svg.py` y pegado tal cual en el DOM (`dangerouslySetInnerHTML`, memorizado por valor para que un re-render ajeno no lo vuelva a pisar). El componente solo le cambia el `class` (y por ende el color) a cada elemento por su `id` — nunca recalcula posiciones ni convierte las formas a otra cosa (si dibujaste rects, se ven rects; si en el futuro dibujas otra forma, se ve esa forma). `espacios` (con x/y/ancho/alto ya resueltos) se sigue calculando para: la capacidad, el recorte del `viewBox` a la zona, y el emparejamiento SKU-por-posición.

  Recibe un prop `campo` (`ZONA_ACTUAL`/`ZONA_RECOMENDADA`) — **cuál mapa abrió el detalle**, no un valor fijo: `DetalleZona` lo recibe a su vez de quien lo abrió (`PlanoEscaneado`), así que el detalle de una zona muestra la ocupación de hoy si se abrió desde "Situación actual"/"Hoy", o la propuesta si se abrió desde "Propuesta de slotting" — nunca una mezcla fija sin importar el origen del click (ver §7, `movimientoReal.ts`).

  Toggle **Por movimiento / Por rotación**, por defecto en **rotación**:

  - **Por movimiento** — usa `asientosPorMovimiento()` (§7) con ese `campo`, coloreado por clase CSS (`estado-*` en `VistaAsientosReales.css`): gris = disponible, azul = ocupada (se mantiene), rojo = se va (solo aparece si `campo` es `ZONA_ACTUAL`), verde = llega (solo aparece si `campo` es `ZONA_RECOMENDADA`). La leyenda y el resumen de arriba solo listan los estados que de verdad pueden aparecer en ese `campo`.
  - **Por rotación** — mismo `colorCalor()` (`frontend/src/lib/colorCalor.ts`, escala verde→amarillo→rojo compartida por todos los mapas de calor de la app) aplicado vía `style.fill` inline a cualquier espacio con SKU asociado (según el mismo `asientosPorMovimiento()`), normalizado contra el min/max de `ROTACION_6M` de **todas** las recomendaciones (no solo las de esta zona) para que el color sea comparable entre zonas. Los disponibles quedan en gris (sin dato de rotación) en ambos modos.

  Para zonas SIN geometría real todavía (Mesas de trabajo, Zona de carpintería, y las que falten según §3), `DetalleZona` sigue mostrando la grilla CSS ilustrativa de siempre (`GrillaSkus`/`espaciosZona.ts`) — nada se rompe, solo mejora donde ya hay dato real.

  **Nota de implementación (por si el color desaparece de nuevo):** el objeto `{ __html: ... }` de `dangerouslySetInnerHTML` DEBE estar memorizado por el valor de `markup_svg` (`useMemo`). Si se pasa un objeto literal nuevo en cada render, React vuelve a pegar el marcado original en cualquier re-render ajeno (ej. el fetch de reglas resolviendo async unos milisegundos después de abrir el modal) y borra los `class`/listeners que el efecto de coloreado ya había puesto — fue exactamente el bug que apareció al construir esto.

### Otros estados posibles (no implementados, quedan como idea)

Preguntaste explícitamente si hay más estados representables. Con los datos que ya calcula el pipeline, estos son implementables sin trabajo de backend:

- **Bloqueada por regla**: la posición nunca podría alojar cierto tipo de SKU por una regla de negocio activa en esa zona (ej. "livianos fuera de piso") — un patrón diagonal/hachurado en vez de un color sólido.
- **Riesgo ergonómico (NIOSH)**: el SKU ahí excede la constante NIOSH de 23kg (`app/dominio/ergonomia.py`, ya calculado) — un borde de advertencia o ícono, no un color nuevo (para no competir con el estado de movimiento).
- **Alta prioridad / ABC=A**: destacar visualmente los SKU de mayor importancia con un borde o tamaño distinto, sin cambiar el color base (que ya comunica el movimiento).

Ninguno se implementó — son ideas para si te sirven más adelante, no una limitación técnica.

### Qué SKU cae en qué espacio (siempre ilustrativo, ahora coherente)

`STOCK_ACTUAL` no trae fila/columna/nivel — ningún dato dice en qué espacio físico exacto está cada SKU, solo en qué **zona**. El emparejamiento SKU↔espacio en `VistaAsientosReales`/`PlanoEscaneado` siempre fue, y sigue siendo, **ilustrativo** — nunca hay que leerlo como la ubicación real registrada.

Al principio ese emparejamiento era por índice arbitrario: el SKU #i de la lista (que venía ordenada globalmente por `AHORRO_ESTIMADO_MIN`, sin relación con la zona) caía en el espacio #i del SVG (en el orden en que se dibujaron los rects en Synoptic Designer) — dos órdenes sin relación entre sí, así que el resultado no seguía ninguna lógica de almacén (los SKU de más movimiento no caían cerca de "Mesas de trabajo", por ejemplo).

`movimientoReal.ts` ahora ordena los dos lados por algo con sentido físico antes de emparejarlos:
- **Espacios**: por distancia real a `referencia_mesa_trabajo` (centro de la forma "Mesas de trabajo" del SVG, mismo sistema de coordenadas que `espacios` — `extraer_layout_svg.py` la extrae de la forma suelta `Mesa_x20_de_x20_Trabajo`, fuera de cualquier `Grupo_x20_...`; `null` en SVG viejos que no la traen, y ahí se usa el orden que ya tenía `espacios`, sin inventar una referencia).
- **SKU**: por `N_LINEAS` descendente (líneas de pedido reales) — **no** por `ROTACION_6M`: la rotación declarada del Excel no correlaciona con los hits reales (Pearson 0.028, `CLAUDE_1.md` #2), así que no sirve como proxy de velocidad.

El SKU con más movimiento real de la zona cae en el espacio más cercano a Mesas de trabajo, y así sucesivamente — coherente con cómo se sloteria un almacén real, aunque sigue sin ser el dato registrado. Ambas vistas muestran un aviso explícito de esto (`.plano-esc-nota i` / `.asientos-reales-aviso`).

## 7. `PlanoEscaneado` es el mapa de ocupación de la app (no un plano aparte)

Hasta acá hubo dos intentos intermedios que ya no existen, por si aparecen mencionados en commits viejos:
1. Un plano esquemático (`zonas.json`, `PlanoBase.tsx`) con un color plano por zona (`MapaOcupacion.tsx`).
2. Ese mismo plano esquemático con un **mosaico** de espacios reales estirados a la fuerza dentro de cada polígono aproximado (`PlanoBase`'s `contenidoReal` + `MapaOcupacion`) — quedaba visiblemente descuadrado: la forma real de cada espacio no coincide con la forma aproximada de `zonas.json` (son dos escaneos/sistemas de coordenadas independientes), así que el mosaico se veía "roto" comparado con el plano real escaneado en su propio panel.

**Ahora hay uno solo:** `PlanoEscaneado.tsx` usa directamente la geometría real (`boundary_d` + `espacios` de `layoutEscaneado.json`, en su propio sistema de coordenadas, sin estirar nada) como *el* mapa de ocupación — "Situación actual del almacén" en Resumen, "Hoy"/"Propuesta de slotting" en Mapas son las tres veces que se renderiza (con distinto `titulo`/`campo`), no tres implementaciones distintas. `MapaOcupacion.tsx`, su CSS, y el prop `contenidoReal` de `PlanoBase.tsx` se borraron — `PlanoBase.tsx` volvió a ser solo el plano esquemático simple que sigue usando `PlanoSVG.tsx` (la referencia por técnica/densidad/distancia, un feature aparte que nunca necesitó geometría real).

**Reglas de color, en toda la app:**
- El **contorno** de una zona (`boundary_d`/`puntos_svg`) **nunca se rellena** — `fill: none`, solo el trazo. Lo único que se colorea son los **espacios individuales**.
- Un espacio **disponible** (sin SKU, ni hoy ni en la propuesta) se pinta **gris** (`#c7c7cc`), nunca blanco — blanco se confundiría con un contorno sin relleno sobre fondo claro.
- Un espacio **ocupado** se colorea con `colorCalor()` sobre su `ROTACION_6M` (verde→amarillo→rojo) en modo "Por rotación", o con la paleta de 4 estados de movimiento (azul/rojo/verde/gris, ver abajo) en modo "Por ocupación"/"Por movimiento".

### `movimientoReal.ts` — un solo cálculo de movimiento, compartido

`asientosPorMovimiento(espacios, claveExcel, recomendaciones, campo)` (`frontend/src/components/mapas/movimientoReal.ts`) es la única función que decide, para cada espacio real, si está disponible/ocupada/se_va/llega — la usan `PlanoEscaneado.tsx` (modo "Por ocupación") y `VistaAsientosReales.tsx` (modo "Por movimiento") por igual, así que un mismo espacio se ve del mismo color en el mapa grande y en el detalle de zona.

El resultado depende de `campo` (cuál mapa/detalle lo pide, "Hoy" o "Propuesta") — **no siempre calcula lo mismo sin importar quién pregunta**, a propósito:
- `ZONA_ACTUAL` ("Hoy"/"Situación actual"): los SKU de **hoy** son los primarios, uno por posición en orden. "se_va" marca los que la propuesta saca de la zona. Los espacios libres de hoy **se quedan disponibles** — nunca se rellenan con llegadas de la propuesta. Antes de este cambio sí se rellenaban (para dar contexto de "qué va a pasar"), pero eso hacía que abrir el detalle de una zona desde "Situación actual" pareciera mostrar la propuesta en vez de la situación actual, cuando la zona tenía pocos SKU hoy y muchos recomendados.
- `ZONA_RECOMENDADA` ("Propuesta"): los SKU de la **propuesta** son los primarios. "llega" marca los que son nuevos (no estaban hoy). No se marca "se_va" -- parados en el futuro, lo que se va ya no está.

Por eso "Hoy" nunca muestra verde (llega) y "Propuesta" nunca muestra rojo (se_va) — cada mapa/detalle solo muestra los estados que tienen sentido desde su propia perspectiva temporal.

`descripcionAsiento(asiento)` (mismo archivo) arma el texto del tooltip: para "se_va"/"llega" usa `JUSTIFICACION` (ya viene armada del backend, `_generar_justificacion` en `recomendaciones.py`: de qué zona a cuál, cuántas visitas tuvo, cómo cambia el tiempo de acceso, ahorro estimado) en vez de solo mostrar el SKU — así el tooltip responde de una sola vez qué hay ahí, por qué se mueve y hacia dónde. Antes solo decía "Se va a mover" sin destino.

**Lista lateral en `VistaAsientosReales`** (el detalle por zona, ver §6): pasar el mouse cuadro por cuadro para encontrar qué se mueve entre cientos de espacios es poco intuitivo, así que junto a la grilla hay una lista de todos los SKU reales de la zona -- los que se mueven (`se_va`/`llega` según `campo`) van primero y destacados con el mismo color que su cuadro, mostrando `JUSTIFICACION` completa; los que se mantienen van después, solo con su rotación. Pasar el mouse por un ítem de la lista resalta (borde grueso) su cuadro correspondiente en la grilla -- útil para ubicarlo entre decenas de espacios iguales. El modo por defecto al abrir el detalle es **"Por movimiento"** (no "Por rotación") -- al hacer click en un sector lo primero que se quiere ver es qué se mueve ahí.

Bug de paso: la leyenda de "Por movimiento" (los círculos de color) usaba las mismas clases `estado-*` que los `<rect>` de la grilla, con `fill` -- pero la leyenda son `<span>` (HTML, no SVG), y `fill` no existe para HTML, así que los círculos quedaban huecos. Se agregaron reglas `background` aparte para `.asientos-reales-chip.estado-*`.

Mesa de Trabajo y Recepción Aéreos **sí aparecen** en `PlanoEscaneado`/`PlanoInteractivoD3`/`PlanoSVG` (ver §10) desde que se trazó su `boundary_d` (§2/§3) — se dibuja el polígono (relleno gris claro en Dashboard v2 para que se lea como área real y no como hueco vacío) pero, al no tener `espacios`, no hay nada individual para colorear ni SKU que emparejar. Las únicas zonas que siguen sin ninguna geometría (ni siquiera el borde) son "14. LATERALES"/lo que quede sin trazar y "Cluster (mezz.)" — esas sí quedan afuera de todos los mapas con geometría real, listadas aparte en la tabla de zonas (que sigue trayendo las 13 completas, con o sin geometría).

## 8. Próximos pasos

1. Confirmar (o corregir) la hipótesis "14. LATERALES" = Rack Doble (§3).
2. ~~Trazar Mesas de trabajo y Zona de carpintería~~ — hecho (§3): `Mesa_x20_de_x20_Trabajo`/`Recepcion_x20_Aereos` ya se extraen como zonas con `boundary_d`. Sigue pendiente si algún día necesitan subdivisión interna (`espacios`) para mostrar SKU individuales — hoy no la tienen y no aportan capacidad.
3. Decidir y reconciliar: ¿la capacidad final de espacios es la de Excel, la del SVG, o se cuenta directamente desde el trazado final?

## 9. Modo de optimización "distancia real del SVG"

El optimizador (`backend/app/dominio/optimizador.py`) minimiza `N_LINEAS × TIEMPO_MINUTOS` por zona -- `TIEMPO_MINUTOS` y `DISTANCIA_METROS` son dos columnas **independientes** declaradas en el Excel (`LAYOUT_CD`), ninguna se calcula de la otra en este código. Ahora hay dos formas de obtener ese `TIEMPO_MINUTOS` para correr el optimizador, elegibles con un switch en el frontend ("Layout CD (Excel)" / "Distancia real (SVG)", `KpisPrincipales.tsx`):

- **`layout_cd`** (default, comportamiento de siempre): el `TIEMPO_MINUTOS` tal cual está en el Excel.
- **`svg`**: un `TIEMPO_MINUTOS` calibrado a partir de la distancia real medida en `vfinal.svg` desde cada zona hasta "Mesas de trabajo" -- el mismo punto de referencia que usa `movimientoReal.ts` (§7), pero acá para decidir la asignación completa, no solo el orden de llenado ilustrativo.

**El problema de las unidades:** la distancia real del SVG está en las unidades del dibujo (píxeles de Synoptic Designer), no en metros -- no hay una escala metros/píxel conocida para `vfinal.svg`. En vez de inventar un factor de conversión, `app/dominio/distancia_svg.py::calcular_layout_cd_svg` calibra por **regresión lineal** (`numpy.polyfit`, mínimos cuadrados) contra las zonas que sí tienen ambos datos: la distancia real (píxeles) y el `TIEMPO_MINUTOS` ya declarado en el Excel. La recta ajustada (`tiempo ≈ a·distancia_px + b`) se aplica a todas las zonas. Es una aproximación calibrada contra datos reales, nunca una medición de campo -- el switch y `KpisPrincipales.tsx` lo dicen explícitamente.

**De dónde sale la distancia real por zona:** `scripts/calcular_distancia_svg_zonas.py` (independiente de `extraer_layout_svg.py`, no lo modifica) lee `frontend/src/data/layoutEscaneado.json` (espacios reales + `referencia_mesa_trabajo`) y `mapeoZonas.json` (qué zona geométrica es cada clave de `LAYOUT_CD`), calcula el centroide de los espacios reales de cada zona mapeada y su distancia euclídea a la referencia, y escribe `backend/data/distancia_svg_por_zona.json` -- un diccionario simple `{ "1. LLANTAS": 311.04, ... }` que el backend consume sin tocar SVG ni geometría. Correr de nuevo cuando cambie el escaneo:

```
conda run -n IngenieriaPython python scripts/calcular_distancia_svg_zonas.py
```

**Qué NO cambia entre los dos modos:** el "Actual Declarado" (`TIEMPO_LAYOUT_ACTUAL`, calculado en `impacto.py::calcular_impacto_operativo` con el `layout_cd` ORIGINAL, siempre) -- es la referencia fija contra la que se comparan ambas propuestas (`kpis.productividad_actual_lineas_hh`/`tiempo_promedio_actual_min_pedido`, invariantes). Lo que sí cambia es el lado "propuesta": el optimizador puede recomendar **zonas distintas** por SKU en cada modo (verificado: ~32 de 100 SKU cambian de `ZONA_RECOMENDADA` entre `layout_cd` y `svg` en el dataset de práctica), no es solo un recálculo de KPI sobre la misma asignación.

`SolicitudPipeline.modo_distancia: "layout_cd" | "svg"` (`POST /pipeline/ejecutar`) -- default `"layout_cd"`, así que omitirlo no cambia el comportamiento existente. `PipelineContext.tsx` guarda el modo actual y los últimos pesos/tope usados, para poder re-ejecutar con el mismo criterio cuando solo cambia el switch.

## 10. `PlanoBase`/`PlanoSVG` ("Planta · zonificación") también usa geometría 100% real

Era el último mapa de la app que seguía con el polígono aproximado de `zonas.json` (`puntos_svg`) -- ya se había demostrado que no era fiel al escaneo real (§7). Ahora `PlanoBase.tsx` dibuja:

- El **contorno completo del edificio** (`LAYOUT_ESCANEADO.contorno_d`) en vez del pentágono aproximado (`CONTORNO_EDIFICIO`, constante que se borró).
- El **contorno real de cada zona** (`boundary_d`, un `<path>`) en vez de su polígono aproximado (`puntos_svg`, un `<polygon>`).

**A propósito, sin las ubicaciones individuales (`rect`/`path` de cada espacio)** -- este mapa sigue siendo el de referencia por técnica/densidad/distancia (un solo color por zona, `colorModos.ts` sin cambios), no el de ocupación real por SKU (ese ya es `PlanoEscaneado.tsx`, §7). Mezclar los dos hubiera sido redundante con `PlanoEscaneado` y mucho más pesado (900+ elementos extra) sin aportar nada a lo que este panel muestra.

**Qué zona real dibuja el contorno de cada zona esquemática** (`PlanoBase.tsx::CONTORNO_REAL_POR_ZONA`) -- un mapeo **distinto** de `mapeoZonas.json` (ese vincula por `clave_excel`, para ocupación real; acá se vincula **por nombre**, para fidelidad visual del contorno):

| zona.json (id) | Forma real usada | Nota |
|---|---|---|
| `cluster` | Cluster Multinivel | |
| `recepcion` | Recepcion Aereos | "Recepción de aéreos" -- zona real independiente de "Ubicación Recibo" (ver §11), actualmente vacía. |
| `recibo` | Recibido | "Ubicación Recibo" -- zona real independiente de "Recepción de aéreos" (ver §11), con sus 144 espacios reales. |
| `estanteria`, `doble`, `simple`, `balda14`, `balda22`, `neumaticos` (→Llantas), `bulk`, `colgantes`, `mesas` (→Mesa de Trabajo) | igual criterio, 1 a 1 por nombre | |
| `clustan`, `carpin` | *(ninguna)* | Sin geometría real trazada todavía -- no se dibujan, siguen en la tabla de zonas con "—". |

12 de 14 zonas con contorno real. El header/caption del panel lo muestra dinámicamente (`Object.keys(CONTORNO_REAL_POR_ZONA).length` vs `zonas.length`), nunca un número hardcodeado que se desactualice.

**Qué se sacó, y por qué:** los muelles (`Muelles`, 16 rects numerados), la grilla métrica (`GridMetrica`) y la escala "≈ 20 m" (`Escala`) eran geometría **inventada a mano**, calibrada solo para encajar visualmente en el polígono aproximado viejo -- posiciones de muelle arbitrarias, sin dato real detrás. Sobre el escaneo real no hay (todavía) ni una posición real de muelles ni una escala metros/píxel confirmada (mismo problema de calibración que §9) -- así que se sacan en vez de inventar una versión "real" que en realidad seguiría siendo arbitraria. El caption del panel lo dice explícitamente.

## 11. "Ubicación Recibo" y "Recepción de aéreos" son dos zonas reales distintas

Corrección de un error de datos que venía de antes de todo este trabajo de escaneo: `zonas.json` traía la zona `recepcion` ("Recepción de aéreos") con `clave_excel: "10. UBICACIÓN RECIBO"` -- y como esa era la única pista de a qué zona real (`Recibido`, 144 espacios) correspondía esa clave, todo el trabajo de mapeo (`mapeoZonas.json`) terminó fusionando las dos bajo el mismo `zonaId` ("recepcion"). El escaneo real las desmiente: sus posiciones reales están en extremos opuestos del edificio (Recibido abajo, cerca de Bulk; Recepción de aéreos arriba, cerca de Multinivel Cluster) -- son dos áreas físicas independientes, una de ellas con clave de Excel y ubicaciones reales, la otra vacía y sin equivalente en el Excel.

**Corrección aplicada:**
- `backend/data/zonas.json`: se agregó una zona nueva, `recibo` ("Ubicación Recibo", `clave_excel: "10. UBICACIÓN RECIBO"`, 144 ubicaciones) -- ahora son **14 zonas**, no 13. `recepcion` ("Recepción de aéreos") quedó con `clave_excel: "—"` y `lineas_picking: 0` (vacía, como corresponde a que no tiene equivalente real en el Excel).
- `frontend/src/data/mapeoZonas.json`: `Recibido` (el grupo real del SVG) ahora apunta a `zonaId: "recibo"` (antes apuntaba, mal, a `"recepcion"`). `Recepcion Aereos` ahora apunta a `zonaId: "recepcion"` (antes tenía un `zonaId` inventado, `"recepcion_aereos"`, que no coincidía con ningún id real de `zonas.json` y por lo tanto nunca resolvía nada vía `zonaEscaneadaPorId`). De paso se corrigió el mismo tipo de error en `Mesa de Trabajo` (`zonaId` pasó de `"mesa_trabajo"` a `"mesas"`, el id real).
- `PlanoBase.tsx::CONTORNO_REAL_POR_ZONA`: se agregó `recibo: 'Recibido'`.
- La tabla `zonas` en la base ya sembrada se volvió a poblar desde el `zonas.json` corregido (`DELETE FROM zonas` + `seed_zonas_si_vacio()`) -- esa siembra es de una sola vez al arrancar (§6 backend README), así que editar el JSON solo no alcanza si el backend ya corrió antes.

**Qué NO se tocó:** `backend/data/distancia_svg_por_zona.json` (§9) y `scripts/calcular_distancia_svg_zonas.py` ya usaban `claveExcel`/`nombreSvg` de `mapeoZonas.json` directamente, nunca el `zonaId` -- la distancia real calibrada para "10. UBICACIÓN RECIBO" ya estaba calculada correctamente desde el grupo real `Recibido`, sin importar que el `zonaId` estuviera mal asignado. No hizo falta recalcular nada ahí.
