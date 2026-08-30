# Layout SVG escaneado — cómo aprovechar el trazado real del almacén

Fecha: 2026-08-27 (v3), actualizado 2026-08-27 (v4). Documenta los SVG "layout inchape v3/v4.svg" (raíz del proyecto): qué son, qué contrato deben cumplir para que el pipeline los entienda, cómo regenerar los datos cuando subas una versión más completa, y dónde se usan hoy.

Nombres de archivo de datos/código deliberadamente **sin número de versión** (`layoutEscaneado.json`, `layoutEscaneado.ts`, `PlanoEscaneado.tsx`) — se sobrescriben cada vez que llega un escaneo más completo, no hay que renombrar nada en el frontend cuando eso pase. Los SVG crudos sí quedan versionados por nombre (`layout  inchape v3.svg`, `v4.svg`, ...) porque son snapshots reales de cada entrega.

---

## 1. Qué es el archivo

Exportado de una herramienta tipo SCADA/sinóptico ("Synoptic Designer", `data-synoptic-designer-version="2.0.5"` en el `<svg>` raíz). La v3 traía además una imagen de fondo trazada embebida (ver §5); la v4 ya no la trae (exportada directo sin esa capa). Lo que sí importa en ambas es la **capa vectorial**: grupos `<g id="Grupo_x20_<Nombre de Zona>">`, cada uno con:

- Un `<path>` con `title="<Nombre de Zona>"` — el **polígono real del borde de la zona**.
- Varios `<rect>` — cada uno es **una posición de espacio real**, con su `x`, `y`, `width`, `height` y (si el editor lo generó así) un `transform` de `translate`/`matrix`/`scale`/`rotate` para ubicarlo dentro del polígono.

`_x20_` es el espacio codificado como en una URL — así nombra los ids el editor cuando el nombre de la zona tiene espacios.

## 2. Contrato para que el script lo reconozca

`scripts/extraer_layout_svg.py` busca exactamente esto — si sigues dibujando zonas nuevas en el mismo editor con la misma convención, el script las levanta solas, sin tocar código:

- Un `<g id="Grupo_x20_...">` por zona.
- Dentro, **un** `<path>` con atributo `title` = el nombre de la zona.
- Dentro, **uno o más** `<rect>` por cada posición de espacio real que quieras que cuente como una ubicación.

No importa el orden interno de los `<rect>`, ni si tienen `transform` o no — el script resuelve `translate`, `matrix`, `scale` y `rotate` a coordenadas finales absolutas. Si algún rect queda con rotación o escala no-axial, el script lo avisa por consola (no lo descarta, pero su `x/y/width/height` extraído es solo el bounding box).

## 3. Estado actual (v4, ago 2026)

| Zona trazada | Espacios en el SVG | Total ya definido en `espaciosZona.ts` (tu Excel) |
|---|---|---|
| Rack Doble | 36 | 50 |
| Rack Simple | 35 | 84 |
| Rack Balda 2.2 | 39 | 162 |
| Rack Balda 1.4 (`title="Balda 1.4"`) | 39 | 96 |
| Estantería Multinivel | 278 | 211 |
| Bulk *(nuevo en v4)* | 344 | 154 |
| Rack Neumáticos / Llantas *(nuevo en v4)* | 102 | 72 |
| Cluster Multinivel *(nuevo en v4)* | 30 | 32 |

También apareció trazado **"Recibido"** (Recepción de aéreos, `title="UBI-Recibido"`, 144 espacios) — queda **fuera a propósito**: no es una zona de ubicación de almacenamiento (decisión explícita, ago 2026, igual que Mesas de trabajo y Zona de carpintería).

**Falta de trazar:** solo **Rack Colgantes**.

Los conteos de este SVG siguen sin coincidir con los de Excel en la mayoría de zonas (Cluster Multinivel es la excepción: 30 vs 32, muy cerca). Por decisión explícita, mientras tanto:
- El **plano/forma** de estas 8 zonas se usa tal cual, tanto en el panel comparativo como en el detalle de zona (ver §6).
- La **capacidad oficial de espacios** (para "ocupados/libres" agregados) sigue siendo la de `espaciosZona.ts`, no la de este SVG.

## 4. Cómo regenerar los datos cuando subas una versión nueva

Desde `MVP-Inchape/`, con el entorno `IngenieriaPython` activo:

```
conda run -n IngenieriaPython python scripts/extraer_layout_svg.py "<nombre del nuevo svg>.svg" frontend/src/data/layoutEscaneado.json
```

Sobrescribe `frontend/src/data/layoutEscaneado.json` — el frontend lo recoge automáticamente. No hace falta tocar `layoutEscaneado.ts` ni los componentes **salvo que agregues una zona con un nombre nuevo** — en ese caso, agrégala al array `ZONAS_ESCANEADAS` en `frontend/src/components/mapas/layoutEscaneado.ts` con su `zonaId` (el id que ya usa `zonas.json`/`espaciosZona.ts`) y su `claveExcel` (el nombre real de `LAYOUT_CD`, o `null` si esa zona no tiene equivalente/es no-primaria de una clave compartida — ver README backend §3.1).

