import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3000,
  geminiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  geoapifyKey: process.env.GEOAPIFY_API_KEY || '',
  dbPath: process.env.DB_PATH || './data/app.db',
  // Centro de Bogotá: sesga la geocodificación hacia la ciudad
  centro: { lat: 4.6097, lon: -74.0817 },
};
