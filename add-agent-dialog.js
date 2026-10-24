// add-agent-dialog.js - "Add Restaurant" dialog for the Jain Sattvik site,
// powered by the Jain Restaurants Agent endpoint.
//
// SELF-CONTAINED COMPONENT - read this before integrating:
//  * This ONE file is the entire feature: its own styles (every class is
//    prefixed `jra-`), its own DOM, its own logic. It reads NOTHING from
//    the host page's CSS or JS and changes NOTHING in them.
//  * Host integration = 2 lines: a button with [data-jra-open] (or any
//    call to JainAgentDialog.open()) + this script tag. Removing both
//    removes the feature completely - the site is exactly as before.
//  * It talks ONLY to the agent endpoint (config.apiBase): POST /api/run
//    and GET /api/dish-options. No keys live here; keys live server-side.
//  * Theme values are copied from the site's own styles.css (2026-10-23)
//    so the dialog matches the site as it looks now:
//    primary #ff6b35, secondary #f7931e, accent #c1502e, bg #fff8f0,
//    bg-light #fffcf7, text #2d2d2d, border #e0e0e0, success #4caf50,
//    font 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
//    modal: white, radius 20px, shadow 0 20px 60px rgba(0,0,0,.3),
//    backdrop rgba(0,0,0,.6) + blur(4px), slide-in from -30px.
//
// API:  JainAgentDialog.open() / .close() / .config({ apiBase: '...' })
// Local test default apiBase: http://localhost:3737 (the agent's server.js)
// Production: point apiBase at the hosted endpoint (Netlify Function).

