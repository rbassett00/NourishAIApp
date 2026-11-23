// Models and limits come from config.json, overridable by environment variables.
// Changing OPENAI_CHAT_MODEL here (or in the env) switches the model with no code changes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = JSON.parse(readFileSync(fileURLToPath(new URL('../config.json', import.meta.url)), 'utf8'));

export const config = Object.fromEntries(
  Object.entries(file).map(([k, v]) => [k, process.env[k] ?? v]),
);
