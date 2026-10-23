// runAgent.js - the agent's brain as a reusable function.
//
// The CLI (index.js) and the local web page (server.js) are two FACES;
// this is the one BRAIN both call. runAgent({ name, city, dishesInput,
// notes, pick, submit }, log) -> result object:
//   { outcome, message?, places?, listing?, classification?, photo?, logs }
// Outcomes: 'preview' | 'submitted' | 'multiple' | 'duplicate' |
//   'not-found' | 'closed' | 'lookup-failed' | 'quota' | 'blocked'
// `log` receives human-readable lines (CLI prints them; the web server
// collects them into the JSON response for the page to show).
// Environment (keys) must be loaded by the caller via lib/loadEnv.js.

const { lookupPlace } = require('./lookup');
const { normalizeDishes } = require('./dishes');
const messages = require('./messages');
const { checkDuplicate } = require('./duplicateCheck');
const { classify, DIETARY_LABELS } = require('./classify');
const { fetchMenu } = require('./menuFetch');
const { buildListing } = require('./buildListing');
const { fetchPhoto } = require('./photo');
const { uploadPhoto, insertRestaurant, verifyRestaurant } = require('./submit');
const { buildChainNotes } = require('./chainNotes');
const { logRun } = require('./runLog');

function placeSummary(p) {
  return {
    name: p.displayName && p.displayName.text,
    address: p.formattedAddress || '',
    phone: p.nationalPhoneNumber || '',
    rating: p.rating || null,
    reviews: p.userRatingCount || 0,
    status: p.businessStatus || '',
    type: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || '',
  };
}

