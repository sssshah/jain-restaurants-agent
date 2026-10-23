// run-tests.js - regression tests: every past incident becomes a test
// that must pass forever. Run:  node run-tests.js
// No framework, no network, $0. If a test fails, the fix that created
// it has been undone somewhere - do not submit restaurants until green.

const assert = require('node:assert');
const { isMenuPath, looksLikeMenu } = require('./lib/menuFetch');
const { classify } = require('./lib/classify');

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); passed++; console.log(`  PASS  ${label}`); }
  catch (err) { failed++; console.log(`  FAIL  ${label}\n        ${err.message}`); process.exitCode = 1; }
}

console.log('Incident 2026-10-23: Forno Rosso - a Wix CSS file was read as the menu');
const CSS_URL = 'https://static.parastorage.com/services/editor-elements/1.14125.0/dist/thunderbolt/rb_werbolt[DropDownMenu_OverlineMenuButtonSkin].308fb8f3.min.css';
check('stylesheet URL is NOT a menu page', () => assert.strictEqual(isMenuPath(CSS_URL), false));
check('CSS/code text does NOT look like a menu', () => assert.strictEqual(looksLikeMenu('.a{color:red} .menu-button{display:flex} @media(max-width:100px){.x{margin:0}}'), false));
check('/menu page IS a menu candidate', () => assert.strictEqual(isMenuPath('https://example.com/menu'), true));
check('/menus/lunch.html IS a menu candidate', () => assert.strictEqual(isMenuPath('https://example.com/menus/lunch.html'), true));
check('real menu text looks like a menu', () => assert.strictEqual(looksLikeMenu('Appetizers: Insalata $12. Pizza Margherita topped with basil, Pasta al pomodoro, Desserts'), true));

console.log('Classification rules (Sam):');
check('no menu text at all -> never Pure Veg from a code/CSS fetch', () => {
  const r = classify({ name: 'Forno Rosso Pizzeria Napoletana', primaryType: 'Pizza Restaurant', types: ['pizza_restaurant'], menuText: '' });
  assert.notStrictEqual(r.dietaryType, 'vegetarian');
});
check('Italian cured meats on a menu -> Mixed (both)', () => {
  const r = classify({ name: 'Forno Rosso', primaryType: 'Pizza Restaurant', types: [], menuText: 'Pizza with prosciutto crudo and salami, margherita pizza, salad' });
  assert.strictEqual(r.dietaryType, 'both');
});
check('pepperoni on a menu -> Mixed (both)', () => {
  const r = classify({ name: 'Slice House', primaryType: 'Pizza Restaurant', types: [], menuText: 'Pepperoni pizza, cheese pizza, garden salad' });
  assert.strictEqual(r.dietaryType, 'both');
});
check('menu text itself says vegetarian, no meat -> Pure Veg proposal', () => {
  const r = classify({ name: 'Green Leaf', primaryType: 'Restaurant', types: [], menuText: 'A fully vegetarian kitchen. Salads, soups, pasta dishes.' });
  assert.strictEqual(r.dietaryType, 'vegetarian');
});
check('vegan in the name -> Vegan', () => {
  const r = classify({ name: 'Vegan Bowl', primaryType: 'Restaurant', types: [], menuText: '' });
  assert.strictEqual(r.dietaryType, 'vegan');
});
check('no menu, no signals -> UNKNOWN (human decides)', () => {
  const r = classify({ name: 'Mystery Place', primaryType: 'Restaurant', types: [], menuText: '' });
  assert.strictEqual(r.dietaryType, null);
  assert.strictEqual(r.needsHuman, true);
});

console.log(`\n${passed} passed, ${failed} failed.`);
