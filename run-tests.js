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

console.log('Fuzzy-duplicate override (2026-10-25):');
const { shouldStopOnDuplicate, summarizeMatches } = require('./lib/duplicateCheck');
check('exact match always stops, even with override', () => {
  assert.strictEqual(shouldStopOnDuplicate([{ _match: 'exact' }], true), true);
});
check('exact match stops without override', () => {
  assert.strictEqual(shouldStopOnDuplicate([{ _match: 'exact' }], false), true);
});
check('fuzzy match stops without override', () => {
  assert.strictEqual(shouldStopOnDuplicate([{ _match: 'fuzzy' }], false), true);
});
check('fuzzy match proceeds with override', () => {
  assert.strictEqual(shouldStopOnDuplicate([{ _match: 'fuzzy' }], true), false);
});
check('no matches never stops', () => {
  assert.strictEqual(shouldStopOnDuplicate([], true), false);
});

console.log('Duplicate match summary (2026-10-25):');
check('summarizeMatches maps name/address/city', () => {
  const out = summarizeMatches([{ name: 'Vatan Indian Vegetarian Cuisine & Bakery', address: '761 NJ-33, East Windsor, NJ 08520, USA', city: 'East Windsor' }]);
  assert.deepStrictEqual(out, [{ name: 'Vatan Indian Vegetarian Cuisine & Bakery', address: '761 NJ-33, East Windsor, NJ 08520, USA', city: 'East Windsor' }]);
});
check('summarizeMatches falls back to alternate field names', () => {
  const out = summarizeMatches([{ restaurant_name: 'Rustico Goregaon', formatted_address: 'Top Floor, Chandiwala Arcade, Link Rd', city: '' }]);
  assert.strictEqual(out[0].name, 'Rustico Goregaon');
  assert.strictEqual(out[0].address, 'Top Floor, Chandiwala Arcade, Link Rd');
  assert.strictEqual(out[0].city, '');
});

