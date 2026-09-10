/* Kostenvergleich Lieferanten - reine Client-seitige Web-App, kein Server nötig. */

const STORAGE_KEY = 'kostenvergleich_v1';

let state = null;
let selectedGridSupplierId = null; // transiente UI-Auswahl, nicht persistiert

/* ---------- Hilfsfunktionen ---------- */

function uid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function fmt(n) {
  if (n === null || n === undefined || !isFinite(n)) return '–';
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n) {
  if (n === null || n === undefined || !isFinite(n)) return '–';
  return n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}

function parseNumberList(text) {
  return (text || '')
    .split(/[,;\s]+/)
    .map(function (s) { return s.trim().replace(',', '.'); })
    .filter(function (s) { return s !== ''; })
    .map(Number)
    .filter(function (n) { return !isNaN(n); });
}

function uniqueSorted(arr) {
  return Array.from(new Set(arr)).sort(function (a, b) { return a - b; });
}

function findSupplier(id) { return state.suppliers.find(function (s) { return s.id === id; }); }
function findItem(id) { return state.specialItems.find(function (i) { return i.id === id; }); }
function findLine(id) { return state.orderLines.find(function (l) { return l.id === id; }); }
function findTestDim(id) { return state.testDims.find(function (t) { return t.id === id; }); }

/* ---------- Persistenz ---------- */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.suppliers)) return null;
    return parsed;
  } catch (e) {
    console.warn('Konnte gespeicherten Stand nicht laden:', e);
    return null;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Konnte Stand nicht speichern:', e);
  }
}

function persistAndRender() {
  saveState();
  renderAll();
}

function defaultState() {
  return { suppliers: [], specialItems: [], orderLines: [], testDims: [] };
}

function demoState() {
  const supA = {
    id: uid('sup'), name: 'Lieferant A', stages: [10, 5, 2],
    grid: { lengths: [1000, 1500, 2000, 2500], widths: [1200, 1400, 1600], prices: {} },
    specialPrices: {}
  };
  const supB = {
    id: uid('sup'), name: 'Lieferant B', stages: [15, 0, 0],
    grid: { lengths: [1000, 1500, 2000, 2500], widths: [1000, 1500, 2000], prices: {} },
    specialPrices: {}
  };
  function fillGrid(grid, rate) {
    grid.lengths.forEach(function (L) {
      grid.widths.forEach(function (W) {
        grid.prices[L + '|' + W] = Math.round(L * W * rate) / 100;
      });
    });
  }
  fillGrid(supA.grid, 0.0021);
  fillGrid(supB.grid, 0.00225);

  const item1 = { id: uid('itm'), name: 'Zuschnitt Sonderform' };
  const item2 = { id: uid('itm'), name: 'Express-Zuschlag' };
  supA.specialPrices[item1.id] = 45;
  supA.specialPrices[item2.id] = 20;
  supB.specialPrices[item1.id] = 39;
  // Lieferant B bietet den Express-Zuschlag nicht an -> bewusst kein Eintrag

  const line1 = { id: uid('ln'), type: 'grid', length: 1300, width: 1250, qty: 10, label: 'Bauteil 1' };
  const line2 = { id: uid('ln'), type: 'grid', length: 2200, width: 1550, qty: 4, label: 'Bauteil 2' };
  const line3 = { id: uid('ln'), type: 'special', specialItemId: item1.id, qty: 2, label: '' };

  const testDims = [
    { id: uid('td'), length: 1000, width: 1000, qty: 1 },
    { id: uid('td'), length: 1300, width: 1250, qty: 1 },
    { id: uid('td'), length: 2000, width: 1600, qty: 1 },
    { id: uid('td'), length: 2500, width: 2000, qty: 1 }
  ];

  return {
    suppliers: [supA, supB],
    specialItems: [item1, item2],
    orderLines: [line1, line2, line3],
    testDims: testDims
  };
}

/* ---------- Berechnungslogik ---------- */

function roundUpGrid(sortedArr, value) {
  for (let i = 0; i < sortedArr.length; i++) {
    if (sortedArr[i] >= value) return sortedArr[i];
  }
  return null;
}

function applyChain(base, stages) {
  let factor = 1;
  (stages || []).forEach(function (s) {
    const d = Number(s) || 0;
    factor *= (1 - d / 100);
  });
  return base * factor;
}

function chainFactor(stages) {
  let factor = 1;
  (stages || []).forEach(function (s) {
    const d = Number(s) || 0;
    factor *= (1 - d / 100);
  });
  return factor;
}

