import {
  crearCaso, actualizarCaso, getCaso, getTrazas, getAcciones, getMensajes,
  addTraza, siguienteOrden, addMensaje, tiposNecesidad,
} from './db.js';
import { crearContexto, ejecutarHerramienta, compacto, requiereTallerBici } from './tools.js';
import * as geo from './geo.js';
import { agenteAnalista, agenteInvestigador, agenteRecomendador, agenteChat } from './agents.js';

const TIPOS = tiposNecesidad();
const MODO = { a_pie: 'walk', bicicleta: 'bicycle', auto: 'drive', transporte_publico: 'transit', no_especificado: 'walk' };

function crearTraza(casoId) {
  let orden = siguienteOrden(casoId);
  return (tipo, actor, invocado_por, entrada, salida, estado = 'ok', duracion_ms = 0) =>
    addTraza({ caso_id: casoId, orden: ++orden, tipo, actor, invocado_por, entrada, salida, estado, duracion_ms });
}

// Ejecuta un paso, mide el tiempo y lo registra en la traza
async function paso(traza, tipo, actor, entrada, fn) {
  const t0 = Date.now();
  try {
    const salida = await fn();
    traza(tipo, actor, 'orquestador', entrada, salida, 'ok', Date.now() - t0);
    return salida;
  } catch (e) {
    traza(tipo, actor, 'orquestador', entrada, { error: e.message }, 'error', Date.now() - t0);
    throw e;
  }
}

// Reglas de calidad de la información que el orquestador aplica sobre lo que dijo el modelo
export function validarAnalisis(a, { tieneGps, origenTexto, tieneImagen }) {
  const preguntas = [...(a.preguntas_aclaratorias || [])];
  let estado = a.estado_informacion, motivo = a.motivo_estado;
  const forzar = (e, m, p) => { if (estado === 'suficiente') { estado = e; motivo = m; if (p) preguntas.push(p); } };

  if (a.tipo_necesidad === 'otro') forzar('fuera_de_alcance', 'La solicitud no corresponde a movilidad o servicios urbanos.');
  if (tieneImagen && a.hallazgos_imagen?.coincide_con_texto === false) {
    forzar('contradictoria', 'La imagen no coincide con lo descrito en el texto.', '¿Puedes confirmar qué necesitas o adjuntar la imagen correcta?');
  }
  if (a.confianza < 0.4) forzar('insuficiente', 'La confianza del análisis es baja.', '¿Puedes describir con más detalle lo que necesitas?');
  if (a.tipo_necesidad === 'ruta_a_destino' && !a.destino_texto?.trim()) {
    forzar('insuficiente', 'Falta el destino.', '¿A qué lugar o dirección quieres llegar?');
  }
  if (!tieneGps && !origenTexto?.trim() && !a.origen_texto?.trim()) {
    forzar('insuficiente', 'No se indicó un origen.', '¿Desde dónde sales? Escribe una dirección o comparte tu ubicación.');
  }
  return { estado, motivo, preguntas };
}

// Búsqueda directa (respaldo y ampliación de radio), registrada como herramientas del orquestador
async function buscarDirecto(ctx, analisis, radio) {
  const tipo = TIPOS.find((t) => t.clave === analisis.tipo_necesidad);
  for (const cat of tipo?.categorias_propias || []) {
    await ejecutarHerramienta(ctx, 'consultar_servicios_propios',
      { categoria: cat, radio_m: radio, solo_accesibles: !!analisis.requiere_accesibilidad }, 'orquestador');
  }
  if (tipo?.categoria_geoapify) {
    await ejecutarHerramienta(ctx, 'buscar_lugares_cercanos', { tipo_necesidad: tipo.clave, radio_m: radio, limite: 5 }, 'orquestador');
  }
  if (tipo?.clave === 'ruta_a_destino') {
    await ejecutarHerramienta(ctx, 'geocodificar_destino', { texto: analisis.destino_texto }, 'orquestador');
  }
}

export function detalleCaso(id) {
  const caso = getCaso(id);
  if (!caso) return null;
  return { caso, trazas: getTrazas(id), acciones: getAcciones(id), mensajes: getMensajes(id) };
}

