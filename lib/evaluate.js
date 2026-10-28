// evaluate.js - the EVALUATE step of the agent loop.
//
// The loop in the diagram Sam shared is: Observe -> Reason -> Act ->
// EVALUATE -> Repeat as needed. Our loop used to be only Observe ->
// Reason -> Act (one straight pass, verified only by "did the insert
// return OK?"). That is how the Forno Rosso misclassification went
// live: nothing ever checked the QUALITY of the decision, only that
// an insert happened. This module is that missing step.
//
// DESIGN RULE: the evaluator must NOT reuse the code it checks.
// menuFetch's own filters decided the CSS file was a menu; if the
// evaluator trusted menuFetch's verdict, it would be blind to the
// same bug. So every check below is written independently, from the
// raw listing/menu/classification values.
//
// Two uses:
//   1. PRE-SUBMIT (evaluateListing): runs after the listing is built,
//      before any submit. verdict 'fail' BLOCKS the submit outright
//      (the agent stops itself and says why) - even when --submit /
//      the dialog's Submit button was pressed. 'warn' lets it proceed
//      but the warnings ride along in the result for the human.
//   2. POST-SUBMIT (compareListing): after the read-back, compares
//      the live row field-by-field against what the agent intended
//      to submit. Existence is not enough - a row with the wrong
//      dietary_type or notes is a mismatch, reported as such.
//
// The evaluator never invents data and never changes the listing.
// It only judges. Fixing stays with the human (or, for the ambiguous
// zone, with lib/llmJudge.js) - see README-loop-update.md.

const BAD_MENU_EXT = /\.(css|js|mjs|png|jpe?g|gif|svg|ico|woff2?|ttf|map|xml)(\?|$)/i;
const FOOD_WORDS = [
  'pizza', 'pasta', 'salad', 'appetizer', 'entree', 'dessert', 'sandwich',
  'soup', 'burger', 'taco', 'curry', 'thali', 'dosa', 'paneer', 'noodle',
  'rice', 'breakfast', 'lunch', 'dinner', 'wrap', 'platter', 'starter',
];
// Times like "11 AM", "9:30 PM" in notes = opening hours, which RULES.md forbids.
const HOURS_PATTERN = /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i;
const VEGETARIAN_SIGNAL = /vegetarian|pure veg|veg only/i;

function foodHits(text) {
  const t = String(text || '').toLowerCase();
  return FOOD_WORDS.filter(w => t.includes(w)).length;
}

function evaluateListing({ listing, classification, menu, photo, dishChoice }) {
  const issues = [];
  const fail = (code, message) => issues.push({ severity: 'fail', code, message });
  const warn = (code, message) => issues.push({ severity: 'warn', code, message });
  const L = listing || {};
  const C = classification || {};
  const M = menu || {};

  // --- Hard stops: the listing must not go live like this ---
  if (!dishChoice || !dishChoice.dishesText) {
    fail('no-dishes', 'Dishes are REQUIRED and missing.');
  }
  if (!L.name) fail('no-name', 'Listing has no name.');
  if (!L.address) fail('no-address', 'Listing has no address.');
  if (!L.country) fail('no-country', 'Listing has no country.');
  if (!C.dietaryType) {
    fail('unknown-classification', 'Classification is UNKNOWN - no evidence settled it.');
  }
  if (C.dietaryType === 'vegetarian' && !VEGETARIAN_SIGNAL.test(M.menuText || '')) {
    fail('pure-veg-no-evidence',
      'Pure Veg claimed, but the menu text itself contains no vegetarian signal. ' +
      'The strongest claim needs the strongest evidence.');
  }
  // Mixed needs a recorded basis: meat evidence from the menu, OR the
  // explicit default (no menu text could be read - rule set 2026-10-28,
  // incident #10). The evaluator reads the basis from the
  // classification evidence; it does not re-run the classifier.
  const evidenceText = (C.evidence || []).join(' ');
  const hasMeatEvidence = /contains:/i.test(evidenceText);
  const isDefaultedMixed = /defaulted to mixed/i.test(evidenceText);
  if (C.dietaryType === 'both' && !hasMeatEvidence && !isDefaultedMixed) {
    fail('mixed-no-meat-evidence',
      'Mixed claimed, but no meat evidence was recorded from the menu.');
  }
  if (M.status === 'ok') {
    if (M.menuUrl && (BAD_MENU_EXT.test(M.menuUrl) || /dropdownmenu/i.test(M.menuUrl))) {
      fail('menu-not-a-page',
        'The "menu" URL is not a real page (stylesheet/script/image). ' +
        'This is exactly the Forno Rosso bug - refuse it.');
    }
    if ((M.menuText || '').length < 100 || foodHits(M.menuText) < 2) {
      fail('menu-not-a-menu',
        'The fetched "menu" text does not look like a menu (too short or no food words).');
    }
  }
  if (L.notes && HOURS_PATTERN.test(L.notes)) {
    fail('hours-in-notes', 'Notes appear to contain opening hours, which RULES.md forbids.');
  }

  // --- Warnings: proceed, but the human should see these ---
  if (!photo || photo.status !== 'ok') {
    warn('no-photo', 'No photo was downloaded - the listing will go live without one.');
  }
  if (C.confidence === 'medium') {
    warn('medium-confidence', 'Classification confidence is only medium - preview carefully.');
  }
  if (C.confidence === 'low') {
    warn('defaulted-mixed', 'Classification defaulted to Mixed - no menu text could be read; preview carefully.');
  }
  if (!L.phone && !L.website) {
    warn('no-contact', 'Neither phone nor website came from Google - the listing is thin.');
  }

  const verdict = issues.some(i => i.severity === 'fail')
    ? 'fail'
    : (issues.length > 0 ? 'warn' : 'pass');
  return { verdict, issues };
}

// Post-submit: compare the live row against the intended listing.
// Only fields the agent itself set are compared (server defaults like
// created_at are ignored). Returns an array of { field, expected, got }.
const COMPARED_FIELDS = [
  'name', 'address', 'city', 'state', 'country', 'near_city',
  'phone', 'website', 'dietary_type', 'liked_items', 'notes',
  'latitude', 'longitude', 'photo_url',
];

// Coordinates: Google and Supabase round the same float differently
// (e.g. -121.93841019999999 vs -121.9384102), so latitude/longitude
// are compared numerically with a 1e-6 degree tolerance (~11 cm).
// A genuinely different pin still mismatches. (Sam, 2026-10-27:
// approximate map locations are fine.)
const COORD_TOLERANCE = 1e-6;

function compareListing(verifiedRow, intended) {
  const mismatches = [];
  if (!verifiedRow) return [{ field: '(row)', expected: 'a live row', got: 'none found' }];
  for (const field of COMPARED_FIELDS) {
    const expected = intended[field];
    if (expected === undefined || expected === null || expected === '') continue;
    const got = verifiedRow[field];
    if (field === 'latitude' || field === 'longitude') {
      const e = Number(expected);
      const g = Number(got);
      if (Number.isFinite(e) && Number.isFinite(g)) {
        if (Math.abs(g - e) > COORD_TOLERANCE) {
          mismatches.push({ field, expected, got: got ?? null });
        }
        continue;
      }
    }
    if (String(got ?? '') !== String(expected)) {
      mismatches.push({ field, expected, got: got ?? null });
    }
  }
  return mismatches;
}

module.exports = { evaluateListing, compareListing };