function getGridCellPrice(supplier, length, width) {
  const Ls = supplier.grid.lengths, Ws = supplier.grid.widths;
  if (!Ls.length || !Ws.length) return { error: true, message: 'Kein Raster hinterlegt' };
  const L = roundUpGrid(Ls, length);
  const W = roundUpGrid(Ws, width);
  if (L === null || W === null) return { error: true, message: 'Außerhalb Rasterbereich' };
  const raw = supplier.grid.prices[L + '|' + W];
  if (raw === undefined || raw === null || raw === '') {
    return { error: true, message: 'Kein Preis hinterlegt (' + L + '×' + W + ')' };
  }
  return { error: false, price: Number(raw), matchedLength: L, matchedWidth: W };
}

function computeLineForSupplier(line, supplier) {
  if (line.type === 'grid') {
    const length = Number(line.length), width = Number(line.width), qty = Number(line.qty) || 0;
    if (!length || !width) return { error: true, message: 'Maße fehlen' };
    const res = getGridCellPrice(supplier, length, width);
    if (res.error) return { error: true, message: res.message };
    const unitPrice = applyChain(res.price, supplier.stages);
    return {
      error: false, basePrice: res.price, unitPrice: unitPrice, qty: qty,
      lineTotal: unitPrice * qty, matchedLength: res.matchedLength, matchedWidth: res.matchedWidth
    };
  }
  const qty = Number(line.qty) || 0;
  const raw = supplier.specialPrices ? supplier.specialPrices[line.specialItemId] : undefined;
  if (raw === undefined || raw === null || raw === '') return { error: true, message: 'Nicht angeboten' };
  const basePrice = Number(raw);
  const unitPrice = applyChain(basePrice, supplier.stages);
  return { error: false, basePrice: basePrice, unitPrice: unitPrice, qty: qty, lineTotal: unitPrice * qty };
}

/**
 * Ermittelt, welche zusätzliche Rabattstufe 3 der (teurere) Lieferant gewähren müsste,
 * um beim gegebenen Referenzpreis (targetUnitPrice) gleichzuziehen. Stufen 1 & 2 bleiben fix.
 */
function computeNegotiation(basePrice, stages, targetUnitPrice) {
  if (!basePrice || basePrice <= 0) return null;
  const currentFactor = chainFactor(stages);
  const currentUnit = basePrice * currentFactor;
  if (targetUnitPrice >= currentUnit) return { alreadyCheaperOrEqual: true };

  const requiredFactor = targetUnitPrice / basePrice;
  const requiredDiscountPct = (1 - requiredFactor) * 100;
  const currentDiscountPct = (1 - currentFactor) * 100;
  const deltaPct = requiredDiscountPct - currentDiscountPct;

  const d1 = Number(stages && stages[0] || 0);
  const d2 = Number(stages && stages[1] || 0);
  const factor12 = (1 - d1 / 100) * (1 - d2 / 100);

  let newStage3Pct = null, feasible = true;
  if (factor12 > 0) {
    const newStage3Factor = requiredFactor / factor12;
    newStage3Pct = (1 - newStage3Factor) * 100;
    if (newStage3Pct < 0) feasible = false;
  } else {
    feasible = false;
  }
  return {
    alreadyCheaperOrEqual: false, currentDiscountPct: currentDiscountPct,
    requiredDiscountPct: requiredDiscountPct, deltaPct: deltaPct,
    newStage3Pct: newStage3Pct, feasible: feasible
  };
}

/* ---------- Tab-Umschaltung ---------- */

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

/* ---------- Render: Lieferanten ---------- */

function renderSuppliers() {
  const container = document.getElementById('supplierList');
  if (!state.suppliers.length) {
    container.innerHTML = '<p class="small">Noch keine Lieferanten angelegt.</p>';
    return;
  }
  container.innerHTML = state.suppliers.map(function (s) {
    return '' +
      '<div class="card">' +
      '  <div class="card-header">' +
      '    <input type="text" value="' + escapeHtml(s.name) + '" onchange="updateSupplierName(\'' + s.id + '\', this.value)">' +
      '    <button class="icon-btn" onclick="removeSupplier(\'' + s.id + '\')" title="Lieferant entfernen">✕ entfernen</button>' +
      '  </div>' +
      '  <div class="stage-row">' +
      [0, 1, 2].map(function (i) {
        return '<div class="field"><label>Rabattstufe ' + (i + 1) + ' (%)</label>' +
          '<input type="number" step="0.1" value="' + (s.stages[i] != null ? s.stages[i] : 0) +
          '" onchange="updateSupplierStage(\'' + s.id + '\', ' + i + ', this.value)"></div>';
      }).join('') +
      '    <div class="field"><label>Effektiver Gesamtrabatt</label>' +
      '      <div style="padding:6px 0;font-weight:600;">' + fmtPct((1 - chainFactor(s.stages)) * 100) + '</div>' +
      '    </div>' +
      '  </div>' +
      '</div>';
  }).join('');
}

