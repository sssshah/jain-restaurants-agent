# INCIDENTS.md - what this agent has learned the hard way

This file is the agent's long-term memory of mistakes. The agent itself
does NOT learn on its own: the loop (observe -> decide -> act) is not
learning. Learning here is a reviewed, versioned process:

1. A run goes wrong (or nearly does).
2. The run is in runs.log.jsonl - what the agent saw and decided.
3. A human finds the root cause and fixes the code.
4. A regression test is added to run-tests.js so the same mistake can
   never silently come back.
5. The incident is written up here, and everything is committed to git.

The agent never edits its own rules. Every "lesson" below arrived as a
code change a human reviewed - that is what makes the learning safe to
trust on a public directory.

---

## 2026-10-23 - Forno Rosso: a CSS file was read as the menu (first live submit)

**What happened:** The agent's first real end-to-end submit added
Forno Rosso (Chicago, Randolph St) to the live directory classified as
Pure Veg (`vegetarian`). Forno Rosso serves meat; the correct class is
Mixed (`both`). The site owner corrected the row by hand in Supabase.

**Root cause:** `lib/menuFetch.js` accepted any homepage link whose URL
contained the letters "menu" and any fetched text over 400 characters.
The restaurant's Wix site links a stylesheet named
`.../rb_werbolt[DropDownMenu_OverlineMenuButtonSkin]....min.css` -
"DropDownMenu" matched, 2,889 characters of CSS code were treated as
menu text, the code contained no meat words, and the classifier's
Pure Veg rule fired on a stray vegetarian signal.

**Fixes (all in code, same day):**
- Menu candidates must be real pages: file extensions AND content-type
  reject CSS/JS/images; "menu" must be an actual URL path segment.
- Fetched text must LOOK like a menu (food words / prices) before it
  counts as one - otherwise the agent honestly reports "no menu found"
  and classification stops at UNKNOWN for a human.
- Pure Veg now requires vegetarian evidence in the menu text itself;
  Google place types no longer count toward it.
- Italian cured meats (prosciutto, salami, mortadella, pancetta, ...)
  added to the meat scan.

**Regression tests:** `run-tests.js` - the CSS URL, code-text, and
classification cases from this incident run on every test pass.

**Lesson:** the loop worked end to end; one sloppy assumption in one
"sense" (the menu fetcher) poisoned a downstream decision. Verify what
each sense actually captured before trusting what the brain concludes.

---

## 2026-10-24 - Vatans: a missed duplicate (same place, different name shape)

**What happened:** Sam tried to add "Vatans" in East Windsor through
the dialog. The directory already lists "Vatan Indian Vegetarian
Cuisine & Bakery, East Windsor, NJ". The agent did NOT flag it as a
duplicate and showed a preview instead. Nothing bad went live (the
run stopped at preview; nothing was submitted), but the safety net
that should have caught it did not.

**Root cause:** `lib/duplicateCheck.js` required EXACT normalized-name
equality (`rowName !== wantedName` rejects). Google calls the place
"Vatans"; the directory calls it "Vatan Indian Vegetarian Cuisine &
Bakery". Same place, different name shapes - the rule never stood a
chance. This was NOT an Evaluate failure: Evaluate checks the
listing's own quality (dishes, evidence, menu) and never looks at
the directory, so it cannot know about near-duplicates. The gap was
in the duplicate sense itself.

**Fixes (same day):**
- Fuzzy core-name matching in `lib/duplicateCheck.js`: lowercase,
  punctuation out, generic words dropped (indian, vegetarian,
  cuisine, bakery, restaurant...), plurals singularized (vatans ->
  vatan). If one core is contained in the other AND the city
  matches, it is a FUZZY match - still a stop, but the message
  (`messages.possibleDuplicate`) names the existing listing so a
  human can judge whether it is really the same place.
- Fuzzy matching requires the city gate (never street alone: street
  fragments collide across towns). Over-flagging is the safe
  direction: a blocked legit add is recoverable, a second listing
  for the same restaurant corrupts the directory.
- `lib/runAgent.js` now picks the possible-duplicate message when
  every match is fuzzy, and the exact-duplicate message otherwise.

**Regression tests:** `run-tests.js` - the Vatans case itself, plus
 exact, no-match, subset, and all-generic-name cases.