async function runAgent(input, log) {
  const say = typeof log === 'function' ? log : () => {};
  const name = String(input.name || '').trim();
  const city = String(input.city || '').trim();
  const extraNotes = String(input.notes || '').trim();
  const dishChoice = normalizeDishes(input.dishesInput);
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const result = { outcome: 'blocked', logs: [] };
  const emit = (line) => { result.logs.push(line); say(line); };

  if (!name || !city) { result.message = 'Name and city are required.'; return result; }
  if (!apiKey) { result.message = 'Google Places key missing (.env).'; return result; }

  // 1. Lookup
  let places;
  try {
    places = await lookupPlace(name, city, apiKey);
  } catch (err) {
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(err.message)) {
      result.outcome = 'quota'; result.message = messages.quotaReached();
    } else {
      result.outcome = 'lookup-failed'; result.message = messages.lookupFailed(name, city);
    }
    result.detail = err.message;
    return result;
  }
  if (!places || places.length === 0) {
    result.outcome = 'not-found'; result.message = messages.notFound(name, city);
    return result;
  }

  // 2. Permanently closed (single match)
  if (places.length === 1 && places[0].businessStatus === 'CLOSED_PERMANENTLY') {
    result.outcome = 'closed'; result.message = messages.permanentlyClosed(name, city);
    result.places = places.map(placeSummary);
    return result;
  }

  // 3. Multiple matches - human picks (the agent never guesses)
  let otherPlaces = [];
  if (places.length > 1) {
    const pick = parseInt(input.pick, 10);
    if (!pick || pick < 1 || pick > places.length) {
      result.outcome = 'multiple'; result.message = messages.multipleLocations(name, city);
      result.places = places.map(placeSummary);
      return result;
    }
    otherPlaces = places.filter((_, i) => i !== pick - 1);
    places = [places[pick - 1]];
    emit(`Picked location #${pick}: ${places[0].formattedAddress}`);
  }
  const place = places[0];
  result.places = places.map(placeSummary);

  // 4. Duplicate check
  if (supabaseUrl && supabaseKey) {
    try {
      const dup = await checkDuplicate(place, city, supabaseUrl, supabaseKey);
      emit(`Duplicate check: searched ${dup.totalInDirectory} listings.`);
      if (dup.matches.length > 0) {
        result.outcome = 'duplicate'; result.message = messages.duplicate(name, city);
        return result;
      }
      emit('Duplicate check: CLEAR.');
    } catch (err) {
      emit(`Duplicate check failed (${err.message}) - continuing with care.`);
    }
  }

  // 5. Menu fetch + classification
  const menu = await fetchMenu(place.websiteUri);
  emit(`Menu: ${menu.status} - ${menu.note}`);
  const proposal = classify({
    name: place.displayName && place.displayName.text,
    primaryType: place.primaryTypeDisplayName && place.primaryTypeDisplayName.text,
    types: place.types,
    menuText: menu.menuText || '',
  });
  result.classification = {
    code: proposal.dietaryType,
    label: proposal.dietaryType ? (DIETARY_LABELS[proposal.dietaryType] || proposal.dietaryType) : null,
    confidence: proposal.confidence,
    evidence: proposal.evidence,
    jainInMenu: proposal.jainInMenu,
  };
  emit(proposal.dietaryType
    ? `Classification: ${result.classification.label} (confidence: ${proposal.confidence})`
    : 'Classification: UNKNOWN - exception stop, a human decides.');
  proposal.evidence.forEach(e => emit(`  - ${e}`));

  // 6. Photo (download locally; uploaded only at submit)
  let photo = { status: 'skipped', note: 'No place ID.' };
  if (place.id) {
    try { photo = await fetchPhoto(place.id, place.displayName.text, apiKey); }
    catch (err) { photo = { status: 'failed', note: err.message }; }
  }
  emit(`Photo: ${photo.status} - ${photo.note}`);
  result.photo = { status: photo.status, filename: photo.filename || null };

  // 7. Build the listing
  const chainNotes = buildChainNotes(city, otherPlaces, place.websiteUri);
  const allNotes = [chainNotes, extraNotes].filter(Boolean).map(s => s.replace(/\.+$/, '')).join('. ')
    + ([chainNotes, extraNotes].some(Boolean) ? '.' : '');
  const listing = buildListing({ place, city, dishChoice, classification: proposal, notes: allNotes, photoUrl: '' });
  result.listing = listing;

  const audit = {
    name, city, address: place.formattedAddress || null,
    menuStatus: menu.status, menuUrl: menu.menuUrl || null,
    classification: proposal.dietaryType || 'UNKNOWN', confidence: proposal.confidence,
    evidence: proposal.evidence, dishes: dishChoice ? dishChoice.dishesText : null,
    photo: photo.status, via: input.via || 'cli',
  };

  // 8. Submit gate
  if (!input.submit) {
    result.outcome = 'preview';
    logRun({ ...audit, outcome: 'preview' });
    return result;
  }
  if (!dishChoice) { result.message = 'Cannot submit: dishes are REQUIRED.'; logRun({ ...audit, outcome: 'blocked-no-dishes' }); return result; }
  if (!proposal.dietaryType) { result.message = 'Cannot submit: classification is UNKNOWN (exception stop).'; logRun({ ...audit, outcome: 'blocked-unknown-class' }); return result; }
  if (!supabaseUrl || !supabaseKey) { result.message = 'Cannot submit: Supabase env missing.'; return result; }
  try {
    if (photo.status === 'ok') {
      listing.photo_url = await uploadPhoto(supabaseUrl, supabaseKey, photo.filePath, photo.filename, photo.contentType);
      emit(`Photo uploaded: ${listing.photo_url}`);
    }
    const inserted = await insertRestaurant(supabaseUrl, supabaseKey, listing);
    const verified = await verifyRestaurant(supabaseUrl, supabaseKey, listing.name);
    if (verified) {
      result.outcome = 'submitted'; result.rowId = verified.id;
      result.message = `"${listing.name}" is now in the directory.`;
      logRun({ ...audit, outcome: 'submitted-verified', rowId: verified.id });
    } else {
      result.outcome = 'blocked'; result.rowId = inserted && inserted.id;
      result.message = 'Insert returned OK but read-back did not find it - check Supabase.';
      logRun({ ...audit, outcome: 'submitted-unverified', rowId: result.rowId });
    }
  } catch (err) {
    result.outcome = 'blocked'; result.message = `Submit failed: ${err.message}`;
    logRun({ ...audit, outcome: 'submit-failed', error: err.message });
  }
  return result;
}

module.exports = { runAgent };
