import { db, addAccion, tiposNecesidad } from './db.js';
import * as geo from './geo.js';

const TIPOS = tiposNecesidad();
const CATEGORIAS_PROPIAS = db.prepare('SELECT DISTINCT categoria FROM servicios').all().map((r) => r.categoria);
const TIPOS_CON_GEO = TIPOS.filter((t) => t.categoria_geoapify).map((t) => t.clave);
export const MODOS = ['walk', 'bicycle', 'drive', 'transit'];

// Clasificación conservadora: alquiler o estacionamiento NO equivale a reparación.
export function requiereTallerBici(analisis) {
  if (analisis?.tipo_necesidad !== 'bicicleta') return false;
  const descripcion = [analisis.resumen_necesidad, ...(analisis.restricciones || [])].join(' ');
  return /(repar|pinchad|llanta|taller|frenos|mantenimiento)/i.test(descripcion);
}


export function haversine(a, b) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- Declaraciones que ve el modelo ----------
export const DECL = {
  consultar_servicios_propios: {
    name: 'consultar_servicios_propios',
    description: 'Consulta el catálogo propio de la aplicación (SQLite) de servicios urbanos cercanos al origen del usuario.',
    parameters: { type: 'OBJECT', properties: {
      categoria: { type: 'STRING', enum: CATEGORIAS_PROPIAS, description: 'Categoría del servicio propio' },
      radio_m: { type: 'INTEGER', description: 'Radio de búsqueda en metros (por defecto 3000)' },
      solo_accesibles: { type: 'BOOLEAN', description: 'Solo servicios con acceso para movilidad reducida' },
    } },
  },
  buscar_lugares_cercanos: {
    name: 'buscar_lugares_cercanos',
    description: 'Busca lugares reales cerca del origen usando el servicio externo Geoapify Places.',
    parameters: { type: 'OBJECT', properties: {
      tipo_necesidad: { type: 'STRING', enum: TIPOS_CON_GEO },
      radio_m: { type: 'INTEGER', description: 'Radio en metros (por defecto 3000)' },
      limite: { type: 'INTEGER', description: 'Máximo de resultados (por defecto 5)' },
    }, required: ['tipo_necesidad'] },
  },
  geocodificar_destino: {
    name: 'geocodificar_destino',
    description: 'Convierte un destino escrito (dirección o lugar de Bogotá) en coordenadas con Geoapify. Devuelve un id de candidato.',
    parameters: { type: 'OBJECT', properties: { texto: { type: 'STRING' } }, required: ['texto'] },
  },
  calcular_ruta: {
    name: 'calcular_ruta',
    description: 'Calcula distancia y tiempo reales desde el origen hasta un candidato ya encontrado (usa su id) con Geoapify Routing.',
    parameters: { type: 'OBJECT', properties: {
      destino_id: { type: 'STRING', description: 'Id devuelto por otra herramienta' },
      modo: { type: 'STRING', enum: MODOS },
    }, required: ['destino_id', 'modo'] },
  },
  guardar_recomendacion: {
    name: 'guardar_recomendacion',
    description: 'ACCIÓN: guarda en la base de datos la recomendación final del caso.',
    parameters: { type: 'OBJECT', properties: {
      candidato_id: { type: 'STRING', description: 'Id del candidato elegido' },
      alternativas_ids: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Ids de hasta 2 alternativas' },
      justificacion: { type: 'STRING', description: 'Por qué se eligió, citando solo datos del contexto' },
      pasos: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Pasos sugeridos para el usuario' },
      advertencias: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Datos no verificados o riesgos' },
    }, required: ['candidato_id', 'justificacion', 'pasos', 'advertencias'] },
  },
  guardar_ruta_en_caso: {
    name: 'guardar_ruta_en_caso',
    description: 'ACCIÓN: guarda en el caso la ruta hacia un candidato elegido por el usuario (recorrido guardado).',
    parameters: { type: 'OBJECT', properties: {
      destino_id: { type: 'STRING' },
      modo: { type: 'STRING', enum: MODOS },
      nota: { type: 'STRING', description: 'Nota opcional del usuario' },
    }, required: ['destino_id', 'modo'] },
  },
};