**Lesson:** the loop generalizes WITHIN each step's checks, not
ACROSS senses. The Forno lesson hardened menu evaluation; it could
not harden duplicate matching, because that is a different sense
with its own rule. A new failure shape still needs a human to name
it once - then the fix + test cover that whole class forever. That
is the learning layer working as designed: Sam spotted the miss,
the rule changed, the test locks it. The agent did not "fail to
learn" - learning was never its job; it is ours, and it happened.

---

## 2026-10-24 - Vatan in the wrong city: the picker listed unrelated businesses

**What happened:** Sam searched "Vatan" with the WRONG city
(Robbinsville instead of East Windsor). The dialog showed a
"more than one location" picker listing four places: the real Vatan
(East Windsor) plus a Robbinsville ashram, a Robbinsville Hindu
temple, and Ganga Indian Restaurant - presented as if they were all
locations of Vatan. They are not. Picking one would have started
adding a temple as a restaurant.

**Root cause:** Google Places Text Search is relevance-ranked, NOT
"locations of X". Given "Vatan in Robbinsville" it returns the
strong name match (East Windsor Vatan) plus prominent nearby places
that loosely fit. `runAgent` treated EVERY returned place as a
candidate location of the searched restaurant, so the picker
mislabeled unrelated businesses as outlets.

A second, quieter thread in the same scenario: the duplicate gate
used the TYPED city. Even after incident #2's fuzzy fix, a
wrong-city search would have missed the East Windsor duplicate,
because Robbinsville != East Windsor. (The listing city itself was
NOT wrong: `buildListing` already takes the city from the place's
own address, falling back to the typed city.)

**Fixes (same day):**
- `lib/lookup.js` gains `filterNameMatches`: always keep Google's
  TOP hit (its best interpretation of the query, including typos),
  and keep any other hit whose NAME matches the searched name
  (exact or fuzzy core). Everything else is dropped before the
  picker, closed check, or duplicate check ever see it, and the
  drop is logged.
- `lib/duplicateCheck.js` now gates on the place's OWN address city
  as well as the typed city, so a wrong typed city cannot hide a
  duplicate. Chain protection is unchanged: the gate is still about
  the place's actual city, so a same-name outlet in a different city
  still passes through as its own listing.
- `namesMatch` now normalizes its inputs itself, so any caller can
  pass raw display names.

**Regression tests:** `run-tests.js` - the Vatan/Robbinsville filter
case, a genuine two-outlet case, a typo-query case (top hit kept),
and the raw-input namesMatch case.

**Lesson:** never trust a search API's result list to mean what your
UI claims it means. Text Search answers "what is relevant to these
words near here", not "all locations of this restaurant". The
picker's label was a claim the data did not support - so the data
must be filtered to the claim, not the other way around.

---

## 2026-10-25 - T's Tantan, Tokyo: a missed duplicate + a USA stamp on Japan

**What happened:** Sam searched "Vegan" in Tokyo. The agent
previewed T's Tantan (Tokyo Station, phone +81332188040) with the
Submit button enabled - even though T's Tantan is already in the
directory (Chiyoda, Tokyo, Japan, phone +81332188040). The preview
card also showed the wrong geography: country "USA", city
"〒100-0005 Tokyo" (a postal code glued to the city), state
"Chiyoda" (a ward fragment, not a prefecture). Nothing was
submitted (the run stopped at preview), but both the safety net
and the listing fields were wrong.

**Root causes (two, same run):**
- `lib/buildListing.js` hardcoded `country: 'USA'` and parsed
  city/state by splitting the formatted address on commas. That
  works for "Street, City, ST ZIP, USA" and fails everywhere else:
  Japan's formatted address leads with the country and the postal
  code, so the "city" segment came out as "〒100-0005 Tokyo".
- The duplicate gate compared cities for exact equality. The
  stored row says city Chiyoda, Sam searched Tokyo, and the parsed
  place city was "〒100-0005 Tokyo" - three different strings for
  one place. The name matched exactly; the city gate vetoed it.
  A lookup against the directory card and against Google's
  structured record confirmed Sam's manual entry was CORRECT
  (Chiyoda, Tokyo, Japan, same phone) - the agent's parsing and
  gate were wrong, not his data.

