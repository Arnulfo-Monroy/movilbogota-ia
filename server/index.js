import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { listarCasos } from './db.js';
import { procesarCaso, responderChat, detalleCaso } from './orchestrator.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const carpetaUploads = path.join(raiz, 'uploads');
fs.mkdirSync(carpetaUploads, { recursive: true });

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!EXT[file.mimetype]) {
      const error = new Error('Formato de imagen no permitido. Adjunta un archivo JPG, PNG o WebP.');
      error.status = 400;
      return cb(error);
    }
    cb(null, true);
  },
});

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(raiz, 'public')));
app.use('/uploads', express.static(carpetaUploads));

const num = (v) => (v === undefined || v === '' ? NaN : Number(v));
const limpiar = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

app.get('/api/estado', (req, res) => {
  res.json({ gemini: !!config.geminiKey, geoapify: !!config.geoapifyKey, modelo: config.geminiModel });
});

app.get('/api/casos', (req, res) => res.json(listarCasos()));

app.get('/api/casos/:id', (req, res) => {
  const d = detalleCaso(Number(req.params.id));
  d ? res.json(d) : res.status(404).json({ error: 'Caso no encontrado' });
});

app.post('/api/casos', upload.single('imagen'), async (req, res, next) => {
  try {
    const texto = limpiar(req.body.texto, 2000);
    if (!texto) return res.status(400).json({ error: 'Describe tu necesidad en el campo de texto.' });
    let imagen = null;
    if (req.file) {
      const nombre = `${Date.now()}-${Math.round(Math.random() * 1e6)}${EXT[req.file.mimetype]}`;
      fs.writeFileSync(path.join(carpetaUploads, nombre), req.file.buffer);
      imagen = { mime: req.file.mimetype, buffer: req.file.buffer, ruta: `/uploads/${nombre}` };
    }
    const d = await procesarCaso({
      texto, imagen,
      origenLat: num(req.body.origen_lat), origenLon: num(req.body.origen_lon),
      origenTexto: limpiar(req.body.origen_texto, 200),
      modoUsuario: limpiar(req.body.modo, 30),
    });
    res.status(201).json(d);
  } catch (e) { next(e); }
});

app.post('/api/casos/:id/chat', async (req, res, next) => {
  try {
    const mensaje = limpiar(req.body?.mensaje, 1000);
    if (!mensaje) return res.status(400).json({ error: 'Escribe una pregunta.' });
    const d = await responderChat(Number(req.params.id), mensaje);
    d ? res.json(d) : res.status(404).json({ error: 'Caso no encontrado' });
  } catch (e) { next(e); }
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'La imagen supera el límite de 4 MB. Selecciona una imagen más pequeña.' });
    }
    return res.status(400).json({ error: 'No se pudo adjuntar la imagen. Comprueba el archivo e inténtalo de nuevo.' });
  }
  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
});

app.listen(config.port, () => {
  console.log(`MovilBogotá en http://localhost:${config.port}`);
  if (!config.geminiKey) console.warn('⚠ Falta GEMINI_API_KEY');
  if (!config.geoapifyKey) console.warn('⚠ Falta GEOAPIFY_API_KEY');
});
