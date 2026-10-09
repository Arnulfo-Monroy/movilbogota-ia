import { generarJSON, conHerramientas } from './llm.js';
import { DECL, ejecutarHerramienta, compacto, requiereTallerBici } from './tools.js';
import { tiposNecesidad } from './db.js';

const TIPOS = tiposNecesidad();
const CLAVES = [...TIPOS.map((t) => t.clave), 'otro'];
const LISTA_TIPOS = TIPOS.map((t) => `- ${t.clave}: ${t.descripcion}`).join('\n');
const S = (extra = {}) => ({ type: 'STRING', ...extra });

// ---------- Esquema de la respuesta estructurada del Agente Analista ----------
export const ESQUEMA_ANALISIS = {
  type: 'OBJECT',
  properties: {
    estado_informacion: S({ enum: ['suficiente', 'insuficiente', 'contradictoria', 'fuera_de_alcance'] }),
    motivo_estado: S(),
    preguntas_aclaratorias: { type: 'ARRAY', items: S() },
    tipo_necesidad: S({ enum: CLAVES }),
    resumen_necesidad: S(),
    urgencia: S({ enum: ['baja', 'media', 'alta'] }),
    modo_transporte: S({ enum: ['a_pie', 'bicicleta', 'auto', 'transporte_publico', 'no_especificado'] }),
    requiere_accesibilidad: { type: 'BOOLEAN' },
    origen_texto: S({ description: 'Origen escrito por el usuario, o cadena vacía' }),
    destino_texto: S({ description: 'Destino escrito por el usuario, o cadena vacía' }),
    restricciones: { type: 'ARRAY', items: S() },
    hallazgos_imagen: {
      type: 'OBJECT',
      properties: {
        hay_imagen: { type: 'BOOLEAN' },
        descripcion: S({ description: 'Solo lo que se ve realmente en la imagen' }),
        relevante_para_caso: { type: 'BOOLEAN' },
        coincide_con_texto: { type: 'BOOLEAN' },
      },
      required: ['hay_imagen', 'descripcion', 'relevante_para_caso', 'coincide_con_texto'],
    },
    confianza: { type: 'NUMBER', description: 'Entre 0 y 1' },
    datos_faltantes: { type: 'ARRAY', items: S() },
  },
  required: ['estado_informacion', 'motivo_estado', 'preguntas_aclaratorias', 'tipo_necesidad', 'resumen_necesidad',
    'urgencia', 'modo_transporte', 'requiere_accesibilidad', 'origen_texto', 'destino_texto', 'restricciones',
    'hallazgos_imagen', 'confianza', 'datos_faltantes'],
};

// ---------- Agente 1: Analista (multimodal, sin herramientas) ----------
export async function agenteAnalista({ texto, imagen, origenTexto, tieneGps, modoUsuario }) {
  const system = `Eres el Agente Analista de MovilBogotá, un asistente de movilidad y servicios urbanos en Bogotá (Colombia).
Tu única responsabilidad es interpretar la solicitud del usuario (texto, imagen opcional y datos de ubicación) y devolver un JSON con el esquema indicado. NO recomiendas lugares ni rutas.

Tipos de necesidad válidos:
${LISTA_TIPOS}
- otro: cualquier cosa que no encaje.

Reglas para estado_informacion:
- "suficiente": la necesidad es clara y existe un origen (GPS o escrito). Si el tipo es ruta_a_destino también debe existir un destino.
- "insuficiente": falta la necesidad concreta, el origen o el destino. Llena preguntas_aclaratorias y datos_faltantes.
- "contradictoria": el texto, la imagen o el origen se contradicen (por ejemplo, la imagen muestra algo sin relación con lo descrito).
- "fuera_de_alcance": no tiene que ver con movilidad o servicios urbanos en Bogotá (use tipo_necesidad "otro").
Reglas generales: no inventes datos que no estén en el texto o la imagen; si algo no se ve en la imagen, dilo. Si no hay imagen, hay_imagen=false y coincide_con_texto=true. Escribe en español.`;

  const partes = [{ text:
`Solicitud del usuario: """${texto || '(vacío)'}"""
Ubicación GPS compartida: ${tieneGps ? 'sí' : 'no'}
Origen escrito en el formulario: ${origenTexto || '(no indicado)'}
Modo de transporte elegido en el formulario: ${modoUsuario || 'no_especificado'}
Imagen adjunta: ${imagen ? 'sí' : 'no'}` }];
  if (imagen) partes.push({ inlineData: { mimeType: imagen.mime, data: imagen.buffer.toString('base64') } });

  return generarJSON({ system, contents: [{ role: 'user', parts: partes }], schema: ESQUEMA_ANALISIS, temperature: 0.1 });
}

