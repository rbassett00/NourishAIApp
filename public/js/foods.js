// Prototype food database. Values are per unit and approximate USDA FoodData Central figures
// (rounded), plus a small custom table for mixed dishes and supplements.
// Keys: fo folate (mcg DFE), fe iron (mg), io iodine (mcg), ch choline (mg), dha (mg), ca calcium (mg),
// d vitamin D (IU), pr protein (g), b12 (mcg), fi fiber (g), w water (L), caf caffeine (mg),
// ret preformed vitamin A (mcg RAE), alc alcoholic drinks.
// Energy is intentionally not stored: calories are never shown (spec §2).

const KEYMAP = { fo: 'folate', fe: 'iron', io: 'iodine', ch: 'choline', dha: 'dha', ca: 'calcium', d: 'vitamin_d', pr: 'protein', b12: 'b12', fi: 'fiber', w: 'water', caf: 'caffeine', ret: 'retinol', alc: 'alcohol' };

function f(id, name, unit, n, o = {}) {
  const nutrients = {};
  for (const [k, v] of Object.entries(n)) nutrients[KEYMAP[k]] = v;
  return {
    id, name, unit, nutrients,
    aka: o.aka || [],
    tags: o.tags || [],               // diet + allergen tags: meat poultry fish shellfish dairy egg gluten wheat soy peanut tree_nut sesame
    ingredients: o.ing || [],
    flags: o.flags || [],             // high_mercury listeria raw high_retinol sugary trans_fat alcohol
    fertility: Boolean(o.fert),       // whole grain / legume / nuts-olive oil-avocado / leafy green
    fishServing: Boolean(o.fish),     // counts as a low-mercury fish serving
    recommend: o.rec !== false,       // can appear as a gap-filler
    meals: o.meals || ['breakfast', 'lunch', 'dinner', 'snack'],
    defaultQty: o.q || 1,
  };
}

const B = ['breakfast'], LD = ['lunch', 'dinner'], S = ['snack'], BS = ['breakfast', 'snack'], LDS = ['lunch', 'dinner', 'snack'];

