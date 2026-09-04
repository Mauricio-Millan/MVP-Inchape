import { utils, writeFile } from 'xlsx';
import type { RecomendacionSKU, RespuestaPipeline } from '../api/pipeline';
import { etiquetaModelo } from './modelosSlotting';

/** Nombres de KPI propio del modelo (`Kpis.kpis_modelo`, ver
 * `backend/app/dominio/kpis.py::calcular_kpis_modelo`) a texto legible
 * para la hoja de resumen -- si aparece una clave nueva que no está acá,
 * se muestra tal cual (nunca se descarta silenciosamente). */
const ETIQUETA_KPI_MODELO: Record<string, string> = {
  valor_en_zona_rapida_pct: '% del valor en zonas rápidas',
  sku_promovidos_a_zona_rapida: 'SKU promovidos a zona rápida',
  sku_promovidos_riesgo_bajo: 'De esos, con riesgo de obsolescencia Bajo',
  cobertura_critica_pct: '% de SKU Crítico/Alto en zonas rápidas',
  peor_caso_critico_min: 'Peor caso crítico (min de acceso)',
};

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Fila con las 12 columnas exactas de la hoja CONSTRUYE_TU_SLOTTING del
 * Excel del ejercicio -- MI_LOGICA es el nombre del modelo (la hoja
 * original la deja en blanco para que el estudiante escriba su criterio
 * a mano; acá la llena el modelo real que decidió la propuesta),
 * JUSTIFICACION es el texto que ya arma el backend explicando por qué se
 * mueve cada SKU a esa zona (`recomendaciones.py::_generar_justificacion`,
 * distinto en términos según el modelo -- minutos, valor o criticidad). */
function aFilaPlantilla(r: RecomendacionSKU, nombreModelo: string) {
  return {
    SKU: r.SKU,
    MARCA: r.MARCA,
    FAMILIA: r.FAMILIA,
    ROT_6M: r.ROTACION_6M,
    VOL_M3: r.VOLUMEN_M3,
    PESO_KG: r.PESO_KG,
    ZONA_ACTUAL: r.ZONA_ACTUAL,
    TIEMPO_HOY_MIN: redondear(r.TIEMPO_LAYOUT_ACTUAL),
    MI_LOGICA: nombreModelo,
    ZONA_NUEVA: r.ZONA_RECOMENDADA,
    TIEMPO_NUEVO_MIN: redondear(r.TIEMPO_NUEVO_MIN),
    JUSTIFICACION: r.JUSTIFICACION,
  };
}

/** Exporta la propuesta activa (el modelo que corrió esta `resultado`) a
 * un .xlsx: una hoja con el formato exacto de la plantilla
 * CONSTRUYE_TU_SLOTTING, y una hoja RESUMEN_MODELO con la línea base,
 * la propuesta y los KPI propios del modelo. 100% en cliente -- SheetJS
 * ya es dependencia y `resultado` ya está completo en memoria, no hace
 * falta ningún endpoint nuevo. */
export function exportarPropuestaSlotting(resultado: RespuestaPipeline): void {
  const nombreModelo = etiquetaModelo(resultado.modo_objetivo);
  const filasSlotting = resultado.recomendaciones.map((r) => aFilaPlantilla(r, nombreModelo));

  const libro = utils.book_new();

  const hojaSlotting = utils.json_to_sheet(filasSlotting);
  hojaSlotting['!cols'] = [
    { wch: 10 }, // SKU
    { wch: 9 }, // MARCA
    { wch: 12 }, // FAMILIA
    { wch: 7 }, // ROT_6M
    { wch: 8 }, // VOL_M3
    { wch: 9 }, // PESO_KG
    { wch: 20 }, // ZONA_ACTUAL
    { wch: 14 }, // TIEMPO_HOY_MIN
    { wch: 22 }, // MI_LOGICA
    { wch: 20 }, // ZONA_NUEVA
    { wch: 16 }, // TIEMPO_NUEVO_MIN
    { wch: 70 }, // JUSTIFICACION
  ];
  utils.book_append_sheet(libro, hojaSlotting, 'CONSTRUYE_TU_SLOTTING');

  const { kpis } = resultado;
  const filasResumen: { CAMPO: string; VALOR: string | number }[] = [
    { CAMPO: 'Modelo', VALOR: nombreModelo },
    { CAMPO: 'SKU analizados', VALOR: kpis.sku_analizados },
    { CAMPO: 'SKU movidos', VALOR: kpis.sku_movidos },
    { CAMPO: 'Tope de movimientos', VALOR: kpis.max_movimientos_permitidos },
    { CAMPO: '', VALOR: '' },
    { CAMPO: 'Tiempo actual (línea base, min)', VALOR: redondear(kpis.tiempo_actual_min) },
    { CAMPO: 'Tiempo propuesto (min)', VALOR: redondear(kpis.tiempo_optimizado_min) },
    { CAMPO: 'Reducción (%)', VALOR: redondear(kpis.reduccion_porcentaje) },
    { CAMPO: 'Tiempo promedio actual (min/pedido)', VALOR: redondear(kpis.tiempo_promedio_actual_min_pedido) },
    { CAMPO: 'Tiempo promedio propuesto (min/pedido)', VALOR: redondear(kpis.tiempo_promedio_optimizado_min_pedido) },
    { CAMPO: 'Productividad actual (líneas/HH)', VALOR: redondear(kpis.productividad_actual_lineas_hh) },
    { CAMPO: 'Productividad propuesta (líneas/HH)', VALOR: redondear(kpis.productividad_optimizada_lineas_hh) },
    { CAMPO: '', VALOR: '' },
    { CAMPO: 'Personal necesario', VALOR: '' },
    { CAMPO: 'Horas-hombre actual', VALOR: redondear(kpis.horas_hombre_actual) },
    { CAMPO: 'Horas-hombre propuesto', VALOR: redondear(kpis.horas_hombre_optimizado) },
    { CAMPO: 'Pedidos atendibles con la misma dotación', VALOR: redondear(kpis.pedidos_atendibles_con_misma_dotacion) },
    { CAMPO: 'FTE actual (jornada 8h x 22d/mes)', VALOR: redondear(kpis.fte_actual) },
    { CAMPO: 'FTE propuesto', VALOR: redondear(kpis.fte_optimizado) },
  ];

  if (kpis.kpis_modelo) {
    filasResumen.push({ CAMPO: '', VALOR: '' }, { CAMPO: `KPI propio de ${nombreModelo}`, VALOR: '' });
    for (const [clave, valor] of Object.entries(kpis.kpis_modelo)) {
      filasResumen.push({ CAMPO: ETIQUETA_KPI_MODELO[clave] ?? clave, VALOR: redondear(valor) });
    }
  }

  const hojaResumen = utils.json_to_sheet(filasResumen, { skipHeader: false });
  hojaResumen['!cols'] = [{ wch: 42 }, { wch: 22 }];
  utils.book_append_sheet(libro, hojaResumen, 'RESUMEN_MODELO');

  writeFile(libro, `slotting-${resultado.modo_objetivo}.xlsx`);
}
