// duplicateCheck.js - Slice 2: is this place already in the directory?
// The directory lives in Supabase. Its REST API is PostgREST:
//   GET {SUPABASE_URL}/rest/v1/restaurants?select=*
//   headers: apikey: <anon key>, Authorization: Bearer <anon key>
// The anon key is a PUBLISHABLE key (it ships in the website/app code,
// e.g. jain-restaurants-mobile/src/config.js) - but we still keep our copy
// in .env and never print it. The secret service_role key is NEVER used here.
//
// Strategy (same as the website): fetch the full list once, compare locally.
// A duplicate = same normalized name AND (same city OR same street address).
// Name-only matching would false-positive on chains in different cities.

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

  const matches = rows.filter(row => {
    const rowName = normalize(row.name || row.restaurant_name || row.title);
    if (!rowName || rowName !== wantedName) return false;
    const rowCity = normalize(row.city);
    const rowStreet = streetPart(row.address || row.formatted_address || row.full_address);
    return (rowCity && rowCity === wantedCity) || (rowStreet && rowStreet === wantedStreet);
  });

  return { totalInDirectory: rows.length, matches };
}

module.exports = { checkDuplicate, fetchAllRestaurants };
