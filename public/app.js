const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ESTADOS = {
  recomendado: 'Recomendación lista',
  requiere_aclaracion: 'Falta información',
  fuera_de_alcance: 'Fuera de alcance',
  sin_resultados: 'Sin resultados',
  error: 'Error',
  procesando: 'Procesando',
};
const FUENTES = { datos_propios: 'Datos propios', geoapify: 'Geoapify' };
const MODOS = { walk: 'a pie', bicycle: 'bicicleta', drive: 'auto', transit: 'transporte público', approximated_transit: 'transporte público (aprox.)' };

let casoActual = null;
let gps = null;

// ---------- Mapa ----------
const mapa = L.map('mapa').setView([4.6097, -74.0817], 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; Colaboradores de OpenStreetMap',
}).addTo(mapa);
const capa = L.layerGroup().addTo(mapa);

function dibujarMapa(caso) {
  capa.clearLayers();
  const r = caso.resultado;
  if (!r?.origen) return;
  const puntos = [[r.origen.lat, r.origen.lon]];
  L.circleMarker([r.origen.lat, r.origen.lon], { radius: 9, color: '#1b2a33', fillColor: '#f5b800', fillOpacity: 1 })
    .bindPopup('Origen').addTo(capa);
  const elegido = r.recomendacion?.candidato_id;
  const alternativas = r.recomendacion?.alternativas_ids || [];
  for (const c of r.candidatos || []) {
    const esElegido = c.id === elegido;
    if (!esElegido && !alternativas.includes(c.id) && (r.candidatos.length > 8)) continue;
    L.circleMarker([c.lat, c.lon], {
      radius: esElegido ? 10 : 6, color: '#1f5f4a', fillColor: esElegido ? '#1f5f4a' : '#fff', fillOpacity: 1, weight: 2,
    }).bindPopup(`<b>${esc(c.nombre)}</b><br>${esc(FUENTES[c.fuente] || c.fuente)}`).addTo(capa);
    puntos.push([c.lat, c.lon]);
    if (esElegido && c.ruta?.geometria?.length) {
      // Geoapify entrega MultiLineString: [[ [lon,lat], ... ], ...]
      const lineas = c.ruta.geometria.map((tramo) => tramo.map(([lon, lat]) => [lat, lon]));
      L.polyline(lineas, { color: '#1f5f4a', weight: 5 }).addTo(capa);
    }
  }
  mapa.fitBounds(puntos, { padding: [30, 30], maxZoom: 16 });
}

// ---------- Utilidades de interfaz ----------
function mostrarTab(nombre) {
  document.querySelectorAll('.pestanas button').forEach((b) => b.classList.toggle('activa', b.dataset.tab === nombre));
  ['resultado', 'chat', 'traza'].forEach((t) => { $('#tab-' + t).hidden = t !== nombre; });
}
document.querySelectorAll('.pestanas button').forEach((b) => b.addEventListener('click', () => mostrarTab(b.dataset.tab)));

const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
const minutos = (s) => `${Math.round(s / 60)} min`;