function addSupplier() {
  state.suppliers.push({
    id: uid('sup'), name: 'Neuer Lieferant', stages: [0, 0, 0],
    grid: { lengths: [], widths: [], prices: {} }, specialPrices: {}
  });
  persistAndRender();
}

function removeSupplier(id) {
  const s = findSupplier(id);
  if (!s) return;
  if (!confirm('Lieferant "' + s.name + '" inkl. Preisraster und Sonderpreisen wirklich entfernen?')) return;
  state.suppliers = state.suppliers.filter(function (x) { return x.id !== id; });
  if (selectedGridSupplierId === id) selectedGridSupplierId = null;
  persistAndRender();
}

function updateSupplierName(id, value) {
  const s = findSupplier(id); if (!s) return;
  s.name = value; persistAndRender();
}

function updateSupplierStage(id, idx, value) {
  const s = findSupplier(id); if (!s) return;
  const n = Number(value.replace(',', '.'));
  s.stages[idx] = isNaN(n) ? 0 : n;
  persistAndRender();
}

/* ---------- Render: Preisraster ---------- */

function renderGridsTab() {
  const tabsEl = document.getElementById('gridSupplierTabs');
  const editorEl = document.getElementById('gridEditor');

  if (!state.suppliers.length) {
    tabsEl.innerHTML = '';
    editorEl.innerHTML = '<p class="small">Bitte zuerst im Tab "Lieferanten" mindestens einen Lieferanten anlegen.</p>';
    return;
  }
  if (!selectedGridSupplierId || !findSupplier(selectedGridSupplierId)) {
    selectedGridSupplierId = state.suppliers[0].id;
  }

  tabsEl.innerHTML = state.suppliers.map(function (s) {
    const cls = s.id === selectedGridSupplierId ? 'subtab-btn active' : 'subtab-btn';
    return '<button class="' + cls + '" onclick="selectGridSupplier(\'' + s.id + '\')">' + escapeHtml(s.name) + '</button>';
  }).join('');

  renderGridEditor(findSupplier(selectedGridSupplierId));
}

function selectGridSupplier(id) {
  selectedGridSupplierId = id;
  renderGridsTab();
}

