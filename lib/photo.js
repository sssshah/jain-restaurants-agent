// photo.js - Slice 4: fetch the restaurant's photo from Google Places
//
// Two calls, deliberately kept OUT of the lookup (so lookups stay cheap):
//   1. Place Details: GET places.googleapis.com/v1/places/{id}
//      FieldMask: photos  -> first photo's resource name + author info
//      (counts against the GetPlaceRequest quota)
//   2. Photo Media:  GET places.googleapis.com/v1/{photoName}/media
//      ?maxWidthPx=1600&key=...  (redirects to the image bytes;
//      counts against the GetPhotoMediaRequest quota)
// Saves into photos/ (gitignored). The directory form/bucket accept
// JPG/PNG/WebP up to 5MB - we verify size + type before keeping it.

const fs = require('fs');
const path = require('path');

function slugify(name) {
  return String(name || 'restaurant').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'restaurant';
}

async function fetchPhoto(placeId, placeName, apiKey) {
  // 1. Place Details -> photos list
  const detailsRes = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'photos' },
  });
  const details = await detailsRes.json().catch(() => ({}));
  if (!detailsRes.ok) throw new Error(`Place Details error ${detailsRes.status}: ${JSON.stringify(details).slice(0, 300)}`);
  const photos = details.photos || [];
  if (photos.length === 0) return { status: 'none', note: 'Google has no photos for this place.' };
  const photoName = photos[0].name; // e.g. places/{id}/photos/{ref}
  const author = (photos[0].authorAttributions && photos[0].authorAttributions[0] && photos[0].authorAttributions[0].displayName) || '';

  // 2. Photo media -> image bytes (fetch follows the redirect for us)
  const mediaRes = await fetch(`https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1600&key=${encodeURIComponent(apiKey)}`, { redirect: 'follow' });
  if (!mediaRes.ok) throw new Error(`Photo media error ${mediaRes.status}`);
  const contentType = mediaRes.headers.get('content-type') || '';
  const buffer = Buffer.from(await mediaRes.arrayBuffer());
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  if (buffer.length > 5 * 1024 * 1024) return { status: 'too-big', note: `Photo is ${(buffer.length / 1048576).toFixed(1)}MB - over the 5MB limit.` };
  if (!/image\/(jpeg|png|webp)/.test(contentType)) return { status: 'bad-type', note: `Unexpected photo type: ${contentType}` };

  // Local runs save under the project photos/ dir. On a hosted function
  // (Netlify) the bundle dir is read-only, so fall back to the OS temp
  // dir - the file is uploaded to Supabase at submit time either way,
  // so where it briefly lives does not matter.
  const os = require('node:os');
  const filename = `${slugify(placeName)}.${ext}`;
  let dir = path.join(__dirname, '..', 'photos');
  let filePath = path.join(dir, filename);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, buffer);
  } catch {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jra-photo-'));
    filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, buffer);
  }
  return { status: 'ok', filePath, filename, bytes: buffer.length, contentType, author, note: `Saved photos/${filename} (${(buffer.length / 1024).toFixed(0)} KB)` };
}

module.exports = { fetchPhoto, slugify };
