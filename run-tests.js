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

console.log('Chain notes (Sam, simplified 2026-10-23): one-line signal, never addresses');
const { buildChainNotes } = require('./lib/chainNotes');
check('no other locations -> no chain note', () => assert.strictEqual(buildChainNotes('Chicago', [], 'https://x.com'), ''));
check('1 other -> singular one-liner, NO address', () => {
  const note = buildChainNotes('Chicago', [{ formattedAddress: '3719 N Harlem Ave, Chicago, IL 60634, USA' }], 'https://x.com');
  assert.strictEqual(note, 'Multiple locations in Chicago: 1 other location - see website for all locations');
  assert.ok(!note.includes('Harlem'), 'note must not contain other locations addresses');
});
check('5 others -> same one-liner shape with count', () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ formattedAddress: `${i} Main St` }));
  assert.strictEqual(buildChainNotes('New York', five, ''), 'Multiple locations in New York: 5 other locations - see website for all locations');
});

console.log('Evaluate step (2026-10-24): the loop judges its own work');
const { evaluateListing, compareListing } = require('./lib/evaluate');
const REAL_MENU = 'Appetizers: Insalata $12. Pizza Margherita topped with basil, Pasta al pomodoro, Desserts. Prosciutto pizza, salami sandwich.';
const VEG_MENU = 'A fully vegetarian kitchen serving fresh salads, hearty soups, handmade pasta dishes, and a traditional vegetarian thali every day.';
const goodBase = {
  listing: { name: 'Forno Rosso', address: '1048 W Randolph St', country: 'USA', city: 'Chicago', state: 'Illinois', phone: '+13122436000', website: 'https://x.com/', notes: 'Dough is eggless.', liked_items: 'Jain Pizza' },
  classification: { dietaryType: 'both', confidence: 'high', evidence: ['Menu contains: prosciutto, salami -> Mixed (flat rule)'] },
  menu: { status: 'ok', menuUrl: 'https://x.com/menu', menuText: REAL_MENU },
  photo: { status: 'ok' },
  dishChoice: { dishesText: 'Jain Pizza' },
};
check('clean listing passes with no issues', () => {
  const r = evaluateListing(goodBase);
  assert.strictEqual(r.verdict, 'pass');
  assert.deepStrictEqual(r.issues, []);
});
check('Forno bug replay: CSS menu URL fails evaluation', () => {
  const r = evaluateListing({ ...goodBase,
    menu: { status: 'ok', menuUrl: 'https://static.parastorage.com/x/DropDownMenu_Skin.min.css', menuText: '.a{color:red} .menu-button{display:flex}' } });
  assert.strictEqual(r.verdict, 'fail');
  assert.ok(r.issues.some(i => i.code === 'menu-not-a-page'));
});
check('Pure Veg without menu-text evidence fails', () => {
  const r = evaluateListing({ ...goodBase,
    classification: { dietaryType: 'vegetarian', confidence: 'medium', evidence: [] },
    menu: { status: 'ok', menuUrl: 'https://x.com/menu', menuText: 'Pizza, pasta, salads, desserts.' } });
  assert.strictEqual(r.verdict, 'fail');
  assert.ok(r.issues.some(i => i.code === 'pure-veg-no-evidence'));
});
check('Pure Veg WITH menu-text evidence passes (warn only for medium confidence)', () => {
  const r = evaluateListing({ ...goodBase,
    classification: { dietaryType: 'vegetarian', confidence: 'medium', evidence: ['menu says vegetarian'] },
    menu: { status: 'ok', menuUrl: 'https://x.com/menu', menuText: VEG_MENU } });
  assert.strictEqual(r.verdict, 'warn');
  assert.ok(r.issues.every(i => i.severity === 'warn'));
});
check('Mixed without meat evidence fails', () => {
  const r = evaluateListing({ ...goodBase,
    classification: { dietaryType: 'both', confidence: 'high', evidence: ['no meat words found'] } });
  assert.strictEqual(r.verdict, 'fail');
  assert.ok(r.issues.some(i => i.code === 'mixed-no-meat-evidence'));
});
check('missing dishes fails', () => {
  const r = evaluateListing({ ...goodBase, dishChoice: null });
  assert.strictEqual(r.verdict, 'fail');
  assert.ok(r.issues.some(i => i.code === 'no-dishes'));
});
check('UNKNOWN classification fails', () => {
  const r = evaluateListing({ ...goodBase,
    classification: { dietaryType: null, confidence: 'none', evidence: [] },
    menu: { status: 'none', menuUrl: null, menuText: '' } });
  assert.strictEqual(r.verdict, 'fail');
  assert.ok(r.issues.some(i => i.code === 'unknown-classification'));
});
check('hours in notes fails', () => {
  const r = evaluateListing({ ...goodBase,
    listing: { ...goodBase.listing, notes: 'Open 11 AM to 10 PM daily.' } });
  assert.strictEqual(r.verdict, 'fail');
  assert.ok(r.issues.some(i => i.code === 'hours-in-notes'));
});
check('missing photo is a warning, not a failure', () => {
  const r = evaluateListing({ ...goodBase, photo: { status: 'failed' } });
  assert.strictEqual(r.verdict, 'warn');
  assert.ok(r.issues.some(i => i.code === 'no-photo'));
});
check('post-submit comparison: identical row matches', () => {
  const row = { ...goodBase.listing, dietary_type: 'both' };
  assert.deepStrictEqual(compareListing(row, { ...goodBase.listing, dietary_type: 'both' }), []);
});
check('post-submit comparison: wrong dietary_type is a mismatch', () => {
  const row = { ...goodBase.listing, dietary_type: 'vegetarian' };
  const mm = compareListing(row, { ...goodBase.listing, dietary_type: 'both' });
  assert.strictEqual(mm.length, 1);
  assert.strictEqual(mm[0].field, 'dietary_type');
});

