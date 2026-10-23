// classify.js - dietary classification, Sam's simplified rules (2026-10-23)
//
// Key insight from Sam: menus almost NEVER say "Jain". So we do NOT waste
// LLM cycles trying to figure out which dishes could be made Jain.
// Dishes come from the PERSON adding the place (typed, or options 1/2/3).
//
// Classification is mostly a CODE job (cheap keyword / signal checks):
//  1. Jain menu / Jain legend found in menu text  -> flag it (dishes option 2 territory)
//  2. "vegan" in the restaurant NAME or in its Google place type -> Vegan
//  3. Any fish / chicken / meat (etc.) in the menu -> Mixed (flat rule)
//  4. Menu present, no meat words, vegetarian signals -> Pure Veg (proposal)
//  5. None of the above settles it -> UNKNOWN = exception stop, human decides
//
// An LLM (Muse Spark contributor) is reserved for rare messy cases only:
// e.g. a menu that is a scanned image / awkward PDF where plain text
// scanning fails. It is NOT on the routine path.

const MEAT_WORDS = [
  'chicken', 'fish', 'pork', 'beef', 'lamb', 'shrimp', 'prawn', 'prawns',
  'seafood', 'salmon', 'tuna', 'turkey', 'duck', 'bacon', 'ham', 'steak',
  'meat', 'crab', 'lobster', 'oyster', 'sausage', 'pepperoni', 'anchovy',
  'prosciutto', 'salami', 'mortadella', 'pancetta', 'guanciale', 'nduja',
  'bresaola', 'capicola', 'soppressata', 'chorizo', 'meatball', 'meatballs',
];

function containsWord(text, word) {
  return new RegExp(`\\b${word}\\b`, 'i').test(text || '');
}

function classify({ name, primaryType, types, menuText }) {
  const evidence = [];
  const menu = menuText || '';
  const hasMenu = menu.trim().length > 0;

  // 1. Jain mentioned in the menu at all?
  const jainInMenu = containsWord(menu, 'jain');
  if (jainInMenu) evidence.push('Menu mentions "Jain" (Jain menu / legend found)');

  // 2. Vegan from name or Google type (Sam's rule: vegan places usually say so)
  const typeText = [primaryType || '', ...(types || [])].join(' ');
  if (/vegan/i.test(name || '') || /vegan/i.test(typeText)) {
    evidence.push('"Vegan" in the name or Google place type');
    return { dietaryType: 'vegan', jainInMenu, evidence, confidence: 'high', needsHuman: false };
  }

  if (hasMenu) {
    // 3. Any meat / fish / chicken -> Mixed, flat
    const foundMeat = MEAT_WORDS.filter(w => containsWord(menu, w));
    if (foundMeat.length > 0) {
      evidence.push(`Menu contains: ${foundMeat.slice(0, 6).join(', ')} -> Mixed (flat rule)`);
      return { dietaryType: 'both', jainInMenu, evidence, confidence: 'high', needsHuman: false };
    }
    // 4. No meat in a real menu + vegetarian evidence IN THE MENU TEXT
    // ITSELF -> Pure Veg proposal. (Google place "types" no longer count:
    // after the Forno Rosso CSS-menu bug, Pure Veg - the strongest claim
    // we make - requires positive evidence from actual menu text.)
    if (/vegetarian|pure veg|veg only/i.test(menu)) {
      evidence.push('Menu has no meat/fish/chicken, and the menu text itself says vegetarian');
      return { dietaryType: 'vegetarian', jainInMenu, evidence, confidence: 'medium', needsHuman: false };
    }
    evidence.push('Menu fetched, but no meat words and no clear vegetarian signal either');
  } else {
    evidence.push('No menu text yet (menu fetch is Slice 3) - name/type alone do not settle it');
  }

  // 5. Unsettled
  return { dietaryType: null, jainInMenu, evidence, confidence: 'none', needsHuman: true };
}

// The database stores SHORT CODES (verified by the --schema probe against
// the live directory, 2026-10-23): vegetarian | both | vegan.
// The website turns them into the labels diners see.
const DIETARY_LABELS = {
  vegetarian: 'Pure Veg (vegetarian)',
  both: 'Mixed - serves veg and non-veg, Jain options possible (both)',
  vegan: 'Vegan',
};

module.exports = { classify, MEAT_WORDS, DIETARY_LABELS };
