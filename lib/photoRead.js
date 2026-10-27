// photoRead.js - read a restaurant photo with the LLM (vision prefill).
//
// Where this fits: the dialog's optional "Upload photo" pre-step. The
// user photographs a signboard, storefront, or menu BEFORE filling the
// form; this call reads the photo and returns what it can see - the
// restaurant name, the city, and dish names visible anywhere in the photo.
// The dialog prefills only fields that are still empty, and shows a
// message when the photo yields nothing usable. It NEVER submits
// anything: the user still reviews, looks up, previews, and submits.
//
// One more LLM call, same provider/key/model as the judge (Muse Spark
// contributor via the Meta Model API). The photo is a PUBLIC scene (a
// signboard/menu) - never private data - and like menu text it goes
// to Meta under the contributor tier. The call is skipped entirely
// when MODEL_API_KEY is missing, and every failure mode returns empty
// fields + a reason instead of throwing, so the dialog can message
// the user rather than crash.
//
// The model is natively multimodal (text + image in), so the photo
// travels as an OpenAI-compatible image_url block. If the endpoint
// ever rejects images for this SKU, that surfaces as an HTTP error
// here and a plain message in the dialog - the feature degrades to
// manual entry, it never blocks the normal flow.
//
// Cost: one vision call per upload, user-initiated only, on a
// browser-downscaled photo - a few hundred to low-thousands of image
// tokens at contributor input pricing, i.e. fractions of a cent.
//
// LIST PHOTOS: when the photo lists several restaurants, the same
// call returns them all as restaurants[] (name + dishes + its full
// description text each). The dialog offers them as a picker so the user
// can choose ONE to add - one restaurant at a time, like every other
// flow. There is deliberately no loop: bulk adds from a list photo
// happen later via the public endpoint (Sam hands Muse the image,
// Muse calls the endpoint once per restaurant), not in the dialog.

const DEFAULT_MODEL = 'muse-spark-1.3-contributor';
const ENDPOINT = 'https://api.meta.ai/v1/chat/completions';
const MAX_IMAGE_CHARS = 2000000; // ~1.5MB after downscaling; the routes cap the body too

function empty(reason) {
  return { name: null, city: null, dishes: [], restaurants: [], reason };
}

// Pure + unit-tested: turn the model's raw reply into fields.
// Never invents: anything outside the contract becomes empty.
function parsePhotoReply(raw) {
  const match = String(raw || '').match(/\{[\s\S]*\}/);
  if (!match) return empty('LLM reply was not JSON.');
  let parsed;
  try { parsed = JSON.parse(match[0]); } catch (err) { return empty('LLM reply was not JSON.'); }
  const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : null;
  const city = typeof parsed.city === 'string' && parsed.city.trim() ? parsed.city.trim() : null;
  const dishes = Array.isArray(parsed.dishes)
    ? parsed.dishes.filter(function (d) { return typeof d === 'string' && d.trim(); }).map(function (d) { return d.trim(); }).slice(0, 10)
    : [];
  // LIST PHOTO: every restaurant in the photo, each with its own
  // dishes and full description note. Entries without a name are dropped; the
  // list is capped so a long screenshot cannot flood the picker.
  const restaurants = Array.isArray(parsed.restaurants)
    ? parsed.restaurants.filter(function (r) { return r && typeof r.name === 'string' && r.name.trim(); }).map(function (r) {
      return {
        name: r.name.trim(),
        dishes: Array.isArray(r.dishes)
          ? r.dishes.filter(function (d) { return typeof d === 'string' && d.trim(); }).map(function (d) { return d.trim(); }).slice(0, 10)
          : [],
        notes: typeof r.notes === 'string' ? r.notes.trim().slice(0, 200) : '',
      };
    }).slice(0, 30)
    : [];
  return { name: name, city: city, dishes: dishes, restaurants: restaurants, reason: '' };
}

async function readPhoto({ image }) {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) return empty('LLM not configured (no MODEL_API_KEY).');
  if (typeof image !== 'string' || !image.startsWith('data:image/') || image.length > MAX_IMAGE_CHARS) {
    return empty('Photo was not a readable image.');
  }
  const model = process.env.LLM_MODEL || DEFAULT_MODEL;
  const effort = process.env.LLM_EFFORT || 'medium';

  const prompt =
    'You read a photo for a restaurant directory prefill.\n' +
    'If the photo shows ONE restaurant (a signboard, storefront, or menu), put it in name/city/dishes and leave restaurants empty.\n' +
    'If the photo LISTS MULTIPLE restaurants, put every one of them in restaurants: each with name (exactly as shown), dishes (food items or specialties named for that restaurant, e.g. "Vegan Sushi"; [] if none are named), and notes (the full description text of the entry as shown, including its Jain instruction and any cuisine description or recommendation; "" only if the entry has no description text at all). Never put addresses, phone numbers, or location counts in notes.\n' +
    'Return JSON ONLY: {"name": string|null, "city": string|null, "dishes": string[], "restaurants": [{"name": string, "dishes": string[], "notes": string}]}.\n' +
    '- "name": the restaurant name visible in the photo, or null if none is visible (or if the photo lists several).\n' +
    '- "city": the city visible in the photo (e.g. on an address line), or null if none is visible.\n' +
    '- "dishes": every dish, food, or drink name visible anywhere in the photo: on a menu, in an ordered-items or "what we ordered" list, in a caption, or on a signboard. Up to 10 names, exactly as shown; [] only if no dish name is visible anywhere.\n' +
    'Do NOT guess: null, [], and "" are the correct answers when unsure. Copy names exactly as shown.\n';

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: image } },
        ] }],
        temperature: 0,
        reasoning_effort: effort,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return empty('LLM call failed (HTTP ' + res.status + ').');
    const data = await res.json();
    const raw = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : '';
    return parsePhotoReply(raw);
  } catch (err) {
    return empty('LLM call error: ' + err.message);
  }
}

module.exports = { readPhoto, parsePhotoReply };
