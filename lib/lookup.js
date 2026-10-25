// lookup.js - Slice 1: Google Places API (New) Text Search
// One job: given a name + city, return the matching place(s).
// Docs pattern: POST https://places.googleapis.com/v1/places:searchText
// Headers tell Google: (1) who we are [api key], (2) which fields we want [FieldMask].
// Asking only for fields we need is cheaper + faster - that is what FieldMask is for.

async function lookupPlace(name, city, apiKey) {
  const url = 'https://places.googleapis.com/v1/places:searchText';

  const body = {
    textQuery: `${name} in ${city}`,
    maxResultCount: 10,
    // English preferred for names + address components. Google falls
    // back to the local language where English is not available, so a
    // city/state/country is never blank just because English is missing.
    // The address field keeps whatever formatted string comes back;
    // multilingual there is fine.
    languageCode: 'en',
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.rating',
        'places.userRatingCount',
        'places.nationalPhoneNumber',
        'places.internationalPhoneNumber',
        'places.websiteUri',
        'places.googleMapsUri',
        'places.businessStatus',
        'places.primaryTypeDisplayName',
        'places.types',
        // Structured address (2026-10-25, international): country,
        // prefecture/state, city as labeled components, instead of
        // parsing the formatted-address string. The formatted string
        // stays the listing's address field as returned (multilingual
        // is fine); the components feed city/state/country only.
        'places.addressComponents',
      ].join(','),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Note: we do NOT include the api key in any error we print.
    throw new Error(`Places API error ${response.status}: ${errorText.slice(0, 500)}`);
  }

  const data = await response.json();
  return data.places || [];
}

// filterNameMatches - incident #3 (2026-10-24): Google Text Search is
// relevance-ranked, NOT "locations of X". With a wrong city it returns
// unrelated nearby businesses alongside the real match; showing those
// in the "pick a location" picker mislabels them as outlets of the
// searched restaurant (a temple is not a Vatan location). So: always
// keep Google's TOP hit (its best interpretation of the query,
// including typos), and keep any other hit whose NAME matches the
// searched name (exact or fuzzy core). Everything else is dropped -
// it is not a candidate location. The caller logs how many were dropped.
const { namesMatch } = require('./duplicateCheck');

function filterNameMatches(places, searchedName) {
  if (!Array.isArray(places) || places.length === 0) return [];
  const [top, ...rest] = places;
  const kept = [top];
  for (const place of rest) {
    if (namesMatch(searchedName, place.displayName && place.displayName.text)) {
      kept.push(place);
    }
  }
  return kept;
}

module.exports = { lookupPlace, filterNameMatches };
