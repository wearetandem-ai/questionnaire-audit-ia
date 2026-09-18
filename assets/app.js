/* Questionnaire collaborateurs, audit IA. Vanilla JS, aucune dépendance.
   Les réponses brutes sont envoyées à un webhook n8n ; aucun corrigé ni scoring n'existe côté client. */
(function () {
  'use strict';

  var DEFAULT_WEBHOOK = 'https://n8n.wearetandem.ai/webhook/audit-ia/reponse';
  var CONFIG_URL = 'https://n8n.wearetandem.ai/webhook/audit-ia/config';
  var VERSION = '1.0.0';

  var params = new URLSearchParams(location.search);
  var slug = (params.get('c') || 'demo').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'demo';
  var mission = (params.get('m') || '').trim();
  var STORAGE_KEY = 'audit-ia-' + slug;
  var DONE_KEY = STORAGE_KEY + '-done';

  var $app = document.getElementById('app');
  var $progress = document.getElementById('progress');
  var $fill = document.getElementById('progress-fill');
  var $step = document.getElementById('progress-step');
  var $blockLabel = document.getElementById('progress-block');
  var $langToggle = document.getElementById('lang-toggle');
  var $brandSub = document.getElementById('brand-sub');

  var DATA, CFG, lang, state;
  var SCREENS = ['intro', 0, 1, 2, 3, 4, 5];

  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  function t(key, vars) {
    var dict = DATA.ui[lang] || DATA.ui.fr;
    var s = dict[key] !== undefined ? dict[key] : (DATA.ui.fr[key] || key);
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b); else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var tmp = a[i]; a[i] = a[j]; a[j] = tmp; }
    return a;
  }
  function tr(obj, key) { // texte localisé d'un objet {fr:..., en:...} ou d'une question q[lang].enonce
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    return obj[lang] || obj.fr || '';
  }
  function qtext(q, field) { var o = q[lang] || q.fr; var v = o && o[field]; if (v === undefined && q.fr) v = q.fr[field]; return v || ''; }
  function toolLabel(tool) { return (lang === 'en' && tool.label_en) ? tool.label_en : tool.label; }

  // ------------------------------------------------------------------ état
  function newState() {
    state = { response_id: uuid(), started_at: Date.now(), screen: 'intro', answers: {}, order: {}, version: VERSION };
    save();
  }
  function save() { state.saved_at = Date.now(); store.set(STORAGE_KEY, state); }
  var A = function () { return state.answers; };

  // ------------------------------------------------------------------ options et conditions
  function allTools() {
    var extra = (CFG.outils_supplementaires || []).map(function (o) { return { id: String(o.id).replace(/[^a-z0-9_]/gi, '_').toLowerCase(), label: o.label, label_en: o.label_en, extra: true }; });
    var base = DATA.outils.slice();
    var aucun = base.pop(); // « aucun » reste en dernier
    return base.concat(extra).concat([aucun]);
  }
  function optionsFor(q) {
    var opts;
    if (q.options_from === 'directions') {
      opts = (CFG.directions || []).map(function (d) { return { id: d, label: d }; });
      opts.push({ id: lang === 'en' ? 'Other' : 'Autre', label: lang === 'en' ? 'Other / I prefer not to say' : 'Autre / je préfère ne pas répondre' });
    } else if (q.options_from === 'outils') {
      opts = allTools().map(function (o) { return { id: o.id, label: toolLabel(o), exclusif: !!o.exclusif, preciser: !!o.preciser }; });
    } else {
      opts = (q.options || []).map(function (o) { return { id: o.id, label: o[lang] || o.fr, exclusif: !!o.exclusif, preciser: !!o.preciser }; });
    }
    if (q.shuffle) {
      var ids = opts.map(function (o) { return o.id; });
      if (!state.order[q.id] || state.order[q.id].length !== ids.length) state.order[q.id] = shuffle(ids);
      var order = state.order[q.id];
      opts.sort(function (a, b) { return order.indexOf(a.id) - order.indexOf(b.id); });
    }
    if (q.nsp) opts.push({ id: 'nsp', label: t('nsp'), nsp: true });
    return opts;
  }
  function selectedTools() {
    var v = A().U2;
    if (!Array.isArray(v)) return [];
    return v.filter(function (id) { return id !== 'aucun'; });
  }
  function visible(q) {
    var c = q.condition;
    if (!c) return true;
    if (c.config) return !!CFG[c.config];
    if (c.not) { for (var k in c.not) if (A()[k] === c.not[k]) return false; return true; }
    if (c.outils_coches) return selectedTools().length > 0;
    if (c.compte_perso) {
      var u3 = A().U3 || {};
      return selectedTools().some(function (id) { return ['perso_gratuit', 'perso_paye', 'nsp'].indexOf(u3[id]) >= 0; });
    }
    return true;
  }
  function questionsOfBlock(b) { return DATA.questions.filter(function (q) { return q.bloc === b; }); }

  // ------------------------------------------------------------------ rendu
  function setProgress(screen) {
    var idx = SCREENS.indexOf(screen);
    if (screen === 'intro' || screen === 'done' || idx < 0) { $progress.hidden = true; return; }
    $progress.hidden = false;
    var total = SCREENS.length - 1;
    $fill.style.width = Math.round((idx / total) * 100) + '%';
    $step.textContent = t('etape', { n: idx, total: total });
    var bloc = DATA.blocs.filter(function (b) { return b.id === screen; })[0];
    $blockLabel.textContent = bloc ? (bloc[lang] || bloc.fr) : '';
  }
  function updateLangToggle() {
    var langs = CFG.langues_disponibles || ['fr', 'en'];
    if (langs.length < 2) { $langToggle.hidden = true; return; }
    $langToggle.hidden = false;
    $langToggle.textContent = t('langue');
    $langToggle.setAttribute('aria-label', t('langue'));
  }
  function render() {
    document.documentElement.lang = lang;
    updateLangToggle();
    setProgress(state.screen);
    $brandSub.textContent = CFG.entreprise || '';
    if (state.screen === 'intro') return renderIntro();
    if (state.screen === 'done') return renderDone(false);
    renderBlock(state.screen);
  }

  function renderIntro() {
    var h = '<h1>' + esc(tr(DATA.meta.titre)) + '</h1>';
    if (CFG.entreprise) h += '<p class="meta">' + esc(CFG.entreprise) + '</p>';
    h += '<p>' + esc(t('intro_texte')) + '</p>';
    h += '<div class="notice">' + esc(CFG.nominatif ? t('intro_nominatif') : t('intro_pseudo')) + '</div>';
    var compl = CFG.intro_complement && (CFG.intro_complement[lang] || CFG.intro_complement.fr);
    if (compl) h += '<p>' + esc(compl) + '</p>';
    h += '<p class="meta">' + (lang === 'en' ? 'Estimated time: ' : 'Durée estimée : ') + esc(tr(DATA.meta.duree_minutes)) + ' min</p>';
    h += '<div class="actions"><span></span><button type="button" class="btn btn-primary" id="btn-start">' + esc(t('commencer')) + '</button></div>';
    $app.innerHTML = h;
    document.getElementById('btn-start').addEventListener('click', function () { go(0); });
  }

  function renderResume() {
    $progress.hidden = true;
    $app.innerHTML = '<h1>' + esc(tr(DATA.meta.titre)) + '</h1><div class="notice">' + esc(t('reprise')) + '</div>' +
      '<div class="actions"><button type="button" class="btn btn-secondary" id="btn-restart">' + esc(t('recommencer')) + '</button>' +
      '<button type="button" class="btn btn-primary" id="btn-resume">' + esc(t('reprendre')) + '</button></div>';
    document.getElementById('btn-resume').addEventListener('click', function () { if (state.screen === 'intro') state.screen = 0; render(); window.scrollTo(0, 0); });
    document.getElementById('btn-restart').addEventListener('click', function () { newState(); render(); });
  }

  function renderDone(already) {
    $progress.hidden = true;
    var h = '<div class="thanks"><div class="check" aria-hidden="true">✓</div><h1>' + esc(t('merci_titre')) + '</h1><p>' + esc(t('merci_texte')) + '</p>';
    if (CFG.contact) h += '<p class="meta">' + (lang === 'en' ? 'Questions about this survey: ' : 'Une question sur ce questionnaire : ') + esc(CFG.contact) + '</p>';
    h += '</div>';
    $app.innerHTML = h;
  }

  function renderBlock(b) {
    var bloc = DATA.blocs.filter(function (x) { return x.id === b; })[0];
    var h = '<h2>' + esc(bloc[lang] || bloc.fr) + '</h2>';
    if (bloc.intro_key) h += '<p class="block-intro">' + esc(t(bloc.intro_key)) + '</p>';
    if (b === 0) h += '<p class="block-intro">' + esc(CFG.nominatif ? t('intro_nominatif') : t('intro_pseudo')) + '</p>';
    h += '<div class="global-error" id="global-error" role="alert">' + esc(t('champ_requis')) + '</div>';
    var qs = questionsOfBlock(b);
    var IDENTITY = ['prenom', 'N1', 'N2', 'equipe'];
    var n = 0;
    qs.forEach(function (q) {
      var isIdentity = IDENTITY.indexOf(q.id) >= 0;
      if (!isIdentity) n++;
      h += renderQuestion(q, isIdentity ? null : n);
    });
    if (b === 5) h += '<div class="hp" aria-hidden="true"><label>Website<input type="text" id="hp-website" name="website" tabindex="-1" autocomplete="off"></label></div>';
    h += '<div class="actions">';
    h += '<button type="button" class="btn btn-secondary" id="btn-prev">' + esc(t('precedent')) + '</button>';
    h += '<button type="button" class="btn btn-primary" id="btn-next">' + esc(b === 5 ? t('envoyer') : t('suivant')) + '</button>';
    h += '</div>';
    $app.innerHTML = h;
    qs.forEach(function (q) { fillQuestion(q); });
    updateVisibility();
    $app.addEventListener('change', onChange);
    $app.addEventListener('input', onInput);
    document.getElementById('btn-prev').addEventListener('click', function () { go(b === 0 ? 'intro' : b - 1); });
    document.getElementById('btn-next').addEventListener('click', function () { if (validateBlock(b)) { if (b === 5) submit(); else go(b + 1); } });
  }

  function renderQuestion(q, num) {
    var optional = !q.required;
    var label = '<span class="q-num">' + (num ? num + '.' : '') + '</span>' + esc(qtext(q, 'enonce')) +
      (optional ? ' <span class="optional">(' + esc(t('facultatif')) + ')</span>' : '');
    var isText = ['text_court', 'text_long', 'email'].indexOf(q.type) >= 0;
    var h = isText
      ? '<div class="question' + (q.type === 'text_long' ? ' textarea-long' : '') + '" data-q="' + q.id + '"><label class="q-label" for="in-' + q.id + '">' + label + '</label>'
      : '<fieldset class="question" data-q="' + q.id + '"><legend>' + label + '</legend>';
    if (qtext(q, 'aide')) h += '<p class="q-help">' + esc(qtext(q, 'aide')) + '</p>';
    if (qtext(q, 'contexte')) h += '<div class="q-context">' + esc(qtext(q, 'contexte')) + '</div>';
    if (qtext(q, 'question')) h += '<p class="q-question">' + esc(qtext(q, 'question')) + '</p>';
    h += '<div class="q-body" id="body-' + q.id + '"></div>';
    h += '<p class="error-msg">' + esc(t('champ_requis')) + '</p>';
    h += isText ? '</div>' : '</fieldset>';
    return h;
  }

  function fillQuestion(q) {
    var body = document.getElementById('body-' + q.id);
    if (!body) return;
    var val = A()[q.id];
    var h = '';
    if (q.type === 'single') {
      h += '<div class="options">';
      optionsFor(q).forEach(function (o) {
        h += '<label class="opt' + (o.nsp ? ' nsp' : '') + '"><input type="radio" name="' + q.id + '" value="' + esc(o.id) + '"' + (val === o.id ? ' checked' : '') + '><span>' + esc(o.label) + '</span></label>';
      });
      h += '</div>';
    } else if (q.type === 'multi') {
      var arr = Array.isArray(val) ? val : [];
      h += '<div class="options">';
      optionsFor(q).forEach(function (o) {
        var checked = arr.indexOf(o.id) >= 0;
        h += '<label class="opt' + (o.nsp ? ' nsp' : '') + '"><input type="checkbox" name="' + q.id + '" value="' + esc(o.id) + '"' + (checked ? ' checked' : '') + (o.exclusif ? ' data-exclusif="1"' : '') + '><span>' + esc(o.label) + '</span></label>';
        if (o.preciser) {
          var key = q.id + '_' + o.id + '_precision';
          h += '<div class="precision" data-for="' + esc(o.id) + '"' + (checked ? '' : ' hidden') + '><input type="text" maxlength="120" data-precision="' + key + '" placeholder="' + esc(t('preciser')) + '" value="' + esc(A()[key] || '') + '" aria-label="' + esc(t('preciser')) + ' : ' + esc(o.label) + '"></div>';
        }
      });
      h += '</div>';
    } else if (q.type === 'par_outil') {
      var u3 = A().U3 || {};
      var tools = allTools();
      h += '<div class="tool-grid">';
      selectedTools().forEach(function (id) {
        var tool = tools.filter(function (x) { return x.id === id; })[0];
        if (!tool) return;
        h += '<div class="tool-row" data-tool="' + esc(id) + '"><div class="tool-name">' + esc(toolLabel(tool)) + '</div><div class="options">';
        (q.options || []).forEach(function (o) {
          h += '<label class="opt"><input type="radio" name="U3__' + esc(id) + '" value="' + esc(o.id) + '"' + (u3[id] === o.id ? ' checked' : '') + '><span>' + esc(o[lang] || o.fr) + '</span></label>';
        });
        h += '</div></div>';
      });
      h += '</div>';
    } else if (q.type === 'echelle') {
      h += '<div class="scale">';
      for (var i = 1; i <= 5; i++) h += '<label><input type="radio" name="' + q.id + '" value="' + i + '"' + (String(val) === String(i) ? ' checked' : '') + '><span>' + i + '</span></label>';
      h += '</div><div class="scale-ends"><span>' + esc(t('echelle_1')) + '</span><span>' + esc(t('echelle_5')) + '</span></div>';
    } else if (q.type === 'text_long') {
      h += '<textarea id="in-' + q.id + '" name="' + q.id + '" maxlength="3000" placeholder="' + esc(t('texte_placeholder')) + '">' + esc(val || '') + '</textarea>';
    } else if (q.type === 'text_court') {
      h += '<input type="text" id="in-' + q.id + '" name="' + q.id + '" maxlength="300" value="' + esc(val || '') + '" placeholder="' + esc(t('autre_placeholder')) + '">';
    } else if (q.type === 'email') {
      h += '<input type="email" id="in-' + q.id + '" name="' + q.id + '" maxlength="200" value="' + esc(val || '') + '" autocomplete="email" placeholder="prenom.nom@entreprise.com">';
    }
    body.innerHTML = h;
  }

  function updateVisibility() {
    DATA.questions.forEach(function (q) {
      var el = $app.querySelector('[data-q="' + q.id + '"]');
      if (!el) return;
      var v = visible(q);
      el.hidden = !v;
      if (!v) el.classList.remove('invalid');
    });
  }

  // ------------------------------------------------------------------ événements
  function onChange(e) {
    var el = e.target;
    if (!el || !el.name) return;
    var name = el.name;
    if (name.indexOf('U3__') === 0) {
      var tool = name.slice(4);
      A().U3 = A().U3 || {};
      A().U3[tool] = el.value;
    } else if (el.type === 'radio') {
      A()[name] = el.value;
    } else if (el.type === 'checkbox') {
      var q = DATA.questions.filter(function (x) { return x.id === name; })[0];
      var arr = Array.isArray(A()[name]) ? A()[name].slice() : [];
      var opts = optionsFor(q);
      var opt = opts.filter(function (o) { return o.id === el.value; })[0] || {};
      if (el.checked) {
        if (opt.exclusif) arr = [el.value];
        else { arr = arr.filter(function (id) { var o = opts.filter(function (x) { return x.id === id; })[0]; return !(o && o.exclusif); }); arr.push(el.value); }
      } else {
        arr = arr.filter(function (id) { return id !== el.value; });
      }
      A()[name] = arr;
      // resynchroniser les cases (exclusif) et les champs « préciser »
      $app.querySelectorAll('input[name="' + name + '"]').forEach(function (cb) { cb.checked = arr.indexOf(cb.value) >= 0; });
      $app.querySelectorAll('[data-q="' + name + '"] .precision').forEach(function (p) { p.hidden = arr.indexOf(p.getAttribute('data-for')) < 0; });
      if (name === 'U2') {
        // nettoyer U3 des outils décochés puis regénérer
        var u3 = A().U3 || {};
        Object.keys(u3).forEach(function (k) { if (arr.indexOf(k) < 0) delete u3[k]; });
        A().U3 = u3;
        var q3 = DATA.questions.filter(function (x) { return x.id === 'U3'; })[0];
        if (q3) fillQuestion(q3);
      }
    }
    var fs = el.closest('.question'); if (fs) fs.classList.remove('invalid');
    updateVisibility();
    save();
  }
  function onInput(e) {
    var el = e.target;
    if (!el) return;
    if (el.getAttribute('data-precision')) { A()[el.getAttribute('data-precision')] = el.value; save(); return; }
    if (el.name && (el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'email')) { A()[el.name] = el.value; save(); }
  }

  // ------------------------------------------------------------------ validation et navigation
  function answered(q) {
    var v = A()[q.id];
    if (q.type === 'multi') return Array.isArray(v) && v.length > 0;
    if (q.type === 'par_outil') { var u3 = A().U3 || {}; return selectedTools().every(function (id) { return !!u3[id]; }); }
    if (q.type === 'email') return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    return v !== undefined && v !== null && String(v) !== '';
  }
  function validateBlock(b) {
    var first = null;
    questionsOfBlock(b).forEach(function (q) {
      var el = $app.querySelector('[data-q="' + q.id + '"]');
      if (!el || el.hidden) return;
      var ok = q.required ? answered(q) : (q.type === 'email' ? answered(q) : true);
      el.classList.toggle('invalid', !ok);
      if (!ok && !first) first = el;
    });
    var ge = document.getElementById('global-error');
    if (first) {
      if (ge) ge.classList.add('show');
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var input = first.querySelector('input, textarea'); if (input) try { input.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      return false;
    }
    if (ge) ge.classList.remove('show');
    // valeurs « sans objet » pour les questions masquées par la logique conditionnelle
    questionsOfBlock(b).forEach(function (q) {
      if (!visible(q)) {
        if (q.id === 'U6' && A().U1 === 'jamais') A().U6 = 'sans_objet';
        else if (q.id === 'U7') A().U7 = 'sans_objet';
        else if (q.id === 'U2' && A().U1 === 'jamais') { A().U2 = ['aucun']; A().U3 = {}; }
        else if (q.id === 'U9' && A().U1 === 'jamais') A().U9 = 'aucun';
        else if (q.id === 'U4' || q.id === 'U8') A()[q.id] = [];
        else if (q.condition && q.condition.config) delete A()[q.id];
      }
    });
    save();
    return true;
  }
  function go(screen) {
    $app.removeEventListener('change', onChange);
    $app.removeEventListener('input', onInput);
    state.screen = screen;
    save();
    render();
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ envoi
  function submit() {
    var btn = document.getElementById('btn-next');
    var hp = document.getElementById('hp-website');
    btn.disabled = true; btn.textContent = t('envoi_en_cours');
    var payload = {
      response_id: state.response_id,
      client: slug,
      mission_id: (CFG.mission && CFG.mission.mission_id) || '',
      lang: lang,
      duration_s: Math.round((Date.now() - state.started_at) / 1000),
      user_agent: navigator.userAgent,
      website: hp ? hp.value : '',
      form_version: VERSION,
      answers: state.answers
    };
    var url = CFG.webhook || DEFAULT_WEBHOOK;
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json().catch(function () { return {}; }); })
      .then(function () {
        store.set(DONE_KEY, { response_id: state.response_id, at: Date.now() });
        store.del(STORAGE_KEY);
        state.screen = 'done';
        $app.removeEventListener('change', onChange);
        $app.removeEventListener('input', onInput);
        render();
        window.scrollTo(0, 0);
      })
      .catch(function () {
        btn.disabled = false; btn.textContent = t('reessayer');
        var ge = document.getElementById('global-error');
        if (ge) { ge.textContent = t('erreur_envoi'); ge.classList.add('show'); ge.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      });
  }

  // ------------------------------------------------------------------ démarrage
  function fail(msg) { $progress.hidden = true; $app.innerHTML = '<h1>Questionnaire</h1><div class="notice warn">' + esc(msg) + '</div>'; }

  function init() {
    var bust = '?v=' + encodeURIComponent(VERSION);
    var cfgUrl = CONFIG_URL + '?c=' + encodeURIComponent(slug) + (mission ? '&m=' + encodeURIComponent(mission) : '');
    Promise.all([
      fetch('data/questions.json' + bust).then(function (r) { if (!r.ok) throw new Error('questions'); return r.json(); }),
      fetch(cfgUrl).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { return (j && j.ok !== false) ? j : null; }).catch(function () { return null; })
        .then(function (c) { return c || fetch('clients/' + slug + '.json' + bust).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); })
    ]).then(function (res) {
      DATA = res[0]; CFG = res[1];
      if (!CFG || CFG.ok === false) {
        lang = params.get('lang') === 'en' ? 'en' : 'fr';
        return fail(lang === 'en'
          ? 'This link is not valid: the company code is unknown. Please use the link you were sent, or contact the person who sent it.'
          : 'Ce lien n’est pas valide : le code entreprise est inconnu. Utilisez le lien qui vous a été envoyé ou contactez la personne qui l’a diffusé.');
      }
      var langs = CFG.langues_disponibles || ['fr', 'en'];
      var wanted = params.get('lang');
      lang = (wanted && langs.indexOf(wanted) >= 0) ? wanted : (CFG.langue && langs.indexOf(CFG.langue) >= 0 ? CFG.langue : langs[0]);
      if (CFG.mission && CFG.mission.statut && CFG.mission.statut !== 'en_ligne') {
        $brandSub.textContent = CFG.entreprise || '';
        var notOpen = CFG.mission.statut === 'brouillon';
        return fail(lang === 'en'
          ? (notOpen ? 'This survey is not open yet. Please use your link again on the announced date.' : 'This survey is now closed. Thank you for your interest.')
          : (notOpen ? 'Ce questionnaire n’est pas encore ouvert. Revenez avec votre lien à la date indiquée.' : 'Ce questionnaire est désormais clôturé aux réponses. Merci de votre intérêt.'));
      }
      $langToggle.addEventListener('click', function () {
        var idx = langs.indexOf(lang);
        lang = langs[(idx + 1) % langs.length];
        if (state && state.screen !== 'intro' && state.screen !== 'done') {
          $app.removeEventListener('change', onChange); $app.removeEventListener('input', onInput);
        }
        render();
      });

      if (params.has('reset')) { store.del(STORAGE_KEY); store.del(DONE_KEY); }
      var done = store.get(DONE_KEY);
      var existing = store.get(STORAGE_KEY);
      if (done && !params.has('reset')) { state = { screen: 'done', answers: {}, order: {} }; updateLangToggle(); $brandSub.textContent = CFG.entreprise || ''; return renderDone(true); }
      if (existing && existing.answers && Object.keys(existing.answers).length > 0 && existing.version === VERSION) {
        state = existing; updateLangToggle(); $brandSub.textContent = CFG.entreprise || ''; return renderResume();
      }
      newState();
      render();
    }).catch(function () {
      fail('Le questionnaire n’a pas pu être chargé. Rechargez la page ; si le problème persiste, contactez la personne qui vous a envoyé le lien.');
    });
  }
  init();
})();
