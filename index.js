// Jain Restaurants Agent - v1, Phase 1 complete: lookup -> duplicate check
// -> menu fetch -> classify -> photo -> build listing -> submit (--submit only)
// Run with no args to check your .env is working:
//   node index.js
// Run a lookup (name, city, dishes - dishes come from YOU, not Google):
//   node index.js "Planta" "New York" "2"   <- dishes option 2 = Full Jain Menu available
//   node index.js "Beyond Sushi" "New York" "1"   <- should trigger the multi-match STOP
// Dishes can be: a real list, OR 1 / 2 / 3 from the displayed options (see lib/dishes.js)
//
// Flow so far: loadEnv() -> check key (length only) -> lookupPlace() -> print OR stop on an exception

const { loadEnv } = require('./lib/loadEnv');
const { lookupPlace } = require('./lib/lookup');
const { printDishOptions, normalizeDishes } = require('./lib/dishes');
const messages = require('./lib/messages');
const { checkDuplicate, fetchAllRestaurants } = require('./lib/duplicateCheck');
const { classify } = require('./lib/classify');
const { testLLM } = require('./lib/llm');
const { fetchMenu } = require('./lib/menuFetch');
const { buildListing, printListing } = require('./lib/buildListing');
const { fetchPhoto } = require('./lib/photo');
const { uploadPhoto, insertRestaurant, verifyRestaurant } = require('./lib/submit');
const { buildChainNotes } = require('./lib/chainNotes');
const { logRun } = require('./lib/runLog');

function printPlace(place, index) {
  const name = place.displayName && place.displayName.text ? place.displayName.text : '(no name)';
  const lat = place.location ? place.location.latitude : '?';
  const lng = place.location ? place.location.longitude : '?';
  console.log(`${index + 1}. ${name}`);
  console.log(`   Address:     ${place.formattedAddress || '(none)'}`);
  console.log(`   Phone:       ${place.nationalPhoneNumber || '(none - leave blank, do not invent)'}`);
  console.log(`   Website:     ${place.websiteUri || '(none - leave blank)'}`);
  console.log(`   Google rating: ${place.rating || '(none)'} (${place.userRatingCount || 0} reviews)  [our listing rating defaults to 4 per RULES.md]`);
  console.log(`   Coordinates: ${lat}, ${lng}`);
  console.log(`   Maps URL:    ${place.googleMapsUri || '(none)'}`);
  console.log(`   Status:      ${place.businessStatus || '(unknown)'}`);
  console.log(`   Type:        ${(place.primaryTypeDisplayName && place.primaryTypeDisplayName.text) || '(unknown)'}  [used for Vegan detection]`);
  console.log(`   Place ID:    ${place.id || '(none)'}`);
  console.log('');
}

