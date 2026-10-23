// chainNotes.js - the chain / multiple-locations notes rule
// Sam's rule (updated 2026-10-23):
//  - The agent NEVER picks a location itself - the customer / Sam picks one.
//  - 1 to 3 OTHER locations in the same city: list their addresses in notes.
//  - More than 3 others: do NOT dump a long address list in notes.
//    Summarize with a count instead. A location someone cares about
//    deserves its own listing (own coordinates / phone / directions),
//    submitted separately - a notes dump is not a substitute.
//
// Examples:
//  1 other:  "Multiple locations in New York: 62 W 56th St, New York, NY 10019"
//  5 others: "Multiple locations in New York: 5 other locations - see website for all locations."

function buildChainNotes(city, otherPlaces, website) {
  if (!otherPlaces || otherPlaces.length === 0) return '';

  const addresses = otherPlaces.map(p =>
    typeof p === 'string' ? p : (p.formattedAddress || '')
  ).filter(Boolean);

  if (addresses.length === 0) return '';

  if (addresses.length <= 3) {
    return `Multiple locations in ${city}: ${addresses.join('; ')}`;
  }

  const suffix = website ? ' - see website for all locations.' : '.';
  return `Multiple locations in ${city}: ${addresses.length} other locations${suffix}`;
}

module.exports = { buildChainNotes };