// ======================= Flujo principal =======================
export async function procesarCaso({ texto, imagen, origenLat, origenLon, origenTexto, modoUsuario }) {
  const tieneGps = Number.isFinite(origenLat) && Number.isFinite(origenLon);
  const casoId = crearCaso({
    texto, imagen_path: imagen?.ruta || null, origen_lat: tieneGps ? origenLat : null,
    origen_lon: tieneGps ? origenLon : null, origen_texto: origenTexto || null, modo_usuario: modoUsuario || null,
  });
  const traza = crearTraza(casoId);
  const ctx = crearContexto({ casoId, origen: null, traza });
  traza('orquestador', 'recibir_caso', 'usuario', { texto, origenTexto, tieneGps, tieneImagen: !!imagen, modoUsuario }, { casoId });

  try {
    // 1. Agente Analista (multimodal, respuesta estructurada)
    const analisis = await paso(traza, 'agente', 'agente_analista', { tieneImagen: !!imagen },
      () => agenteAnalista({ texto, imagen, origenTexto, tieneGps, modoUsuario }));
    actualizarCaso(casoId, { analisis });
    ctx.analisis = analisis; // permite a las herramientas validar pertinencia al guardar

    // 2. Compuerta de calidad: información insuficiente, contradictoria o fuera de alcance
    const v = validarAnalisis(analisis, { tieneGps, origenTexto, tieneImagen: !!imagen });
    traza('orquestador', 'validar_analisis', 'orquestador', { estado_modelo: analisis.estado_informacion }, v);
    if (v.estado !== 'suficiente') {
      actualizarCaso(casoId, {
        analisis: { ...analisis, estado_informacion: v.estado, motivo_estado: v.motivo, preguntas_aclaratorias: v.preguntas },
        estado: v.estado === 'fuera_de_alcance' ? 'fuera_de_alcance' : 'requiere_aclaracion',
      });
      return detalleCaso(casoId);
    }

    // 3. Resolver el origen (GPS o geocodificación del texto)
    let origen;
    if (tieneGps) origen = { lat: origenLat, lon: origenLon, fuente: 'gps', etiqueta: 'Ubicación compartida' };
    else {
      const textoOrigen = (origenTexto || analisis.origen_texto).trim();
      const g = await paso(traza, 'herramienta', 'geocodificar_origen', { textoOrigen },
        () => geo.geocode(/bogot/i.test(textoOrigen) ? textoOrigen : `${textoOrigen}, Bogotá`));
      if (!g) {
        actualizarCaso(casoId, {
          analisis: { ...analisis, estado_informacion: 'insuficiente', motivo_estado: 'No se pudo ubicar el origen indicado.',
            preguntas_aclaratorias: ['No encontré ese origen. ¿Puedes escribir una dirección más precisa o usar tu ubicación?'] },
          estado: 'requiere_aclaracion',
        });
        return detalleCaso(casoId);
      }
      origen = { lat: g.lat, lon: g.lon, fuente: 'geocodificacion', etiqueta: g.formatted };
    }
    ctx.origen = origen;
    actualizarCaso(casoId, { origen_lat: origen.lat, origen_lon: origen.lon });

    // 4. Agente Investigador (herramientas); si falla, el orquestador usa búsqueda directa
    let resumen = '';
    try {
      resumen = await paso(traza, 'agente', 'agente_investigador', { tipo: analisis.tipo_necesidad },
        () => agenteInvestigador(ctx, analisis));
    } catch (e) {
      resumen = `El agente investigador falló (${e.message}); se aplicó búsqueda directa.`;
      await buscarDirecto(ctx, analisis, 3000);
    }

    // 5. Condición: si no hubo candidatos se amplía el radio una vez
    if (ctx.candidatos.size === 0) {
      traza('orquestador', 'ampliar_busqueda', 'orquestador', { radio_m: 6000 }, { motivo: 'Sin candidatos en el radio inicial' });
      await buscarDirecto(ctx, analisis, 6000);
    }
    if (ctx.candidatos.size === 0) {
      actualizarCaso(casoId, {
        estado: 'sin_resultados',
        resultado: { origen, resumen_investigacion: resumen, candidatos: [], recomendacion: null },
      });
      return detalleCaso(casoId);
    }

    // 6. Completar rutas faltantes de los 3 candidatos más cercanos
    const modo = MODO[analisis.modo_transporte] || 'walk';
    const cercanos = [...ctx.candidatos.values()].sort((a, b) => a.distancia_m - b.distancia_m).slice(0, 3).filter((c) => !c.ruta);
    for (const c of cercanos) await ejecutarHerramienta(ctx, 'calcular_ruta', { destino_id: c.id, modo }, 'orquestador');

    // 7. Agente Recomendador (ejecuta la acción guardar_recomendacion); respaldo por regla
    const todos = [...ctx.candidatos.values()];
    const adecuados = requiereTallerBici(analisis)
      ? todos.filter((c) => c.categoria === 'taller_bicicletas')
      : todos;
    // Sin candidatos que acrediten el servicio, NO inventamos una recomendación.
    if (!adecuados.length) {
      actualizarCaso(casoId, {
        estado: 'sin_resultados',
        resultado: {
          origen, resumen_investigacion: `${resumen} No se hallaron servicios que acrediten la reparación solicitada.`,
          candidatos: todos, recomendacion: null,
        },
      });
      return detalleCaso(casoId);
    }
    const ordenados = adecuados
      .sort((a, b) => (a.ruta?.tiempo_s ?? a.distancia_m * 2) - (b.ruta?.tiempo_s ?? b.distancia_m * 2)).slice(0, 6);
    try {
      await paso(traza, 'agente', 'agente_recomendador', { candidatos: ordenados.map((c) => c.id) },
        () => agenteRecomendador(ctx, analisis, ordenados.map(compacto)));
    } catch (e) { /* se aplica el respaldo */ }
    if (!ctx.recomendacion) {
      const mejor = ordenados[0];
      await ejecutarHerramienta(ctx, 'guardar_recomendacion', {
        candidato_id: mejor.id, alternativas_ids: ordenados.slice(1, 3).map((c) => c.id),
        justificacion: `Es la opción más cercana según los datos obtenidos (${mejor.distancia_m} m en línea recta).`,
        pasos: ['Dirígete al lugar recomendado siguiendo la ruta del mapa.'],
        advertencias: [
          'Recomendación generada por regla de respaldo; confirma horarios antes de salir.',
          ...(/\(demo\)/i.test(mejor.nombre) ? ['Servicio de demostración: no constituye un taller real verificado.'] : []),
        ],
      }, 'orquestador');
    }

    // 8. Persistir resultado
    actualizarCaso(casoId, {
      estado: 'recomendado',
      resultado: { origen, resumen_investigacion: resumen, candidatos: [...ctx.candidatos.values()], recomendacion: ctx.recomendacion },
    });
    return detalleCaso(casoId);
  } catch (e) {
    traza('orquestador', 'error_flujo', 'orquestador', {}, { error: e.message }, 'error');
    actualizarCaso(casoId, { estado: 'error', error: e.message });
    return detalleCaso(casoId);
  }
}

// ======================= Chat contextual =======================
export async function responderChat(casoId, mensaje) {
  const caso = getCaso(casoId);
  if (!caso) return null;
  if (!caso.resultado?.origen) {
    const err = new Error('Este caso aún no tiene un origen verificado. Crea un nuevo caso con la información solicitada.');
    err.status = 400; throw err;
  }
  const traza = crearTraza(casoId);
  const ctx = crearContexto({ casoId, origen: caso.resultado.origen, traza, candidatos: caso.resultado.candidatos || [] });
  const historial = getMensajes(casoId);
  addMensaje(casoId, 'user', mensaje);

  const respuesta = await paso(traza, 'agente', 'agente_chat', { pregunta: mensaje }, () => agenteChat(ctx, caso, historial, mensaje));
  addMensaje(casoId, 'model', respuesta);
  // Conservar candidatos nuevos encontrados durante el chat
  actualizarCaso(casoId, { resultado: { ...caso.resultado, candidatos: [...ctx.candidatos.values()] } });
  return detalleCaso(casoId);
}
