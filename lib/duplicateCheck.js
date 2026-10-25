// duplicateCheck.js - Slice 2: is this place already in the directory?
// The directory lives in Supabase. Its REST API is PostgREST:
//   GET {SUPABASE_URL}/rest/v1/restaurants?select=*
//   headers: apikey: <anon key>, Authorization: Bearer <anon key>
// The anon key is a PUBLISHABLE key (it ships in the website/app code,
// e.g. jain-restaurants-mobile/src/config.js) - but we still keep our copy
// in .env and never print it. The secret service_role key is NEVER used here.
//
// parseAddress (from buildListing) reads the place's own address city;
// buildListing requires nothing at top level, so no require cycle here.
const { parseAddress } = require('./buildListing');
//
// Strategy (same as the website): fetch the full list once, compare locally.
// A duplicate = same normalized name AND (same city OR same street address).
// Name-only matching would false-positive on chains in different cities.
//
// PLUS, since incident #2 (2026-10-24): FUZZY name matching. Google and
// the directory often name the same place differently ("Vatans" vs
// "Vatan Indian Vegetarian Cuisine & Bakery"). Exact equality alone
// misses those, so we also compare CORE names: lowercase, punctuation
// out, generic words dropped (indian, vegetarian, cuisine, bakery,
// restaurant...), plurals singularized. If one core is contained in
// the other AND the city matches, it is a FUZZY match - still a stop,
// but the message names the existing listing so a human can judge
// whether it is really the same place. Fuzzy matching NEVER fires on
// street alone (street fragments collide across towns); city is required.
// Over-flagging is the safe direction: a blocked legit add is
// recoverable, a second listing for the same restaurant corrupts the
// directory. A future improvement could ask "is this the same place?"
// instead of stopping; for now the stop + named match is the safe call.
// Sam's ruling (2026-10-25): NO prefix/substring matching - users are
// expected to type the restaurant name correctly (only 3 fields to
// fill); matching stays whole-token containment. Declined: rustic ->
// rustico must NOT match.

const GENERIC_WORDS = new Set([
  'indian', 'vegetarian', 'vegan', 'cuisine', 'cuisines', 'bakery',
  'restaurant', 'restaurants', 'cafe', 'kitchen', 'foods', 'food',
  'dining', 'grill', 'house', 'eatery', 'bistro', 'place', 'veg',
  'pure', 'south', 'north', 'fast', 'express', 'the', 'and',
]);

function coreTokens(text) {
  return normalize(text).split(' ')
    .filter(t => t.length > 1) // drops possessive fragments like "'s" -> "s"
    .map(t => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t)) // vatans -> vatan
    .filter(t => !GENERIC_WORDS.has(t));
}

// Returns 'exact' | 'fuzzy' | null. Pure function - unit-tested in
// run-tests.js without touching Supabase. Inputs are normalized here,
// so callers may pass raw display names.
function namesMatch(wantedRaw, rowRaw) {
  const wantedName = normalize(wantedRaw);
  const rowName = normalize(rowRaw);
  if (!wantedName || !rowName) return null;
  if (rowName === wantedName) return 'exact';
  const w = coreTokens(wantedName);
  const r = coreTokens(rowName);
  if (w.length === 0 || r.length === 0) return null; // all-generic name: exact only
  const wSet = new Set(w);
  const rSet = new Set(r);
  if (w.every(t => rSet.has(t)) || r.every(t => wSet.has(t))) return 'fuzzy';
  return null;
}

// Override rule (2026-10-25): an EXACT match is always a stop - same
// name + same city is the same place, no argument. A FUZZY (possible)
// match stops UNLESS the user confirmed this is a different restaurant
// (allowFuzzy): fuzzy matching can be wrong, and a genuinely different
// restaurant must still be addable. The preview is the last check -
// it shows the real place name and address before any submit.
function shouldStopOnDuplicate(matches, allowFuzzy) {
  if (!matches || matches.length === 0) return false;
  if (matches.some(m => m._match === 'exact')) return true;
  return !allowFuzzy;
}

// What the dialog shows for a duplicate stop: the MATCHED directory
// row(s) - never the just-picked place. Showing the picked place
// under "Already listed" mislabels the candidate as listed, when the
// listed one is a different (similar) restaurant.
function summarizeMatches(matches) {
  return (matches || []).map(function (m) {
    return {
      name: m.name || m.restaurant_name || m.title || '',
      address: m.address || m.formatted_address || m.full_address || '',
      city: m.city || '',
    };
  });
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')  // punctuation out (handles curly apostrophes etc.)
    .replace(/\s+/g, ' ')
    .trim();
}

function streetPart(address) {
  // "15 W 27th St, New York, NY 10001, USA" -> "15 w 27th st"
  return normalize(String(address || '').split(',')[0]);
}

async function fetchAllRestaurants(supabaseUrl, anonKey) {
  const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/restaurants?select=*`;
  const response = await fetch(url, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase error ${response.status}: ${errorText.slice(0, 400)}`);
  }
  return response.json();
}

async function checkDuplicate(place, city, supabaseUrl, anonKey) {
  const rows = await fetchAllRestaurants(supabaseUrl, anonKey);

  const wantedName = normalize(place.displayName && place.displayName.text);
  const wantedStreet = streetPart(place.formattedAddress);
  const wantedCity = normalize(city);
  // The place's OWN city (from its address) is ground truth; the typed
  // city may be wrong (incident #3: Vatan searched in Robbinsville,
  // actually in East Windsor). Gate on either city, so a wrong typed
  // city cannot hide a duplicate. This does NOT weaken the chain
  // protection: the gate is still about the place's actual city, so
  // a same-name outlet in a different city still passes through.
  const placeCity = normalize(parseAddress(place.formattedAddress).city) || wantedCity;

  const matches = [];
  for (const row of rows) {
    const rowName = normalize(row.name || row.restaurant_name || row.title);
    const kind = namesMatch(wantedName, rowName);
    if (!kind) continue;
    const rowCity = normalize(row.city);
    const rowStreet = streetPart(row.address || row.formatted_address || row.full_address);
    const sameCity = Boolean(rowCity && (rowCity === wantedCity || rowCity === placeCity));
    const sameStreet = Boolean(rowStreet && rowStreet === wantedStreet);
    if (kind === 'exact' && (sameCity || sameStreet)) matches.push({ ...row, _match: 'exact' });
    else if (kind === 'fuzzy' && sameCity) matches.push({ ...row, _match: 'fuzzy' });
  }

  const fuzzyOnly = matches.length > 0 && matches.every(m => m._match === 'fuzzy');
  return { totalInDirectory: rows.length, matches, fuzzyOnly };
}

module.exports = { checkDuplicate, fetchAllRestaurants, namesMatch, shouldStopOnDuplicate, summarizeMatches };