// ---------- Agente 2: Investigador (usa herramientas de datos propios y mapas) ----------
export async function agenteInvestigador(ctx, analisis) {
  const system = `Eres el Agente Investigador de MovilBogotá. Tu responsabilidad es reunir candidatos REALES usando herramientas; no eliges ni recomiendas.
Procedimiento:
1. Si el tipo de necesidad tiene categorías propias, llama consultar_servicios_propios (una vez por categoría relevante).
2. Si el tipo tiene búsqueda externa, llama buscar_lugares_cercanos.
3. Si el tipo es ruta_a_destino, llama geocodificar_destino con el destino del usuario.
4. Calcula la ruta con calcular_ruta para los 3 candidatos más cercanos, usando el modo de transporte pedido (a_pie=walk, bicicleta=bicycle, auto=drive, transporte_publico=transit; si no se especificó, usa walk).
Usa únicamente ids devueltos por las herramientas. Si requiere_accesibilidad es true, usa solo_accesibles=true en datos propios.
Termina con un resumen de 2 a 4 líneas: qué encontraste y qué no pudo verificarse.`;
  const msg = `Análisis del caso:\n${JSON.stringify(analisis)}`;
  const { texto } = await conHerramientas({
    system, contents: [{ role: 'user', parts: [{ text: msg }] }],
    tools: [DECL.consultar_servicios_propios, DECL.buscar_lugares_cercanos, DECL.geocodificar_destino, DECL.calcular_ruta],
    toolConfig: { mode: 'AUTO' },
    ejecutar: (n, a) => ejecutarHerramienta(ctx, n, a, 'agente_investigador'),
    maxPasos: 7,
  });
  return texto;
}

// ---------- Agente 3: Recomendador (decide y ejecuta la acción de guardar) ----------
export async function agenteRecomendador(ctx, analisis, candidatos) {
  // Solo proponemos talleres para solicitudes de reparación de bicicletas.
  const elegibles = requiereTallerBici(analisis)
    ? candidatos.filter((c) => c.categoria === 'taller_bicicletas')
    : candidatos;
  if (elegibles.length === 0) return null;
  const system = `Eres el Agente Recomendador de MovilBogotá. Recibes el análisis del caso y candidatos ya verificados por herramientas (con distancia y ruta cuando existe).
Elige el mejor candidato y llama OBLIGATORIAMENTE guardar_recomendacion. Criterios: si requiere_accesibilidad es true prefiere accesible=true; si la urgencia es alta prioriza el menor tiempo; si no, equilibra cercanía y calidad de datos.
Primero confirma que la CATEGORÍA sea pertinente a la necesidad. Para reparar bicicletas solo son pertinentes candidatos de categoria taller_bicicletas; alquiler y estacionamiento de bicicletas no acreditan reparaciones.
Un lugar con nombre (demo) es FICTICIO y se utiliza para demostrar la arquitectura: nunca lo describas como negocio real ni como servicio confirmado. Advierte explícitamente que la ubicación, horario y disponibilidad NO están verificados en la realidad.
No afirmes que un establecimiento externo repara llantas si no hay evidencia explícita de ese servicio. No confundas distancia corta con idoneidad.
Usa SOLO los datos del contexto. Si un dato (horario, accesibilidad, precio) aparece como null o "No verificado", menciónalo en advertencias en lugar de afirmarlo. Escribe en español, con frases cortas.`;
  const msg = `Análisis:\n${JSON.stringify(analisis)}\n\nCandidatos pertinentes:\n${JSON.stringify(elegibles)}`;
  await conHerramientas({
    system, contents: [{ role: 'user', parts: [{ text: msg }] }],
    tools: [DECL.guardar_recomendacion],
    toolConfig: { mode: 'ANY', allowedFunctionNames: ['guardar_recomendacion'] },
    ejecutar: (n, a) => ejecutarHerramienta(ctx, n, a, 'agente_recomendador'),
    maxPasos: 2,
  });
  return ctx.recomendacion;
}

// ---------- Agente 4: Chat contextual (consulta herramientas y puede guardar rutas) ----------
export async function agenteChat(ctx, caso, historial, pregunta) {
  const contexto = {
    solicitud_original: caso.texto,
    origen: ctx.origen,
    analisis: caso.analisis,
    recomendacion: caso.resultado?.recomendacion,
    candidatos_conocidos: [...ctx.candidatos.values()].map(compacto),
  };
  const system = `Eres el Agente de Chat de MovilBogotá y respondes preguntas de seguimiento sobre UN caso específico.
Reglas de veracidad:
- Solo presentas como hechos los datos que están en el contexto del caso o que obtengas con herramientas en esta conversación.
- Los lugares marcados (demo) son ficticios: no presentes sus horarios, distancias aproximadas o servicios como información real o confirmada.
- La categoría alquiler de bicicletas NO demuestra que exista taller mecánico; aclara que no está verificado.
- Si no tienes un dato (horarios, precios, tráfico, estado de vías, disponibilidad), dilo claramente; no lo supongas.
- Para distancias o tiempos nuevos usa calcular_ruta; para otros lugares usa consultar_servicios_propios o buscar_lugares_cercanos.
- Si el usuario pide guardar una ruta o recorrido, usa guardar_ruta_en_caso y confirma con el id de acción devuelto; nunca digas que guardaste algo sin llamar a la herramienta.
- Menciona de dónde viene cada dato clave (datos propios o Geoapify). Responde en español, breve y claro.

Contexto del caso:
${JSON.stringify(contexto)}`;
  const contents = historial.map((m) => ({ role: m.rol === 'user' ? 'user' : 'model', parts: [{ text: m.contenido }] }));
  contents.push({ role: 'user', parts: [{ text: pregunta }] });
  const { texto } = await conHerramientas({
    system, contents,
    tools: [DECL.consultar_servicios_propios, DECL.buscar_lugares_cercanos, DECL.calcular_ruta, DECL.geocodificar_destino, DECL.guardar_ruta_en_caso],
    toolConfig: { mode: 'AUTO' },
    ejecutar: (n, a) => ejecutarHerramienta(ctx, n, a, 'agente_chat'),
    maxPasos: 6,
  });
  return texto || 'No pude generar una respuesta. Intenta reformular la pregunta.';
}
