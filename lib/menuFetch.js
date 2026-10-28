// menuFetch.js - Slice 3a: get the menu TEXT from the restaurant's own website
//
// Plain code, $0: fetch the homepage, look for menu links, fetch the best
// menu page, strip the HTML down to text. Classification (classify.js)
// then scans this text for Jain / meat / vegetarian signals.
//
// Returns: { status, menuText, menuUrl, pdfUrls, note }
//   status: 'ok' (got usable text) | 'pdf-only' (menu is a PDF - LLM territory)
//           | 'none' (no website / no menu found / fetch failed)
// PDFs are NOT parsed here on purpose: that is the rare case the LLM
// (Muse Spark, lib/llm.js) exists for.

const MAX_TEXT = 30000; // chars kept - plenty for a menu, keeps scans fast

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function findLinks(html, baseUrl) {
  const links = [];
  const re = /href=["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { links.push(new URL(m[1], baseUrl).href); } catch { /* skip bad href */ }
  }
  return links;
}

async function fetchPage(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (JainRestaurantsAgent/1.0)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const contentType = res.headers.get('content-type') || '';
  return { html: await res.text(), finalUrl: res.url || url, contentType };
}

const NOT_A_PAGE = /\.(css|js|mjs|png|jpe?g|gif|svg|ico|woff2?|ttf|map|xml)(\?|$)/i;

// A URL is a MENU PAGE candidate only if its path has a real "menu"
// segment - NOT just the letters m-e-n-u inside a filename.
// (Bug 2026-10-23: a Wix stylesheet named DropDownMenu....min.css was
// accepted as the "menu" for Forno Rosso, and its CSS text produced a
// false Pure Veg classification on a live submit.)
function isMenuPath(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (NOT_A_PAGE.test(path)) return false;
    if (/dropdownmenu/.test(path)) return false;
    return /(^|\/)menus?(\/|$|\.html?$)/.test(path) || /\/menu-/.test(path);
  } catch { return false; }
}

const FOOD_WORDS = ['pizza', 'pasta', 'salad', 'appetizer', 'appetizers', 'entree', 'entrees', 'main course', 'dessert', 'desserts', 'sandwich', 'soup', 'sides', 'beverages', 'drinks', 'chef', 'served with', 'topped with'];

// Text only counts as a menu if it actually looks like one: at least 2
// food signals, or prices. Stylesheet/code text fails this test.
function looksLikeMenu(text) {
  const t = String(text || '').toLowerCase();
  const hits = FOOD_WORDS.filter(w => t.includes(w)).length;
  const hasPrices = /\$\s?\d/.test(t);
  return hits >= 2 || (hits >= 1 && hasPrices);
}

// Incident #10 (2026-10-28, Sforno): JavaScript-rendered navigation
// (Wix etc.) puts no menu link in the raw homepage HTML, so a real
// menu page at the conventional address is never requested. These are
// the same-origin addresses to probe directly when no link qualifies.
// Pure (no network) so it is unit-testable.
function menuProbeUrls(baseUrl) {
  try {
    const origin = new URL(baseUrl).origin;
    return [`${origin}/menu`, `${origin}/menus`];
  } catch { return []; }
}

async function fetchMenu(websiteUri) {
  if (!websiteUri) return { status: 'none', menuText: '', menuUrl: null, pdfUrls: [], note: 'No website on the Google listing.' };
  try {
    const home = await fetchPage(websiteUri);
    const links = findLinks(home.html, home.finalUrl);

    const pdfUrls = [...new Set(links.filter(u => /\.pdf(\?|$)/i.test(u)))];
    const menuLinks = [...new Set(links.filter(u => isMenuPath(u)))];

    // Best candidate first: a link that says both "menu" and food-ish words
    const score = u => (/food|dinner|lunch|cuisine/i.test(u) ? 2 : 0) + (/menu/i.test(u) ? 1 : 0);
    menuLinks.sort((a, b) => score(b) - score(a));

    for (const link of menuLinks.slice(0, 2)) {
      try {
        const page = await fetchPage(link);
        if (!/text\/html|application\/xhtml/.test(page.contentType)) continue; // never CSS/JS
        const text = htmlToText(page.html);
        if (text.length > 400 && looksLikeMenu(text)) {
          return { status: 'ok', menuText: text.slice(0, MAX_TEXT), menuUrl: page.finalUrl, pdfUrls, note: `Menu page found: ${page.finalUrl}` };
        }
      } catch { /* try the next link */ }
    }

    // No link qualified: probe the conventional menu addresses directly,
    // under the SAME gates as a linked candidate (real HTML page, over
    // 400 chars, looks like a menu). This is what reaches JS-rendered
    // sites like Sforno, whose /menu page exists but whose navigation
    // never appears in the raw homepage HTML.
    for (const probe of menuProbeUrls(home.finalUrl)) {
      try {
        const page = await fetchPage(probe);
        if (!/text\/html|application\/xhtml/.test(page.contentType)) continue;
        const text = htmlToText(page.html);
        if (text.length > 400 && looksLikeMenu(text)) {
          return { status: 'ok', menuText: text.slice(0, MAX_TEXT), menuUrl: page.finalUrl, pdfUrls, note: `Menu page found by probing: ${page.finalUrl}` };
        }
      } catch { /* try the next probe */ }
    }

    // Fall back to the homepage text itself - ONLY if it looks like a menu
    const homeText = htmlToText(home.html);
    if (homeText.length > 400 && looksLikeMenu(homeText)) {
      return { status: 'ok', menuText: homeText.slice(0, MAX_TEXT), menuUrl: home.finalUrl, pdfUrls, note: 'No separate menu page - homepage text looks like a menu.' };
    }
    if (pdfUrls.length > 0) {
      return { status: 'pdf-only', menuText: '', menuUrl: null, pdfUrls, note: 'Menu appears to be a PDF only - this is the rare LLM case.' };
    }
    return { status: 'none', menuText: '', menuUrl: null, pdfUrls: [], note: 'No menu found on the website.' };
  } catch (err) {
    return { status: 'none', menuText: '', menuUrl: null, pdfUrls: [], note: `Website fetch failed: ${err.message}` };
  }
}

module.exports = { fetchMenu, htmlToText, isMenuPath, looksLikeMenu, menuProbeUrls };
