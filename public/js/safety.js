// Urgent-sign detection (spec §4.1). Runs in code before any model call; the cards are templated.
// The model can also show the same cards with show_safety_card(kind) when it spots phrasing these rules miss.

const PAIN_WORDS = '(abdominal|stomach|belly|pelvic|pelvis|tummy|cramp|cramps|cramping|abdomen|lower back)';

const RULES = {
  crisis: [
    /\b(kill|hurt|harm) myself\b/i,
    /\bself[- ]harm/i,
    /\bsuicid/i,
    /\bend (it all|my life)\b/i,
    /\bdon'?t want to (be alive|live|be here)\b/i,
    /\bhopeless\b/i,
    /\b(don'?t|can'?t) see the point\b/i,
    /\bno (reason|point) (to|in) (live|living|going on)\b/i,
    /\bbetter off (dead|without me)\b/i,
  ],
  poison: [
    /\boverdos/i,
    /\bpoison/i,
    /\b(drank|swallowed|ingested|ate|drink)\b[^.?!]{0,25}\b(bleach|detergent|cleaner|antifreeze|laundry pod|tide pod|ammonia|lye)\b/i,
    /\b(took|swallowed|taken)\b[^.?!]{0,15}\b(too many|a (whole )?bunch of|handful of|the whole bottle|whole bottle|[5-9]|\d{2,3}|five|six|seven|eight|nine|ten|several)\b[^.?!]{0,25}\b(pills|tablets|capsules|prenatals?|vitamins?|gummies|advil|ibuprofen|tylenol|acetaminophen|iron|aleve|melatonin|benadryl)\b/i,
    /\baccidentally (took|swallowed|had)\b[^.?!]{0,30}\b(pills|tablets|prenatals?|vitamins?|medicine|medication)\b/i,
  ],
  medical: [
    /\bheavy (vaginal )?bleed/i,
    /\bbleeding (a lot|heavily|through|so much|really bad)/i,
    /\bsoak(ing|ed)? (through )?(a |my |one )?(pad|tampon)/i,
    /\b(severe|really bad|extreme|intense|sharp|unbearable|excruciating|worst)\b[^.?!]{0,25}\b(abdominal|stomach|belly|pelvic|tummy|abdomen) ?(pain|ache|cramps?)?/i,
    new RegExp(`\\b${PAIN_WORDS}\\b[^.?!]{0,20}\\b(severe|unbearable|extreme|excruciating|killing me)\\b`, 'i'),
    /\b(stomach|belly|abdomen|pelvis|side) is killing me\b/i,
    // Fever with pelvic/abdominal pain. Decimals like 100.5 are allowed inside the gap; sentence ends are not.
    new RegExp(`\\bfever\\b(?:[^.?!\\n]|\\.\\d){0,40}\\b${PAIN_WORDS}\\b|\\b${PAIN_WORDS}\\b(?:[^.?!\\n]|\\.\\d){0,40}\\bfever\\b`, 'i'),
    new RegExp(`\\b(10[0-9](\\.\\d)?|3[89](\\.\\d)?)\\s*(°|degrees|f\\b|c\\b)(?:[^.?!\\n]|\\.\\d){0,40}\\b${PAIN_WORDS}\\b`, 'i'),
    /\bchest pain\b/i,
    /\bpain in my chest\b/i,
    /\b(trouble|difficulty|hard time|can'?t|cannot|struggling to) (breath|breathe|breathing)\b/i,
    /\bshort(ness)? of breath\b/i,
    /\b(fainted|passed out|blacked out|fainting)\b/i,
  ],
};

/** Returns 'crisis' | 'poison' | 'medical' | null. Crisis and poison win over medical. */
export function detectSafety(text) {
  for (const kind of ['crisis', 'poison', 'medical']) if (RULES[kind].some((p) => p.test(text))) return kind;
  return null;
}

export const isUrgent = (text) => detectSafety(text) !== null;

export const SAFETY_CARDS = {
  medical: {
    title: 'This could need care right away',
    body: 'What you described can be a warning sign. Please call your provider now, or call 911.',
    actions: [{ label: 'Call 911', href: 'tel:911', primary: true }],
  },
  poison: {
    title: 'Call Poison Control now',
    body: 'Call Poison Control at 1-800-222-1222 now. Call 911 if you are having trouble breathing or someone is unresponsive.',
    actions: [{ label: 'Call 1-800-222-1222', href: 'tel:18002221222', primary: true }, { label: 'Call 911', href: 'tel:911' }],
  },
  crisis: {
    title: 'You don\'t have to go through this alone',
    body: 'Please call or text 988 (Suicide & Crisis Lifeline), any time, day or night. If you are in immediate danger, call 911.',
    actions: [{ label: 'Call or text 988', href: 'tel:988', primary: true }, { label: 'Call 911', href: 'tel:911' }],
  },
};

/** Strip any sentence that mentions calories/kcal from model text (acceptance criterion 18). */
export function stripCalories(text) {
  if (!/calori|kcal|\bcal\b/i.test(text)) return text;
  return text
    .split(/(?<=[.!?])\s+|\n/)
    .filter((s) => !/calori|kcal|\bcal\b/i.test(s))
    .join(' ')
    .trim();
}
