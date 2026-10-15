// Browser editor for questions and solutions, with picture support.
// Pictures can be pasted (Ctrl/Cmd+V), dragged in, or picked from a file/camera, in the
// question, in each answer choice, and in the solution.
import { rich, plain, imageIds } from './richtext.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DIFFICULTY = ['', 'Easy', 'Easy-Medium', 'Medium', 'Medium-Hard', 'Hard'];
const FREQUENCY = { very_common: 'Very common', common: 'Common', moderate: 'Moderate', less_common: 'Less common', unknown: 'Not classified' };
const STATUSES = ['approved', 'draft', 'human_review', 'archived'];
const MAX_EDGE = 1600;              // longest side after downscaling, in px
const TARGET_BYTES = 1.5 * 1024 * 1024;

/** Downscale big screenshots/photos so uploads stay fast and the database small. */
export async function prepareImage(file) {
  if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.type)) throw new Error('Use a PNG, JPG, GIF or WebP image.');
  if (file.type === 'image/gif') return file;               // keep animation
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { return file; }
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size <= TARGET_BYTES) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const toBlob = (type, q) => new Promise(r => canvas.toBlob(r, type, q));
  let out = await toBlob('image/png');                       // PNG keeps graph lines/text crisp
  if (out && out.size > TARGET_BYTES) out = await toBlob('image/jpeg', 0.86);
  return out || file;
}

export async function uploadImage(file, endpoint = '/api/admin/images') {
  const blob = await prepareImage(file);
  const r = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': blob.type || 'application/octet-stream' }, body: blob });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Upload failed (HTTP ${r.status})`);
  return d; // { id, url, token }
}

/**
 * A text box that accepts pictures. Returns { el, get(), set(v), onChange(fn) }.
 * The picture is stored as a token in the text; thumbnails below make it easy to see/remove.
 */
function richField({ value = '', rows = 4, placeholder = '', compact = false, onChange = () => {}, onError = alert }) {
  const el = document.createElement('div');
  el.className = 'rf' + (compact ? ' rfCompact' : '');
  el.innerHTML = `
    <div class="rfBox">
      <textarea class="input rfText" rows="${rows}" placeholder="${esc(placeholder)}"></textarea>
      <div class="rfDrop">Drop image to add</div>
    </div>
    <div class="rfBar">
      <button type="button" class="btn alt rfAdd">🖼 Add image</button>
      <span class="rfHint small muted">or paste a screenshot (Ctrl/⌘+V) or drag one in. A <code>![image](…)</code> line is the picture; cut/paste that line to move it.</span>
      <span class="rfStatus small"></span>
      <input type="file" accept="image/*" multiple hidden>
    </div>
    <div class="rfThumbs"></div>`;
  const ta = el.querySelector('textarea'), status = el.querySelector('.rfStatus'), thumbs = el.querySelector('.rfThumbs');
  const fileInput = el.querySelector('input[type=file]'), box = el.querySelector('.rfBox');
  ta.value = value;

  const renderThumbs = () => {
    const ids = [...new Set(imageIds(ta.value))];
    thumbs.innerHTML = ids.map(id => `<span class="rfThumb"><img src="/api/images/${id}" alt=""><button type="button" class="rfRemove" data-id="${id}" title="Remove image" aria-label="Remove image">×</button></span>`).join('');
  };
  const changed = () => { renderThumbs(); onChange(ta.value); };
  const insert = (text) => {
    const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
    const before = ta.value.slice(0, s), after = ta.value.slice(e);
    const pad1 = before && !before.endsWith('\n') ? '\n' : '', pad2 = after && !after.startsWith('\n') ? '\n' : '';
    ta.value = before + pad1 + text + pad2 + after;
    const pos = (before + pad1 + text).length; ta.setSelectionRange(pos, pos);
    changed();
  };
  const addFiles = async (files) => {
    const list = [...files].filter(f => f.type.startsWith('image/'));
    if (!list.length) return;
    for (const f of list) {
      status.textContent = 'Uploading…'; status.className = 'rfStatus small muted';
      try { const up = await uploadImage(f); insert(up.token); status.textContent = ''; }
      catch (err) { status.textContent = ''; onError(err.message); }
    }
  };

  el.querySelector('.rfAdd').onclick = () => fileInput.click();
  fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ''; };
  ta.addEventListener('input', changed);
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addFiles(files); }       // plain-text pastes behave normally
  });
  for (const ev of ['dragenter', 'dragover']) box.addEventListener(ev, (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); box.classList.add('dragging'); } });
  for (const ev of ['dragleave', 'drop']) box.addEventListener(ev, () => box.classList.remove('dragging'));
  box.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
  thumbs.addEventListener('click', (e) => {
    const b = e.target.closest('.rfRemove'); if (!b) return;
    ta.value = ta.value.replace(new RegExp(`\\n?!\\[[^\\]]*\\]\\(img:${b.dataset.id}\\)\\n?`, 'g'), '\n').replace(/^\n+|\n+$/g, '');
    changed();
  });
  renderThumbs();
  return { el, get: () => ta.value.trim(), set: (v) => { ta.value = v; changed(); }, focus: () => ta.focus() };
}