## 5. Limpieza de SVG con imagen de fondo embebida

Si una futura versión vuelve a traer la imagen de fondo trazada (como la v3), pesa cientos de KB de más y no se usa para nada en el frontend. `scripts/limpiar_layout_svg.py` genera una copia sin esa capa, sin tocar ninguna zona/path/rect real:

```
conda run -n IngenieriaPython python scripts/limpiar_layout_svg.py "<archivo>.svg" "<archivo>-limpio.svg"
```

v3: 782 KB → 156 KB (verificado: misma extracción exacta). v4 no trae esa capa — el script no encuentra nada que quitar y no hace falta correrlo. Sigue editando el archivo **original** (con la imagen de fondo, si la trae) en Synoptic Designer si necesitas la referencia visual para seguir trazando.

## 6. Dónde se usa hoy

- `frontend/src/data/layoutEscaneado.json` — salida cruda del script (no editar a mano).
- `frontend/src/components/mapas/layoutEscaneado.ts` — tipos + mapeo nombre-de-zona-en-el-SVG → `zonaId`/`claveExcel` de la app (`ZONAS_ESCANEADAS`, `zonaEscaneadaPorId`).
- `frontend/src/components/mapas/PlanoEscaneado.tsx` — el panel "Plano real (escaneado)": dibuja el polígono real de cada zona trazada y sus espacios reales, con un toggle **Por ocupación / Por rotación**. Click en una zona abre el mismo `DetalleZona` que el resto de los mapas. Se renderiza en **Resumen** (debajo del mapa de calor esquemático) y en **Mapas** (entre el comparativo Hoy/Propuesta y el plano de referencia por técnica).
- `frontend/src/components/mapas/VistaAsientosReales.tsx` — **estilo "asientos de cine"**: al hacer click en cualquier zona que ya tenga geometría real (desde cualquier mapa de la app, no solo `PlanoEscaneado`), `DetalleZona` muestra esta vista en vez de la grilla CSS ilustrativa. Un círculo por espacio real, en su posición real, con 4 estados:
  - **Blanco** = disponible (nadie ahí, ni hoy ni en la propuesta).
  - **Azul** = ocupada y se mantiene (está hoy y sigue ahí en la propuesta).
  - **Rojo** = se va a mover (está hoy, la propuesta la saca).
  - **Verde** = llega (propuesta) — no está hoy en esta posición puntual, pero la propuesta trae ese número de SKU nuevos a la zona. Es **ilustrativo**: como no existe una asignación real posición-por-posición (`STOCK_ACTUAL` no trae fila/columna), no se puede decir *cuál* espacio libre específico ocupará cada llegada — solo *cuántos* de los libres pasarán a estar ocupados.

  Para zonas SIN geometría real todavía (Rack Colgantes, y las 13 menos las 8 ya escaneadas), `DetalleZona` sigue mostrando la grilla CSS ilustrativa de siempre (`GrillaSkus`/`espaciosZona.ts`) — nada se rompe, solo mejora donde ya hay dato real.

### Otros estados posibles (no implementados, quedan como idea)

Preguntaste explícitamente si hay más estados representables. Con los datos que ya calcula el pipeline, estos son implementables sin trabajo de backend:

- **Bloqueada por regla**: la posición nunca podría alojar cierto tipo de SKU por una regla de negocio activa en esa zona (ej. "livianos fuera de piso") — un patrón diagonal/hachurado en vez de un color sólido.
- **Riesgo ergonómico (NIOSH)**: el SKU ahí excede la constante NIOSH de 23kg (`app/dominio/ergonomia.py`, ya calculado) — un borde de advertencia o ícono, no un color nuevo (para no competir con el estado de movimiento).
- **Alta prioridad / ABC=A**: destacar visualmente los SKU de mayor importancia con un borde o tamaño distinto, sin cambiar el color base (que ya comunica el movimiento).

Ninguno se implementó — son ideas para si te sirven más adelante, no una limitación técnica.

## 7. Próximos pasos

1. Terminar de trazar Rack Colgantes (la única zona de almacenamiento que falta).
2. Decidir y reconciliar: ¿la capacidad final de espacios es la de Excel, la del SVG, o se cuenta directamente desde el trazado final?
3. Recién ahí: promover esta geometría real a reemplazar también `zonas.json` (`puntos_svg` aproximados) en el plano principal — hoy el plano principal (`PlanoBase.tsx`) sigue usando las 13 zonas esquemáticas; solo el detalle al hacer click (`DetalleZona`) y el panel `PlanoEscaneado` usan la geometría real.
