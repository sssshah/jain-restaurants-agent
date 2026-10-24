// messages.js - customer-facing messages
// Sam's rule (2026-10-23): when a restaurant cannot be added, the CUSTOMER
// must see a clear message on the GUI - not a silent failure, not a tech error.
//
// In v1 the "GUI" is the terminal, so index.js prints these.
// In the later public web form, the GUI will show these exact texts
// (in a banner / inline message) - same words, two surfaces.
//
// Every function returns a plain English message naming the restaurant,
// so the customer knows exactly which entry had the problem.

function permanentlyClosed(name, city) {
  return `Sorry, "${name}" in ${city} appears to be permanently closed, so it can't be added to the directory. If you believe this is a mistake, please check the name and city and try again.`;
}

function notFound(name, city) {
  return `Sorry, we couldn't find a restaurant called "${name}" in ${city}. Please check the spelling and city, and try again. If it is a very new restaurant, it may not be listed on Google yet.`;
}

function duplicate(name, city) {
  return `Good news - "${name}" in ${city} is already in the directory, so it doesn't need to be added again. You can find it by searching the directory.`;
}

// Fuzzy-match stop (incident #2): the names are not identical, but the
// core name matches an existing listing in the same city. Name the
// existing listing so the human can judge whether it is the same place.
function possibleDuplicate(name, city, existingNames) {
  const list = (existingNames || []).filter(Boolean);
  const named = list.length ? ` ("${list.join('", "')}")` : '';
  return `Hold on - "${name}" in ${city} looks very similar to an existing listing${named}, so it may already be in the directory under a slightly different name. Please check the directory first - if it is the same restaurant, it doesn't need to be added again.`;
}

function multipleLocations(name, city) {
  return `"${name}" has more than one location in ${city}. Please choose which location you mean from the list below - each location is added separately.`;
}

function lookupFailed(name, city) {
  return `Sorry, something went wrong while looking up "${name}" in ${city}. Please try again in a few minutes.`;
}

// Sam's exact wording (2026-10-23) for when the Google quota cap is hit.
function quotaReached() {
  return 'Google Quota for Map reached, try later.';
}

module.exports = { permanentlyClosed, notFound, duplicate, possibleDuplicate, multipleLocations, lookupFailed, quotaReached };
