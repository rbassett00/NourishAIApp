// Ingredient-name normalization + synonym/allergen matching used to hard-exclude
// allergies and disliked foods from every recommendation and recipe (spec §4.4 rule 1).

// canonical -> synonyms
const SYNONYMS = {
  cilantro: ['coriander', 'coriander leaf', 'coriander leaves', 'chinese parsley'],
  chickpea: ['garbanzo', 'garbanzo bean', 'chana'],
  shrimp: ['prawn', 'prawns'],
  eggplant: ['aubergine', 'brinjal'],
  zucchini: ['courgette'],
  'bell pepper': ['capsicum', 'sweet pepper', 'red pepper', 'green pepper', 'pepper'],
  mushroom: ['shiitake', 'portobello', 'cremini', 'button mushroom', 'fungi'],
  'green onion': ['scallion', 'spring onion'],
  arugula: ['rocket'],
  'sweet potato': ['yam'],
  tuna: ['ahi'],
  salmon: ['lox'],
  egg: ['eggs', 'egg white', 'egg yolk'],
  peanut: ['peanuts', 'groundnut', 'peanut butter'],
  yogurt: ['yoghurt'],
  lettuce: ['romaine', 'salad green', 'salad greens', 'mixed greens'],
  'soy sauce': ['tamari', 'shoyu'],
  tofu: ['bean curd'],
  fish: ['seafood'],
};

// allergy term -> everything it rules out (tags + ingredient names)
const ALLERGEN_GROUPS = {
  dairy: ['dairy', 'milk', 'cheese', 'yogurt', 'butter', 'cream', 'whey', 'casein', 'latte'],
  gluten: ['gluten', 'wheat', 'bread', 'pasta', 'tortilla', 'barley', 'rye', 'cereal', 'couscous'],
  wheat: ['wheat', 'bread', 'pasta', 'tortilla', 'cereal', 'couscous'],
  egg: ['egg', 'mayonnaise'],
  soy: ['soy', 'tofu', 'edamame', 'soy milk', 'soy sauce', 'tempeh', 'miso'],
  peanut: ['peanut'],
  tree_nut: ['tree_nut', 'almond', 'walnut', 'cashew', 'pecan', 'pistachio', 'hazelnut', 'macadamia'],
  shellfish: ['shellfish', 'shrimp', 'crab', 'lobster', 'scallop', 'clam', 'mussel', 'oyster'],
  fish: ['fish', 'salmon', 'tuna', 'cod', 'sardine', 'tilapia', 'anchovy', 'swordfish', 'mackerel'],
  sesame: ['sesame', 'tahini', 'hummus'],
};
const ALLERGEN_ALIASES = {
  milk: 'dairy', lactose: 'dairy', 'cow milk': 'dairy', 'tree nut': 'tree_nut', nut: 'tree_nut', 'nuts': 'tree_nut',
  'tree nuts': 'tree_nut', eggs: 'egg', shellfish: 'shellfish', seafood: 'shellfish', celiac: 'gluten', soya: 'soy',
};

const SYN_TO_CANON = {};
for (const [canon, syns] of Object.entries(SYNONYMS)) for (const s of syns) SYN_TO_CANON[singular(clean(s))] = canon;

function clean(s) {
  return String(s).toLowerCase().replace(/_/g, ' ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function singular(phrase) {
  return phrase.split(' ').map((w) => {
    if (w.length <= 3) return w;
    if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
    if (w.endsWith('oes') || w.endsWith('ches') || w.endsWith('shes')) return w.slice(0, -2);
    if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }).join(' ');
}

/** Normalize a term to its canonical form ("Coriander leaves" -> "cilantro"). */
export function canonical(term) {
  const s = singular(clean(term));
  return SYN_TO_CANON[s] || s;
}

/** All normalized terms describing a food (name, aliases, tags, ingredients). */
export function foodTerms(food) {
  return [food.name, ...food.aka, ...food.tags, ...food.ingredients].map(canonical);
}

/** Terms for a recipe: its name, extra ingredients and every component food's terms. */
export function recipeTerms(recipe, foodById) {
  const terms = [recipe.name, ...recipe.ingredients].map(canonical);
  for (const c of recipe.components) terms.push(...foodTerms(foodById[c.food]));
  return terms;
}

const containsPhrase = (haystack, needle) => ` ${haystack} `.includes(` ${needle} `);

function matchesAny(terms, needles) {
  return needles.some((n) => n && terms.some((t) => t === n || containsPhrase(t, n)));
}

function expandAllergy(term) {
  const c = canonical(term);
  const raw = clean(term);
  const group = ALLERGEN_GROUPS[c.replace(' ', '_')] || ALLERGEN_GROUPS[ALLERGEN_ALIASES[raw]] || ALLERGEN_GROUPS[ALLERGEN_ALIASES[c]];
  return group ? group.map(canonical) : [c];
}

/** Which exclusion (if any) knocks this term list out. Returns the offending profile entry or null. */
export function excludedBy(terms, { allergies = [], disliked = [] }) {
  for (const a of allergies) if (matchesAny(terms, expandAllergy(a))) return { field: 'allergies', value: a };
  for (const d of disliked) if (matchesAny(terms, [canonical(d)])) return { field: 'disliked_foods', value: d };
  return null;
}

export function isFavorite(terms, favorites = []) {
  return matchesAny(terms, favorites.map(canonical));
}
