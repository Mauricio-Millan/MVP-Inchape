# Cómo se decide a dónde mover cada SKU — modo "Distancia real (SVG)"

Modo alternativo del optimizador (`modo_distancia: "svg"`, switch "Distancia real (SVG)" en Resumen). Usa un tiempo de acceso **estimado a partir de la distancia real medida sobre el layout escaneado del almacén** (`layout inchape vfinal.svg`) en vez del declarado en el Excel. Ver `OPTIMIZACION-DISTANCIA-LAYOUT-CD.md` para el modo default y el detalle de las restricciones/reglas — son **las mismas** en ambos modos (capacidad, tope de movimientos, reglas de atributo, incompatibilidad de familias); este documento se enfoca en lo que cambia: de dónde sale el tiempo por zona.

---

## 1. La idea

El Excel declara un `TIEMPO_MINUTOS` por zona, pero ese número puede no reflejar bien la distancia real dentro del almacén — especialmente ahora que tenemos el layout escaneado (`vfinal.svg`) con la posición real de cada zona. Este modo reemplaza el tiempo declarado por uno **calculado a partir de esa geometría real**, para poder comparar: ¿la propuesta cambia si confiamos en la distancia real en vez de en el número del Excel?

## 2. De dónde sale la distancia real

`scripts/calcular_distancia_svg_zonas.py` mide, para cada zona de `LAYOUT_CD` que ya tiene geometría real trazada, la distancia desde el **centro de esa zona** (promedio de los centros de todos sus espacios reales) hasta **"Mesas de trabajo"** — el mismo punto de referencia real que usa el resto de la app para el llenado ilustrativo de los mapas (`movimientoReal.ts`, ver `LAYOUT-SVG-ESCANEADO.md` §7). El resultado se guarda en `backend/data/distancia_svg_por_zona.json`:

```json
{
  "1. LLANTAS": 311.04,
  "2. PISO": 272.97,
  "4. RACK BALDA": 203.41,
  "5. RACK SIMPLE": 175.31,
  "6. RACK COLGANTES": 375.73,
  "7. MEZANNINE": 199.51,
  "8. CLUSTER": 272.81,
  "10. UBICACIÓN RECIBO": 233.77,
  "14. LATERALES": 172.3
}
```

Estos números están en las **unidades del dibujo SVG** (píxeles de la herramienta de trazado, Synoptic Designer) — no son metros. Cubren las 9 zonas de `LAYOUT_CD` (una de ellas, "14. LATERALES", está asignada a la zona geométrica "Rack Doble" a modo de hipótesis sin confirmar — ver `LAYOUT-SVG-ESCANEADO.md` §3).

## 3. El problema de las unidades — y cómo se resuelve sin inventar nada

Para poder usar esta distancia en el mismo optimizador (que necesita minutos, no píxeles) hace falta convertirla. No existe una escala metros/píxel conocida para `vfinal.svg`, así que **no se inventa un factor de conversión**. En cambio, se calibra por **regresión lineal** (`numpy.polyfit`, mínimos cuadrados) contra el único dato real disponible: las zonas que ya tienen *ambos* números — su distancia real (píxeles) y su `TIEMPO_MINUTOS` ya declarado en el Excel.

```
tiempo_estimado(zona) ≈ a × distancia_svg(zona) + b
```

`a` y `b` se ajustan una sola vez, usando las 9 zonas conocidas como muestra de calibración, y luego se aplican a todas — así que el resultado sigue proporcional a la distancia real medida, pero expresado en la misma escala de minutos que ya usa el resto del sistema. (`backend/app/dominio/distancia_svg.py::calcular_layout_cd_svg`.)

Zonas sin distancia real conocida (SVG todavía no trazado para esa zona) **conservan** su `TIEMPO_MINUTOS` declarado tal cual — nunca se inventa una posición para lo que no está medido.

## 4. La cuenta que hace el optimizador (igual estructura, otro insumo)

```
costo(SKU, zona) = N_LINEAS(SKU) × TIEMPO_MINUTOS_SVG(zona)
```

Mismo optimizador, mismas restricciones duras (capacidad, tope de movimientos, reglas de atributo, incompatibilidad de familias — ver `OPTIMIZACION-DISTANCIA-LAYOUT-CD.md` §3) — lo único que cambia es qué `TIEMPO_MINUTOS` usa cada zona. Esto significa que el optimizador puede recomendar **zonas distintas** por SKU en este modo: no es un recálculo cosmético del mismo resultado.

**Verificado con el dataset de práctica:** ~32 de 100 SKU terminan con una `ZONA_RECOMENDADA` distinta entre el modo Excel y el modo SVG. La mejora total también cambia — en este dataset, el modo Excel estima ~29% de reducción de tiempo de picking, mientras que el modo SVG da una mejora casi nula (incluso ligeramente negativa) porque, medida por distancia real, la propuesta que optimiza contra el dato declarado no resulta tan buena.

## 5. Qué NO cambia respecto al modo Excel

- **El "Actual Declarado"** (`TIEMPO_LAYOUT_ACTUAL`, KPIs de "hoy") — siempre se calcula con el `LAYOUT_CD` **original**, nunca con la versión calibrada por SVG. Es la misma referencia fija en los dos modos, para que la comparación sea justa.
- **Las restricciones y reglas** — capacidad, tope de movimientos, zonas bloqueadas, reglas de atributo, incompatibilidad de familias. Todas idénticas, ver el otro documento.
- **El score de prioridad** (`SCORE_PRIORIDAD`) — sigue sin participar en la decisión del optimizador en ningún modo, es solo para explicar/priorizar.

## 6. Limitaciones honestas de este modo (léelas antes de presentar estos números)

- **Nunca es una medición de campo.** Es una aproximación calibrada contra el propio Excel — si el Excel está mal cargado, la calibración hereda ese error.
- **La calibración es una sola recta para todo el almacén**, no una escala por zona/pasillo — si la relación real distancia↔tiempo no es lineal en algún tramo (ej. un pasillo mucho más angosto), la recta no lo captura.
- **Solo cubre las 9 zonas con geometría real trazada** hasta ahora (ver `LAYOUT-SVG-ESCANEADO.md` §3 para el estado del trazado) — zonas nuevas sin escanear seguirían usando el tiempo declarado del Excel hasta que se agreguen a `distancia_svg_por_zona.json`.
- **"14. LATERALES"** depende de una hipótesis de mapeo sin confirmar (→ "Rack Doble") — si esa hipótesis está mal, el tiempo estimado para esa zona específica no corresponde a la zona real.
- Regenerar `backend/data/distancia_svg_por_zona.json` (`conda run -n IngenieriaPython python scripts/calcular_distancia_svg_zonas.py`) cada vez que cambie el escaneo del SVG o el mapeo de zonas (`mapeoZonas.json`) — si no, la calibración queda desactualizada contra un layout viejo.