async function main() {
  console.log('Jain Restaurants Agent - Phase 1 (full flow)');
  console.log('----------------------------------------');

  // Step 0: load .env
  const foundEnv = loadEnv();
  if (!foundEnv) {
    console.log('STOP: No .env file found. Copy .env.example to .env and add your key.');
    return;
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || apiKey === 'your_google_places_api_key_here') {
    console.log('STOP: GOOGLE_PLACES_API_KEY is missing or still the placeholder in .env');
    return;
  }
  // Safe check: we print ONLY the length, never the key itself.
  console.log(`Key loaded: yes (${apiKey.length} characters)`);
  const llmKey = process.env.MODEL_API_KEY;
  console.log(`LLM key loaded: ${llmKey ? `yes (${llmKey.length} characters)` : 'no (fine - the LLM is only for rare messy menus)'}`);
  console.log('');

  // Special mode: node index.js --schema   (print the live directory's real
  // column names + the dietary_type values in use - public listing data only)
  if (process.argv[2] === '--schema') {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) { console.log('STOP: Supabase env missing (.env.supabase)'); return; }
    const rows = await fetchAllRestaurants(url, key);
    console.log(`Directory rows: ${rows.length}`);
    console.log(`Columns: ${Object.keys(rows[0] || {}).join(', ')}`);
    const types = [...new Set(rows.map(r => r.dietary_type).filter(Boolean))];
    console.log(`dietary_type values in use: ${types.join(' | ')}`);
    const sample = rows[0] || {};
    console.log(`Sample keys with values: ${Object.entries(sample).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(' ; ')}`);
    return;
  }

  // Special mode: node index.js --test-llm   (verify the Spark key actually works)
  if (process.argv[2] === '--test-llm') {
    if (!llmKey) { console.log('STOP: MODEL_API_KEY is empty in .env.llm'); return; }
    const model = process.env.LLM_MODEL || 'muse-spark-1.3-contributor';
    console.log(`Testing LLM: model ${model} ...`);
    try {
      const { text, usage } = await testLLM(llmKey, model);
      console.log(`LLM replied: "${text}"`);
      if (usage) console.log(`Tokens used: ${usage.prompt_tokens} in + ${usage.completion_tokens} out (contributor cost: a tiny fraction of a cent)`);
      console.log('LLM connection: OK');
    } catch (err) {
      console.log('LLM test FAILED.');
      console.log(`[internal] ${err.message}`);
    }
    return;
  }

  // Step 1: get input from the command line
  // process.argv is: [node, index.js, ...your words]
  const name = process.argv[2];
  const city = process.argv[3];
  const dishes = process.argv[4]; // from Sam / the source post - Google does NOT know Jain dishes
  const extraNotes = (process.argv[5] && process.argv[5] !== '--submit') ? process.argv[5] : ''; // optional facts for Notes (never hours)

  const dishChoice = normalizeDishes(dishes);

  if (!name || !city) {
    console.log('Env check passed. Now try a lookup:');
    console.log('  node index.js "Planta" "New York" "2"');
    console.log('');
    printDishOptions();
    return;
  }

  if (!dishChoice) {
    console.log('Note: No dishes given. Lookup still works, but a LISTING cannot be built without dishes.');
    console.log('Recommended Dishes is REQUIRED in RULES.md. When inserting, you will be shown these options:');
    console.log('');
    printDishOptions();
  } else {
    console.log(`Dishes for listing: ${dishChoice.dishesText}${dishChoice.notVisited ? '  [flag: not yet visited - dishes to be added later]' : ''}`);
    console.log('');
  }

  console.log(`Looking up: "${name}" in "${city}" ...`);
  console.log('');

  // Step 2: call Places API
  let places;
  try {
    places = await lookupPlace(name, city, apiKey);
  } catch (err) {
    console.log('STOP: Lookup failed.');
    // Quota hit? Google returns 429 / RESOURCE_EXHAUSTED - show Sam's quota message, not a generic error.
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(err.message)) {
      console.log(`Customer message (GUI): ${messages.quotaReached()}`);
    } else {
      console.log(`Customer message (GUI): ${messages.lookupFailed(name, city)}`);
    }
    console.log(`[internal] ${err.message}`);
    console.log('');
    console.log('Common causes: Places API (New) not enabled, billing not linked, or key restricted to a different API/IP.');
    return;
  }

  if (places.length === 0) {
    console.log('STOP: No matches found - this restaurant does not appear to exist in that city.');
    console.log(`Customer message (GUI): ${messages.notFound(name, city)}`);
    return;
  }

  // EXCEPTION STOP #3: permanently closed
  const closed = places.filter(p => p.businessStatus === 'CLOSED_PERMANENTLY');
  if (places.length === 1 && closed.length === 1) {
    printPlace(places[0], 0);
    console.log('STOP - EXCEPTION: This place is marked PERMANENTLY CLOSED. Skipping, as in RULES.md.');
    console.log(`Customer message (GUI): ${messages.permanentlyClosed(name, city)}`);
    return;
  }

  // EXCEPTION STOP #1: multiple matches - the agent never guesses.
  // BUT a human can pick: re-run with --pick N and that location proceeds,
  // with the others going into the listing's notes (chain rule).
  let otherPlaces = [];
  if (places.length > 1) {
    const pickEq = process.argv.find(a => a.startsWith('--pick='));
    const pickIdx = process.argv.indexOf('--pick');
    const pickNum = pickEq ? parseInt(pickEq.split('=')[1], 10)
      : (pickIdx > -1 ? parseInt(process.argv[pickIdx + 1], 10) : NaN);
    if (!pickNum || pickNum < 1 || pickNum > places.length) {
      console.log(`Found ${places.length} matches:`);
      console.log('');
      places.forEach((p, i) => printPlace(p, i));
      console.log('STOP - EXCEPTION: Multiple matches. The agent will NOT guess which outlet.');
      console.log(`Customer message (GUI): ${messages.multipleLocations(name, city)}`);
      console.log('');
      console.log(`To choose one, re-run the same command with --pick 1 (or 2, ...) added.`);
      return;
    }
    otherPlaces = places.filter((_, i) => i !== pickNum - 1);
    places = [places[pickNum - 1]];
    console.log(`Picked location #${pickNum}: ${places[0].formattedAddress}`);
    console.log(`(${otherPlaces.length} other location(s) will be noted in the listing's Notes, per the chain rule.)`);
    console.log('');
  }

  // Happy path: exactly 1 match
  console.log('Found 1 match:');
  console.log('');
  printPlace(places[0], 0);
  console.log(`Dishes for listing: ${dishChoice ? dishChoice.dishesText : '(MISSING - cannot submit without this)'}`);
  if (dishChoice && dishChoice.notVisited) console.log('Flag: Not yet visited - dishes to be added later (goes in notes/status, not the dishes text).');
  console.log('');

  // Step 3 (Slice 2): duplicate check against the Supabase directory
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey || supabaseKey === 'your_supabase_anon_key_here') {
    console.log('Duplicate check: SKIPPED - SUPABASE_ANON_KEY is empty.');
    console.log('(Add the key value in .env.supabase - source: jain-restaurants-mobile/src/config.js, line 2)');
  } else {
    // Safe diagnostic: length ONLY, never the key. A Supabase legacy anon key
    // is a long JWT (typically ~200 characters, starts with eyJ).
    console.log(`Supabase key loaded: yes (${supabaseKey.length} characters)`);
    try {
      const { totalInDirectory, matches } = await checkDuplicate(places[0], city, supabaseUrl, supabaseKey);
      console.log(`Duplicate check: searched ${totalInDirectory} listings in the directory.`);
      if (matches.length > 0) {
        console.log(`STOP - DUPLICATE: found ${matches.length} existing listing(s) with this name + city/address.`);
        console.log(`Customer message (GUI): ${messages.duplicate(name, city)}`);
        return;
      }
      console.log('Duplicate check: CLEAR - not in the directory yet.');
    } catch (err) {
      console.log('Duplicate check: FAILED (lookup result above is still valid).');
      console.log(`[internal] ${err.message}`);
      console.log('[internal] Common causes: wrong table name, anon key wrong, or RLS blocking reads.');
    }
  }
  console.log('');

  const place = places[0];

  // Step 4 (Slice 3): fetch the menu from the restaurant's own website
  console.log('Fetching menu from the restaurant website...');
  const menu = await fetchMenu(place.websiteUri);
  console.log(`Menu: ${menu.status} - ${menu.note}`);
  if (menu.status === 'ok') console.log(`  (menu text: ${menu.menuText.length} characters)`);
  if (menu.status === 'pdf-only') console.log('  PDF menus are the rare LLM case - v1 hands this to a human instead.');
  console.log('');

  // Step 5: classify with the REAL menu text (Sam's rules, lib/classify.js)
  const proposal = classify({
    name: place.displayName && place.displayName.text,
    primaryType: place.primaryTypeDisplayName && place.primaryTypeDisplayName.text,
    types: place.types,
    menuText: menu.menuText || '',
  });
  if (proposal.dietaryType) {
    const { DIETARY_LABELS } = require('./lib/classify');
    console.log(`Classification: ${DIETARY_LABELS[proposal.dietaryType] || proposal.dietaryType} (confidence: ${proposal.confidence}) [stored as: ${proposal.dietaryType}]`);
  } else {
    console.log('Classification: UNKNOWN - exception stop, a human decides. Listing preview below is NOT submittable.');
  }
  proposal.evidence.forEach(e => console.log(`  - ${e}`));
  console.log('');

  // Step 6 (Slice 4): fetch the photo from Google
  let photo = { status: 'skipped', note: 'No place ID.' };
  if (place.id) {
    try { photo = await fetchPhoto(place.id, place.displayName.text, apiKey); }
    catch (err) { photo = { status: 'failed', note: err.message }; }
  }
  console.log(`Photo: ${photo.status} - ${photo.note}`);
  console.log('');

  // Step 7 (Slice 3b): build the listing and preview it
  const chainNotes = buildChainNotes(city, otherPlaces, place.websiteUri);
  const allNotes = [chainNotes, extraNotes].filter(Boolean).map(s => s.replace(/\.+$/, '')).join('. ') + ([chainNotes, extraNotes].some(Boolean) ? '.' : '');
  const listing = buildListing({ place, city, dishChoice, classification: proposal, notes: allNotes, photoUrl: '' });
  printListing(listing);
  console.log('');

  // Audit log: EVERY completed flow writes one line, dry run or submit -
  // what the senses saw + what the brain decided. See lib/runLog.js.
  const audit = {
    name, city, address: place.formattedAddress || null,
    menuStatus: menu.status, menuUrl: menu.menuUrl || null,
    classification: proposal.dietaryType || 'UNKNOWN',
    confidence: proposal.confidence, evidence: proposal.evidence,
    dishes: dishChoice ? dishChoice.dishesText : null,
    photo: photo.status,
  };
  logRun({ ...audit, outcome: 'preview' });

  // Step 8 (Slice 5): submit - ONLY with an explicit --submit flag
  const doSubmit = process.argv.includes('--submit');
  if (!doSubmit) {
    console.log('DRY RUN - nothing was submitted. To actually add this restaurant, re-run with --submit at the end.');
    return;
  }
  if (!dishChoice) { console.log('STOP: cannot submit - dishes are REQUIRED.'); return; }
  if (!proposal.dietaryType) { console.log('STOP: cannot submit - classification is UNKNOWN (exception stop).'); return; }
  const supabaseUrl2 = process.env.SUPABASE_URL, supabaseKey2 = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl2 || !supabaseKey2) { console.log('STOP: Supabase env missing - cannot submit.'); return; }
  try {
    if (photo.status === 'ok') {
      listing.photo_url = await uploadPhoto(supabaseUrl2, supabaseKey2, photo.filePath, photo.filename, photo.contentType);
      console.log(`Photo uploaded: ${listing.photo_url}`);
    }
    const inserted = await insertRestaurant(supabaseUrl2, supabaseKey2, listing);
    console.log(`Inserted row id: ${inserted && inserted.id}`);
    const verified = await verifyRestaurant(supabaseUrl2, supabaseKey2, listing.name);
    if (verified) {
      console.log(`VERIFIED: "${listing.name}" is now in the directory (id ${verified.id}).`);
      logRun({ ...audit, outcome: 'submitted-verified', rowId: verified.id });
    } else {
      console.log('WARNING: insert returned OK but the read-back did not find it - check Supabase.');
      logRun({ ...audit, outcome: 'submitted-unverified', rowId: inserted && inserted.id });
    }
  } catch (err) {
    console.log('SUBMIT FAILED - nothing was added.');
    console.log(`[internal] ${err.message}`);
    logRun({ ...audit, outcome: 'submit-failed', error: err.message });
  }
}

main();
