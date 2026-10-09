import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { SERVICIOS, TIPOS_NECESIDAD } from './seed.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS servicios (
  id TEXT PRIMARY KEY, nombre TEXT NOT NULL, categoria TEXT NOT NULL,
  lat REAL NOT NULL, lon REAL NOT NULL, direccion TEXT, horario TEXT,
  accesible INTEGER DEFAULT 0, notas TEXT
);
CREATE TABLE IF NOT EXISTS tipos_necesidad (
  clave TEXT PRIMARY KEY, descripcion TEXT, categorias_propias TEXT, categoria_geoapify TEXT
);
CREATE TABLE IF NOT EXISTS casos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creado_en TEXT DEFAULT (datetime('now','localtime')),
  texto TEXT, imagen_path TEXT,
  origen_lat REAL, origen_lon REAL, origen_texto TEXT, modo_usuario TEXT,
  analisis TEXT, estado TEXT DEFAULT 'procesando', resultado TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS trazas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caso_id INTEGER NOT NULL REFERENCES casos(id),
  orden INTEGER, tipo TEXT, actor TEXT, invocado_por TEXT,
  entrada TEXT, salida TEXT, estado TEXT, duracion_ms INTEGER,
  creado_en TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS mensajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caso_id INTEGER NOT NULL REFERENCES casos(id),
  rol TEXT NOT NULL, contenido TEXT NOT NULL,
  creado_en TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS acciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caso_id INTEGER NOT NULL REFERENCES casos(id),
  tipo TEXT NOT NULL, payload TEXT, creado_por TEXT,
  creado_en TEXT DEFAULT (datetime('now','localtime'))
);
`);

// Carga inicial de datos propios (solo si las tablas están vacías)
if (db.prepare('SELECT COUNT(*) n FROM servicios').get().n === 0) {
  const ins = db.prepare(`INSERT INTO servicios VALUES (@id,@nombre,@categoria,@lat,@lon,@direccion,@horario,@accesible,@notas)`);
  db.transaction(() => SERVICIOS.forEach((x) => ins.run(x)))();
}
if (db.prepare('SELECT COUNT(*) n FROM tipos_necesidad').get().n === 0) {
  const ins = db.prepare(`INSERT INTO tipos_necesidad VALUES (?,?,?,?)`);
  db.transaction(() => TIPOS_NECESIDAD.forEach((t) =>
    ins.run(t.clave, t.descripcion, JSON.stringify(t.categorias_propias), t.categoria_geoapify)))();
}

const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
const cortar = (v, n = 4000) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? null);
  return s.length > n ? s.slice(0, n) + '…[recortado]' : s;
};

export function tiposNecesidad() {
  return db.prepare('SELECT * FROM tipos_necesidad').all()
    .map((t) => ({ ...t, categorias_propias: parse(t.categorias_propias) || [] }));
}

export function crearCaso(datos) {
  const r = db.prepare(`INSERT INTO casos (texto, imagen_path, origen_lat, origen_lon, origen_texto, modo_usuario)
    VALUES (@texto,@imagen_path,@origen_lat,@origen_lon,@origen_texto,@modo_usuario)`).run(datos);
  return Number(r.lastInsertRowid);
}

export function actualizarCaso(id, campos) {
  const claves = Object.keys(campos); // claves internas, nunca provienen del usuario
  const params = { id };
  for (const k of claves) {
    params[k] = campos[k] !== null && typeof campos[k] === 'object' ? JSON.stringify(campos[k]) : campos[k];
  }
  db.prepare(`UPDATE casos SET ${claves.map((k) => `${k}=@${k}`).join(',')} WHERE id=@id`).run(params);
}

export function getCaso(id) {
  const c = db.prepare('SELECT * FROM casos WHERE id=?').get(id);
  if (!c) return null;
  return { ...c, analisis: parse(c.analisis), resultado: parse(c.resultado) };
}

export function listarCasos() {
  return db.prepare('SELECT id, creado_en, texto, estado FROM casos ORDER BY id DESC LIMIT 50').all();
}

export function siguienteOrden(casoId) {
  return db.prepare('SELECT COALESCE(MAX(orden),0) m FROM trazas WHERE caso_id=?').get(casoId).m;
}

export function addTraza(t) {
  db.prepare(`INSERT INTO trazas (caso_id, orden, tipo, actor, invocado_por, entrada, salida, estado, duracion_ms)
    VALUES (@caso_id,@orden,@tipo,@actor,@invocado_por,@entrada,@salida,@estado,@duracion_ms)`)
    .run({ ...t, entrada: cortar(t.entrada), salida: cortar(t.salida) });
}

export const getTrazas = (id) => db.prepare('SELECT * FROM trazas WHERE caso_id=? ORDER BY orden').all(id);

export function addMensaje(casoId, rol, contenido) {
  db.prepare('INSERT INTO mensajes (caso_id, rol, contenido) VALUES (?,?,?)').run(casoId, rol, contenido);
}
export const getMensajes = (id) => db.prepare('SELECT rol, contenido, creado_en FROM mensajes WHERE caso_id=? ORDER BY id').all(id);

export function addAccion(casoId, tipo, payload, creadoPor) {
  const r = db.prepare('INSERT INTO acciones (caso_id, tipo, payload, creado_por) VALUES (?,?,?,?)')
    .run(casoId, tipo, JSON.stringify(payload), creadoPor);
  return Number(r.lastInsertRowid);
}
export const getAcciones = (id) =>
  db.prepare('SELECT * FROM acciones WHERE caso_id=? ORDER BY id').all(id).map((a) => ({ ...a, payload: parse(a.payload) }));