export const FOODS = [
  // Eggs, meat, poultry
  f('egg', 'Egg', 'large egg', { fo: 22, fe: 0.9, io: 26, ch: 147, dha: 29, ca: 28, d: 44, pr: 6.3, b12: 0.45, ret: 80 }, { aka: ['eggs', 'scrambled eggs', 'fried egg', 'boiled egg', 'hard-boiled egg', 'poached egg'], tags: ['egg'], ing: ['egg'], q: 2, meals: ['breakfast', 'lunch', 'snack'] }),
  f('runny_egg', 'Runny / raw egg', 'egg', { fo: 22, fe: 0.9, io: 26, ch: 147, dha: 29, ca: 28, d: 44, pr: 6.3, b12: 0.45, ret: 80 }, { aka: ['soft-boiled egg', 'raw egg', 'sunny side up'], tags: ['egg'], ing: ['egg'], flags: ['raw'], rec: false }),
  f('chicken_breast', 'Chicken breast', '3 oz cooked', { fo: 3, fe: 0.9, io: 6, ch: 72, dha: 15, ca: 13, d: 4, pr: 26, b12: 0.3 }, { aka: ['chicken', 'grilled chicken', 'roast chicken'], tags: ['poultry'], ing: ['chicken'], meals: LD }),
  f('ground_beef', 'Ground beef', '3 oz cooked', { fo: 8, fe: 2.2, io: 3, ch: 70, ca: 10, pr: 22, b12: 2.4 }, { aka: ['beef', 'mince'], tags: ['meat'], ing: ['beef'], meals: LD }),
  f('steak', 'Steak', '3 oz cooked', { fo: 6, fe: 2.6, ch: 85, ca: 12, pr: 25, b12: 1.6 }, { aka: ['sirloin', 'beef steak'], tags: ['meat'], ing: ['beef'], meals: LD }),
  f('beef_liver', 'Beef liver', '3 oz cooked', { fo: 215, fe: 5.2, ch: 333, ca: 5, pr: 23, b12: 60, ret: 6600 }, { aka: ['liver', 'pate', 'liver pate'], tags: ['meat'], ing: ['liver'], flags: ['high_retinol'], rec: false }),
  f('turkey_deli', 'Deli turkey', '2 oz', { fe: 0.5, io: 5, ch: 25, pr: 10, b12: 0.2 }, { aka: ['turkey', 'deli meat', 'lunch meat', 'cold cuts', 'sliced turkey', 'ham'], tags: ['poultry'], ing: ['turkey', 'deli meat'], flags: ['listeria'], rec: false }),
  f('hot_dog', 'Hot dog', '1 hot dog', { fe: 0.8, ch: 20, pr: 5, b12: 0.5 }, { aka: ['frank', 'sausage'], tags: ['meat'], ing: ['pork', 'beef'], flags: ['listeria'], rec: false }),
  f('bacon', 'Bacon', '2 slices', { fe: 0.2, ch: 18, pr: 6, b12: 0.2 }, { tags: ['meat'], ing: ['pork', 'bacon'], rec: false }),

  // Fish & seafood
  f('salmon', 'Salmon', '3 oz cooked', { fo: 20, fe: 0.3, io: 12, ch: 75, dha: 1100, ca: 13, d: 570, pr: 22, b12: 2.6 }, { aka: ['baked salmon', 'grilled salmon', 'salmon fillet'], tags: ['fish'], ing: ['salmon', 'fish'], fish: true, meals: LD }),
  f('tuna_light', 'Canned light tuna', '3 oz', { fe: 1.4, io: 15, ch: 25, dha: 190, d: 40, pr: 22, b12: 2.5 }, { aka: ['tuna', 'tuna salad', 'canned tuna'], tags: ['fish'], ing: ['tuna', 'fish'], fish: true, meals: LDS }),
  f('sardines', 'Sardines', '3 oz', { fe: 2.5, io: 30, ch: 65, dha: 430, ca: 325, d: 164, pr: 21, b12: 7.6 }, { aka: ['sardine'], tags: ['fish'], ing: ['sardine', 'fish'], fish: true, meals: LDS }),
  f('cod', 'Cod', '3 oz cooked', { fe: 0.3, io: 146, ch: 70, dha: 130, d: 40, pr: 19, b12: 0.8 }, { aka: ['white fish', 'fish fillet', 'baked fish'], tags: ['fish'], ing: ['cod', 'fish'], fish: true, meals: LD }),
  f('tilapia', 'Tilapia', '3 oz cooked', { fe: 0.6, io: 10, ch: 50, dha: 110, d: 130, pr: 22, b12: 1.6 }, { tags: ['fish'], ing: ['tilapia', 'fish'], fish: true, meals: LD }),
  f('shrimp', 'Shrimp', '3 oz cooked', { fe: 0.4, io: 13, ch: 115, dha: 100, ca: 60, pr: 20, b12: 1.4 }, { aka: ['prawns'], tags: ['shellfish'], ing: ['shrimp'], fish: true, meals: LD }),
  f('swordfish', 'Swordfish', '3 oz cooked', { dha: 580, d: 470, pr: 20, b12: 1.7 }, { aka: ['shark', 'king mackerel', 'tilefish', 'bigeye tuna', 'marlin', 'orange roughy'], tags: ['fish'], ing: ['swordfish', 'fish'], flags: ['high_mercury'], rec: false }),
  f('sushi_raw', 'Sushi with raw fish', '6-piece roll', { fo: 20, fe: 0.8, io: 50, dha: 300, pr: 9, fi: 1 }, { aka: ['sushi', 'sashimi', 'poke', 'raw fish', 'ceviche', 'oysters', 'raw oysters'], tags: ['fish'], ing: ['raw fish', 'fish', 'rice', 'seaweed'], flags: ['raw'], rec: false }),
  f('smoked_salmon', 'Smoked salmon (cold)', '2 oz', { dha: 280, d: 380, pr: 10, b12: 1.8 }, { aka: ['lox', 'nova'], tags: ['fish'], ing: ['salmon', 'fish'], flags: ['listeria'], rec: false }),

  // Plant proteins & legumes
  f('tofu', 'Tofu (calcium-set)', '1/2 cup', { fo: 19, fe: 3.4, ch: 35, ca: 350, pr: 10, fi: 0.5 }, { tags: ['soy'], ing: ['tofu', 'soy'], meals: LD }),
  f('lentils', 'Lentils', '1 cup cooked', { fo: 358, fe: 6.6, ch: 65, ca: 38, pr: 18, fi: 15.6 }, { aka: ['lentil soup', 'dal', 'dhal'], ing: ['lentil'], fert: true, meals: LD }),
  f('chickpeas', 'Chickpeas', '1 cup cooked', { fo: 282, fe: 4.7, ch: 70, ca: 80, pr: 14.5, fi: 12.5 }, { aka: ['garbanzo beans'], ing: ['chickpea'], fert: true, meals: LD }),
  f('black_beans', 'Black beans', '1 cup cooked', { fo: 256, fe: 3.6, ch: 55, ca: 46, pr: 15, fi: 15 }, { aka: ['beans', 'pinto beans', 'kidney beans', 'refried beans'], ing: ['bean'], fert: true, meals: LD }),
  f('edamame', 'Edamame', '1 cup shelled', { fo: 482, fe: 3.5, ch: 100, ca: 98, pr: 18, fi: 8 }, { aka: ['soybeans'], tags: ['soy'], ing: ['edamame', 'soy'], fert: true, meals: LDS }),
  f('hummus', 'Hummus', '1/4 cup', { fo: 50, fe: 1.4, ch: 20, ca: 22, pr: 4.8, fi: 3.6 }, { tags: ['sesame'], ing: ['chickpea', 'tahini', 'sesame'], fert: true, meals: LDS }),
  f('peanut_butter', 'Peanut butter', '2 tbsp', { fo: 24, fe: 0.6, ch: 20, ca: 15, pr: 7, fi: 1.9 }, { aka: ['pb'], tags: ['peanut'], ing: ['peanut'], fert: true, meals: BS }),

  // Dairy & alternatives
  f('milk', 'Milk', '1 cup', { fo: 12, io: 85, ch: 40, ca: 300, d: 120, pr: 8, b12: 1.3, ret: 135, w: 0.24 }, { aka: ['glass of milk', 'cow milk'], tags: ['dairy'], ing: ['milk'], meals: BS }),
  f('greek_yogurt', 'Greek yogurt', '3/4 cup (170 g)', { io: 60, ch: 25, ca: 190, pr: 17, b12: 1.3 }, { aka: ['yogurt', 'yoghurt', 'skyr'], tags: ['dairy'], ing: ['yogurt', 'milk'], meals: BS }),
  f('cheddar', 'Cheddar cheese', '1 oz', { io: 12, ch: 5, ca: 200, pr: 7, b12: 0.3, ret: 75 }, { aka: ['cheese', 'swiss cheese', 'mozzarella', 'parmesan'], tags: ['dairy'], ing: ['cheese', 'milk'], meals: LDS }),
  f('cottage_cheese', 'Cottage cheese', '1/2 cup', { io: 25, ch: 20, ca: 70, pr: 12, b12: 0.5 }, { tags: ['dairy'], ing: ['cheese', 'milk'], meals: BS }),
  f('soft_cheese_raw', 'Unpasteurized soft cheese', '1 oz', { ca: 100, pr: 5, ret: 60 }, { aka: ['brie', 'camembert', 'queso fresco', 'raw milk cheese', 'blue cheese', 'feta (unpasteurized)'], tags: ['dairy'], ing: ['cheese', 'milk'], flags: ['listeria'], rec: false }),
  f('soy_milk', 'Fortified soy milk', '1 cup', { fo: 21, fe: 1.1, ch: 57, ca: 300, d: 120, pr: 7, b12: 2.7, w: 0.24 }, { aka: ['soymilk', 'plant milk'], tags: ['soy'], ing: ['soy milk', 'soy'], meals: BS }),

  // Grains
  f('oatmeal', 'Oatmeal', '1 cup cooked', { fo: 14, fe: 2.1, ch: 17, ca: 21, pr: 6, fi: 4 }, { aka: ['oats', 'porridge', 'overnight oats'], ing: ['oat'], fert: true, meals: B }),
  f('fortified_cereal', 'Fortified breakfast cereal', '1 cup', { fo: 340, fe: 8, ch: 10, ca: 100, d: 40, pr: 3, b12: 1.5, fi: 3 }, { aka: ['cereal', 'cheerios', 'bran flakes', 'corn flakes'], tags: ['gluten', 'wheat'], ing: ['cereal', 'wheat'], meals: B }),
  f('whole_wheat_bread', 'Whole-wheat bread', 'slice', { fo: 14, fe: 0.8, ch: 8, ca: 50, pr: 4, fi: 2 }, { aka: ['toast', 'whole grain toast', 'wheat toast', 'whole grain bread', 'pita'], tags: ['gluten', 'wheat'], ing: ['bread', 'wheat'], fert: true }),
  f('white_bread', 'White bread (enriched)', 'slice', { fo: 55, fe: 1, ch: 3, ca: 40, pr: 2.6, fi: 0.6 }, { aka: ['white toast', 'sandwich bread', 'bun'], tags: ['gluten', 'wheat'], ing: ['bread', 'wheat'], rec: false }),
  f('bagel', 'Bagel', '1 bagel', { fo: 140, fe: 4.4, ch: 10, ca: 20, pr: 10, fi: 2.3 }, { tags: ['gluten', 'wheat'], ing: ['bread', 'wheat'], rec: false, meals: B }),
  f('quinoa', 'Quinoa', '1 cup cooked', { fo: 78, fe: 2.8, ch: 43, ca: 31, pr: 8, fi: 5 }, { ing: ['quinoa'], fert: true, meals: LD }),
  f('brown_rice', 'Brown rice', '1 cup cooked', { fo: 18, fe: 0.8, ch: 18, ca: 20, pr: 5.5, fi: 3.5 }, { ing: ['rice'], fert: true, meals: LD }),
  f('white_rice', 'White rice (enriched)', '1 cup cooked', { fo: 150, fe: 1.9, ch: 4, ca: 16, pr: 4.3, fi: 0.6 }, { aka: ['rice'], ing: ['rice'], rec: false, meals: LD }),
  f('pasta_ww', 'Whole-wheat pasta', '1 cup cooked', { fo: 7, fe: 1.5, ch: 13, ca: 15, pr: 7.5, fi: 6 }, { tags: ['gluten', 'wheat'], ing: ['pasta', 'wheat'], fert: true, meals: LD }),
  f('pasta', 'Pasta (enriched)', '1 cup cooked', { fo: 170, fe: 1.8, ch: 10, ca: 10, pr: 8, fi: 2.5 }, { aka: ['spaghetti', 'noodles', 'penne'], tags: ['gluten', 'wheat'], ing: ['pasta', 'wheat'], rec: false, meals: LD }),
  f('tortilla', 'Flour tortilla', '1 tortilla', { fo: 90, fe: 1.5, ca: 40, pr: 4, fi: 1 }, { aka: ['wrap'], tags: ['gluten', 'wheat'], ing: ['tortilla', 'wheat'], rec: false }),

  // Vegetables
  f('spinach_cooked', 'Spinach, cooked', '1/2 cup', { fo: 131, fe: 3.2, ch: 18, ca: 122, pr: 2.7, fi: 2.2 }, { aka: ['sauteed spinach'], ing: ['spinach'], fert: true, meals: LD }),
  f('spinach_raw', 'Spinach, raw', '1 cup', { fo: 58, fe: 0.8, ch: 6, ca: 30, pr: 0.9, fi: 0.7 }, { aka: ['spinach', 'baby spinach', 'spinach salad'], ing: ['spinach'], fert: true, meals: LD }),
  f('kale', 'Kale', '1 cup raw', { fo: 30, fe: 0.3, ca: 52, pr: 0.9, fi: 0.9 }, { ing: ['kale'], fert: true, meals: LD }),
  f('mixed_greens', 'Salad greens', '2 cups', { fo: 120, fe: 1.2, ca: 40, pr: 1.5, fi: 2 }, { aka: ['salad', 'side salad', 'lettuce', 'romaine', 'green salad'], ing: ['lettuce'], fert: true, meals: LD }),
  f('broccoli', 'Broccoli', '1 cup cooked', { fo: 168, fe: 1, ch: 63, ca: 62, pr: 3.7, fi: 5 }, { ing: ['broccoli'], meals: LD }),
  f('brussels', 'Brussels sprouts', '1/2 cup cooked', { fo: 78, fe: 0.9, ch: 32, ca: 28, pr: 2, fi: 2 }, { aka: ['brussels sprouts'], ing: ['brussels sprout'], meals: LD }),
  f('asparagus', 'Asparagus', '4 spears', { fo: 89, fe: 0.6, ch: 10, ca: 14, pr: 1.5, fi: 1.2 }, { ing: ['asparagus'], meals: LD }),
  f('avocado', 'Avocado', '1/2 avocado', { fo: 81, fe: 0.6, ch: 14, ca: 12, pr: 2, fi: 6.7 }, { aka: ['guacamole'], ing: ['avocado'], fert: true }),
  f('sweet_potato', 'Sweet potato', '1 medium', { fo: 7, fe: 0.8, ch: 15, ca: 43, pr: 2, fi: 3.8 }, { aka: ['yam'], ing: ['sweet potato'], meals: LD }),
  f('potato', 'Potato', '1 medium baked', { fo: 40, fe: 1.9, ch: 26, ca: 26, pr: 4.3, fi: 4 }, { aka: ['baked potato', 'mashed potatoes'], ing: ['potato'], rec: false, meals: LD }),
  f('mushrooms', 'Mushrooms', '1 cup cooked', { fo: 11, ch: 12, d: 5, pr: 3, fi: 1 }, { aka: ['mushroom'], ing: ['mushroom'], meals: LD }),
  f('bell_pepper', 'Bell pepper', '1 cup sliced', { fo: 50, fe: 0.4, ca: 10, pr: 1, fi: 3 }, { aka: ['peppers', 'red pepper'], ing: ['bell pepper'], meals: LDS }),
  f('carrots', 'Carrots', '1 cup', { fo: 24, fe: 0.4, ca: 42, pr: 1.2, fi: 3.6 }, { aka: ['baby carrots'], ing: ['carrot'], meals: LDS }),
  f('green_peas', 'Green peas', '1/2 cup', { fo: 50, fe: 1.2, ch: 22, ca: 20, pr: 4.3, fi: 4.4 }, { aka: ['peas'], ing: ['pea'], fert: true, meals: LD }),

  // Fruit
  f('orange', 'Orange', '1 medium', { fo: 39, ca: 52, pr: 1.2, fi: 3.1 }, { aka: ['clementine', 'mandarin'], ing: ['orange'], meals: BS }),
  f('orange_juice', 'Orange juice', '1 cup', { fo: 74, ca: 27, pr: 1.7, fi: 0.5, w: 0.24 }, { aka: ['oj', 'juice'], ing: ['orange'], rec: false, meals: B }),
  f('banana', 'Banana', '1 medium', { fo: 24, ch: 12, pr: 1.3, fi: 3.1 }, { ing: ['banana'], meals: BS }),
  f('berries', 'Berries', '1 cup', { fo: 25, fe: 0.5, ca: 20, pr: 1, fi: 4 }, { aka: ['blueberries', 'strawberries', 'raspberries'], ing: ['berry'], meals: BS }),
  f('apple', 'Apple', '1 medium', { fo: 5, ca: 11, pr: 0.5, fi: 4.4 }, { ing: ['apple'], meals: S }),

  // Nuts, seeds, fats
  f('almonds', 'Almonds', '1 oz (23 nuts)', { fo: 14, fe: 1, ch: 15, ca: 76, pr: 6, fi: 3.5 }, { aka: ['almond'], tags: ['tree_nut'], ing: ['almond'], fert: true, meals: S }),
  f('walnuts', 'Walnuts', '1 oz', { fo: 28, fe: 0.8, ch: 11, ca: 28, pr: 4.3, fi: 1.9 }, { aka: ['walnut', 'nuts', 'mixed nuts'], tags: ['tree_nut'], ing: ['walnut'], fert: true, meals: S }),
  f('chia', 'Chia seeds', '2 tbsp', { fe: 2.2, ca: 180, pr: 4.7, fi: 10 }, { ing: ['chia'], fert: true, meals: BS }),
  f('pumpkin_seeds', 'Pumpkin seeds', '1 oz', { fo: 16, fe: 2.5, ch: 18, ca: 15, pr: 8.5, fi: 1.7 }, { aka: ['pepitas'], ing: ['pumpkin seed'], fert: true, meals: S }),
  f('olive_oil', 'Olive oil', '1 tbsp', {}, { ing: ['olive oil'], fert: true, rec: false }),

  // Drinks
  f('water', 'Water', 'glass (250 ml)', { w: 0.25 }, { aka: ['glass of water', 'sparkling water', 'bottle of water'], rec: false }),
  f('coffee', 'Coffee', '8 oz cup', { caf: 95, w: 0.24 }, { aka: ['black coffee', 'drip coffee', 'americano', 'cold brew'], ing: ['coffee'], rec: false }),
  f('latte', 'Latte', '12 oz', { io: 80, ch: 40, ca: 300, d: 110, pr: 8, b12: 1.2, ret: 130, caf: 128, w: 0.33 }, { aka: ['cappuccino', 'flat white', 'cafe latte'], tags: ['dairy'], ing: ['coffee', 'milk'], rec: false }),
  f('espresso', 'Espresso', '1 shot', { caf: 64, w: 0.03 }, { ing: ['coffee'], rec: false }),
  f('black_tea', 'Black tea', '8 oz cup', { caf: 47, w: 0.24 }, { aka: ['tea', 'chai', 'iced tea'], ing: ['tea'], rec: false }),
  f('green_tea', 'Green tea', '8 oz cup', { caf: 28, w: 0.24 }, { aka: ['matcha'], ing: ['tea'], rec: false }),
  f('soda', 'Cola / soda', '12 oz can', { caf: 34, w: 0.35 }, { aka: ['coke', 'pop', 'diet coke', 'soft drink'], ing: ['soda'], flags: ['sugary'], rec: false }),
  f('energy_drink', 'Energy drink', '16 oz can', { caf: 160, w: 0.47 }, { aka: ['red bull', 'monster'], flags: ['sugary'], rec: false }),
  f('wine', 'Wine', '5 oz glass', { alc: 1 }, { aka: ['glass of wine', 'red wine', 'white wine'], flags: ['alcohol'], rec: false }),
  f('beer', 'Beer', '12 oz', { alc: 1 }, { aka: ['cocktail', 'margarita', 'hard seltzer'], tags: ['gluten'], flags: ['alcohol'], rec: false }),

  // Mixed dishes
  f('turkey_sandwich', 'Turkey sandwich', '1 sandwich', { fo: 90, fe: 2.6, io: 25, ch: 55, ca: 120, pr: 22, b12: 0.5, fi: 4 }, { aka: ['deli sandwich', 'sandwich', 'ham sandwich'], tags: ['poultry', 'gluten', 'wheat', 'dairy'], ing: ['turkey', 'deli meat', 'bread', 'lettuce', 'cheese'], flags: ['listeria'], rec: false, meals: LD }),
  f('pizza', 'Cheese pizza', '1 slice', { fo: 70, fe: 2.4, io: 20, ch: 20, ca: 220, pr: 12, b12: 0.4, fi: 2.5, ret: 70 }, { tags: ['dairy', 'gluten', 'wheat'], ing: ['cheese', 'bread', 'tomato'], rec: false, meals: LD }),
  f('burrito_bowl', 'Chicken burrito bowl', '1 bowl', { fo: 220, fe: 5, io: 15, ch: 120, ca: 250, pr: 40, b12: 0.5, fi: 13 }, { aka: ['burrito', 'chipotle bowl', 'burrito bowl'], tags: ['poultry', 'dairy'], ing: ['chicken', 'rice', 'bean', 'cheese', 'salsa', 'cilantro', 'lettuce'], fert: true, rec: false, meals: LD }),
  f('spaghetti_meat', 'Spaghetti with meat sauce', '1.5 cups', { fo: 200, fe: 4, ch: 70, ca: 60, pr: 25, b12: 1.8, fi: 5 }, { aka: ['spaghetti bolognese', 'bolognese'], tags: ['meat', 'gluten', 'wheat'], ing: ['beef', 'pasta', 'tomato', 'onion', 'garlic'], rec: false, meals: LD }),
  f('chicken_salad', 'Grilled chicken salad', '1 large salad', { fo: 130, fe: 2, io: 8, ch: 80, ca: 70, pr: 28, b12: 0.3, fi: 4 }, { aka: ['caesar salad', 'cobb salad'], tags: ['poultry'], ing: ['chicken', 'lettuce'], fert: true, rec: false, meals: LD }),
  f('hamburger', 'Hamburger', '1 burger', { fo: 60, fe: 3.5, ch: 80, ca: 100, pr: 25, b12: 2.4, fi: 1.5 }, { aka: ['burger', 'cheeseburger'], tags: ['meat', 'gluten', 'wheat'], ing: ['beef', 'bread'], rec: false, meals: LD }),
  f('mac_cheese', 'Mac and cheese', '1 cup', { fo: 100, fe: 1.5, io: 30, ch: 20, ca: 250, pr: 13, b12: 0.6, fi: 1.5, ret: 90 }, { aka: ['macaroni and cheese'], tags: ['dairy', 'gluten', 'wheat'], ing: ['pasta', 'cheese', 'milk'], rec: false, meals: LD }),
  f('chicken_stirfry', 'Chicken stir-fry with rice', '1 plate', { fo: 150, fe: 2.5, ch: 80, ca: 60, pr: 30, b12: 0.3, fi: 4 }, { aka: ['stir fry', 'stir-fry', 'teriyaki chicken'], tags: ['poultry', 'soy'], ing: ['chicken', 'rice', 'soy sauce', 'broccoli', 'bell pepper'], rec: false, meals: LD }),
  f('veggie_omelet', 'Veggie omelet (2 eggs)', '1 omelet', { fo: 75, fe: 2.4, io: 60, ch: 300, dha: 58, ca: 220, d: 88, pr: 20, b12: 1.2, fi: 1, ret: 260 }, { aka: ['omelet', 'omelette', 'frittata'], tags: ['egg', 'dairy'], ing: ['egg', 'spinach', 'cheese'], rec: false, meals: B }),
  f('avocado_toast', 'Avocado toast', '1 slice', { fo: 95, fe: 1.4, ch: 22, ca: 62, pr: 6, fi: 8.7 }, { tags: ['gluten', 'wheat'], ing: ['avocado', 'bread'], fert: true, rec: false, meals: B }),
  f('smoothie', 'Fruit & yogurt smoothie', '16 oz', { fo: 50, io: 100, ch: 60, ca: 380, d: 60, pr: 20, b12: 2, fi: 6, w: 0.3 }, { tags: ['dairy'], ing: ['banana', 'berry', 'yogurt', 'milk'], rec: false, meals: BS }),
  f('fries', 'French fries', 'medium serving', { fe: 0.8, pr: 4, fi: 4 }, { aka: ['fries', 'chips'], ing: ['potato'], flags: ['trans_fat'], rec: false, meals: LD }),
  f('donut', 'Donut', '1 donut', { fo: 40, fe: 1, pr: 3, fi: 1 }, { aka: ['doughnut', 'pastry', 'muffin', 'cookie'], tags: ['gluten', 'wheat'], ing: ['wheat'], flags: ['trans_fat', 'sugary'], rec: false, meals: BS }),

  // Supplements (the profile's prenatal vitamin is handled separately)
  f('dha_supplement', 'Algae DHA supplement', 'softgel', { dha: 200 }, { aka: ['dha', 'omega 3 supplement', 'algae oil'], ing: ['algae'], rec: false }),
  f('vitamin_d_supplement', 'Vitamin D3 supplement', '1,000 IU softgel', { d: 1000 }, { aka: ['vitamin d', 'd3'], rec: false }),
];