console.log('International addresses (2026-10-25, T\'s Tantan Tokyo):');
const { buildListing, deriveLocation } = require('./lib/buildListing');
const { rowMatches } = require('./lib/duplicateCheck');
function comp(type, longText, shortText) {
  return { types: [type], longText, shortText: shortText || longText };
}
const tantanPlace = {
  displayName: { text: "T's Tantan" },
  formattedAddress: 'Japan, 〒100-0005 Tokyo, Chiyoda City, Marunouchi, 1-chōme−9−１ Gransta Tokyo B1F スクエアゼロエリア改札外',
  location: { latitude: 35.682428, longitude: 139.76828 },
  internationalPhoneNumber: '+81 3-3218-8040',
  websiteUri: 'https://shop.jr-cross.co.jp/eki/spot/detail?code=f15521',
  googleMapsUri: 'https://maps.google.com/?cid=1',
  addressComponents: [
    comp('country', 'Japan', 'JP'),
    comp('administrative_area_level_1', 'Tokyo'),
    comp('locality', 'Chiyoda City'),
    comp('postal_code', '100-0005'),
  ],
};
check('Japan components derive city/state/country (no postal code in city)', () => {
  assert.deepStrictEqual(deriveLocation(tantanPlace), { isUS: false, city: 'Chiyoda City', state: 'Tokyo', country: 'Japan' });
});
check('Japan listing: Japan/Tokyo/Chiyoda City, address kept as returned', () => {
  const l = buildListing({ place: tantanPlace, city: 'Tokyo', dishChoice: { dishesText: 'Full Jain Menu available' }, classification: { dietaryType: 'vegan' }, notes: '', photoUrl: '' });
  assert.strictEqual(l.country, 'Japan');
  assert.strictEqual(l.state, 'Tokyo');
  assert.strictEqual(l.city, 'Chiyoda City');
  assert.strictEqual(l.address, tantanPlace.formattedAddress);
  assert.strictEqual(l.near_city, 'Tokyo');
});
const usPlace = {
  displayName: { text: 'Forno Rosso' },
  formattedAddress: '1048 W Randolph St, Chicago, IL 60607, USA',
  location: { latitude: 41.8847, longitude: -87.6477 },
  internationalPhoneNumber: '+1 312-243-6000',
  websiteUri: 'https://example.com/',
  googleMapsUri: 'https://maps.google.com/?cid=2',
};
check('US place without components: legacy parse, country USA (unchanged)', () => {
  const l = buildListing({ place: usPlace, city: 'Chicago', dishChoice: { dishesText: 'Jain Pizza' }, classification: { dietaryType: 'both' }, notes: '', photoUrl: '' });
  assert.strictEqual(l.country, 'USA');
  assert.strictEqual(l.city, 'Chicago');
  assert.strictEqual(l.state, 'Illinois');
});
check('US place WITH components: still legacy parse, country USA', () => {
  const p = { ...usPlace, addressComponents: [comp('country', 'United States', 'US'), comp('administrative_area_level_1', 'Illinois'), comp('locality', 'Chicago')] };
  assert.deepStrictEqual(deriveLocation(p), { isUS: true });
  const l = buildListing({ place: p, city: 'Chicago', dishChoice: { dishesText: 'Jain Pizza' }, classification: { dietaryType: 'both' }, notes: '', photoUrl: '' });
  assert.strictEqual(l.country, 'USA');
  assert.strictEqual(l.city, 'Chicago');
  assert.strictEqual(l.state, 'Illinois');
});
check('city-state: state kept even when it duplicates city/country (Singapore, site searches by state)', () => {
  const p = { addressComponents: [comp('country', 'Singapore', 'SG'), comp('administrative_area_level_1', 'Singapore'), comp('locality', 'Singapore')] };
  assert.deepStrictEqual(deriveLocation(p), { isUS: false, city: 'Singapore', state: 'Singapore', country: 'Singapore' });
});
check('missing admin level 1: state empty, city kept (Monaco)', () => {
  const p = { addressComponents: [comp('country', 'Monaco', 'MC'), comp('locality', 'Monaco')] };
  assert.deepStrictEqual(deriveLocation(p), { isUS: false, city: 'Monaco', state: '', country: 'Monaco' });
});
check('city fallback: no locality -> sublocality used', () => {
  const p = { addressComponents: [comp('country', 'Japan', 'JP'), comp('administrative_area_level_1', 'Tokyo'), comp('sublocality_level_1', 'Shibuya')] };
  const loc = deriveLocation(p);
  assert.strictEqual(loc.city, 'Shibuya');
  assert.strictEqual(loc.state, 'Tokyo');
});
check('no components at all: deriveLocation returns null (legacy path)', () => {
  assert.strictEqual(deriveLocation({ formattedAddress: 'x' }), null);
});
check('components without country: country empty so Evaluate blocks submit', () => {
  const p = { addressComponents: [comp('locality', 'Nowhere')] };
  assert.strictEqual(deriveLocation(p).country, '');
});
check('T\'s Tantan replay: Chiyoda row + Tokyo search + Chiyoda City place = exact duplicate', () => {
  const row = { name: "T's Tantan", city: 'Chiyoda', state: 'Tokyo', address: 'Yaesu Central Gate' };
  assert.strictEqual(rowMatches(row, { wantedName: "T's Tantan", wantedCity: 'Tokyo', wantedStreet: tantanPlace.formattedAddress, placeCity: 'Chiyoda City', placeState: 'Tokyo', useMetro: true }), 'exact');
});
check('metro gate: same state alone never matches (Pune vs Mumbai)', () => {
  const row = { name: 'Same Name', city: 'Pune', state: 'Maharashtra', address: '1 MG Rd' };
  assert.strictEqual(rowMatches(row, { wantedName: 'Same Name', wantedCity: 'Mumbai', wantedStreet: '2 Main St', placeCity: 'Mumbai', placeState: 'Maharashtra', useMetro: true }), null);
});
check('accent-insensitive city: typed Sao Paulo matches stored São Paulo', () => {
  const row = { name: 'Veg Place', city: 'São Paulo', state: 'São Paulo', address: 'Av Paulista' };
  assert.strictEqual(rowMatches(row, { wantedName: 'Veg Place', wantedCity: 'Sao Paulo', wantedStreet: 'Av Paulista', placeCity: 'São Paulo', placeState: 'São Paulo', useMetro: true }), 'exact');
});
check('US gate unchanged: wrong typed city still finds place-city match (Vatan/Robbinsville)', () => {
  const row = { name: 'Vatan Indian Vegetarian Cuisine & Bakery', city: 'East Windsor', state: 'New Jersey', address: '761 NJ-33' };
  assert.strictEqual(rowMatches(row, { wantedName: 'Vatans', wantedCity: 'Robbinsville', wantedStreet: '761 NJ-33, East Windsor', placeCity: 'East Windsor', placeState: '', useMetro: false }), 'fuzzy');
});