(function () {
  if (window.JainAgentDialog) return; // never load twice

  var config = { apiBase: 'http://localhost:3737' };
  var state = { pick: null, optionsLoaded: false };

  var FALLBACK_DISH_OPTIONS = [
    { code: '1', label: 'Some items on the menu can be made Jain' },
    { code: '2', label: 'Jain menu available' },
    { code: '3', label: "Haven't visited - someone would need to add dishes later" },
  ];

  var CSS = '\
.jra-modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);z-index:2000;overflow-y:auto;backdrop-filter:blur(4px);font-family:\'Segoe UI\',Tahoma,Geneva,Verdana,sans-serif;color:#2d2d2d}\
.jra-modal.jra-active{display:flex;align-items:flex-start;justify-content:center;padding:20px;box-sizing:border-box}\
.jra-content{background:#fff;padding:24px;border-radius:20px;max-width:700px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);animation:jraSlideIn .3s ease-out;box-sizing:border-box;margin:auto}\
@keyframes jraSlideIn{from{opacity:0;transform:translateY(-30px)}to{opacity:1;transform:translateY(0)}}\
.jra-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #e0e0e0}\
.jra-title{font-size:24px;font-weight:bold;color:#ff6b35;display:flex;align-items:center;gap:12px;margin:0}\
.jra-close{background:none;border:none;cursor:pointer;color:#666;line-height:1;padding:8px;border-radius:8px;font-size:20px}\
.jra-close:hover{background:#fff8f0;color:#ff6b35}\
.jra-note{background:#fff3e0;border-left:4px solid #f7931e;padding:12px 14px;margin:0 0 16px;font-size:14px;display:flex;gap:12px;border-radius:8px;align-items:flex-start}\
.jra-section{margin-bottom:14px;padding:18px;background:#fffcf7;border-radius:12px}\
.jra-section-title{font-size:18px;color:#ff6b35;margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid #e0e0e0}\
.jra-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}\
.jra-group{margin-bottom:12px}.jra-group:last-child{margin-bottom:0}\
.jra-label{display:block;font-weight:600;margin-bottom:8px;font-size:15px}\
.jra-input,.jra-textarea{width:100%;box-sizing:border-box;padding:12px 16px;border:2px solid #e0e0e0;border-radius:8px;font-size:15px;font-family:inherit;background:#fff;color:#2d2d2d}\
.jra-input:focus,.jra-textarea:focus{outline:none;border-color:#ff6b35}\
.jra-radio{display:block;font-weight:400;margin:8px 0;font-size:15px;cursor:pointer}\
.jra-divider{text-align:center;color:#999;margin:10px 0 4px;font-size:13px;letter-spacing:.4px}\
.jra-btn{padding:12px 24px;border:none;border-radius:8px;cursor:pointer;font-size:15px;font-weight:600;font-family:inherit;display:inline-flex;align-items:center;gap:8px;transition:all .3s cubic-bezier(.4,0,.2,1);text-decoration:none}\
.jra-btn-cta{width:100%;justify-content:center;padding:14px 28px;font-size:16px;background:linear-gradient(135deg,#ff6b35,#f7931e);color:#fff;box-shadow:0 2px 8px rgba(255,107,53,.3)}\
.jra-btn-cta:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(255,107,53,.4)}\
.jra-btn-cta:disabled{opacity:.55;cursor:wait;transform:none}\
.jra-btn-accent{background:#c1502e;color:#fff;box-shadow:0 2px 8px rgba(193,80,46,.3)}\
.jra-btn-accent:hover{transform:translateY(-2px)}\
.jra-btn-success{background:linear-gradient(135deg,#4caf50,#45a049);color:#fff;box-shadow:0 2px 8px rgba(76,175,80,.3)}\
.jra-btn-success:hover{transform:translateY(-2px)}\
.jra-msg{border-radius:12px;padding:12px 16px;margin-top:14px;font-size:15px;line-height:1.5}\
.jra-msg-info{background:#fff3e0;border:2px solid #f7931e;color:#7a4a12}\
.jra-msg-ok{background:linear-gradient(135deg,#d4edda,#c3e6cb);border:2px solid #28a745;color:#155724;font-weight:500}\
.jra-msg-stop{background:#fdecea;border:2px solid #e57373;color:#7a1f1f}\
.jra-card{background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.1);border:1px solid #e0e0e0;overflow:hidden;margin-top:14px}\
.jra-card img{width:100%;max-height:280px;object-fit:cover;display:block}\
.jra-card-body{padding:16px 18px}\
.jra-card h3{margin:0 0 6px;font-size:22px;color:#ff6b35;line-height:1.3}\
.jra-rating{display:inline-block;background:#fff3e0;color:#e55a28;padding:4px 10px;border-radius:8px;font-weight:600;font-size:13.5px;margin-left:8px}\
.jra-liked{background:#fff8f0;padding:12px;border-radius:10px;margin:10px 0;font-size:14px;border-left:4px solid #ff6b35}\
.jra-liked strong{color:#ff6b35;display:block;margin-bottom:6px}\
.jra-card p{margin:5px 0;font-size:15px;color:#2d2d2d}\
.jra-card .jra-sub{color:#666;font-size:14px}\
.jra-badge{display:inline-flex;align-items:center;gap:6px;background:#e8f5e9;color:#4caf50;padding:8px 14px;border-radius:20px;font-size:12px;font-weight:600;margin-top:12px;margin-right:6px}\
.jra-badge.vegan{background:#e1f5e1;color:#2e7d32}\
.jra-badge.both{background:linear-gradient(135deg,#e8f5e9,#e1f5e1);color:#4caf50}\
.jra-place{border:1px solid #e0e0e0;background:#fff;border-radius:12px;padding:12px 14px;margin-top:10px}\
.jra-place p{margin:3px 0;font-size:14.5px}\
.jra-spinner{width:44px;height:44px;margin:10px auto;border:4px solid #e0e0e0;border-top-color:#ff6b35;border-radius:50%;animation:jraSpin 1s linear infinite}\
@keyframes jraSpin{to{transform:rotate(360deg)}}\
.jra-working{text-align:center;color:#666;padding:16px 0 4px;font-size:15px}\
.jra-log{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#999;white-space:pre-wrap;margin-top:14px}\
@media (max-width:640px){.jra-content{padding:20px 16px}.jra-title{font-size:22px}}\
';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild;
  }

  var styleEl = document.createElement('style');
  styleEl.id = 'jra-styles';
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  var overlay = el(
    '<div class="jra-modal" role="dialog" aria-modal="true" aria-label="Add Restaurant">' +
      '<div class="jra-content">' +
        '<div class="jra-header">' +
          '<h2 class="jra-title">' +
            '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 18.5c-3.66-.88-6.36-4.15-6.94-8.5H12v-9l7 3.5v5.5h-6.94c-.58 4.35-3.28 7.62-6.94 8.5z"/></svg>' +
            'Add New Restaurant' +
          '</h2>' +
          '<button class="jra-close" type="button" aria-label="Close">&#10005;</button>' +
        '</div>' +
        '<div class="jra-note">' +
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="#f7931e" style="flex-shrink:0" aria-hidden="true"><path d="M9 11.24V7.5a2.5 2.5 0 0 1 5 0v3.74c1.21.81 2 2.18 2 3.76 0 2.49-2.01 4.5-4.5 4.5S7 17.49 7 15c0-1.58.79-2.95 2-3.76zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>' +
          '<div><strong>Important:</strong> Only add restaurants that serve <strong>some food without onion, garlic, potatoes, carrots, and other root vegetables</strong>.</div>' +
        '</div>' +
        '<div class="jra-section">' +
          '<h3 class="jra-section-title">Find the Restaurant</h3>' +
          '<div class="jra-row">' +
            '<div class="jra-group"><label class="jra-label" for="jra-name">Restaurant Name *</label><input class="jra-input" id="jra-name" type="text" placeholder="e.g., Forno Rosso" autocomplete="off"></div>' +
            '<div class="jra-group"><label class="jra-label" for="jra-city">City *</label><input class="jra-input" id="jra-city" type="text" placeholder="e.g., Chicago" autocomplete="off"></div>' +
          '</div>' +
        '</div>' +
        '<div class="jra-section">' +
          '<h3 class="jra-section-title">Your Jain Dishes</h3>' +
          '<div class="jra-group"><label class="jra-label" for="jra-dishes">Jain dishes you ate - what do you recommend?</label><input class="jra-input" id="jra-dishes" type="text" placeholder="e.g., Jain Pizza; Jain Pasta"></div>' +
          '<div class="jra-divider">- OR CHOOSE AN OPTION -</div>' +
          '<div id="jra-dish-options"></div>' +
        '</div>' +
        '<div class="jra-section">' +
          '<h3 class="jra-section-title">Notes (Optional)</h3>' +
          '<div class="jra-group"><textarea class="jra-textarea" id="jra-notes" rows="2" placeholder="Facts only - e.g., Dough is eggless, sauce is onion/garlic free"></textarea></div>' +
        '</div>' +
        '<button class="jra-btn jra-btn-cta" id="jra-run" type="button">Look Up &amp; Preview</button>' +
        '<div id="jra-out"></div>' +
      '</div>' +
    '</div>'
  );
  document.body.appendChild(overlay);

  var $ = function (id) { return overlay.querySelector('#' + id); };

  function renderDishOptions(options) {
    $('jra-dish-options').innerHTML = options.map(function (o) {
      return '<label class="jra-radio"><input type="radio" name="jra-dishopt" value="' + esc(o.code) + '"> ' + esc(o.label) + '</label>';
    }).join('');
  }
  renderDishOptions(FALLBACK_DISH_OPTIONS);

  function loadDishOptions() {
    if (state.optionsLoaded) return;
    state.optionsLoaded = true;
    fetch(config.apiBase + '/api/dish-options')
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.options && d.options.length) renderDishOptions(d.options); })
      .catch(function () { /* fallback options already shown */ });
  }

  function open() {
    loadDishOptions();
    overlay.classList.add('jra-active');
    document.body.style.overflow = 'hidden';
    var n = $('jra-name'); if (n) n.focus();
  }
  function close() {
    overlay.classList.remove('jra-active');
    document.body.style.overflow = '';
  }

  overlay.querySelector('.jra-close').addEventListener('click', close);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay.classList.contains('jra-active')) close(); });

  function collectPayload(submit) {
    var typed = $('jra-dishes').value.trim();
    var radio = overlay.querySelector('input[name="jra-dishopt"]:checked');
    return {
      name: $('jra-name').value.trim(),
      city: $('jra-city').value.trim(),
      dishesInput: typed || (radio ? radio.value : ''),
      notes: $('jra-notes').value.trim(),
      pick: state.pick,
      submit: !!submit,
    };
  }

  function badgeFor(code) {
    if (code === 'vegan') return '<span class="jra-badge vegan">&#127793; Vegan</span>';
    if (code === 'both') return '<span class="jra-badge both">&#127869;&#65038; Mixed (Jain Options)</span>';
    if (code === 'vegetarian') return '<span class="jra-badge">&#129371; Pure Vegetarian</span>';
    return '';
  }

  function evaluationBlock(res) {
    // EVALUATE, surfaced: the agent's own verdict on its work.
    // Fails are shown in red; the Submit button is hidden when the
    // agent refused (outcome 'needs-review' or a fail verdict).
    // Warnings are shown as an amber list under the preview.
    if (!res.evaluation || !res.evaluation.issues || !res.evaluation.issues.length) return '';
    var fails = res.evaluation.issues.filter(function (i) { return i.severity === 'fail'; });
    var warns = res.evaluation.issues.filter(function (i) { return i.severity === 'warn'; });
    var html = '';
    if (fails.length) {
      html += '<div class="jra-msg jra-msg-stop"><strong>The agent checked its own work and stopped it:</strong><br>' +
        fails.map(function (i) { return '&bull; ' + esc(i.message); }).join('<br>') + '</div>';
    }
    if (warns.length) {
      html += '<div class="jra-msg jra-msg-info"><strong>Agent notes (warnings, not blockers):</strong><br>' +
        warns.map(function (i) { return '&bull; ' + esc(i.message); }).join('<br>') + '</div>';
    }
    return html;
  }

  function render(res) {
    var out = [];
    if (res.evaluation) out.push(evaluationBlock(res));
    if (res.outcome === 'multiple') {
      out.push('<div class="jra-msg jra-msg-info">' + esc(res.message) + '</div>');
      (res.places || []).forEach(function (p, i) {
        out.push(
          '<div class="jra-place"><p><strong>' + (i + 1) + '. ' + esc(p.name) + '</strong></p>' +
          '<p>' + esc(p.address) + '</p>' +
          '<p class="jra-sub">Google ' + esc(p.rating) + ' &#9733; (' + esc(p.reviews) + ' reviews) - ' + esc(p.type) + '</p>' +
          '<button class="jra-btn jra-btn-accent" type="button" data-jra-pick="' + (i + 1) + '" style="margin-top:10px">Use This Location</button></div>'
        );
      });
    } else if (res.outcome === 'preview' || res.outcome === 'submitted') {
      var L = res.listing || {}, c = res.classification || {};
      if (res.outcome === 'submitted') {
        out.push('<div class="jra-msg jra-msg-ok">&#10003; Restaurant added successfully! ' + esc(res.message || '') + '<br><a href="https://jain-restaurants.netlify.app" target="_blank" rel="noopener" style="color:#155724;font-weight:600">View it in the directory &#8599;</a></div>');
      }
      var photoSrc = L.photo_url || (res.photo && res.photo.filename ? config.apiBase + '/photos/' + res.photo.filename : '');
      out.push('<div class="jra-card">');
      if (photoSrc) out.push('<img src="' + esc(photoSrc) + '" alt="">');
      out.push('<div class="jra-card-body"><h3>' + esc(L.name) + '</h3>');
      out.push('<p>' + esc(L.address) + '</p>');
      out.push('<p class="jra-sub">' + esc(L.city) + ', ' + esc(L.state) + ' &middot; ' + esc(L.country) + '<span class="jra-rating">&#9733;&#9733;&#9733;&#9733; ' + esc(L.rating) + '/5</span></p>');
      out.push(badgeFor(L.dietary_type));
      if (!L.dietary_type) out.push('<p style="margin-top:12px"><strong>Type:</strong> not settled yet - a human must decide before this can be submitted.</p>');
      out.push('<div class="jra-liked"><strong>Recommended Dishes:</strong>' + esc(L.liked_items || '(missing - required)') + '</div>');
      if (L.notes) out.push('<p><strong>Additional Notes:</strong> ' + esc(L.notes) + '</p>');
      if (L.phone) out.push('<p><strong>Phone:</strong> ' + esc(L.phone) + '</p>');
      if (L.website) out.push('<p><strong>Website:</strong> ' + esc(L.website) + '</p>');
      out.push('</div></div>');
      if (res.outcome === 'preview') {
        // The agent's own refusal overrides everything: a fail verdict
        // means NO submit button, even with dishes + classification.
        var refused = res.evaluation && res.evaluation.verdict === 'fail';
        var canSubmit = L.liked_items && c.code && !refused;
        out.push(canSubmit
          ? '<button class="jra-btn jra-btn-success" id="jra-submit" type="button" style="width:100%;justify-content:center;margin-top:14px;padding:12px 24px;font-size:16px">Submit to the Directory</button>'
          : (refused
            ? '<div class="jra-msg jra-msg-stop">Submit is disabled: the agent refused this listing (see its checks above). Fix the flagged issue and preview again.</div>'
            : '<div class="jra-msg jra-msg-stop">This preview cannot be submitted yet (dishes are missing, or the type could not be settled).</div>'));
      }
    } else {
      out.push('<div class="jra-msg jra-msg-stop">' + esc(res.message || 'Something stopped the process.') + '</div>');
      if (res.outcome === 'duplicate' && res.places && res.places[0]) {
        out.push('<div class="jra-place"><p><strong>Already listed:</strong> ' + esc(res.places[0].name) + '</p><p>' + esc(res.places[0].address) + '</p></div>');
      }
    }
    if (res.logs && res.logs.length) out.push('<div class="jra-log">' + esc(res.logs.join('\n')) + '</div>');
    $('jra-out').innerHTML = out.join('');

    var picks = overlay.querySelectorAll('[data-jra-pick]');
    picks.forEach(function (b) {
      b.addEventListener('click', function () { state.pick = parseInt(b.getAttribute('data-jra-pick'), 10); run(false); });
    });
    var submitBtn = $('jra-submit');
    if (submitBtn) submitBtn.addEventListener('click', function () { run(true); });
  }

  function run(submit) {
    var payload = collectPayload(submit);
    var runBtn = $('jra-run');
    runBtn.disabled = true;
    $('jra-out').innerHTML = '<div class="jra-working"><div class="jra-spinner"></div>Working - looking it up on Google, checking the directory, fetching the menu and photo...</div>';
    fetch(config.apiBase + '/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {
        $('jra-out').innerHTML = '<div class="jra-msg jra-msg-stop">Could not reach the agent. Please try again in a few minutes.</div>';
      })
      .finally(function () { runBtn.disabled = false; });
  }

  $('jra-run').addEventListener('click', function () { state.pick = null; run(false); });

  // Host-page hook: any element with [data-jra-open] opens the dialog.
  document.querySelectorAll('[data-jra-open]').forEach(function (elm) {
    elm.addEventListener('click', function (e) { e.preventDefault(); open(); });
  });

  window.JainAgentDialog = {
    open: open,
    close: close,
    config: function (opts) { if (opts && opts.apiBase) config.apiBase = String(opts.apiBase).replace(/\/$/, ''); },
  };
})();
