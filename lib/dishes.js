// dishes.js - the dishes options, displayed when a restaurant is inserted
// (Sam's design, 2026-10-23: a submitter who does not know specific dishes
//  should get preset choices, not a blank required field.)
//
// In the CLI these show as a menu. In the later public web form, these
// same options will be radio buttons + a free-text box for real dishes.

const DISH_OPTIONS = [
  { code: '1', label: 'Some items on the menu can be made Jain', dishesText: 'Some items on the menu can be made Jain', notVisited: false },
  { code: '2', label: 'Jain menu available', dishesText: 'Full Jain Menu available', notVisited: false },
  { code: '3', label: "Haven't visited - someone would need to add dishes later", dishesText: 'Some items on the menu can be made Jain', notVisited: true },
];

function printDishOptions() {
  console.log('Dishes - pick one option, or type the actual dishes:');
  for (const opt of DISH_OPTIONS) {
    console.log(`  ${opt.code}. ${opt.label}`);
  }
  console.log('  Or: "Jain Pizza; Jain Pasta"  (actual dishes, semicolon-separated)');
  console.log('');
}

// Takes what the user typed and returns the canonical listing values.
// - '1' / '2' / '3' expand to the standard text above
// - anything else is treated as a real dish list, used as-is
// Option 3 also sets notVisited=true - that flag goes in notes/status,
// NOT in the dishes text shown to diners.
function normalizeDishes(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  const match = DISH_OPTIONS.find(o => o.code === trimmed);
  if (match) {
    return { dishesText: match.dishesText, notVisited: match.notVisited, sourceOption: match.code };
  }
  return { dishesText: trimmed, notVisited: false, sourceOption: null };
}

module.exports = { DISH_OPTIONS, printDishOptions, normalizeDishes };
