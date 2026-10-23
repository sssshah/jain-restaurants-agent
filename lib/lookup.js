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
        'places.websiteUri',
        'places.googleMapsUri',
        'places.businessStatus',
        'places.primaryTypeDisplayName',
        'places.types',
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

module.exports = { lookupPlace };
