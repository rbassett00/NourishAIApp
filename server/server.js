// Thin backend proxy: holds OPENAI_API_KEY, adds the system prompt + tools, and serves the web app.
// Stores nothing and never logs request/response bodies (spec §9).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { chat, searchFood, summarize, transcribe } from './llm.js';
import { SYSTEM_PROMPT, TOOLS } from './prompt.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

// Per-device rate limit to protect the key from abuse.
const buckets = new Map();
function rateLimited(req) {
  const id = req.headers['x-device-id'] || req.socket.remoteAddress;
  const now = Date.now();
  const b = buckets.get(id) || { start: now, count: 0 };
  if (now - b.start > 60_000) { b.start = now; b.count = 0; }
  b.count++;
  buckets.set(id, b);
  return b.count > Number(config.RATE_LIMIT_PER_MINUTE);
}

function readBody(req, limit = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const routes = {
  'GET /api/health': async () => ({ ok: true, ai: Boolean(process.env.OPENAI_API_KEY), model: config.OPENAI_CHAT_MODEL }),

  'POST /api/chat': async (req) => {
    const { input } = JSON.parse(await readBody(req));
    if (!Array.isArray(input)) throw Object.assign(new Error('input must be an array'), { status: 400 });
    return chat({ instructions: SYSTEM_PROMPT, input, tools: TOOLS });
  },

  'POST /api/summarize': async (req) => {
    const { text } = JSON.parse(await readBody(req));
    const summary = await summarize(
      'You write the weekly pattern note for a preconception nutrition app. Given daily nutrient percentages, write 1-2 short, neutral sentences that only describe what happened (which nutrients were met most often, which were lowest). Do NOT give advice, food ideas, or suggestions. Never mention calories or weight. Plain text.',
      String(text).slice(0, 8000),
    );
    return { summary };
  },

  'POST /api/food-search': async (req) => {
    const { query, portion } = JSON.parse(await readBody(req));
    if (!query || String(query).length > 200) throw Object.assign(new Error('query required'), { status: 400 });
    return searchFood(String(query), portion ? String(portion).slice(0, 100) : null);
  },

  'POST /api/transcribe': async (req) => {
    const audio = await readBody(req);
    return { text: await transcribe(audio, req.headers['content-type'] || 'audio/webm') };
  },
};

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (!path || path.endsWith('/') || path.endsWith('\\')) path += 'index.html';
  const file = join(PUBLIC_DIR, path);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const key = `${req.method} ${req.url.split('?')[0]}`;
  const route = routes[key];
  if (!route) return serveStatic(req, res);
  if (req.method === 'POST' && rateLimited(req)) return send(res, 429, { error: 'Too many requests, slow down a little.' });
  try {
    send(res, 200, await route(req));
  } catch (err) {
    console.error(`${key} failed: ${err.message}`); // message only, never bodies
    send(res, err.status || 502, { error: err.message });
  }
});

server.listen(Number(config.PORT), () => {
  console.log(`Nourish v2 (preconception) on http://localhost:${config.PORT}  (chat model: ${config.OPENAI_CHAT_MODEL})`);
  if (!process.env.OPENAI_API_KEY) console.warn('OPENAI_API_KEY not set: chat will be unavailable (manual logging still works).');
});
