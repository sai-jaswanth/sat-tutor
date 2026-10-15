// Shared helpers for text that may contain pictures.
// Pictures are embedded in any text field (question, choice, solution) as ![alt](img:<id>).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const IMAGE_TOKEN_SRC = '!\\[([^\\]]*)\\]\\(img:([A-Za-z0-9]+)\\)';

/** Safe HTML: text is escaped first, then only well-formed image tokens become <img>. */
export function rich(text) {
  return esc(text)
    .replace(new RegExp(IMAGE_TOKEN_SRC, 'g'), (_m, alt, id) => `<img class="qImg" src="/api/images/${id}" alt="${alt || 'Question image'}" loading="lazy">`)
    .replace(/\n/g, '<br>');
}
/** Single-line text for lists/tooltips: pictures become a short marker. */
export const plain = (text) => String(text ?? '').replace(new RegExp(IMAGE_TOKEN_SRC, 'g'), '🖼 image');
export const imageIds = (text) => [...String(text ?? '').matchAll(new RegExp(IMAGE_TOKEN_SRC, 'g'))].map(m => m[2]);
export const imageCount = (...texts) => texts.reduce((n, t) => n + imageIds(t).length, 0);

/** Click any question image to view it full-size (handy for graphs). Call once. */
export function enableImageZoom() {
  document.addEventListener('click', (e) => {
    const img = e.target instanceof Element ? e.target.closest('img.qImg') : null;
    if (!img) return;
    const layer = document.createElement('div');
    layer.className = 'imgLightbox';
    layer.innerHTML = `<img src="${img.src}" alt="${esc(img.alt)}">`;
    layer.onclick = () => layer.remove();
    document.body.appendChild(layer);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelector('.imgLightbox')?.remove(); });
}