function renderGridEditor(supplier) {
  const editorEl = document.getElementById('gridEditor');
  const lengths = supplier.grid.lengths, widths = supplier.grid.widths;

  let html = '';
  html += '<div class="grid-tools">';
  html += '  <div class="field"><label>Längen (Zeilen), kommagetrennt</label>' +
    '<input type="text" id="lenInput_' + supplier.id + '" style="width:260px" value="' + lengths.join(', ') + '"></div>';
  html += '  <div class="field"><label>Breiten (Spalten), kommagetrennt</label>' +
    '<input type="text" id="widInput_' + supplier.id + '" style="width:260px" value="' + widths.join(', ') + '"></div>';
  html += '  <button class="btn-secondary" style="align-self:flex-end" onclick="applyLengthsWidths(\'' + supplier.id + '\')">Raster-Maße übernehmen</button>';
  html += '</div>';

  if (lengths.length && widths.length) {
    html += '<div class="table-wrap"><table class="data-table"><thead><tr><th class="corner-cell">Länge \\ Breite</th>';
    widths.forEach(function (W) { html += '<th>' + W + '</th>'; });
    html += '</tr></thead><tbody>';
    lengths.forEach(function (L) {
      html += '<tr><th>' + L + '</th>';
      widths.forEach(function (W) {
        const key = L + '|' + W;
        const val = supplier.grid.prices[key];
        html += '<td><input type="number" step="0.01" value="' + (val === undefined || val === null ? '' : val) +
          '" placeholder="–" onchange="updateGridPrice(\'' + supplier.id + '\', ' + L + ', ' + W + ', this.value)"></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  } else {
    html += '<p class="small">Bitte zunächst Längen und Breiten festlegen.</p>';
  }

  html += '<details style="margin-top:14px;">';
  html += '<summary class="small" style="cursor:pointer;">CSV einfügen / kopieren (z.B. aus Excel)</summary>';
  html += '<p class="small">Format: erste Zeile = Eckzelle + Breiten, erste Spalte = Längen, Rest = Preise. Trennzeichen Tab, Semikolon oder Komma werden automatisch erkannt.</p>';
  html += '<textarea class="csv-paste" id="csvArea_' + supplier.id + '"></textarea>';
  html += '<div class="grid-tools" style="margin-top:8px;">';
  html += '<button class="btn-secondary" onclick="applyCsv(\'' + supplier.id + '\')">Aus Textfeld übernehmen (ersetzt Tabelle)</button>';
  html += '<button class="btn-secondary" onclick="showCsv(\'' + supplier.id + '\')">Aktuelle Tabelle ins Textfeld schreiben</button>';
  html += '</div>';
  html += '</details>';

  editorEl.innerHTML = html;
}

function applyLengthsWidths(supplierId) {
  const s = findSupplier(supplierId); if (!s) return;
  const lenVal = document.getElementById('lenInput_' + supplierId).value;
  const widVal = document.getElementById('widInput_' + supplierId).value;
  s.grid.lengths = uniqueSorted(parseNumberList(lenVal));
  s.grid.widths = uniqueSorted(parseNumberList(widVal));
  persistAndRender();
}

function updateGridPrice(supplierId, L, W, value) {
  const s = findSupplier(supplierId); if (!s) return;
  const key = L + '|' + W;
  if (value === '') {
    delete s.grid.prices[key];
  } else {
    const n = Number(String(value).replace(',', '.'));
    s.grid.prices[key] = isNaN(n) ? '' : n;
  }
  persistAndRender();
}

function detectDelimiter(line) {
  if (line.indexOf('\t') !== -1) return '\t';
  if (line.indexOf(';') !== -1) return ';';
  return ',';
}

function applyCsv(supplierId) {
  const s = findSupplier(supplierId); if (!s) return;
  const text = document.getElementById('csvArea_' + supplierId).value;
  const lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
  if (!lines.length) { alert('Textfeld ist leer.'); return; }
  const delim = detectDelimiter(lines[0]);
  const rows = lines.map(function (l) { return l.split(delim).map(function (c) { return c.trim(); }); });

  const headerCells = rows[0];
  const widths = headerCells.slice(1).map(function (c) { return Number(c.replace(',', '.')); }).filter(function (n) { return !isNaN(n); });

  const lengths = [];
  const prices = {};
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const L = Number(String(cells[0]).replace(',', '.'));
    if (isNaN(L)) continue;
    lengths.push(L);
    for (let i = 0; i < widths.length; i++) {
      const raw = cells[i + 1];
      if (raw === undefined || raw === '') continue;
      const n = Number(String(raw).replace(',', '.'));
      if (!isNaN(n)) prices[L + '|' + widths[i]] = n;
    }
  }

  if (!widths.length || !lengths.length) {
    alert('Konnte kein gültiges Raster aus dem Text erkennen.');
    return;
  }

  s.grid.lengths = uniqueSorted(lengths);
  s.grid.widths = uniqueSorted(widths);
  s.grid.prices = prices;
  persistAndRender();
}

function showCsv(supplierId) {
  const s = findSupplier(supplierId); if (!s) return;
  const lengths = s.grid.lengths, widths = s.grid.widths;
  const lines = [];
  lines.push(['L\\B'].concat(widths).join(';'));
  lengths.forEach(function (L) {
    const row = [L].concat(widths.map(function (W) {
      const v = s.grid.prices[L + '|' + W];
      return (v === undefined || v === null) ? '' : v;
    }));
    lines.push(row.join(';'));
  });
  const ta = document.getElementById('csvArea_' + supplierId);
  ta.value = lines.join('\n');
  ta.focus();
  ta.select();
}

/* ---------- Render: Sonderpositionen ---------- */

function renderSpecials() {
  const container = document.getElementById('specialsTable');
  if (!state.specialItems.length) {
    container.innerHTML = '<p class="small">Noch keine Sonderpositionen angelegt.</p>';
    return;
  }
  if (!state.suppliers.length) {
    container.innerHTML = '<p class="small">Bitte zuerst Lieferanten anlegen.</p>';
    return;
  }
  let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>Bezeichnung</th>';
  state.suppliers.forEach(function (s) { html += '<th>' + escapeHtml(s.name) + '</th>'; });
  html += '<th></th></tr></thead><tbody>';
  state.specialItems.forEach(function (item) {
    html += '<tr><td><input type="text" value="' + escapeHtml(item.name) +
      '" onchange="updateSpecialName(\'' + item.id + '\', this.value)"></td>';
    state.suppliers.forEach(function (s) {
      const v = s.specialPrices[item.id];
      html += '<td><input type="number" step="0.01" placeholder="nicht angeboten" value="' +
        (v === undefined || v === null ? '' : v) +
        '" onchange="updateSpecialPrice(\'' + s.id + '\', \'' + item.id + '\', this.value)"></td>';
    });
    html += '<td><button class="icon-btn" onclick="removeSpecialItem(\'' + item.id + '\')">✕</button></td></tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function addSpecialItem() {
  state.specialItems.push({ id: uid('itm'), name: 'Neue Position' });
  persistAndRender();
}

function removeSpecialItem(id) {
  const item = findItem(id); if (!item) return;
  if (!confirm('Sonderposition "' + item.name + '" wirklich entfernen?')) return;
  state.specialItems = state.specialItems.filter(function (i) { return i.id !== id; });
  state.suppliers.forEach(function (s) { delete s.specialPrices[id]; });
  state.orderLines = state.orderLines.filter(function (l) { return !(l.type === 'special' && l.specialItemId === id); });
  persistAndRender();
}

function updateSpecialName(id, value) {
  const item = findItem(id); if (!item) return;
  item.name = value; persistAndRender();
}

function updateSpecialPrice(supplierId, itemId, value) {
  const s = findSupplier(supplierId); if (!s) return;
  if (value === '') { delete s.specialPrices[itemId]; } else {
    const n = Number(String(value).replace(',', '.'));
    s.specialPrices[itemId] = isNaN(n) ? '' : n;
  }
  persistAndRender();
}

/* ---------- Render: Kalkulation ---------- */

function renderCalc() {
  renderOrderLinesTable();
  renderCalcResults();
}

function renderOrderLinesTable() {
  const container = document.getElementById('orderLinesTable');
  if (!state.orderLines.length) {
    container.innerHTML = '<p class="small">Noch keine Bestellpositionen erfasst.</p>';
    return;
  }
  let html = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
    '<th>Typ</th><th>Bezeichnung</th><th>Länge</th><th>Breite</th><th>Menge</th><th></th></tr></thead><tbody>';
  state.orderLines.forEach(function (line) {
    html += '<tr>';
    if (line.type === 'grid') {
      html += '<td>Raster</td>';
      html += '<td><input type="text" value="' + escapeHtml(line.label || '') + '" placeholder="optional" ' +
        'onchange="updateOrderLineField(\'' + line.id + '\', \'label\', this.value)"></td>';
      html += '<td><input type="number" value="' + (line.length || '') + '" ' +
        'onchange="updateOrderLineField(\'' + line.id + '\', \'length\', this.value)"></td>';
      html += '<td><input type="number" value="' + (line.width || '') + '" ' +
        'onchange="updateOrderLineField(\'' + line.id + '\', \'width\', this.value)"></td>';
    } else {
      html += '<td>Sonderposition</td>';
      html += '<td><select onchange="updateOrderLineField(\'' + line.id + '\', \'specialItemId\', this.value)">';
      if (!state.specialItems.length) {
        html += '<option value="">– keine Sonderpositionen angelegt –</option>';
      } else {
        state.specialItems.forEach(function (item) {
          html += '<option value="' + item.id + '"' + (item.id === line.specialItemId ? ' selected' : '') + '>' +
            escapeHtml(item.name) + '</option>';
        });
      }
      html += '</select></td>';
      html += '<td colspan="2" class="small">–</td>';
    }
    html += '<td><input type="number" value="' + (line.qty || '') + '" style="width:60px" ' +
      'onchange="updateOrderLineField(\'' + line.id + '\', \'qty\', this.value)"></td>';
    html += '<td><button class="icon-btn" onclick="removeOrderLine(\'' + line.id + '\')">✕</button></td>';
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function addGridLine() {
  state.orderLines.push({ id: uid('ln'), type: 'grid', length: '', width: '', qty: 1, label: '' });
  persistAndRender();
}

function addSpecialLine() {
  state.orderLines.push({
    id: uid('ln'), type: 'special',
    specialItemId: state.specialItems.length ? state.specialItems[0].id : '', qty: 1, label: ''
  });
  persistAndRender();
}

function removeOrderLine(id) {
  state.orderLines = state.orderLines.filter(function (l) { return l.id !== id; });
  persistAndRender();
}

function updateOrderLineField(id, field, value) {
  const line = findLine(id); if (!line) return;
  if (field === 'length' || field === 'width' || field === 'qty') {
    const n = Number(String(value).replace(',', '.'));
    line[field] = isNaN(n) ? '' : n;
  } else {
    line[field] = value;
  }
  persistAndRender();
}

function lineDisplayName(line) {
  if (line.type === 'grid') {
    return (line.label ? escapeHtml(line.label) + ' ' : '') + '(' + (line.length || '?') + '×' + (line.width || '?') + ')';
  }
  const item = findItem(line.specialItemId);
  return item ? escapeHtml(item.name) : '(Sonderposition gelöscht)';
}

function renderCalcResults() {
  const container = document.getElementById('calcResults');
  if (!state.suppliers.length) {
    container.innerHTML = '<p class="small">Bitte zuerst Lieferanten anlegen.</p>';
    return;
  }
  if (!state.orderLines.length) {
    container.innerHTML = '<p class="small">Bitte Bestellpositionen erfassen, um eine Kalkulation zu sehen.</p>';
    return;
  }

  // Pro Lieferant und Zeile berechnen
  const perSupplier = state.suppliers.map(function (s) {
    const results = state.orderLines.map(function (line) { return computeLineForSupplier(line, s); });
    let totalBase = 0, total = 0, errorCount = 0;
    results.forEach(function (r) {
      if (r.error) { errorCount++; } else { totalBase += r.basePrice * r.qty; total += r.lineTotal; }
    });
    return { supplier: s, results: results, totalBase: totalBase, total: total, errorCount: errorCount };
  });

  const completeTotals = perSupplier.filter(function (p) { return p.errorCount === 0; });
  const pool = completeTotals.length ? completeTotals : perSupplier;
  const cheapest = pool.reduce(function (min, p) { return (!min || p.total < min.total) ? p : min; }, null);

  // Detailtabelle
  let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>Position</th>';
  perSupplier.forEach(function (p) { html += '<th>' + escapeHtml(p.supplier.name) + '</th>'; });
  html += '</tr></thead><tbody>';

  state.orderLines.forEach(function (line, li) {
    html += '<tr><td style="text-align:left;">' + lineDisplayName(line) + '</td>';
    const lineResults = perSupplier.map(function (p) { return p.results[li]; });
    const validTotals = lineResults.filter(function (r) { return !r.error; }).map(function (r) { return r.lineTotal; });
    const minTotal = validTotals.length ? Math.min.apply(null, validTotals) : null;
    lineResults.forEach(function (r) {
      if (r.error) {
        html += '<td class="cell-error">' + r.message + '</td>';
      } else {
        const isCheapest = minTotal !== null && r.lineTotal === minTotal;
        const cls = isCheapest ? 'cell-cheapest' : (minTotal !== null ? 'cell-expensive' : '');
        html += '<td class="' + cls + '">' + fmt(r.unitPrice) + ' / Stk.<br><span class="small">Summe: ' + fmt(r.lineTotal) + '</span></td>';
      }
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';

  // Zusammenfassung
  html += '<div class="result-summary">';
  perSupplier.forEach(function (p) {
    const isCheapest = cheapest && p.supplier.id === cheapest.supplier.id;
    html += '<div class="summary-card' + (isCheapest ? ' is-cheapest' : '') + '">';
    html += '<h3>' + escapeHtml(p.supplier.name) + (isCheapest ? '<span class="badge">Günstigster</span>' : '') + '</h3>';
    html += '<div class="summary-total">' + fmt(p.total) + '</div>';
    if (p.errorCount > 0) {
      html += '<div class="small" style="color:var(--color-danger);margin-top:4px;">' + p.errorCount + ' Position(en) ohne Preis – Summe unvollständig</div>';
    }
    if (!isCheapest && cheapest) {
      const neg = computeNegotiation(p.totalBase, p.supplier.stages, cheapest.total);
      if (neg && !neg.alreadyCheaperOrEqual) {
        html += '<div class="negotiation-box">' +
          'Aktuell <strong>' + fmt(p.total - cheapest.total) + '</strong> teurer (' + fmtPct((p.total / cheapest.total - 1) * 100) + ').<br>' +
          'Um gleichzuziehen, wäre ein Gesamtrabatt von <strong>' + fmtPct(neg.requiredDiscountPct) + '</strong> nötig ' +
          '(aktuell ' + fmtPct(neg.currentDiscountPct) + ').<br>' +
          (neg.feasible && neg.newStage3Pct !== null
            ? 'Konkret: Stufe 3 müsste von ' + fmtPct(Number(p.supplier.stages[2] || 0)) + ' auf <strong>' + fmtPct(neg.newStage3Pct) + '</strong> steigen (Stufen 1 &amp; 2 unverändert).'
            : 'Mit den aktuellen Stufen 1 &amp; 2 allein nicht erreichbar – es müsste an mehreren Stufen angesetzt werden.') +
          '</div>';
      }
    }
    html += '</div>';
  });
  html += '</div>';

  container.innerHTML = html;
}

/* ---------- Render: Rastervergleich & Verhandlung ---------- */

function renderCompare() {
  renderTestDimsTable();
  renderCompareResults();
}

function renderTestDimsTable() {
  const container = document.getElementById('compareTable');
  // Testmaß-Tabelle wird zusammen mit den Ergebnissen weiter unten gerendert,
  // hier nur die Eingabetabelle an den Anfang des Containers setzen.
  let html = '';
  if (!state.testDims.length) {
    html += '<p class="small">Noch keine Testmaße erfasst.</p>';
  } else {
    html += '<div class="table-wrap"><table class="data-table"><thead><tr><th>Länge</th><th>Breite</th><th>Menge</th><th></th></tr></thead><tbody>';
    state.testDims.forEach(function (td) {
      html += '<tr>' +
        '<td><input type="number" value="' + (td.length || '') + '" onchange="updateTestDimField(\'' + td.id + '\', \'length\', this.value)"></td>' +
        '<td><input type="number" value="' + (td.width || '') + '" onchange="updateTestDimField(\'' + td.id + '\', \'width\', this.value)"></td>' +
        '<td><input type="number" value="' + (td.qty || 1) + '" style="width:60px" onchange="updateTestDimField(\'' + td.id + '\', \'qty\', this.value)"></td>' +
        '<td><button class="icon-btn" onclick="removeTestDim(\'' + td.id + '\')">✕</button></td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
  }
  container.innerHTML = html + '<div id="compareResults"></div>';
  renderCompareResultsInto(document.getElementById('compareResults'));
}

function renderCompareResults() {
  const el = document.getElementById('compareResults');
  if (el) renderCompareResultsInto(el);
}

function renderCompareResultsInto(el) {
  if (!state.suppliers.length) {
    el.innerHTML = '<p class="small">Bitte zuerst Lieferanten anlegen.</p>';
    return;
  }
  if (!state.testDims.length) {
    el.innerHTML = '';
    return;
  }

  let html = '<h3 style="margin-top:20px;">Vergleich</h3>';
  html += '<div class="table-wrap"><table class="data-table"><thead><tr><th>Maß (L×B), Menge</th>';
  state.suppliers.forEach(function (s) { html += '<th>' + escapeHtml(s.name) + '</th>'; });
  html += '</tr></thead><tbody>';

  const winCount = {};
  state.suppliers.forEach(function (s) { winCount[s.id] = 0; });

  state.testDims.forEach(function (td) {
    const length = Number(td.length), width = Number(td.width);
    html += '<tr><td style="text-align:left;">' + (length || '?') + '×' + (width || '?') + ', ' + (td.qty || 1) + ' Stk.</td>';
    const perSupplier = state.suppliers.map(function (s) {
      if (!length || !width) return { supplier: s, error: true, message: 'Maße fehlen' };
      const res = getGridCellPrice(s, length, width);
      if (res.error) return { supplier: s, error: true, message: res.message };
      const unitPrice = applyChain(res.price, s.stages);
      return { supplier: s, error: false, basePrice: res.price, unitPrice: unitPrice, matchedLength: res.matchedLength, matchedWidth: res.matchedWidth };
    });
    const validPrices = perSupplier.filter(function (r) { return !r.error; }).map(function (r) { return r.unitPrice; });
    const minPrice = validPrices.length ? Math.min.apply(null, validPrices) : null;

    perSupplier.forEach(function (r) {
      if (r.error) {
        html += '<td class="cell-error">' + r.message + '</td>';
        return;
      }
      const isCheapest = minPrice !== null && r.unitPrice === minPrice;
      if (isCheapest) winCount[r.supplier.id]++;
      let cellHtml = fmt(r.unitPrice) + ' <span class="small">(Raster ' + r.matchedLength + '×' + r.matchedWidth + ')</span>';
      if (!isCheapest && minPrice !== null) {
        const neg = computeNegotiation(r.basePrice, r.supplier.stages, minPrice);
        cellHtml += '<br><span class="small">+' + fmtPct((r.unitPrice / minPrice - 1) * 100) + ' teurer';
        if (neg && !neg.alreadyCheaperOrEqual && neg.feasible && neg.newStage3Pct !== null) {
          cellHtml += ' · Stufe 3 → ' + fmtPct(neg.newStage3Pct);
        }
        cellHtml += '</span>';
      }
      html += '<td class="' + (isCheapest ? 'cell-cheapest' : (minPrice !== null ? 'cell-expensive' : '')) + '">' + cellHtml + '</td>';
    });
    html += '</tr>';
  });

  html += '</tbody></table></div>';

  html += '<p class="small" style="margin-top:10px;">';
  html += state.suppliers.map(function (s) {
    return escapeHtml(s.name) + ': bei ' + winCount[s.id] + ' von ' + state.testDims.length + ' Testmaßen günstigster Anbieter';
  }).join(' · ');
  html += '</p>';

  el.innerHTML = html;
}

function addTestDim() {
  state.testDims.push({ id: uid('td'), length: '', width: '', qty: 1 });
  persistAndRender();
}

function removeTestDim(id) {
  state.testDims = state.testDims.filter(function (t) { return t.id !== id; });
  persistAndRender();
}

function updateTestDimField(id, field, value) {
  const td = findTestDim(id); if (!td) return;
  const n = Number(String(value).replace(',', '.'));
  td[field] = isNaN(n) ? '' : n;
  persistAndRender();
}

function unionTestDims() {
  if (!state.suppliers.length) return;
  let allLengths = [], allWidths = [];
  state.suppliers.forEach(function (s) {
    allLengths = allLengths.concat(s.grid.lengths);
    allWidths = allWidths.concat(s.grid.widths);
  });
  allLengths = uniqueSorted(allLengths);
  allWidths = uniqueSorted(allWidths);

  function sample(arr, max) {
    if (arr.length <= max) return arr;
    const step = Math.ceil(arr.length / max);
    const out = [];
    for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
    return out;
  }
  const Ls = sample(allLengths, 8);
  const Ws = sample(allWidths, 8);

  const existing = new Set(state.testDims.map(function (t) { return t.length + '|' + t.width; }));
  Ls.forEach(function (L) {
    Ws.forEach(function (W) {
      const key = L + '|' + W;
      if (!existing.has(key)) {
        state.testDims.push({ id: uid('td'), length: L, width: W, qty: 1 });
        existing.add(key);
      }
    });
  });
  persistAndRender();
}

/* ---------- Export / Import / Reset ---------- */

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'kostenvergleich-export.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.suppliers)) throw new Error('Ungültiges Format');
      state = Object.assign(defaultState(), parsed);
      selectedGridSupplierId = null;
      persistAndRender();
    } catch (e) {
      alert('Import fehlgeschlagen: ' + e.message);
    }
  };
  reader.readAsText(file);
}

function loadDemo() {
  if (state.suppliers.length || state.specialItems.length || state.orderLines.length) {
    if (!confirm('Aktuelle Daten werden durch Beispieldaten ersetzt. Fortfahren?')) return;
  }
  state = demoState();
  selectedGridSupplierId = null;
  persistAndRender();
}

function resetAll() {
  if (!confirm('Wirklich alle Daten unwiderruflich löschen?')) return;
  state = defaultState();
  selectedGridSupplierId = null;
  persistAndRender();
}

/* ---------- Gesamt-Render & Init ---------- */

function renderAll() {
  renderSuppliers();
  renderGridsTab();
  renderSpecials();
  renderCalc();
  renderCompare();
}

function init() {
  state = loadState() || demoState();

  setupTabs();

  document.getElementById('btnAddSupplier').addEventListener('click', addSupplier);
  document.getElementById('btnAddSpecial').addEventListener('click', addSpecialItem);
  document.getElementById('btnAddGridLine').addEventListener('click', addGridLine);
  document.getElementById('btnAddSpecialLine').addEventListener('click', addSpecialLine);
  document.getElementById('btnAddTestDim').addEventListener('click', addTestDim);
  document.getElementById('btnUnionTestDims').addEventListener('click', unionTestDims);

  document.getElementById('btnLoadDemo').addEventListener('click', loadDemo);
  document.getElementById('btnExport').addEventListener('click', exportJson);
  document.getElementById('btnReset').addEventListener('click', resetAll);
  document.getElementById('fileImport').addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });

  renderAll();
}

init();
