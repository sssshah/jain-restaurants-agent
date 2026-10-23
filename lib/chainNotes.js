// chainNotes.js - the chain / multiple-locations notes rule
// Sam's rule (simplified 2026-10-23 evening, supersedes the tiered
// address-list version from earlier the same day):
//  - The agent NEVER picks a location itself - the customer / Sam picks one.
//  - We do NOT process every location, and we do NOT list the other
//    locations' addresses in notes. Flooding is a concern in BOTH the
//    directory and the notes. The listing's job is a SIGNAL: this chain
//    has Jain-friendly food in this city. Anyone who wants the other
//    outlets uses the website link already on the card.
//  - So whenever there are OTHER same-city locations, notes get ONE
//    standard line, regardless of count:
//      "Multiple locations in <city>: N other location(s) - see website for all locations"
//
// Example (1 other or 9 others - same shape):
//  "Multiple locations in Chicago: 1 other location - see website for all locations"
//  "Multiple locations in New York: 5 other locations - see website for all locations"

function buildChainNotes(city, otherPlaces, website) {
  if (!otherPlaces || otherPlaces.length === 0) return '';
  const n = otherPlaces.length;
  return `Multiple locations in ${city}: ${n} other location${n === 1 ? '' : 's'} - see website for all locations`;
}

module.exports = { buildChainNotes };
