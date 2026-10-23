# RULES.md - The Spec for the Jain Restaurants Agent

> What this file is: the RESTAURANT rules - what a correct listing is
> (fields, dishes, classification, exception stops). It is about the
> OUTPUT of the program. Not to confuse with AGENTS.md, which is about
> how a coding assistant should behave while writing the code (safety,
> git hygiene). This file = restaurants. AGENTS.md = coders.

Source: ~/workspace/jain-directory-adds/playbook.md (v2, 2026-10-23)
Site: https://jain-restaurants.netlify.app - 206 listings as of 2026-10-23
Input (v1): one restaurant at a time - name, city, Jain dishes (CLI)

## The Workflow (in order)

0. Duplicate check first - search the directory. If already listed, stop and report. No add.
1. Identify the exact outlet - same-name places have multiple locations. Never mix details across outlets.
2. Lookup via Google Places API - address, phone, website, rating, coordinates, photo, full place URL.
3. Dietary classification - from facts / menu.
4. Build the listing - apply the field rules below.
5. Photo - download from the place's Google profile (form takes upload only, max 5MB, JPG/PNG/WebP).
6. Submit + verify - confirmation shows "Restaurant added successfully!" + "Coordinates saved: lat, lng"

## Field Rules (non-negotiable)

- Rating: defaults to 4 for every listing. Different only if Sam specifies it for that place.
- Country: exactly "USA" - never "United States" (that fragments the country filter).
- Coordinates matter: they come from the place data / full place URL. Always use the FULL place URL with @lat,lng and !3d / !4d data - never a shortened share link.
- Recommended Dishes: REQUIRED, never empty. Semicolon-separated. If the place has a full Jain menu, use exactly: "Full Jain Menu available"
- Dishes options - DISPLAYED to the submitter at insert time (Sam's rule, 2026-10-23). In the CLI they print as a menu; in the later public web form they will be radio buttons + a free-text box for real dishes. A submitter who doesn't list dishes picks one:
  1. "Some items on the menu can be made Jain" -> dishes text is exactly that.
  2. "Jain menu available" -> dishes text is exactly "Full Jain Menu available" (the standing canonical string).
  3. "Haven't visited and someone would need to add dishes later" -> dishes text is option 1's text, PLUS a not-yet-visited flag in notes/status (the flag does NOT go in the dishes text shown to diners). The card's Suggest Dishes button is how it gets filled in later.
  A real dish list typed by the submitter is always accepted as-is and beats 1/2/3.
- Additional Notes: NO opening hours (people check Google/website for hours).
- Chains: the agent NEVER picks a location itself - the customer / Sam picks one from the GUI list. One listing per restaurant per city - we do NOT process every location and we do NOT list the other locations' addresses in notes (flooding concern, Sam 2026-10-23 evening; this replaces the earlier tiered 1-3-addresses rule). The listing is a SIGNAL that this chain has Jain-friendly food in this city; the website link on the card is how diners find the other outlets. Notes get ONE standard line whenever there are other same-city locations, any count: "Multiple locations in <city>: N other location(s) - see website for all locations". A location someone cares about gets its own listing later, submitted separately. Keep dish details in the dishes field. Implemented in lib/chainNotes.js.
- Phone / Website: leave blank if the place data doesn't have them. Never invent values, never borrow from another outlet.
- Full Address: use the exact address from the place data. Auto-fill strings are often garbled - verify and replace.

## Dietary Classification

Jain = no meat, no fish/chicken, AND no root vegetables (onion, garlic, potato, carrot, etc.).
- Pure Veg / Vegan / Mixed are the buckets.
- A mixed (non-veg) place counts ONLY if Jain preparations are actually offered.
- If the facts don't settle it, that's an exception stop - ask Sam.

## Menu Lookup + Classification - Sam's simplified rules (2026-10-23, supersedes the LLM-reads-everything idea)

Menus almost NEVER say "Jain". Do NOT waste LLM cycles figuring out which dishes could be made Jain - dishes come from the PERSON adding the place (typed, or dishes options 1/2/3).
Classification is mostly a CODE job (lib/classify.js), in this order:
1. Menu mentions "Jain" (a Jain menu, or a Jain legend/symbol on the menu) -> flag it. That is the rare easy win.
2. "Vegan" in the restaurant NAME or in its Google place type -> Vegan. (Sam: most vegan places say so in their name; Google type like "Vegan restaurant" counts too.)
3. Any fish / chicken / meat (full word list in classify.js: pork, beef, lamb, shrimp, seafood, etc.) anywhere in the menu -> Mixed, flat rule.
4. Real menu, no meat words, vegetarian signals present -> Pure Veg proposal (medium confidence).
5. Nothing settles it -> UNKNOWN = exception stop, human decides.
LLM role: RARE, not routine. Reserved for a menu that plain text scanning can't handle (scanned-image menu, awkward PDF). Routine classification uses zero LLM calls.

## EXCEPTION STOPS - Halt and Ask Sam (do not guess, do not submit)

1. Multiple same-name outlets in the city, with no signal which one.
   Example: Beyond Sushi, NYC - 2 outlets (134 W 37th St chosen, 62 W 56th St went in notes).
2. The place appears renamed / rebranded.
   Example: Su Xing House, Philadelphia - now Meet Harbin / Chengdu Center City. Skipped.
3. The place is marked permanently closed.
   Example: Both Planta Miami locations - permanently closed. Skipped.
4. Dietary classification the facts don't settle.

Also stop on: duplicate found in the directory.

## Customer-Facing GUI Messages (Sam's rule, 2026-10-23)

When a restaurant cannot be added, the customer must SEE a clear message on the GUI - never a silent failure or a raw technical error. Canonical texts live in lib/messages.js; the CLI prints them now, the public web GUI will display the same texts later.
- Permanently closed: tell the customer it appears permanently closed, so it can't be added, and invite a re-check if they believe it's a mistake.
- Does not exist / no match in that city: tell the customer it couldn't be found, ask them to check spelling/city, note a very new place may not be on Google yet.
- Also covered by the same principle (same lib): duplicate ("already in the directory"), multiple locations ("please choose which location"), and lookup failure ("try again in a few minutes" - technical details stay internal, never shown to the customer).
- Google quota reached (Sam set hard quota caps in Google Maps Platform > Quotas, 2026-10-23): customer message is exactly "Google Quota for Map reached, try later." Trigger: Places API returns 429 / RESOURCE_EXHAUSTED. No retries in a loop - stop.

## Why Places API, Not Scraping

We hit a Google bot check scraping Maps by hand. The API is the stable, legal path.
API key lives in a local .env file only - never in code, never printed, never committed (.gitignore covers it).
