import { config } from './config.js';

const BASE = 'https://api.geoapify.com';

async function get(ruta, params) {
  if (!config.geoapifyKey) throw new Error('Falta GEOAPIFY_API_KEY en el archivo .env');
  const url = new URL(BASE + ruta);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('apiKey', config.geoapifyKey);
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) {
    const cuerpo = (await r.text()).slice(0, 200).replace(config.geoapifyKey, '***');
    throw new Error(`Geoapify respondió ${r.status}: ${cuerpo}`);
  }
  return r.json();
}

// Una ruta necesita un punto suficientemente preciso, no el centro de toda una ciudad.
// Geoapify distingue result_type (building, amenity, street, city, etc.) y rank.confidence.
// Los umbrales son conservadores para no inventar ubicaciones al calcular rutas.
function ubicacionPrecisa(r) {
  if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return false;
  if (!['building', 'amenity'].includes(r.result_type)) return false;
  const confianza = r.rank?.confidence;
  if (typeof confianza !== 'number' || confianza < 0.75) return false;
  if (r.rank?.match_type && [
    'match_by_city_or_disrict', 'match_by_country_or_state',
    'match_by_postcode', 'match_by_street',
  ].includes(r.rank.match_type)) return false;
  return true;
}

// Convierte una dirección o lugar en coordenadas.
// Si Geoapify solo ubica Bogotá o una calle genérica, devuelve null:
// el orquestador pedirá un origen más exacto o usar el GPS del navegador.
export async function geocode(texto) {
  const d = await get('/v1/geocode/search', {
    text: texto, format: 'json', lang: 'es', limit: 5,
    filter: 'countrycode:co',
    bias: `proximity:${config.centro.lon},${config.centro.lat}`,
  });
  const validos = (d.results || []).filter(ubicacionPrecisa);
  const r = validos.sort((a, b) => b.rank.confidence - a.rank.confidence)[0];
  if (!r) return null;
  return {
    lat: r.lat, lon: r.lon, formatted: r.formatted,
    confianza: r.rank.confidence,
  };
}

// Lugares por categoría dentro de un radio alrededor de un punto
export async function lugaresCercanos({ categorias, lat, lon, radio, limite }) {
  const d = await get('/v2/places', {
    categories: categorias,
    filter: `circle:${lon},${lat},${radio}`,
    bias: `proximity:${lon},${lat}`,
    limit: limite, lang: 'es',
  });
  return (d.features || []).map((f) => ({
    place_id: f.properties.place_id,
    nombre: f.properties.name || f.properties.address_line1 || 'Sin nombre',
    direccion: f.properties.formatted,
    lat: f.properties.lat, lon: f.properties.lon,
    categorias: f.properties.categories,
    distancia_m: f.properties.distance,
  }));
}

// Ruta entre dos puntos. Si "transit" falla, se intenta "approximated_transit".
export async function ruta(desde, hasta, modo) {
  const pedir = async (m) => {
    const d = await get('/v1/routing', { waypoints: `${desde.lat},${desde.lon}|${hasta.lat},${hasta.lon}`, mode: m, lang: 'es' });
    const f = d.features?.[0];
    if (!f) throw new Error('Geoapify no devolvió una ruta');
    return {
      modo: m,
      distancia_m: Math.round(f.properties.distance),
      tiempo_s: Math.round(f.properties.time),
      geometria: f.geometry?.coordinates || [],
    };
  };
  try { return await pedir(modo); }
  catch (e) {
    if (modo === 'transit') return { ...(await pedir('approximated_transit')), modo_solicitado: 'transit' };
    throw e;
  }
}