console.log('Duplicate check, fuzzy names (incident #2, 2026-10-24):');
const { namesMatch } = require('./lib/duplicateCheck');
check('Vatans vs Vatan Indian Vegetarian Cuisine & Bakery -> fuzzy', () => {
  assert.strictEqual(namesMatch('vatans', 'vatan indian vegetarian cuisine & bakery'), 'fuzzy');
});
check('identical names -> exact', () => {
  assert.strictEqual(namesMatch('forno rosso', 'forno rosso'), 'exact');
});
check('different core names -> no match', () => {
  assert.strictEqual(namesMatch('lou malanati s', 'giordano s'), null);
});
check('core contained in longer name -> fuzzy (Sagar vs Sagar Ratna)', () => {
  assert.strictEqual(namesMatch('sagar', 'sagar ratna'), 'fuzzy');
});
check('all-generic name falls back to exact only', () => {
  assert.strictEqual(namesMatch('vegetarian cuisine', 'vegetarian cuisine bakery'), null);
});

console.log('Search-result filter (incident #3, 2026-10-24):');
const { filterNameMatches } = require('./lib/lookup');
const vatanTop = { displayName: { text: 'Vatan Indian Vegetarian Cuisine & Bakery' } };
const ashram = { displayName: { text: 'Shri Paramhans Advait Mat (Nitya Dham)' } };
const temple = { displayName: { text: 'BAPS Swaminarayan Akshardham' } };
const ganga = { displayName: { text: 'Ganga Indian Restaurant' } };
check('wrong-city Vatan search: unrelated Robbinsville hits dropped, real Vatan kept', () => {
  const kept = filterNameMatches([vatanTop, ashram, temple, ganga], 'Vatan');
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(kept[0], vatanTop);
});
check('genuine multi-location: both same-name outlets kept, unrelated dropped', () => {
  const a = { displayName: { text: 'Beyond Sushi' } };
  const b = { displayName: { text: 'Beyond Sushi' } };
  const kept = filterNameMatches([a, b, ganga], 'Beyond Sushi');
  assert.strictEqual(kept.length, 2);
});
check('typo query: top hit kept even when its name does not match', () => {
  const kept = filterNameMatches([vatanTop, ganga], 'Vatam');
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(kept[0], vatanTop);
});
check('namesMatch normalizes raw inputs (no pre-normalizing needed)', () => {
  assert.strictEqual(namesMatch('Vatans', 'Vatan Indian Vegetarian Cuisine & Bakery'), 'fuzzy');
});

console.log(`\n${passed} passed, ${failed} failed.`);