// ---------- Renderizado del caso ----------
function renderResultado(d) {
  const { caso, acciones } = d;
  const a = caso.analisis, r = caso.resultado;
  let html = `<p><span class="insignia ${esc(caso.estado)}">${esc(ESTADOS[caso.estado] || caso.estado)}</span> Caso #${caso.id} · ${esc(caso.creado_en)}</p>`;
  html += `<p>${esc(caso.texto)}</p>`;
  if (caso.imagen_path) html += `<img src="${esc(caso.imagen_path)}" alt="Imagen adjunta al caso" style="max-height:120px;border-radius:6px">`;
  if (caso.error) html += `<div class="aviso"><b>No se pudo completar el análisis.</b><br>${esc(caso.error)}</div>`;

  if (a) {
    if (a.estado_informacion !== 'suficiente') {
      const titulos = { insuficiente: 'Falta información', contradictoria: 'La información se contradice', fuera_de_alcance: 'Esta solicitud está fuera del alcance' };
      html += `<div class="aviso"><b>${titulos[a.estado_informacion] || 'Revisa la información'}.</b> ${esc(a.motivo_estado)}`;
      if (a.preguntas_aclaratorias?.length) html += `<ul>${a.preguntas_aclaratorias.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
      html += `</div>`;
    }
    html += `<h3>Análisis estructurado</h3><dl class="campos">
      <dt>Necesidad</dt><dd>${esc(a.tipo_necesidad)} — ${esc(a.resumen_necesidad)}</dd>
      <dt>Urgencia</dt><dd>${esc(a.urgencia)}</dd>
      <dt>Modo</dt><dd>${esc(a.modo_transporte)}</dd>
      <dt>Accesibilidad</dt><dd>${a.requiere_accesibilidad ? 'Requerida' : 'No requerida'}</dd>
      <dt>Origen / destino</dt><dd>${esc(a.origen_texto || '—')} / ${esc(a.destino_texto || '—')}</dd>
      <dt>Restricciones</dt><dd>${esc((a.restricciones || []).join(', ') || '—')}</dd>
      <dt>Imagen</dt><dd>${a.hallazgos_imagen?.hay_imagen ? esc(a.hallazgos_imagen.descripcion) + (a.hallazgos_imagen.coincide_con_texto ? '' : ' (no coincide con el texto)') : 'Sin imagen'}</dd>
      <dt>Confianza</dt><dd>${Math.round((a.confianza || 0) * 100)} %</dd>
    </dl>`;
  }

  if (r?.recomendacion) {
    const rec = r.recomendacion;
    const c = r.candidatos.find((x) => x.id === rec.candidato_id);
    if (c) {
      html += `<div class="recomendacion"><h3>Recomendación: ${esc(c.nombre)}<span class="fuente">${esc(FUENTES[c.fuente] || c.fuente)}</span></h3>
        <p>${esc(c.direccion || '')}</p>
        <p>${c.ruta ? `<b>${km(c.ruta.distancia_m)}</b> · <b>${minutos(c.ruta.tiempo_s)}</b> ${esc(MODOS[c.ruta.modo] || c.ruta.modo)}` : `${km(c.distancia_m)} en línea recta`}</p>
        <p>${esc(rec.justificacion)}</p>
        <ol>${rec.pasos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>
        ${rec.advertencias.length ? `<div class="aviso"><b>Ten en cuenta</b><ul>${rec.advertencias.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
      </div>`;
    }
  }

  if (acciones.length) {
    html += `<h3>Acciones ejecutadas por el sistema</h3>` + acciones.map((x) =>
      `<div class="accion"><b>${esc(x.tipo.replace(/_/g, ' '))}</b> · acción #${x.id} · ${esc(x.creado_por)} · ${esc(x.creado_en)}</div>`).join('');
  }

  if (r?.candidatos?.length) {
    html += `<h3>Candidatos encontrados</h3><div class="tabla-scroll"><table><thead><tr><th>Lugar</th><th>Fuente</th><th>Distancia</th><th>Ruta</th><th>Horario</th></tr></thead><tbody>` +
      r.candidatos.map((c) => `<tr><td>${esc(c.nombre)}</td><td>${esc(FUENTES[c.fuente] || c.fuente)}</td><td>${km(c.distancia_m)}</td>
        <td>${c.ruta ? `${km(c.ruta.distancia_m)}, ${minutos(c.ruta.tiempo_s)} (${esc(MODOS[c.ruta.modo] || c.ruta.modo)})` : '—'}</td>
        <td>${esc(c.horario || 'No verificado')}</td></tr>`).join('') + `</tbody></table></div>`;
  }
  $('#tab-resultado').innerHTML = html;
}

function renderChat(d) {
  $('#mensajes').innerHTML = d.mensajes.length
    ? d.mensajes.map((m) => `<div class="burbuja ${m.rol}">${esc(m.contenido)}</div>`).join('')
    : '<p class="vacio">Pregunta, por ejemplo, cuánto tardarías en bicicleta o si hay otra opción más cerca.</p>';
  const habilitado = !!d.caso.resultado?.origen;
  $('#pregunta').disabled = !habilitado;
  $('#btn-chat').disabled = !habilitado;
  $('#mensajes').scrollTop = $('#mensajes').scrollHeight;
}

function renderTraza(d) {
  const pasos = d.trazas.map((t) => `<div class="paso ${esc(t.tipo)} ${t.estado === 'error' ? 'error' : ''}">
    <b>${esc(t.actor)}</b> <small>(${esc(t.tipo)} · invocado por ${esc(t.invocado_por || '—')} · ${t.duracion_ms} ms · ${esc(t.estado)})</small>
    <details><summary>Entrada y salida</summary><pre>Entrada: ${esc(t.entrada)}\nSalida: ${esc(t.salida)}</pre></details></div>`).join('');
  $('#tab-traza').innerHTML = `<p>Secuencia de agentes y herramientas que participaron en este caso, en orden.</p>${pasos || '<p class="vacio">Sin pasos registrados.</p>'}`;
}

function mostrarCaso(d) {
  casoActual = d;
  renderResultado(d); renderChat(d); renderTraza(d); dibujarMapa(d.caso);
  mostrarTab('resultado');
  cargarHistorial();
}

// ---------- Eventos ----------
$('#imagen').addEventListener('change', (e) => {
  const f = e.target.files[0], img = $('#vista-previa');
  if (!f) { img.hidden = true; return; }
  img.src = URL.createObjectURL(f); img.hidden = false;
});

$('#btn-gps').addEventListener('click', () => {
  const info = $('#gps-info'); info.hidden = false;
  if (!navigator.geolocation) { info.textContent = 'Tu navegador no permite obtener la ubicación.'; return; }
  info.textContent = 'Obteniendo ubicación…';
  navigator.geolocation.getCurrentPosition(
    (p) => { gps = { lat: p.coords.latitude, lon: p.coords.longitude }; info.textContent = `Ubicación compartida (${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}).`; },
    () => { gps = null; info.textContent = 'No se pudo obtener la ubicación. Escribe una dirección de origen.'; },
    { enableHighAccuracy: true, timeout: 10000 });
});

$('#form-caso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-enviar'); btn.disabled = true; btn.textContent = 'Analizando…';
  $('#tab-resultado').innerHTML = '<p class="vacio">Los agentes están trabajando en tu caso…</p>';
  mostrarTab('resultado');
  const fd = new FormData();
  fd.append('texto', $('#texto').value);
  fd.append('origen_texto', $('#origen').value);
  fd.append('modo', $('#modo').value);
  if (gps) { fd.append('origen_lat', gps.lat); fd.append('origen_lon', gps.lon); }
  if ($('#imagen').files[0]) fd.append('imagen', $('#imagen').files[0]);
  try {
    const r = await fetch('/api/casos', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Error al crear el caso');
    mostrarCaso(d);
  } catch (err) {
    $('#tab-resultado').innerHTML = `<div class="aviso"><b>No se pudo procesar el caso.</b> ${esc(err.message)}</div>`;
  } finally { btn.disabled = false; btn.textContent = 'Analizar caso'; }
});

$('#form-chat').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#pregunta').value.trim();
  if (!q || !casoActual) return;
  $('#pregunta').value = ''; $('#btn-chat').disabled = true;
  $('#mensajes').insertAdjacentHTML('beforeend', `<div class="burbuja user">${esc(q)}</div><div class="burbuja model" id="pensando">Consultando…</div>`);
  try {
    const r = await fetch(`/api/casos/${casoActual.caso.id}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mensaje: q }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Error en el chat');
    mostrarCaso(d); mostrarTab('chat');
  } catch (err) {
    $('#pensando').textContent = `No se pudo responder: ${err.message}`;
    $('#btn-chat').disabled = false;
  }
});

async function cargarHistorial() {
  const casos = await (await fetch('/api/casos')).json();
  $('#lista-casos').innerHTML = casos.length
    ? casos.map((c) => `<li><button data-id="${c.id}">#${c.id} ${esc((c.texto || '').slice(0, 60))}<small>${esc(ESTADOS[c.estado] || c.estado)} · ${esc(c.creado_en)}</small></button></li>`).join('')
    : '<li class="nota">Aún no hay casos.</li>';
}
$('#lista-casos').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-id]'); if (!b) return;
  mostrarCaso(await (await fetch(`/api/casos/${b.dataset.id}`)).json());
});

(async function iniciar() {
  try {
    const s = await (await fetch('/api/estado')).json();
    $('#estado-servicios').innerHTML = (s.gemini && s.geoapify)
      ? `Modelo: ${esc(s.modelo)} · Mapas: Geoapify`
      : `<span class="mal">Faltan claves en .env:</span> ${!s.gemini ? 'GEMINI_API_KEY ' : ''}${!s.geoapify ? 'GEOAPIFY_API_KEY' : ''}`;
  } catch { /* sin estado */ }
  cargarHistorial();
})();
