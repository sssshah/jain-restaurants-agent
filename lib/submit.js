// submit.js - Slice 5: actually add the listing to Supabase.
//
// ONLY runs when the caller passes --submit (default = dry run, ever).
// Steps: upload photo to the public `restaurant-photos` storage bucket,
// insert the row into `restaurants`, then verify by reading it back.
//
// If Supabase Row Level Security blocks the anon key from inserting or
// uploading, this fails LOUDLY with the server's message - it never
// pretends success. (The public website form inserts with this same
// anon key, so a public-insert policy is expected to exist.)

const fs = require('fs');

function base(supabaseUrl) { return supabaseUrl.replace(/\/$/, ''); }
function authHeaders(anonKey, extra = {}) {
  return { apikey: anonKey, Authorization: `Bearer ${anonKey}`, ...extra };
}

async function uploadPhoto(supabaseUrl, anonKey, localFilePath, filename, contentType) {
  const body = fs.readFileSync(localFilePath);
  const res = await fetch(`${base(supabaseUrl)}/storage/v1/object/restaurant-photos/${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: authHeaders(anonKey, { 'Content-Type': contentType || 'image/jpeg', 'x-upsert': 'true' }),
    body,
  });
  if (!res.ok) throw new Error(`Photo upload error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return `${base(supabaseUrl)}/storage/v1/object/public/restaurant-photos/${encodeURIComponent(filename)}`;
}

// Map our listing object onto directory columns. Keys verified against
// the live directory via the --schema probe; unknown extras are dropped
// by PostgREST with an error, which submit reports rather than hiding.
function toRow(listing) {
  // Exact live columns only (schema probe, 2026-10-23). Anything extra
  // makes PostgREST reject the insert - which submit reports loudly.
  return {
    name: listing.name,
    address: listing.address,
    city: listing.city,
    state: listing.state,
    country: listing.country,
    near_city: listing.near_city,
    latitude: listing.latitude,
    longitude: listing.longitude,
    phone: listing.phone,
    website: listing.website,
    google_maps_link: listing.google_maps_link,
    rating: listing.rating,
    dietary_type: listing.dietary_type,
    liked_items: listing.liked_items,
    notes: listing.notes,
    photo_url: listing.photo_url,
    is_preferred: false,
  };
}

async function insertRestaurant(supabaseUrl, anonKey, listing) {
  const res = await fetch(`${base(supabaseUrl)}/rest/v1/restaurants`, {
    method: 'POST',
    headers: authHeaders(anonKey, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(toRow(listing)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Insert error ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
  return Array.isArray(data) ? data[0] : data;
}

async function verifyRestaurant(supabaseUrl, anonKey, name) {
  const res = await fetch(`${base(supabaseUrl)}/rest/v1/restaurants?select=*&name=eq.${encodeURIComponent(name)}`, {
    headers: authHeaders(anonKey),
  });
  if (!res.ok) throw new Error(`Verify error ${res.status}`);
  const rows = await res.json();
  return rows.length > 0 ? rows[0] : null;
}

module.exports = { uploadPhoto, insertRestaurant, verifyRestaurant, toRow };