export const FOOD_BY_ID = Object.fromEntries(FOODS.map((x) => [x.id, x]));

/**
 * Build a food from a web lookup (server /api/food-search). Its unit is the looked-up portion,
 * so quantity 1 = that portion. Web foods are never recommended, only logged and searched.
 */
export function webFood(result, query, id) {
  return {
    id, name: result.name, unit: result.portion, nutrients: Object.fromEntries(Object.entries(result.nutrients).filter(([, v]) => v > 0)),
    aka: query && query.toLowerCase() !== result.name.toLowerCase() ? [query] : [], tags: [], ingredients: [],
    flags: result.flags, fertility: false, fishServing: false, recommend: false,
    meals: ['breakfast', 'lunch', 'dinner', 'snack'], defaultQty: 1,
    web: { estimated: result.estimated, basis: result.basis, sources: result.sources },
  };
}

/** Add web-found foods to the in-memory database so search, logging and editing treat them like any other. */
export function registerFood(food) {
  if (FOOD_BY_ID[food.id]) return;
  FOODS.push(food);
  FOOD_BY_ID[food.id] = food;
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Simple ranked search over names and aliases. */
export function searchFoods(query, limit = 8) {
  const q = norm(query);
  if (!q) return [];
  const qWords = q.split(' ').map((w) => w.replace(/s$/, ''));
  const scored = FOODS.map((food) => {
    const names = [food.name, ...food.aka].map(norm);
    let score = 0;
    for (const n of names) {
      if (n === q) score = Math.max(score, 100);
      else if (n.startsWith(q)) score = Math.max(score, 80);
      else if (n.includes(q)) score = Math.max(score, 60);
      else {
        const hits = qWords.filter((w) => w.length > 2 && n.includes(w)).length;
        if (hits) score = Math.max(score, 20 * hits);
      }
    }
    if (food.recommend) score += 1; // prefer whole foods on ties
    return { food, score };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.food);
}

/** Nutrients for `qty` units, rounded sensibly. */
export function scaleNutrients(nutrients, qty) {
  const out = {};
  for (const [k, v] of Object.entries(nutrients)) out[k] = Math.round(v * qty * 100) / 100;
  return out;
}

// Notes shown at log time (spec §3.2). Facts only: no swaps or suggestions unless she asks.
export const FLAG_TEXT = {
  high_mercury: "High-mercury fish. Mercury builds up in the body over time, so it's one to avoid while preparing for pregnancy.",
  high_retinol: 'Very high in preformed vitamin A, which adds up quickly alongside a prenatal that contains vitamin A.',
  alcohol: null,
  listeria: null,
  raw: null,
  sugary: null,
  trans_fat: null,
};
