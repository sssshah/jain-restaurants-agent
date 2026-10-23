// loadEnv.js - a tiny hand-rolled .env loader
// Why hand-rolled? So you see there is no magic.
// A .env file is just lines of KEY=value. We read the file,
// split each line on the first '=', and put it in process.env.
// We NEVER print the values.
//
// We load TWO files:
//   .env           - the Google Places key (Sam added this himself)
//   .env.supabase  - the Supabase URL + anon key (added 2026-10-23 so Muse
//                    could create the variables without ever reading .env,
//                    which contains the Google key)

const fs = require('fs');
const path = require('path');

function loadOneFile(filename) {
  const envPath = path.join(__dirname, '..', filename);
  if (!fs.existsSync(envPath)) return false;

  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes if the value was copied from JS code like
    // export const X = "value";  - in .env, quotes are NOT wanted.
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (value.endsWith(';')) value = value.slice(0, -1); // copied JS semicolon
    process.env[key] = value;
  }
  return true;
}

function loadEnv() {
  const foundMain = loadOneFile('.env');
  loadOneFile('.env.supabase');
  loadOneFile('.env.llm');
  return foundMain;
}

module.exports = { loadEnv };
