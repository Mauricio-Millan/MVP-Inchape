# Cómo se decide a dónde mover cada SKU — modo "Layout CD (Excel)"

Este es el modo **default** del optimizador (`modo_distancia: "layout_cd"`, o simplemente omitir el campo). Usa el tiempo de acceso **tal cual está declarado en tu Excel**, hoja `LAYOUT_CD`. Ver `OPTIMIZACION-DISTANCIA-SVG.md` para el modo alternativo (distancia real medida sobre el layout escaneado).

---

## 1. De dónde sale el número que decide todo

`LAYOUT_CD` trae, por zona, dos columnas **independientes** — ninguna se calcula de la otra en este código:

| Columna | Qué es | Se usa para |
|---|---|---|
| `DISTANCIA_METROS` | Distancia declarada de la zona al punto de despacho/recepción | Solo informativo/reporte — el optimizador **no la usa directamente** |
| `TIEMPO_MINUTOS` | Tiempo de acceso declarado de la zona | **Esta es la que decide la asignación** |

Es decir: si tu Excel dice que "2. PISO" tiene `TIEMPO_MINUTOS = 1.60`, ese 1.60 es el costo de tiempo que el optimizador le asigna a *cualquier* SKU que termine en esa zona — sin importar cuán lejos esté realmente esa zona en el galpón. El optimizador confía en el dato declarado, no lo cuestiona ni lo recalcula.

## 2. La cuenta que hace el optimizador

Para cada SKU y cada zona candidata, el costo de picking es:

```
costo(SKU, zona) = N_LINEAS(SKU) × TIEMPO_MINUTOS(zona)
```

`N_LINEAS` es cuántas veces ese SKU apareció en líneas de pedido reales (no la rotación declarada del Excel — ver nota al final). El optimizador (`PuLP`, programación lineal entera) elige, para **todos** los SKU a la vez, la asignación zona-por-SKU que minimiza la suma de estos costos en todo el catálogo, más una penalización opcional por moverlo (`PENALIZACION_MOVIMIENTO`, hoy en `0.0` — no hay costo extra por mover un SKU, solo se compara el tiempo de acceso).

No es "cada SKU busca su mejor zona por separado" — es una decisión conjunta: mover el SKU A a la zona más rápida puede dejarla sin espacio para el SKU B, así que el solver considera todas las combinaciones simultáneamente sujeto a las restricciones de la sección 3.

## 3. Restricciones — lo que el optimizador NUNCA puede violar

Estas no son "criterios de puntuación" que compiten con el ahorro de tiempo — son restricciones duras del modelo de programación lineal. El solver directamente no puede proponer una solución que las rompa.

1. **Una zona por SKU.** Cada SKU termina asignado a exactamente una zona.
2. **Capacidad de zona.** El volumen total asignado a una zona (más lo que ya había ahí sin modelar) no puede superar su `CAPACIDAD_MAX_M3`. *Nota real de este dataset:* la ocupación total de la muestra es ~1% de la capacidad del CD — en la práctica esta restricción casi nunca es la que limita el resultado (`CLAUDE_1.md` #4).
3. **Tope de movimientos (`porcentaje_max_movimiento`).** Cuántos SKU como máximo puede reubicar el optimizador en una corrida — **configurable** desde "SKU · Slotting" (slider "Tope de SKU a mover", 1–100%, default 20%). Con el dataset de práctica (100 SKU), 20% = 20 SKU; subir el tope no cambia las reglas de decisión, solo cuántos SKU puede tocar el solver — normalmente esto SÍ es la restricción que limita el ahorro total en este dataset, no la capacidad.
4. **Zonas bloqueadas como destino nuevo (`ZONAS_NO_DESTINO`, `config.py`).** Zonas donde no se puede *entrar* con esta corrida (un SKU que ya estuviera ahí sí puede quedarse). Vacía por default — sin restricciones editoriales activas.
5. **Reglas de atributo (pestaña "Reglas").** Vos las creás en la app (ej. "SKU con `PESO_KG >= 25` solo en `2. PISO`", o "prohibido en `7. MEZANNINE`"). Se traducen en variables fijadas a 0/1 en el modelo — no son un "empujón" en el score, son un candado: si una regla fuerza `SKU → zona X`, el solver no tiene otra opción para ese SKU, así el resto del catálogo pierda tiempo.
6. **Incompatibilidad entre familias (pestaña "Reglas", nivel 1: "misma zona prohibida").** Dos familias marcadas como incompatibles nunca comparten zona destino.

## 4. Qué SI compite por puntaje (no es una restricción dura)

El **score de prioridad** (0–100, columna `SCORE_PRIORIDAD`, visible en "SKU · Slotting") es aparte — no participa en la función objetivo del optimizador. Es una combinación ponderada (sliders "Pesos del score ponderado") de ahorro potencial, rotación, clasificación ABC y facilidad de movimiento. Sirve para **priorizar/explicar** qué SKU conviene más mover primero, y para el ranking preliminar de candidatos — pero la decisión de A DÓNDE se mueve cada SKU la toma únicamente la ecuación de la sección 2, sujeta a las restricciones de la sección 3.

## 5. El "Actual Declarado" — la referencia que nunca cambia

`TIEMPO_LAYOUT_ACTUAL` de cada SKU es el `TIEMPO_MINUTOS` declarado de su zona **actual** (`ZONA_ACTUAL`) — se calcula una sola vez, siempre con el Excel original, sin importar si después corrés el optimizador en modo Excel o en modo SVG (ver el otro documento). Los KPIs "Productividad hoy" y "Tiempo promedio de picking hoy" (Resumen) se calculan con este valor — es la vara fija contra la que se mide cualquier propuesta.

## 6. Ejemplo numérico (datos reales del dataset de práctica)

```
SKU00035 (familia Soportes), hoy en "5. RACK SIMPLE" (TIEMPO_MINUTOS = 5.63)
N_LINEAS = 19

Costo actual = 19 × 5.63 = 106.97 min
Propuesta del optimizador: "2. PISO" (TIEMPO_MINUTOS = 1.60)
Costo nuevo  = 19 × 1.60 = 30.40 min
Ahorro estimado = 106.97 − 30.40 = 76.57 min
```

Esta es exactamente la `JUSTIFICACION` que ves en el tooltip/lista de cada SKU que se mueve.

## 7. Limitaciones honestas de este modo

- `TIEMPO_MINUTOS` es un dato **declarado**, no medido — el optimizador confía en que el Excel esté bien cargado. Si dos zonas con distancia física muy distinta comparten el mismo `TIEMPO_MINUTOS` declarado, el optimizador las trata como igual de rápidas.
- No usa la geometría real del almacén en absoluto — es el modo "de manual/Excel", útil como referencia y como lo que ya existía antes de escanear el layout. Para una asignación basada en la distancia real medida sobre el plano, ver `OPTIMIZACION-DISTANCIA-SVG.md`.
