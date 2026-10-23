// buildListing.js - Slice 3b: turn a Places result + decisions into the
// exact listing that WOULD be submitted (preview first; submit is Slice 5).
//
// Field names + value formats are aligned to the LIVE directory schema,
// verified by the --schema probe on 2026-10-23:
//   columns: id, country, state, city, name, address, google_maps_link,
//     phone, website, liked_items, rating, notes, photo_url, created_at,
//     near_city, dietary_type, user_id, is_preferred, latitude, longitude,
//     chain_name, chain_group_id
//   dietary_type codes: vegetarian | both | vegan
//   state is the FULL name ("Illinois"), phone is international (+1...),
//   dishes live in `liked_items`, the Maps URL in `google_maps_link`.
//
// RULES.md still applies: rating = 4, country exactly "USA", dishes
// REQUIRED, notes carry facts (never hours), phone/website never invented.

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

function parseAddress(formattedAddress) {
  const parts = String(formattedAddress || '').split(',').map(s => s.trim());
  const out = { city: '', state: '', stateAbbr: '' };
  if (parts.length >= 3) {
    out.city = parts[1] || '';
    const abbr = (parts[2] || '').split(/\s+/)[0] || '';
    out.stateAbbr = abbr;
    out.state = STATE_NAMES[abbr] || abbr;
  }
  return out;
}

function buildListing({ place, city, dishChoice, classification, notes, photoUrl }) {
  const name = place.displayName && place.displayName.text;
  const addr = parseAddress(place.formattedAddress);
  const noteParts = [];
  if (notes) noteParts.push(notes);
  if (dishChoice && dishChoice.notVisited) noteParts.push('Not yet visited - dishes to be added later.');
  // NO opening hours in notes (RULES.md). Ever.
  const phone = (place.internationalPhoneNumber || place.nationalPhoneNumber || '').replace(/[\s()-]/g, '');
  // Google sometimes hands back the website with tracking junk on it
  // (?utm_source=google&utm_medium=gmb...) - strip utm_* so the listing
  // carries the clean website, like the directory's other rows.
  let website = place.websiteUri || '';
  try {
    const u = new URL(website);
    [...u.searchParams.keys()].filter(k => /^utm_/i.test(k)).forEach(k => u.searchParams.delete(k));
    website = u.href;
  } catch { /* not a URL - keep as-is */ }

  return {
    name,
    address: place.formattedAddress || '',
    city: addr.city || city,
    state: addr.state,
    country: 'USA',
    near_city: city, // the metro the person searched - site groups by this
    latitude: place.location ? place.location.latitude : null,
    longitude: place.location ? place.location.longitude : null,
    phone,
    website,
    google_maps_link: place.googleMapsUri || '',
    google_rating: place.rating || null,
    rating: 4, // RULES.md: our listing rating defaults to 4, not Google's
    dietary_type: classification ? classification.dietaryType : null, // a CODE: vegetarian | both | vegan
    liked_items: dishChoice ? dishChoice.dishesText : '',
    notes: noteParts.join(' '),
    photo_url: photoUrl || '',
    is_preferred: false,
  };
}

function printListing(listing) {
  const { DIETARY_LABELS } = require('./classify');
  const typeLabel = listing.dietary_type ? (DIETARY_LABELS[listing.dietary_type] || listing.dietary_type) : null;
  console.log('LISTING PREVIEW (what would be submitted):');
  console.log(`  Name:        ${listing.name}`);
  console.log(`  Address:     ${listing.address}`);
  console.log(`  City/State:  ${listing.city}, ${listing.state}  | Country: ${listing.country}  | Near city: ${listing.near_city}`);
  console.log(`  Coordinates: ${listing.latitude}, ${listing.longitude}`);
  console.log(`  Phone:       ${listing.phone || '(blank)'}`);
  console.log(`  Website:     ${listing.website || '(blank)'}`);
  console.log(`  Rating:      ${listing.rating} (ours; Google's is ${listing.google_rating})`);
  console.log(`  Type:        ${typeLabel || '(UNSET - exception stop)'}  [stored as: ${listing.dietary_type || 'null'}]`);
  console.log(`  Dishes:      ${listing.liked_items || '(MISSING - cannot submit)'}  [stored in liked_items]`);
  console.log(`  Notes:       ${listing.notes || '(none)'}`);
  console.log(`  Photo:       ${listing.photo_url || '(set at submit, from the downloaded photo)'}`);
  console.log(`  Maps:        ${listing.google_maps_link}`);
}

module.exports = { buildListing, printListing, parseAddress, STATE_NAMES };
