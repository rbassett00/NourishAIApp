// Provider adapter. This is the ONLY module that talks to the model provider.
// Swap the implementation here (e.g. Vercel AI SDK, LiteLLM) without touching app logic.
import { config } from './config.js';

const OPENAI_URL = 'https://api.openai.com/v1';

function headers(extra = {}) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set on the server');
  return { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...extra };
}

async function post(path, body) {
  const res = await fetch(`${OPENAI_URL}${path}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI error ${res.status}`);
  return json;
}

/**
 * One model turn with function tools. Returns the raw output items so the client
 * can run tool handlers on-device and send results back.
 */
export async function chat({ instructions, input, tools }) {
  const body = {
    model: config.OPENAI_CHAT_MODEL,
    instructions,
    input,
    tools,
    store: false, // don't keep conversations server-side (spec §9)
    include: ['reasoning.encrypted_content'], // needed to pass reasoning back when store=false
  };
  if (config.OPENAI_REASONING_EFFORT) body.reasoning = { effort: config.OPENAI_REASONING_EFFORT };
  const res = await post('/responses', body);
  return { output: res.output, model: res.model };
}

/** Cheap single-shot summary (nightly / weekly pattern jobs). */
export async function summarize(instructions, text) {
  const res = await post('/responses', {
    model: config.OPENAI_SUMMARY_MODEL,
    instructions,
    input: text,
    store: false,
  });
  const out = (res.output || [])
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content || [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('\n');
  return out.trim();
}

const NUTRIENT_FIELDS = ['folate', 'iron', 'iodine', 'choline', 'dha', 'calcium', 'vitamin_d', 'protein', 'b12', 'fiber', 'water', 'caffeine', 'retinol', 'alcohol'];

const FOOD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['found', 'name', 'portion', 'basis', 'nutrients', 'estimated', 'flags', 'sources'],
  properties: {
    found: { type: 'boolean' },
    name: { type: 'string' },
    portion: { type: 'string', description: 'The portion the nutrients are for, e.g. "1 bowl (500 g)"' },
    basis: { type: 'string', description: 'Write this BEFORE the numbers: for a dish, the typical components and amounts you assumed; for each nutrient not published, which USDA ingredient values you used.' },
    nutrients: {
      type: 'object',
      additionalProperties: false,
      required: NUTRIENT_FIELDS,
      properties: Object.fromEntries(NUTRIENT_FIELDS.map((k) => [k, { type: 'number' }])),
    },
    estimated: { type: 'boolean', description: 'true if any value was estimated from ingredients rather than published' },
    flags: { type: 'array', items: { type: 'string', enum: ['high_mercury', 'listeria', 'raw', 'high_retinol', 'sugary', 'trans_fat', 'alcohol'] } },
    sources: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: { type: 'string' }, url: { type: 'string' } } } },
  },
};

const FOOD_SEARCH_INSTRUCTIONS = `You look up nutrition facts for one food using web search.
Prefer USDA FoodData Central, then the manufacturer's or restaurant's official nutrition page, then reputable nutrition databases.
Report values for the portion given (or a typical single serving if none is given) and say that portion in "portion".
Units: folate mcg DFE, iron mg, iodine mcg, choline mg, dha mg (DHA+EPA omega-3 from fish/algae, not ALA), calcium mg, vitamin_d IU, protein g, b12 mcg, fiber g, water L (only for drinks, else 0), caffeine mg, retinol = preformed vitamin A mcg RAE (animal sources only), alcohol = standard drinks.
For a dish or meal (bowl, sandwich, plate), the nutrients must cover the WHOLE dish: assume a typical build, list it in "basis", and sum every component (e.g. rice + beans + protein + salsa + toppings), not just the main protein.
Restaurant and package labels usually list only protein, fiber, calcium and iron. For every other nutrient, estimate from USDA values for the ingredients and set estimated=true. Never put 0 just because a value is unpublished; 0 means the food truly contains none (e.g. B12 in a vegan dish, DHA in a dish without fish or algae).
flags: high_mercury (swordfish, shark, king mackerel, tilefish, bigeye tuna, marlin), listeria (deli meat, hot dogs, unpasteurized soft cheese, cold smoked seafood), raw (raw/undercooked meat, fish or eggs), high_retinol (liver), sugary (sugar-sweetened drinks), trans_fat (deep-fried fast food, packaged pastries), alcohol.
Homemade and generic dishes (rosé pasta, chicken curry, stir-fry, casserole, "leftover" anything) have no official label. That is NOT a reason to fail: find a typical recipe, scale it to one serving, list the ingredients and amounts in "basis", compute the nutrients from USDA values for those ingredients, and set estimated=true and found=true.
Never include calories or energy. Set found=false ONLY when you cannot tell what the food is at all (gibberish, a non-food, or an unknown brand name with no description).`;

/** Web lookup for a food missing from the local database. Returns structured, cited nutrients. */
export async function searchFood(query, portion) {
  const res = await post('/responses', {
    model: config.OPENAI_SEARCH_MODEL,
    instructions: FOOD_SEARCH_INSTRUCTIONS,
    input: `Food: ${query}\nPortion: ${portion || 'typical single serving'}`,
    tools: [{ type: 'web_search' }],
    text: { format: { type: 'json_schema', name: 'food_nutrition', strict: true, schema: FOOD_SCHEMA } },
    store: false,
  });
  const message = (res.output || []).find((o) => o.type === 'message');
  const content = (message?.content || []).find((c) => c.type === 'output_text');
  if (!content) throw new Error('No result from web lookup');
  const result = JSON.parse(content.text);
  // Prefer the citations the search actually returned over URLs the model typed.
  const cited = (content.annotations || []).filter((a) => a.type === 'url_citation').map((a) => ({ title: a.title || a.url, url: a.url }));
  const seen = new Set();
  result.sources = [...cited, ...result.sources].filter((s) => /^https?:\/\//.test(s.url) && !seen.has(s.url) && seen.add(s.url)).slice(0, 3);
  return result;
}

/** Speech-to-text. `audio` is a Buffer, `mime` its content type. */
export async function transcribe(audio, mime) {
  const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
  const form = new FormData();
  form.append('model', config.OPENAI_TRANSCRIBE_MODEL);
  form.append('file', new Blob([audio], { type: mime }), `audio.${ext}`);
  const res = await fetch(`${OPENAI_URL}/audio/transcriptions`, { method: 'POST', headers: headers(), body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI error ${res.status}`);
  return json.text || '';
}
