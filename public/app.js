/* ConImageSizer Frontend — app.js */

let currentResults = null;
let clientId = null;
let eventSource = null;

// Generate unique client ID for SSE progress
function generateClientId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Parse viewports from comma-separated string
function parseViewports(str) {
  return str
    .split(/[,;\s]+/)
    .map((v) => parseInt(v.trim(), 10))
    .filter((v) => !isNaN(v) && v > 0 && v <= 3840);
}

// Copy text to clipboard with feedback
async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = '✓ Kopiert';
    btn.style.color = '#4ade80';
    btn.style.borderColor = '#4ade80';
    setTimeout(() => {
      btn.textContent = original;
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 1500);
  } catch {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

// Copy all configs as formatted text
window.copyAllConfigs = function () {
  if (!currentResults) return;
  const lines = currentResults.results.map((r, i) => {
    const c = r.contaoConfig;
    return [
      `## Bildgröße ${i + 1}: ${c.name}`,
      `Kontext: ${r.meta.contextLabel}`,
      `Name: ${c.name}`,
      `Breite: ${c.width}`,
      `Höhe: (leer)`,
      `Größenänderungsmodus: ${c.resizeMode}`,
      `Pixeldichte/Skalierungsfaktor: ${c.densities}`,
      `Sizes-Attribut: ${c.sizes}`,
      `Lazy-Loading: ${c.lazyLoading ? 'ja' : 'nein'}`,
      '',
    ].join('\n');
  });
  const btn = document.querySelector('[onclick="copyAllConfigs()"]');
  copyText(lines.join('\n'), btn);
};

// Set progress
function setProgress(pct, message) {
  const bar = document.getElementById('progressBar');
  const statusText = document.getElementById('statusText');
  const statusLine = document.getElementById('statusLine');
  const progressWrap = document.getElementById('progressWrap');

  if (pct > 0) {
    progressWrap.classList.remove('hidden');
    bar.style.width = pct + '%';
  }
  if (message) {
    statusLine.classList.remove('hidden');
    statusText.textContent = message + ' ';
  }
}

// Show error
function showError(msg) {
  const box = document.getElementById('errorBox');
  document.getElementById('errorText').textContent = msg;
  box.classList.remove('hidden');
}

// Hide error
function hideError() {
  document.getElementById('errorBox').classList.add('hidden');
}

// Format src for display (truncate)
function truncateSrc(src, max = 60) {
  if (!src) return '';
  try {
    const u = new URL(src);
    const path = u.pathname;
    if (path.length > max) return '…' + path.slice(-max);
    return path;
  } catch {
    return src.length > max ? '…' + src.slice(-max) : src;
  }
}

// Get thumbnail src (prefer direct URL or data URI)
function getThumbnailSrc(meta) {
  if (!meta.src) return null;
  // If it's a full URL with protocol, use directly
  if (meta.src.startsWith('http://') || meta.src.startsWith('https://') || meta.src.startsWith('//')) {
    return meta.src;
  }
  return null;
}

// Render viewport table
function renderViewportTable(viewportData) {
  const headers = viewportData.map((vd) => `<th class="text-right text-term-cyan px-3 py-1">${vd.viewport}px</th>`).join('');
  const widths = viewportData.map((vd) =>
    vd.width
      ? `<td class="text-right vp-cell px-3 py-1 text-slate-300">${vd.width}px</td>`
      : `<td class="text-right vp-cell px-3 py-1 text-slate-700">—</td>`
  ).join('');
  const vws = viewportData.map((vd) =>
    vd.vw
      ? `<td class="text-right vp-cell px-3 py-1 text-term-yellow">${vd.vw}vw</td>`
      : `<td class="text-right vp-cell px-3 py-1 text-slate-700">—</td>`
  ).join('');

  return `
    <table class="w-full text-xs" style="border-collapse:separate; border-spacing:0">
      <thead>
        <tr class="border-b border-slate-800/60">
          <th class="text-left text-slate-500 px-3 py-1 font-normal">Viewport</th>
          ${headers}
        </tr>
      </thead>
      <tbody>
        <tr class="border-b border-slate-800/30">
          <td class="text-slate-500 px-3 py-1">clientWidth</td>
          ${widths}
        </tr>
        <tr>
          <td class="text-slate-500 px-3 py-1">~vw</td>
          ${vws}
        </tr>
      </tbody>
    </table>
  `;
}

// Render child items (Größen-Elemente)
function renderChildItems(childItems) {
  if (!childItems || childItems.length === 0) return '';
  const rows = childItems.map((item) => `
    <tr class="border-b border-slate-800/20">
      <td class="px-3 py-1.5 text-term-purple font-mono">${item.media}</td>
      <td class="px-3 py-1.5 text-slate-300">${item.width}px</td>
      <td class="px-3 py-1.5 text-slate-300">${item.resizeMode}</td>
      <td class="px-3 py-1.5 text-term-yellow font-mono text-xs">${item.densities}</td>
    </tr>
  `).join('');

  return `
    <div class="mt-4">
      <div class="text-xs text-slate-500 uppercase tracking-widest mb-2">Größen-Elemente (Kind-Datensätze)</div>
      <table class="w-full text-xs">
        <thead>
          <tr class="border-b border-slate-800/50">
            <th class="text-left text-slate-600 px-3 py-1 font-normal">Media Query</th>
            <th class="text-left text-slate-600 px-3 py-1 font-normal">Breite</th>
            <th class="text-left text-slate-600 px-3 py-1 font-normal">Skalierung</th>
            <th class="text-left text-slate-600 px-3 py-1 font-normal">Pixeldichte</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// Render contao config fields — labels match exactly the Contao 5 backend
function renderConfigFields(config, cardId) {
  const fields = [
    {
      label: 'Name',
      key: 'name',
      color: 'text-slate-200',
      hint: 'Pflichtfeld — frei wählbarer interner Name im Contao-Backend.',
      required: true,
    },
    {
      label: 'Breite',
      key: 'width',
      color: 'text-brand font-semibold',
      hint: 'Messung am Standard-Desktop-Viewport (≤1400px). Contao nutzt diesen Wert als 1×-Referenz für die interne Dichte-Berechnung UND als src-Fallback-Bild. Widescreen- und Retina-Varianten werden ausschließlich über die w-Deskriptoren im srcset bereitgestellt.',
    },
    {
      label: 'Höhe',
      key: 'height',
      color: 'text-slate-400',
      hint: 'Leer lassen — Contao berechnet die Höhe proportional aus der Breite.',
    },
    {
      label: 'Größenänderungsmodus',
      key: 'resizeMode',
      color: 'text-term-cyan',
      hint: 'Proportional = Seitenverhältnis beibehalten (empfohlen, solange Höhe leer ist).',
    },
    {
      label: 'Pixeldichte/Skalierungsfaktor',
      key: 'densities',
      color: 'text-term-yellow',
      hint: 'W-Breitendeskriptoren für das srcset-Attribut. Contao generiert je einen Bildschnitt pro Wert (1× und 2× Retina abgedeckt).',
    },
    {
      label: 'Sizes-Attribut',
      key: 'sizes',
      color: 'text-term-green',
      hint: 'Teilt dem Browser mit, wie groß das Bild im Layout ist — damit er den optimalen srcset-Kandidaten wählen kann.',
    },
  ];

  return fields.map((f) => {
    const raw = config[f.key];
    const isEmpty = !raw;
    const value = isEmpty ? '(leer)' : raw;
    return `
      <div class="config-row flex items-start justify-between gap-3 px-3 py-2.5 rounded group" data-field="${f.key}">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 mb-0.5">
            <span class="text-slate-500 text-xs uppercase tracking-wider">${f.label}</span>
            ${f.required ? '<span class="text-red-500 text-xs">*</span>' : ''}
          </div>
          <div class="${isEmpty ? 'text-slate-700 italic' : f.color} text-sm font-mono break-all">${value}</div>
          <div class="text-slate-700 text-xs mt-0.5 leading-relaxed">${f.hint}</div>
        </div>
        ${!isEmpty ? `<button class="copy-btn flex-shrink-0 mt-1" onclick="copyFieldValue('${cardId}', '${f.key}', this)">copy</button>` : ''}
      </div>
    `;
  }).join('');
}

// Render lazy-loading field as a separate styled row
function renderLazyRow(config) {
  return `
    <div class="flex items-center gap-3 px-3 py-2.5 border-t border-slate-800/40">
      <div class="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${config.lazyLoading ? 'bg-term-green/20 border-term-green/50' : 'border-slate-700'}">
        ${config.lazyLoading ? '<svg class="w-3 h-3 text-term-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>' : ''}
      </div>
      <div>
        <span class="text-slate-500 text-xs uppercase tracking-wider">Lazy-Loading aktivieren</span>
        <div class="text-slate-700 text-xs">${config.lazyLoading ? 'Empfohlen — Bild war als lazy erkannt.' : 'Nicht erkannt — nach Bedarf aktivieren.'}</div>
      </div>
    </div>
  `;
}

// Global map for config values (for copy)
const configMap = {};

window.copyFieldValue = function (cardId, fieldKey, btn) {
  const config = configMap[cardId];
  if (config && config[fieldKey]) {
    copyText(config[fieldKey], btn);
  }
};

// Toggle accordion
window.toggleAccordion = function (id) {
  const body = document.getElementById(`acc-${id}`);
  const icon = document.getElementById(`acc-icon-${id}`);
  if (body) {
    body.classList.toggle('open');
    if (icon) icon.style.transform = body.classList.contains('open') ? 'rotate(180deg)' : '';
  }
};

// Render a single result card
function renderResultCard(result, index) {
  const { meta, viewportData, contaoConfig, childItems } = result;
  const cardId = `card-${index}`;
  configMap[cardId] = contaoConfig;

  const thumbSrc = getThumbnailSrc(meta);
  const thumb = thumbSrc
    ? `<img src="${thumbSrc}" alt="${meta.alt || ''}" class="thumb flex-shrink-0" onerror="this.style.display='none'">`
    : `<div class="thumb flex-shrink-0 flex items-center justify-center text-slate-700 text-xs">no img</div>`;

  const badges = [
    meta.isGroup ? `<span class="tag badge-group">Gruppe × ${meta.groupCount || '?'}</span>` : '',
    meta.isLazy ? `<span class="tag badge-lazy">lazy</span>` : '',
    meta.inPicture ? `<span class="tag badge-pic">&lt;picture&gt;</span>` : '',
  ].filter(Boolean).join('');

  return `
    <div class="result-card fade-in" style="animation-delay: ${index * 60}ms">
      <!-- Card Header -->
      <div class="p-4 border-b border-slate-800/50">
        <div class="flex items-start gap-4">
          ${thumb}
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span class="text-slate-200 text-sm font-semibold">${contaoConfig.name}</span>
              ${badges}
              <span class="text-slate-700 text-xs">·</span>
              <span class="text-xs text-slate-600">#${index + 1}</span>
            </div>
            <div class="text-xs text-slate-500 mb-1">${meta.contextLabel}</div>
            <div class="text-xs text-slate-700 font-mono truncate" title="${meta.src}">${truncateSrc(meta.src)}</div>
          </div>
          <div class="text-xs text-slate-700 text-right flex-shrink-0">
            ${meta.naturalWidth ? `<div>${meta.naturalWidth} × ${meta.naturalHeight}px<br><span class="text-slate-800">Quellbild</span></div>` : ''}
          </div>
        </div>
      </div>

      <!-- Viewport Measurements -->
      <div class="p-4 border-b border-slate-800/50">
        <div class="text-xs text-slate-600 uppercase tracking-widest mb-2">Viewport-Messungen</div>
        ${renderViewportTable(viewportData)}
      </div>

      <!-- Contao Config -->
      <div class="p-4">
        <div class="text-xs text-slate-600 uppercase tracking-widest mb-2">Contao Bildgröße — Konfiguration</div>

        <div class="rounded-lg overflow-hidden border border-slate-800/50">
          ${renderConfigFields(contaoConfig, cardId)}
          ${renderLazyRow(contaoConfig)}
        </div>

        ${childItems && childItems.length > 0 ? `
          <div class="accordion-toggle mt-3 text-xs text-slate-600 hover:text-brand transition-colors flex items-center gap-1" onclick="toggleAccordion('${cardId}')">
            <svg id="acc-icon-${cardId}" class="w-3 h-3 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
            </svg>
            ${childItems.length} Größen-Elemente für Breakpoints (optional)
          </div>
          <div class="accordion-body" id="acc-${cardId}">
            ${renderChildItems(childItems)}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

window.copyText = copyText;

// Render full results
function renderResults(data) {
  currentResults = data;

  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('results').classList.remove('hidden');
  document.getElementById('resultCount').textContent = data.count;
  document.getElementById('resultUrl').textContent = data.url;

  const list = document.getElementById('resultList');
  list.innerHTML = data.results.map((r, i) => renderResultCard(r, i)).join('');
}

// Setup SSE for progress
function setupProgress(id) {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/api/progress/${id}`);
  eventSource.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'status') {
      setProgress(data.progress, data.message);
    } else if (data.type === 'error') {
      showError(data.message);
    }
  };
}

// Form submit handler
document.getElementById('analyzeForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const url = document.getElementById('urlInput').value.trim();
  const viewportStr = document.getElementById('viewportsInput').value;
  const viewports = parseViewports(viewportStr);

  if (!url) return showError('Bitte eine URL eingeben.');
  if (viewports.length === 0) return showError('Keine gültigen Viewports angegeben.');

  hideError();
  document.getElementById('results').classList.add('hidden');
  document.getElementById('emptyState').classList.add('hidden');

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = `
    <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
    </svg>
    Analysiere…
  `;

  clientId = generateClientId();
  setupProgress(clientId);
  setProgress(5, 'Verbindung wird aufgebaut…');

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, viewports, clientId }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Analyse fehlgeschlagen');
    }

    renderResults(data);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      </svg>
      Analysieren
    `;
    document.getElementById('statusLine').classList.add('hidden');
    document.getElementById('progressWrap').classList.add('hidden');
    if (eventSource) { eventSource.close(); eventSource = null; }
  }
});