console.log('Photo prefill (2026-10-25): the LLM reads a signboard/menu photo');
const { parsePhotoReply } = require('./lib/photoRead');
check('full reply parses: name, city, dishes', () => {
  const r = parsePhotoReply('{"name": "Mallow", "city": "London", "dishes": ["Coconut Pasanda", "Shan Tofu"]}');
  assert.strictEqual(r.name, 'Mallow');
  assert.strictEqual(r.city, 'London');
  assert.deepStrictEqual(r.dishes, ['Coconut Pasanda', 'Shan Tofu']);
});
check('signboard photo: dishes empty, name kept, city null', () => {
  const r = parsePhotoReply('{"name": "Rustico", "city": null, "dishes": []}');
  assert.strictEqual(r.name, 'Rustico');
  assert.strictEqual(r.city, null);
  assert.deepStrictEqual(r.dishes, []);
});
check('non-JSON reply -> all empty (never invent)', () => {
  const r = parsePhotoReply('I can see a restaurant front.');
  assert.strictEqual(r.name, null);
  assert.strictEqual(r.city, null);
  assert.deepStrictEqual(r.dishes, []);
});
check('dishes capped at 10, blank and non-string entries dropped', () => {
  const r = parsePhotoReply('{"name": "X", "city": "Y", "dishes": ["a", " ", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", 42]}');
  assert.deepStrictEqual(r.dishes, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
});
check('Crepe Bistro replay (2026-10-27): all 7 ordered items survive the cap', () => {
  const r = parsePhotoReply('{"name": "Crepe Bistro", "city": "Santa Clara", "dishes": ["Jain Crepe", "Oregano Zaatar Crepe", "Tofu Scramble", "Biscoff Crunch Crepe", "Mint Lemonade", "Dubai Strawberry Cup", "Nutella Coffee"]}');
  assert.strictEqual(r.name, 'Crepe Bistro');
  assert.strictEqual(r.city, 'Santa Clara');
  assert.deepStrictEqual(r.dishes, ['Jain Crepe', 'Oregano Zaatar Crepe', 'Tofu Scramble', 'Biscoff Crunch Crepe', 'Mint Lemonade', 'Dubai Strawberry Cup', 'Nutella Coffee']);
});
check('non-string name/city and non-array dishes -> all empty', () => {
  const r = parsePhotoReply('{"name": 123, "city": ["London"], "dishes": "soup"}');
  assert.strictEqual(r.name, null);
  assert.strictEqual(r.city, null);
  assert.deepStrictEqual(r.dishes, []);
});

console.log('Photo list picker (2026-10-25): one photo, several restaurants');
check('list reply parses: every restaurant with dishes + Jain note', () => {
  const r = parsePhotoReply('{"name": null, "city": "London", "dishes": [], "restaurants": [{"name": "Tofu Vegan", "dishes": [], "notes": "Jain food upon walk-in"}, {"name": "Mallow", "dishes": [], "notes": ""}]}');
  assert.strictEqual(r.restaurants.length, 2);
  assert.strictEqual(r.restaurants[0].name, 'Tofu Vegan');
  assert.strictEqual(r.restaurants[0].notes, 'Jain food upon walk-in');
  assert.strictEqual(r.restaurants[1].name, 'Mallow');
  assert.strictEqual(r.restaurants[1].notes, '');
});
check('single reply -> restaurants empty', () => {
  const r = parsePhotoReply('{"name": "Mallow", "city": "London", "dishes": ["Coconut Pasanda"]}');
  assert.deepStrictEqual(r.restaurants, []);
});
check('nameless list entries dropped, non-array restaurants -> empty', () => {
  const r = parsePhotoReply('{"name": null, "city": null, "dishes": [], "restaurants": [{"dishes": []}, {"name": "  "}, {"name": "Kin Restaurant", "dishes": [], "notes": ""}]}');
  assert.strictEqual(r.restaurants.length, 1);
  assert.strictEqual(r.restaurants[0].name, 'Kin Restaurant');
  assert.deepStrictEqual(parsePhotoReply('{"name": null, "city": null, "dishes": [], "restaurants": "nope"}').restaurants, []);
});
check('per-entry dishes capped at 10, notes trimmed and capped', () => {
  const long = 'x'.repeat(250);
  const r = parsePhotoReply('{"name": null, "city": null, "dishes": [], "restaurants": [{"name": "X", "dishes": ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"], "notes": "  Jain upon walk-in  "}, {"name": "Y", "dishes": [], "notes": "' + long + '"}]}');
  assert.deepStrictEqual(r.restaurants[0].dishes, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
  assert.strictEqual(r.restaurants[0].notes, 'Jain upon walk-in');
  assert.strictEqual(r.restaurants[1].notes.length, 200);
});

console.log(`\n${passed} passed, ${failed} failed.`);