export async function openQuestionEditor(q = {}, { api, onSaved = () => {} } = {}) {
  document.getElementById('qEditor')?.remove();
  const isEdit = !!q.id;
  const isGrid = isEdit ? !(q.choices && q.choices.length) : false;
  let meta = { domains: [], skills: [] };
  try { meta = await api('/api/question-filters'); } catch { /* autocomplete is optional */ }

  const layer = document.createElement('div');
  layer.className = 'modalBackdrop'; layer.id = 'qEditor';
  layer.innerHTML = `
  <div class="modal card qEd" role="dialog" aria-modal="true" aria-label="${isEdit ? 'Edit question' : 'New question'}">
    <div class="qEdHead">
      <div><div class="eyebrow">QUESTION BANK</div><h2>${isEdit ? 'Edit question' : 'New question'}${isEdit ? ` <span class="qEdId">${esc(q.id)}</span>` : ''}</h2></div>
      <div class="qEdHeadActions"><button type="button" class="btn alt" data-act="cancel">Cancel</button><button type="button" class="btn btnPrimary" data-act="save">${isEdit ? 'Save changes' : 'Create question'}</button><button type="button" class="iconBtn" data-act="cancel" aria-label="Close">×</button></div>
    </div>
    <div class="qEdError error" hidden></div>
    <div class="qEdBody">
      <div class="qEdForm">
        <section class="qEdSec">
          <h3>Details</h3>
          <div class="qEdGrid">
            <label class="label">Section<select class="input" id="qeSection"><option value="math">Math</option><option value="reading_writing">Reading &amp; Writing</option></select></label>
            <label class="label">Difficulty<select class="input" id="qeDifficulty">${[1,2,3,4,5].map(d => `<option value="${d}">${DIFFICULTY[d]}</option>`).join('')}</select></label>
            <label class="label">Domain<input class="input" id="qeDomain" list="qeDomains" placeholder="e.g. Algebra"></label>
            <label class="label">Skill<input class="input" id="qeSkill" list="qeSkills" placeholder="e.g. math.algebra.linear_equations_1var"></label>
            <label class="label">Status<select class="input" id="qeStatus">${STATUSES.map(s => `<option value="${s}">${s === 'approved' ? 'approved (visible to students)' : s}</option>`).join('')}</select></label>
            <label class="label">Source<input class="input" id="qeSource" placeholder="admin"></label>
          </div>
          <datalist id="qeDomains">${[...new Set((meta.domains || []).map(d => d.domain))].map(d => `<option value="${esc(d)}">`).join('')}</datalist>
          <datalist id="qeSkills">${[...new Set((meta.skills || []).map(s => s.skill))].map(s => `<option value="${esc(s)}">`).join('')}</datalist>
          <details class="qEdMore"><summary>More metadata</summary><div class="qEdGrid">
            <label class="label">Topic frequency<select class="input" id="qeFrequency">${Object.entries(FREQUENCY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
            <label class="label">Verified previous-exam occurrences<input class="input" id="qeOcc" type="number" min="0"></label>
          </div></details>
        </section>

        <section class="qEdSec">
          <h3>Question</h3>
          <p class="muted small">Type the question, or paste a screenshot of it. Mix text and images freely (e.g. a passage, then a graph).</p>
          <div id="qeStemHost"></div>
        </section>

        <section class="qEdSec">
          <div class="qEdSecHead"><h3>Answer</h3>
            <div class="seg" role="radiogroup" aria-label="Answer type">
              <label><input type="radio" name="qeType" value="mcq"><span>Multiple choice</span></label>
              <label><input type="radio" name="qeType" value="grid"><span>Student types the answer</span></label>
            </div>
          </div>
          <div id="qeMcq">
            <p class="muted small">Select the radio button next to the correct choice. A choice can be text, an image, or both.</p>
            <div id="qeChoices"></div>
          </div>
          <div id="qeGrid" hidden>
            <label class="label">Correct answer<input class="input" id="qeAnswer" placeholder="e.g. 12, -3.5 or 7/2"></label>
            <p class="muted small">Students can enter equivalent forms (0.5 = 1/2). Use a number or simple fraction.</p>
          </div>
        </section>

        <section class="qEdSec">
          <h3>Solution</h3>
          <p class="muted small">Shown to students after they answer. Add worked steps as text, or paste a photo/screenshot of a handwritten solution.</p>
          <div id="qeSolHost"></div>
        </section>
      </div>

      <aside class="qEdPreview" aria-label="Student preview">
        <div class="qEdPreviewHead"><b>Student preview</b><span class="muted small">updates as you type</span></div>
        <div id="qePreview"></div>
      </aside>
    </div>
    <div class="qEdFoot"><button type="button" class="btn alt" data-act="cancel">Cancel</button><button type="button" class="btn btnPrimary" data-act="save">${isEdit ? 'Save changes' : 'Create question'}</button></div>
  </div>`;
  document.body.appendChild(layer);
  const $ = (id) => layer.querySelector('#' + id);
  const errBox = layer.querySelector('.qEdError');
  const showError = (m) => { errBox.textContent = m; errBox.hidden = !m; if (m) errBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  let dirty = false;
  const touch = () => { dirty = true; renderPreview(); };

  // existing values
  $('qeSection').value = q.section || 'math';
  $('qeDifficulty').value = String(q.difficulty || 3);
  $('qeDomain').value = q.domain || '';
  $('qeSkill').value = q.skill || '';
  $('qeStatus').value = q.status || 'approved';
  $('qeSource').value = q.source || 'admin';
  $('qeFrequency').value = q.frequency_tier || 'unknown';
  $('qeOcc').value = q.previous_exam_occurrence_count ?? '';

  const stem = richField({ value: q.stem || '', rows: 6, placeholder: 'Type the question here…', onChange: touch, onError: showError });
  $('qeStemHost').appendChild(stem.el);
  const solution = richField({ value: q.explanation || '', rows: 6, placeholder: 'Explain how to get the answer…', onChange: touch, onError: showError });
  $('qeSolHost').appendChild(solution.el);

  const existingChoices = q.choices && q.choices.length ? q.choices : ['', '', '', ''];
  const choiceFields = existingChoices.slice(0, 4).concat(['', '', '', '']).slice(0, 4).map((val, i) => {
    const row = document.createElement('div'); row.className = 'qeChoice';
    row.innerHTML = `<label class="qeCorrect" title="Mark choice ${'ABCD'[i]} as correct"><input type="radio" name="qeCorrect" value="${'ABCD'[i]}"><span class="qeLetter">${'ABCD'[i]}</span></label><div class="qeChoiceField"></div>`;
    const f = richField({ value: val, rows: 1, compact: true, placeholder: `Choice ${'ABCD'[i]}`, onChange: touch, onError: showError });
    row.querySelector('.qeChoiceField').appendChild(f.el);
    $('qeChoices').appendChild(row);
    return f;
  });
  const correctLetter = String(q.correct_answer || '').trim().toUpperCase();
  const radio = layer.querySelector(`input[name=qeCorrect][value="${/^[A-D]$/.test(correctLetter) ? correctLetter : ''}"]`); if (radio) radio.checked = true;
  layer.querySelectorAll('input[name=qeCorrect]').forEach(r => r.addEventListener('change', touch));

  layer.querySelector(`input[name=qeType][value=${isGrid ? 'grid' : 'mcq'}]`).checked = true;
  if (isGrid) $('qeAnswer').value = q.correct_answer || '';
  const applyType = () => {
    const grid = layer.querySelector('input[name=qeType]:checked').value === 'grid';
    $('qeMcq').hidden = grid; $('qeGrid').hidden = !grid; renderPreview();
  };
  layer.querySelectorAll('input[name=qeType]').forEach(r => r.addEventListener('change', () => { dirty = true; applyType(); }));
  layer.addEventListener('input', (e) => { if (!e.target.closest('.rf')) touch(); });
  layer.addEventListener('change', (e) => { if (!e.target.closest('.rf')) touch(); });

  function current() {
    const grid = layer.querySelector('input[name=qeType]:checked').value === 'grid';
    const correct = layer.querySelector('input[name=qeCorrect]:checked')?.value || '';
    return {
      section: $('qeSection').value, domain: $('qeDomain').value.trim() || null, skill: $('qeSkill').value.trim(),
      difficulty: Number($('qeDifficulty').value), status: $('qeStatus').value, source: $('qeSource').value.trim() || 'admin',
      frequency_tier: $('qeFrequency').value,
      previous_exam_occurrence_count: $('qeOcc').value === '' ? null : Number($('qeOcc').value),
      stem: stem.get(), explanation: solution.get(),
      choices: grid ? null : choiceFields.map(f => f.get()),
      correct_answer: grid ? $('qeAnswer').value.trim() : correct,
      answer_type: grid ? 'grid-in' : 'mcq',
    };
  }

  function renderPreview() {
    const c = current();
    $('qePreview').innerHTML = `
      <div class="pvMeta"><span class="pill">${c.section === 'math' ? 'Math' : 'Reading & Writing'}</span><span class="pill mutedPill">${esc(c.domain || c.skill || 'Skill')}</span><span class="pill diff-${c.difficulty}">${DIFFICULTY[c.difficulty]}</span></div>
      <div class="qTitle pvStem">${c.stem ? rich(c.stem) : '<span class="muted">The question will appear here.</span>'}</div>
      ${c.choices ? c.choices.map((t, i) => `<div class="choice pvChoice${c.correct_answer === 'ABCD'[i] ? ' correctChoice' : ''}"><span class="choiceLetter">${'ABCD'[i]}</span><span>${t ? rich(t) : '<span class="muted">Empty</span>'}</span>${c.correct_answer === 'ABCD'[i] ? '<span class="choiceMark">✓</span>' : ''}</div>`).join('')
        : `<div class="gridAnswer"><div class="input bigInput pvGrid">Student types answer</div><div class="small muted">Correct answer: <b>${esc(c.correct_answer || '—')}</b></div></div>`}
      <div class="explanation pvSol"><h4>Step-by-step explanation</h4><p>${c.explanation ? rich(c.explanation) : '<span class="muted">The solution will appear here.</span>'}</p></div>`;
  }
  applyType();

  const close = () => {
    if (dirty && !confirm('Discard your unsaved changes?')) return;
    document.removeEventListener('keydown', onKey); layer.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.imgLightbox')) close(); if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
  document.addEventListener('keydown', onKey);

  let saving = false;
  async function save() {
    if (saving) return;
    const c = current(); showError('');
    if (!c.skill) return showError('Skill is required.');
    if (!c.stem) return showError('Add the question text or paste an image of the question.');
    if (c.choices) {
      const empty = c.choices.findIndex(t => !t);
      if (empty >= 0) return showError(`Choice ${'ABCD'[empty]} is empty. Add text or an image.`);
      if (!c.correct_answer) return showError('Select which choice is correct (the radio button next to A–D).');
    } else if (!c.correct_answer) return showError('Enter the correct answer.');
    if (!c.explanation) return showError('Add a solution (text or image).');
    saving = true; layer.querySelectorAll('[data-act=save]').forEach(b => { b.disabled = true; b.textContent = 'Saving…'; });
    try {
      await api(isEdit ? `/api/admin/questions/${encodeURIComponent(q.id)}` : '/api/admin/questions', { method: isEdit ? 'PATCH' : 'POST', body: JSON.stringify({ ...c, validated: c.status === 'approved' ? 1 : 0 }) });
      dirty = false; document.removeEventListener('keydown', onKey); layer.remove(); onSaved();
    } catch (e) { showError(e.message); }
    finally { saving = false; layer.querySelectorAll('[data-act=save]').forEach(b => { b.disabled = false; b.textContent = isEdit ? 'Save changes' : 'Create question'; }); }
  }
  layer.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') close(); else if (act === 'save') save();
  });
  setTimeout(() => stem.focus(), 50);
}
