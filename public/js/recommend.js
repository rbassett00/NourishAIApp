// Recommendation engine (spec §4.3). Only ever called when she asks for ideas in Chat.
// Filtering is done here in code, before the model sees candidates, and the chat layer re-checks the reply.
import { FOODS, FOOD_BY_ID, scaleNutrients } from './foods.js';
import { RECIPES } from './recipes.js';
import { excludedBy, foodTerms, isFavorite, recipeTerms } from './matching.js';

const AVOID_FLAGS = ['high_mercury', 'listeria', 'raw', 'high_retinol', 'alcohol', 'sugary', 'trans_fat'];
const DIET_EXCLUDES = {
  omnivore: [],
  pescatarian: ['meat', 'poultry'],
  vegetarian: ['meat', 'poultry', 'fish', 'shellfish'],
  vegan: ['meat', 'poultry', 'fish', 'shellfish', 'dairy', 'egg'],
};
// Choline is the most commonly low nutrient, so it ranks slightly higher (spec §3.1).
const PRIORITY = { choline: 1.25, folate: 1.1, iodine: 1.1, dha: 1.1, iron: 1.05 };

function foodAllowed(food, profile) {
  if (food.flags.some((f) => AVOID_FLAGS.includes(f))) return false;
  if (food.tags.some((t) => (DIET_EXCLUDES[profile.diet_pattern] || []).includes(t))) return false;
  return !excludedBy(foodTerms(food), { allergies: profile.allergies, disliked: profile.disliked_foods });
}

export function recipeAllowed(recipe, profile, hidden = []) {
  if (hidden.includes(recipe.id)) return false;
  if (!recipe.components.every((c) => foodAllowed(FOOD_BY_ID[c.food], profile))) return false;
  return !excludedBy(recipeTerms(recipe, FOOD_BY_ID), { allergies: profile.allergies, disliked: profile.disliked_foods });
}

export function recipeNutrients(recipe) {
  const t = {};
  for (const c of recipe.components) {
    for (const [k, v] of Object.entries(scaleNutrients(FOOD_BY_ID[c.food].nutrients, c.qty))) t[k] = (t[k] || 0) + v;
  }
  return t;
}

/**
 * gaps: [{ key, remaining, target }] sorted biggest-first.
 * Score = share of each remaining gap the item closes, weighted by priority.
 */
function score(nutrients, gaps, focus, ironBoost = false) {
  let s = 0;
  const helps = [];
  for (const g of gaps) {
    const v = nutrients[g.key] || 0;
    if (v <= 0 || g.remaining <= 0) continue;
    const closed = Math.min(v, g.remaining) / g.target;
    s += closed * (PRIORITY[g.key] || 1) * (g.key === focus ? 1.3 : 1) * (ironBoost && g.key === 'iron' ? 1.2 : 1);
    if (closed >= 0.08) helps.push({ key: g.key, amount: Math.round(v * 10) / 10 });
  }
  return { s, helps: helps.sort((a, b) => b.amount / 1 - a.amount / 1) };
}

export function computeGaps(progress, only = []) {
  return progress
    .filter((p) => p.key !== 'water' && (!only.length || only.includes(p.key)))
    .map((p) => ({ key: p.key, target: p.target, remaining: Math.max(p.target - p.value, 0), pct: p.pct }))
    .filter((g) => g.remaining > 0)
    .sort((a, b) => a.pct - b.pct);
}

export function recommendFoods({ profile, gaps, mealType = 'any', focus = null, ironBoost = false, limit = 5 }) {
  const top = gaps.slice(0, 5);
  return FOODS
    .filter((f) => f.recommend && foodAllowed(f, profile))
    .filter((f) => mealType === 'any' || f.meals.includes(mealType))
    .map((f) => {
      const qty = f.defaultQty;
      const nutrients = scaleNutrients(f.nutrients, qty);
      const { s, helps } = score(nutrients, top, focus, ironBoost);
      const fav = isFavorite(foodTerms(f), profile.favorite_foods);
      return { kind: 'food', id: f.id, name: f.name, qty, unit: f.unit, helps, favorite: fav, score: s * (fav ? 1.3 : 1) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function recommendRecipes({ profile, gaps, mealType = 'any', focus = null, ironBoost = false, fishThisWeek = 0, hidden = [], limit = 3 }) {
  return RECIPES
    .filter((r) => recipeAllowed(r, profile, hidden))
    .filter((r) => mealType === 'any' || r.meals.includes(mealType))
    .map((r) => {
      const nutrients = recipeNutrients(r);
      const { s, helps } = score(nutrients, gaps.slice(0, 6), focus, ironBoost);
      const fav = isFavorite(recipeTerms(r, FOOD_BY_ID), profile.favorite_foods);
      let boost = 1;
      if (r.tags.includes('mediterranean')) boost *= 1.1;
      if (r.tags.includes('fish') && fishThisWeek < 2) boost *= 1.25;
      if (fav) boost *= 1.3;
      return { kind: 'recipe', id: r.id, name: r.name, minutes: r.minutes, meals: r.meals, helps, favorite: fav, tags: r.tags, score: (s + 0.05) * boost };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export { foodAllowed };