// ---------- Contexto y ejecución ----------
export function crearContexto({ casoId, origen, traza, candidatos = [] }) {
  return {
    casoId, origen, traza,
    candidatos: new Map(candidatos.map((c) => [c.id, c])),
    recomendacion: null,
    nDestinos: 0,
  };
}

const compacto = (c) => ({
  id: c.id, nombre: c.nombre, categoria: c.categoria, fuente: c.fuente,
  distancia_m: c.distancia_m, horario: c.horario, accesible: c.accesible, notas: c.notas,
  ruta: c.ruta ? { modo: c.ruta.modo, distancia_m: c.ruta.distancia_m, tiempo_min: Math.round(c.ruta.tiempo_s / 60) } : undefined,
});
export { compacto };

function agregar(ctx, c) {
  ctx.candidatos.set(c.id, { ...(ctx.candidatos.get(c.id) || {}), ...c });
}

async function asegurarRuta(ctx, cand, modo) {
  if (cand.ruta && (cand.ruta.modo === modo || cand.ruta.modo_solicitado === modo)) return cand.ruta;
  cand.ruta = await geo.ruta(ctx.origen, cand, modo);
  return cand.ruta;
}
export { asegurarRuta };

const EJECUTORES = {
  async consultar_servicios_propios(ctx, a) {
    const radio = a.radio_m || 3000;
    let filas = a.categoria
      ? db.prepare('SELECT * FROM servicios WHERE categoria=?').all(a.categoria)
      : db.prepare('SELECT * FROM servicios').all();
    if (a.solo_accesibles) filas = filas.filter((f) => f.accesible);
    const res = filas
      .map((f) => ({ ...f, distancia_m: Math.round(haversine(ctx.origen, f)) }))
      .filter((f) => f.distancia_m <= radio)
      .sort((x, y) => x.distancia_m - y.distancia_m)
      .slice(0, 8);
    res.forEach((f) => agregar(ctx, {
      id: `propio:${f.id}`, nombre: f.nombre, categoria: f.categoria, direccion: f.direccion,
      lat: f.lat, lon: f.lon, fuente: 'datos_propios', distancia_m: f.distancia_m,
      horario: f.horario, accesible: !!f.accesible, notas: f.notas,
    }));
    return res.length
      ? res.map((f) => compacto(ctx.candidatos.get(`propio:${f.id}`)))
      : { resultados: [], aviso: `Sin servicios propios a menos de ${radio} m` };
  },

  async buscar_lugares_cercanos(ctx, a) {
    const tipo = TIPOS.find((t) => t.clave === a.tipo_necesidad);
    if (!tipo?.categoria_geoapify) return { error: 'Ese tipo de necesidad no tiene categoría externa' };
    const lugares = await geo.lugaresCercanos({
      categorias: tipo.categoria_geoapify, lat: ctx.origen.lat, lon: ctx.origen.lon,
      radio: a.radio_m || 3000, limite: a.limite || 5,
    });
    lugares.forEach((l, i) => agregar(ctx, {
      id: `geo:${l.place_id || `${a.tipo_necesidad}-${i}`}`, nombre: l.nombre, categoria: a.tipo_necesidad,
      direccion: l.direccion, lat: l.lat, lon: l.lon, fuente: 'geoapify',
      distancia_m: Math.round(l.distancia_m ?? haversine(ctx.origen, l)),
      horario: 'No verificado', accesible: null, notas: '',
    }));
    const ids = lugares.map((l, i) => `geo:${l.place_id || `${a.tipo_necesidad}-${i}`}`);
    return ids.length ? ids.map((id) => compacto(ctx.candidatos.get(id))) : { resultados: [], aviso: 'Geoapify no encontró lugares en ese radio' };
  },

  async geocodificar_destino(ctx, a) {
    const g = await geo.geocode(/bogot/i.test(a.texto) ? a.texto : `${a.texto}, Bogotá`);
    if (!g) return { error: 'No se encontró el destino indicado' };
    const id = `dest:${++ctx.nDestinos}`;
    agregar(ctx, {
      id, nombre: g.formatted, categoria: 'destino', direccion: g.formatted, lat: g.lat, lon: g.lon,
      fuente: 'geoapify', distancia_m: Math.round(haversine(ctx.origen, g)),
      horario: null, accesible: null, notas: `Confianza de geocodificación: ${g.confianza ?? 'n/d'}`,
    });
    return compacto(ctx.candidatos.get(id));
  },

  async calcular_ruta(ctx, a) {
    const cand = ctx.candidatos.get(a.destino_id);
    if (!cand) return { error: 'destino_id no existe. Use solo ids devueltos por otras herramientas.' };
    const r = await asegurarRuta(ctx, cand, a.modo);
    return { destino_id: cand.id, modo: r.modo, distancia_m: r.distancia_m, tiempo_min: Math.round(r.tiempo_s / 60) };
  },

  async guardar_recomendacion(ctx, a) {
    const cand = ctx.candidatos.get(a.candidato_id);
    if (!cand) return { ok: false, error: 'candidato_id no existe' };
    // Guardia de ejecución: un lugar de alquiler / parqueo no es un taller de reparación.
    if (requiereTallerBici(ctx.analisis) && cand.categoria !== 'taller_bicicletas') {
      return { ok: false, error: 'El candidato no acredita servicio de reparación de bicicletas' };
    }
    const alternativas = (a.alternativas_ids || [])
      .filter((id) => id !== a.candidato_id && ctx.candidatos.has(id))
      .filter((id) => !requiereTallerBici(ctx.analisis) || ctx.candidatos.get(id).categoria === 'taller_bicicletas')
      .slice(0, 2);
    const advertencias = Array.isArray(a.advertencias) ? [...a.advertencias] : [];
    if (/\(demo\)/i.test(cand.nombre)) {
      advertencias.push('Servicio de demostración: la existencia real, el horario y la disponibilidad no están verificados.');
    }
    const payload = {
      candidato_id: cand.id, alternativas_ids: alternativas,
      justificacion: /\(demo\)/i.test(cand.nombre)
        ? `Opción del catálogo de demostración clasificada como ${cand.categoria}; no es un establecimiento real verificado. ${a.justificacion || ''}`
        : a.justificacion,
      pasos: a.pasos || [], advertencias,
    };
    const accionId = addAccion(ctx.casoId, 'recomendacion_guardada', payload, 'agente_recomendador');
    ctx.recomendacion = { ...payload, accion_id: accionId };
    return { ok: true, accion_id: accionId };
  },

  async guardar_ruta_en_caso(ctx, a) {
    const cand = ctx.candidatos.get(a.destino_id);
    if (!cand) return { ok: false, error: 'destino_id no existe' };
    const r = await asegurarRuta(ctx, cand, a.modo);
    const accionId = addAccion(ctx.casoId, 'ruta_guardada', {
      destino_id: cand.id, destino: cand.nombre, modo: r.modo,
      distancia_m: r.distancia_m, tiempo_min: Math.round(r.tiempo_s / 60), nota: a.nota || '',
    }, 'agente_chat');
    return { ok: true, accion_id: accionId };
  },
};

// Ejecuta una herramienta, la registra en la traza y nunca lanza excepciones al modelo
export async function ejecutarHerramienta(ctx, nombre, args, invocadoPor) {
  const t0 = Date.now();
  let salida, estado = 'ok';
  try {
    if (!EJECUTORES[nombre]) throw new Error(`Herramienta desconocida: ${nombre}`);
    salida = await EJECUTORES[nombre](ctx, args);
    if (salida?.error) estado = 'error';
  } catch (e) {
    salida = { error: e.message }; estado = 'error';
  }
  ctx.traza('herramienta', nombre, invocadoPor, args, salida, estado, Date.now() - t0);
  return salida;
}