**Fixes (same day):**
- `lib/lookup.js` now requests `places.addressComponents` and sets
  `languageCode: 'en'` (English preferred; Google falls back to
  the local language where English is unavailable). The address
  field keeps the formatted string as returned - multilingual
  there is fine; the components feed city/state/country only.
- `lib/buildListing.js` gains `deriveLocation`: US places (and
  places with no components at all) use the legacy parse,
  byte-for-byte unchanged, country exactly "USA". Everywhere
  else, country/state/city come from the components, with a city
  fallback chain (locality -> sublocality -> admin level 2 ->
  admin level 1). State is kept whenever admin level 1 exists,
  even when it duplicates the city or country (Singapore): the
  site searches by state, so a blank state would hide the
  listing from state search (Sam's correction after the first
  test run, which had dropped such states). Only a genuinely
  missing admin level 1 (Monaco) yields an empty state.
  Components with no country yield country '' so Evaluate's
  no-country check blocks the submit instead of stamping a
  wrong country.
- `lib/duplicateCheck.js` gains the METRO rule (non-US only):
  the gate also passes when the typed or place city matches the
  row's state, or the row's city matches the place's state
  (Chiyoda row + Tokyo search = same metro). State equality
  alone never passes (Pune vs Mumbai, both Maharashtra, still
  pass through). City comparison is now accent-insensitive
  (Sao Paulo matches São Paulo) and ignores a trailing
  " City" (Chiyoda City matches Chiyoda). The gate's pure core
  is extracted as `rowMatches` so it is unit-testable with no
  network. The US gate is unchanged.
- The phone-as-second-signal idea was considered and left OUT:
  chains can share one central number across outlets, and the
  metro rule already fixes this case. It can be added later if
  a miss ever needs it.

**Regression tests:** `run-tests.js` - the T's Tantan replay
(Chiyoda row + Tokyo search = exact duplicate), the Japan
derivation, the US control (with and without components),
Singapore, Monaco, the sublocality fallback, the missing-
country case, the Pune/Mumbai state-alone case, the São Paulo
accent case, and the unchanged Vatan/Robbinsville US gate.

**Lesson:** never parse a formatted string when the API offers
the structured form - the string's layout is a display choice
that varies by country, while the components' labels mean the
same thing everywhere. And "city" is not one level worldwide:
wards, suburbs, and city-states all break a city-only gate, so
the gate has to compare at metro level, not just city level.

---

## 2026-10-25 - List-photo notes dropped the description (123V Browns lost "Vegan sushi concept")

**What happened:** On the deployed endpoint, the London list photo
produced a 7-entry picker. The notes kept only the Jain fragment of
each description: 123V Browns showed "Inform in advance for Jain
options" and dropped "Vegan sushi concept by Gauthier's chef.
Absolutely must visit". The same trimming hit every entry (Tofu
Vegan lost "Chinese awesomeness", Kin lost its cafe description).
Nothing wrong was submitted (nothing was picked), but the picker
showed the user less than the photo said.

**Root cause:** `lib/photoRead.js` told the model to return "a short
Jain-relevant note from its description". The model obeyed
literally: it distilled each description down to its Jain
instruction and discarded the cuisine description and
recommendation around it.

**Fix (same day):**
- The prompt now asks for the entry's FULL description text as its
  note, including the Jain instruction and any cuisine description
  or recommendation; "" only when the entry has no description
  text at all.
- Dishes are now "food items or specialties named for that
  restaurant (e.g. "Vegan Sushi")", so a named specialty lands in
  dishes as well as in the note.
- What did NOT change: notes still never carry addresses, phone
  numbers, or location counts, and the 200-character cap in
  `parsePhotoReply` still applies (all seven entries' full texts
  fit under it).
- README's "Photo list picker" section updated to the new rule.

**Verification:** prompt wording is not unit-testable (the parser
already preserves whatever note the model returns, up to the cap),
so no new test was added. Verification is a live re-upload of the
same list photo on the deployed endpoint after redeploy: 123V
Browns' note must read in full.

**Lesson:** when you ask a model for "a short note", you get a
summary, not the text. If the user needs to SEE what the photo
said, ask for the text itself and cap the length instead of asking
for brevity.
