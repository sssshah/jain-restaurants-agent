// agent.js - the hosted endpoint for the Jain Restaurants Agent.
//
// ONE function, THREE routes (see netlify.toml redirect /api/*):
//   POST /api/run           -> runAgent(input)  (preview or submit)
//   GET  /api/dish-options  -> the dishes options from lib/dishes.js
//   POST /api/read-photo    -> readPhoto({ image }) (dialog prefill)
//
// This is the production twin of server.js: same brain (lib/runAgent),
// same JSON contract, same customer messages. The website dialog and
// (later) the iOS screen call THIS instead of localhost:3737 - they
// only change apiBase, nothing else.
//
// KEYS: never in this file, never in the browser. They live in the
// Netlify site's Environment Variables (dashboard) and arrive here
// as process.env. loadEnv() is still called: on Netlify there are no
// .env files in the bundle, so it is a harmless no-op; locally (via
// `netlify dev`) it loads the real .env files the same way server.js
// does. Env names must match what runAgent reads:
//   GOOGLE_PLACES_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY,
//   MODEL_API_KEY, LLM_MODEL, LLM_EFFORT
//
// KNOWN HOSTED DIFFERENCES (honest, by design):
// - Preview photos: locally the dialog shows the downloaded photo via
//   /photos/<file>. A function cannot serve a file it downloaded into
//   a temp dir, so preview responses strip photo.filename - the dialog
//   then shows the card without an image until submit, when the
//   Supabase photo_url appears. Nothing is lost; the photo still
//   uploads at submit time.
// - Audit log: runLog appends to runs.log.jsonl locally, but a
//   function's disk is ephemeral - logRun already catches write
//   failures, so logging silently no-ops here. The durable audit
//   trail for hosted runs is the Supabase row itself.
// - Time limit: Netlify functions default to 10s. A full add (lookup
//   + menu + photo) usually fits, but a slow menu, an LLM-judge
//   case, or a photo read can exceed it. If timeouts appear in
//   testing, the fix is a longer limit (Pro plan, 26s) - not a code
//   change here.

const { loadEnv } = require('../../lib/loadEnv');
const { runAgent } = require('../../lib/runAgent');
const { DISH_OPTIONS } = require('../../lib/dishes');
const { readPhoto } = require('../../lib/photoRead');

loadEnv();

// Only these origins may call the endpoint from a browser. The
// production site, plus localhost so Sam can test the dialog
// against the hosted endpoint from his own machine.
const ALLOWED_ORIGINS = new Set([
  'https://jain-restaurants.netlify.app',
  'http://localhost:3737',
]);

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://jain-restaurants.netlify.app',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function json(statusCode, origin, obj) {
  return { statusCode, headers: corsHeaders(origin), body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  const origin = event.headers && (event.headers.origin || event.headers.Origin) || '';
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  }

  const path = (event.path || '') + ' ' + (event.rawUrl || '');
  try {
    if (event.httpMethod === 'GET' && path.includes('dish-options')) {
      return json(200, origin, { options: DISH_OPTIONS });
    }
    if (event.httpMethod === 'POST' && path.includes('read-photo')) {
      // Photo prefill has its own body cap (2MB for a downscaled
      // image); it must be checked BEFORE the generic run branch.
      const body = event.body || '{}';
      if (body.length > 2000000) {
        return json(413, origin, { name: null, city: null, dishes: [], reason: 'Photo too large.' });
      }
      const input = JSON.parse(body);
      const result = await readPhoto({ image: input.image });
      return json(200, origin, result);
    }
    if (event.httpMethod === 'POST') {
      const body = event.body || '{}';
      if (body.length > 100000) {
        return json(413, origin, { outcome: 'blocked', message: 'Request too large.' });
      }
      const input = JSON.parse(body);
      input.via = 'web-function';
      const result = await runAgent(input, () => {});
      // See "Preview photos" above: a function cannot serve its temp
      // download, so do not send the dialog a filename it cannot load.
      if (result.photo) result.photo = { status: result.photo.status, filename: null };
      return json(200, origin, result);
    }
    return json(404, origin, { outcome: 'blocked', message: 'Unknown route.' });
  } catch (err) {
    return json(500, origin, { outcome: 'blocked', message: 'Server error: ' + err.message });
  }
};
