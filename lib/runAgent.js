// runAgent.js - the agent's brain as a reusable function.
//
// The CLI (index.js) and the local web page (server.js) are two FACES;
// this is the one BRAIN both call. runAgent({ name, city, dishesInput,
// notes, pick, submit }, log) -> result object:
//   { outcome, message?, places?, listing?, classification?, photo?, logs }
// Outcomes: 'preview' | 'submitted' | 'submitted-mismatch' | 'multiple' |
//   'duplicate' | 'not-found' | 'closed' | 'lookup-failed' | 'quota' |
//   'blocked' | 'needs-review' (Evaluate refused the submit)
// `log` receives human-readable lines (CLI prints them; the web server
// collects them into the JSON response for the page to show).
// Environment (keys) must be loaded by the caller via lib/loadEnv.js.

const { lookupPlace, filterNameMatches } = require('./lookup');
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
const { evaluateListing, compareListing } = require('./evaluate');
const { judgeMenu } = require('./llmJudge');

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

  // Incident #3: Text Search returns unrelated nearby businesses too.
  // Never show those in the location picker as if they were outlets
  // of the searched restaurant.
  const filtered = filterNameMatches(places, name);
  if (filtered.length < places.length) {
    emit(`Search returned ${places.length} places; kept ${filtered.length} matching the name "${name}" (top hit + name matches) - dropped ${places.length - filtered.length} unrelated businesses.`);
  }
  places = filtered;

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
        result.outcome = 'duplicate';
        result.message = dup.fuzzyOnly
          ? messages.possibleDuplicate(name, city, dup.matches.map(m => m.name || m.restaurant_name || m.title))
          : messages.duplicate(name, city);
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

  // Ambiguous zone: code rules gave up (UNKNOWN) but menu text exists.
  // Let the agent DECIDE (LLM judgment, bounded) instead of writing one
  // more rule. A null verdict keeps UNKNOWN - the human decides.
  // NOTE: result.classification was already built above, so refresh it
  // when the judge settles the case.
  if (!proposal.dietaryType && menu.menuText) {
    const verdict = await judgeMenu({
      name: place.displayName && place.displayName.text,
      menuText: menu.menuText,
    });
    if (verdict.dietaryType) {
      proposal.dietaryType = verdict.dietaryType;
      proposal.confidence = 'medium';
      proposal.evidence.push('LLM judgment on messy menu: ' + verdict.evidence);
      result.classification = {
        code: proposal.dietaryType,
        label: DIETARY_LABELS[proposal.dietaryType] || proposal.dietaryType,
        confidence: proposal.confidence,
        evidence: proposal.evidence,
        jainInMenu: proposal.jainInMenu,
      };
      emit(`LLM judgment: ${verdict.dietaryType} (${verdict.reason})`);
    } else {
      emit(`LLM judgment: inconclusive (${verdict.reason}) - human decides.`);
    }
  }

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

  // EVALUATE (pre-submit): independent checks on the finished listing.
  // A 'fail' verdict BLOCKS the submit even when submit=true - the agent
  // stops its own bad work and says why. 'warn' rides along for the human.
  // In preview mode the preview still shows, with the failures visible.
  const evaluation = evaluateListing({
    listing, classification: proposal, menu, photo, dishChoice,
  });
  result.evaluation = evaluation;
  evaluation.issues.forEach(i => emit(`Evaluate [${i.severity}]: ${i.message}`));
  if (evaluation.verdict === 'fail' && input.submit) {
    result.outcome = 'needs-review';
    result.message = 'The agent evaluated its own work and stopped it: ' +
      evaluation.issues.filter(i => i.severity === 'fail').map(i => i.message).join(' ');
    logRun({ ...audit, outcome: 'blocked-evaluation', issues: evaluation.issues });
    return result;
  }

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
      // EVALUATE (post-submit): the live row must match the preview,
      // field by field - existence alone is not verification.
      const mismatches = compareListing(verified, listing);
      if (mismatches.length > 0) {
        result.outcome = 'submitted-mismatch'; result.rowId = verified.id;
        result.message = 'Inserted, but the live row differs from the preview: ' +
          mismatches.map(m => m.field + ' (expected ' + m.expected + ', got ' + m.got + ')').join('; ');
        logRun({ ...audit, outcome: 'submitted-mismatch', rowId: verified.id, mismatches });
      } else {
        result.outcome = 'submitted'; result.rowId = verified.id;
        result.message = `"${listing.name}" is now in the directory.`;
        logRun({ ...audit, outcome: 'submitted-verified', rowId: verified.id });
      }
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
