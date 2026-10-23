// Jain Restaurants Agent - v1, Slice 1: Lookup
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
const { checkDuplicate } = require('./lib/duplicateCheck');
const { classify } = require('./lib/classify');
const { testLLM } = require('./lib/llm');

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
  console.log('Jain Restaurants Agent - Slice 1: Lookup');
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

  // EXCEPTION STOP #1: multiple matches
  if (places.length > 1) {
    console.log(`Found ${places.length} matches:`);
    console.log('');
    places.forEach((p, i) => printPlace(p, i));
    console.log('STOP - EXCEPTION: Multiple matches. The agent will NOT guess which outlet.');
    console.log(`Customer message (GUI): ${messages.multipleLocations(name, city)}`);
    return;
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

  // Step 4 (preview): classification proposal from name/type only.
  // Menu text arrives in Slice 3 - rules get stronger then (meat scan, Jain legend).
  const proposal = classify({
    name: places[0].displayName && places[0].displayName.text,
    primaryType: places[0].primaryTypeDisplayName && places[0].primaryTypeDisplayName.text,
    types: places[0].types,
    menuText: '',
  });
  if (proposal.dietaryType) {
    console.log(`Classification proposal: ${proposal.dietaryType} (confidence: ${proposal.confidence})`);
  } else {
    console.log('Classification proposal: UNKNOWN - exception stop, a human decides (menu fetch in Slice 3 may settle it).');
  }
  proposal.evidence.forEach(e => console.log(`  - ${e}`));
  if (proposal.jainInMenu) console.log('  - Jain menu/legend found in menu');
  console.log('');
  console.log('Next slice will: fetch the menu, run the full classification rules, then build the listing.');
}

main();
