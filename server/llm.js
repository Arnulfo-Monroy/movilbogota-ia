import { config } from './config.js';

const URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Una llamada a generateContent (con reintentos ante 429/500/503)
export async function generar({ system, contents, tools, toolConfig, schema, temperature = 0.2 }) {
  if (!config.geminiKey) throw new Error('Falta GEMINI_API_KEY en el archivo .env');
  const body = { contents, generationConfig: { temperature } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools?.length) {
    body.tools = [{ functionDeclarations: tools }];
    if (toolConfig) body.toolConfig = { functionCallingConfig: toolConfig };
  }
  if (schema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = schema;
  }

  let ultimoError;
  for (let intento = 0; intento < 3; intento++) {
    const r = await fetch(`${URL_BASE}/${config.geminiModel}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (r.ok) {
      const data = await r.json();
      const cand = data.candidates?.[0];
      if (!cand?.content?.parts) {
        throw new Error(`Gemini no devolvió contenido (${data.promptFeedback?.blockReason || cand?.finishReason || 'sin motivo'})`);
      }
      return cand.content;
    }
    ultimoError = `Gemini respondió ${r.status}: ${(await r.text()).slice(0, 300)}`;
    if (![429, 500, 503].includes(r.status)) break;
    await espera(1500 * (intento + 1));
  }
  throw new Error(ultimoError);
}

export const textoDe = (content) => (content.parts || []).filter((p) => p.text).map((p) => p.text).join('').trim();

// Salida estructurada: devuelve un objeto JSON validado por el esquema
export async function generarJSON(opts) {
  const content = await generar(opts);
  try { return JSON.parse(textoDe(content)); }
  catch { throw new Error('El modelo no devolvió un JSON válido'); }
}

// Bucle de herramientas: el modelo pide funciones, la aplicación las ejecuta
// y devuelve los resultados hasta que el modelo responde con texto.
// ejecutar(nombre, args) -> resultado serializable
export async function conHerramientas({ system, contents, tools, toolConfig, ejecutar, maxPasos = 6 }) {
  const historial = [...contents];
  for (let paso = 0; paso < maxPasos; paso++) {
    const ultimo = paso === maxPasos - 1; // en el último paso se quitan las herramientas para forzar texto
    const content = await generar({
      system, contents: historial,
      tools: ultimo ? undefined : tools,
      toolConfig: ultimo ? undefined : toolConfig,
    });
    const llamadas = content.parts.filter((p) => p.functionCall);
    if (!llamadas.length) return { texto: textoDe(content), pasos: paso + 1 };

    historial.push(content);
    const respuestas = [];
    for (const p of llamadas) {
      const resultado = await ejecutar(p.functionCall.name, p.functionCall.args || {});
      respuestas.push({ functionResponse: { name: p.functionCall.name, response: { resultado } } });
    }
    historial.push({ role: 'user', parts: respuestas });
    if (toolConfig?.mode === 'ANY') return { texto: '', pasos: paso + 1 }; // herramienta forzada: un solo turno
  }
  return { texto: '', pasos: maxPasos };
}
