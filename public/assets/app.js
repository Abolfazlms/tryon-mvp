/* اتاق پرو آنلاین — MVP
 * فقط HTML/CSS/JS ساده؛ بدون بک‌اند. کاتالوگ از data/catalog.json خوانده می‌شود
 * (که GitHub Actions از CSV می‌سازد).
 */
(() => {
  'use strict';

  /* ---------- ثابت‌ها ---------- */
  const CATS = [
    { id: 'top', label: 'بالاتنه' },
    { id: 'outer', label: 'مانتو / کت' },
    { id: 'bottom', label: 'شلوار' },
    { id: 'shoes', label: 'کفش' },
  ];
  const CAT_LABEL = Object.fromEntries(CATS.map(c => [c.id, c.label]));
  const GEMINI_MODEL = 'gemini-2.5-flash-image';

  const state = {
    catalog: [],
    charts: null,
    gender: 'women',
    m: { height: 165, weight: 60, chest: null, waist: null, hip: null, foot: null },
    cat: 'top',
    selection: {},            // { top: id, outer: id, ... }
    filters: { shop: '', sort: 'default', mySize: false },
    photo: null,              // dataURL (کوچک‌شده)
    aiImage: null,            // dataURL
    view: 'mannequin',
  };

  const $ = (s, r = document) => r.querySelector(s);
  const fmtPrice = n => n.toLocaleString('fa-IR') + ' تومان';
  const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;

  /* ---------- اندازه‌ها و پیشنهاد سایز ---------- */
  // تخمین ساده از قد و وزن (فرمول ساده‌ی خودمان؛ فقط وقتی کاربر دور بدن را وارد نکرده)
  function resolveMeasures() {
    const { height, weight } = state.m;
    const bmi = weight / Math.pow(height / 100, 2);
    const w = state.gender === 'women';
    const est = {
      chest: w ? 46 + 1.9 * bmi : 54 + 1.9 * bmi,
      waist: w ? 24 + 2.2 * bmi : 34 + 2.2 * bmi,
      hip: w ? 48 + 2.2 * bmi : 52 + 1.9 * bmi,
      foot: height * 0.15,
    };
    const out = { height, weight, estimated: [] };
    for (const k of ['chest', 'waist', 'hip', 'foot']) {
      if (state.m[k] != null) out[k] = state.m[k];
      else { out[k] = Math.round(est[k] * 2) / 2; out.estimated.push(k); }
    }
    return out;
  }

  function sizeIndex(chart, key, value) {
    const arr = chart[key];
    const i = arr.findIndex(max => value <= max);
    return i === -1 ? arr.length : i; // arr.length = بزرگ‌تر از جدول
  }

  function recommend(p, m) {
    if (p.category === 'shoes') {
      const eu = Math.round((m.foot + 1.5) * 1.5);
      const avail = p.sizes.map(Number).sort((a, b) => a - b);
      const pick = avail.find(s => s >= eu) ?? avail[avail.length - 1];
      const note = pick === eu ? '' : (avail.includes(eu) ? '' : `سایز ${eu} موجود نیست؛ نزدیک‌ترین: ${pick}`);
      return { size: String(pick), note, ideal: String(eu) };
    }
    const chart = state.charts[state.gender];
    let idx;
    if (p.category === 'top') idx = sizeIndex(chart, 'chest', m.chest);
    else if (p.category === 'outer') idx = Math.max(sizeIndex(chart, 'chest', m.chest), sizeIndex(chart, 'hip', m.hip));
    else idx = Math.max(sizeIndex(chart, 'waist', m.waist), sizeIndex(chart, 'hip', m.hip));
    if (idx >= chart.sizes.length) return { size: null, note: 'اندازه‌ی شما از جدول عمومی بزرگ‌تر است؛ جدول برند را ببینید.', ideal: null };
    const ideal = chart.sizes[idx];
    if (p.sizes.includes(ideal)) return { size: ideal, note: '', ideal };
    // نزدیک‌ترین سایز موجود (ترجیحاً بزرگ‌تر)
    const order = chart.sizes;
    const have = p.sizes.filter(s => order.includes(s)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const larger = have.find(s => order.indexOf(s) > idx);
    const smaller = [...have].reverse().find(s => order.indexOf(s) < idx);
    const pick = larger || smaller;
    return pick
      ? { size: pick, note: `سایز ${ideal} موجود نیست؛ نزدیک‌ترین: ${pick}`, ideal }
      : { size: null, note: 'سایز مناسب موجود نیست.', ideal };
  }

  /* ---------- مانکن SVG ---------- */
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = v => Math.max(0, Math.min(255, Math.round(v * f)));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c).map(v => v.toString(16).padStart(2, '0')).join('');
  }

  // sel: { top: product, ... }  opts: { hideBody, crop:[f0,f1] }
  function figureSVG(m, sel, opts = {}) {
    const s = 3.2, top = 30, cx = 160, H = m.height;
    const Y = f => top + f * H * s;
    const W = c => (c / 3) * s;
    const chestW = W(m.chest), waistW = W(m.waist), hipW = W(m.hip);
    const shW = chestW + 5 * s;
    const skin = '#cdd2d8', skinLine = '#b4bac2';
    const pts = a => a.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
    const mirror = (a) => [...a.map(([x, y]) => [cx - x, y]), ...[...a].reverse().map(([x, y]) => [cx + x, y])];

    const torso = (e, hemF, flare = 0) => pts(mirror([
      [5 * s + e * 0.3, Y(0.15)], [shW / 2 + e, Y(0.175)], [chestW / 2 + e, Y(0.27)],
      [waistW / 2 + e, Y(0.385)], [hipW / 2 + e + flare * 0.5, Y(0.5)], [hipW / 2 + e + flare, Y(hemF)],
    ]));

    // بازو: از شانه تا مچ (t = نسبت طول)
    const shoulder = side => [cx + side * (shW / 2 - 2 * s), Y(0.19)];
    const wrist = side => [cx + side * (shW / 2 + 8 * s), Y(0.47)];
    const armLine = (side, t, width, color) => {
      const [x0, y0] = shoulder(side), [x1, y1] = wrist(side);
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      return `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="${(width * s).toFixed(1)}" stroke-linecap="round"/>`;
    };

    const leg = (side, expand, ankleCm) => {
      const topC = cx + side * (hipW / 4 + 0.8 * s);
      const topW = hipW / 2 - 1.6 * s + expand * 2;
      const kneeW = topW * 0.68;
      const ankW = ankleCm * s + expand * 2;
      const kneeC = cx + side * (hipW / 4 + 0.2 * s);
      const ankC = cx + side * (hipW / 4 - 0.4 * s);
      return pts([
        [topC - topW / 2, Y(0.495)], [topC + topW / 2, Y(0.495)],
        [kneeC + kneeW / 2, Y(0.72)], [ankC + ankW / 2, Y(0.95)],
        [ankC - ankW / 2, Y(0.95)], [kneeC - kneeW / 2, Y(0.72)],
      ]);
    };
    const ankleX = side => cx + side * (hipW / 4 - 0.4 * s);

    let g = '';
    // سایه‌ی کف
    g += `<ellipse cx="${cx}" cy="${Y(0.995).toFixed(1)}" rx="${(hipW * 0.9).toFixed(1)}" ry="${(2 * s).toFixed(1)}" fill="rgba(0,0,0,.12)"/>`;

    if (!opts.hideBody) {
      // پاها
      for (const sd of [-1, 1]) g += `<polygon points="${leg(sd, 0, 7)}" fill="${skin}" stroke="${skin}" stroke-width="3" stroke-linejoin="round"/>`;
      // بازوها
      for (const sd of [-1, 1]) {
        g += armLine(sd, 1, 7, skin);
        const [wx, wy] = wrist(sd);
        g += `<circle cx="${wx.toFixed(1)}" cy="${(wy + 2 * s).toFixed(1)}" r="${(3.2 * s).toFixed(1)}" fill="${skin}"/>`;
      }
      // تنه، گردن، سر
      g += `<polygon points="${torso(0, 0.5)}" fill="${skin}" stroke="${skin}" stroke-width="4" stroke-linejoin="round"/>`;
      g += `<rect x="${(cx - 5 * s).toFixed(1)}" y="${Y(0.115).toFixed(1)}" width="${(10 * s).toFixed(1)}" height="${(0.05 * H * s).toFixed(1)}" fill="${skin}"/>`;
      g += `<ellipse cx="${cx}" cy="${Y(0.065).toFixed(1)}" rx="${(7.6 * s).toFixed(1)}" ry="${(0.066 * H * s).toFixed(1)}" fill="${skin}" stroke="${skinLine}"/>`;
    }

    // شلوار
    const b = sel.bottom;
    if (b) {
      const wide = b.style === 'wide';
      const col = b.color_hex, edge = shade(col, 0.72);
      g += `<polygon points="${pts(mirror([[waistW / 2 + 1.5 * s, Y(0.4)], [hipW / 2 + 2 * s, Y(0.5)], [hipW / 2 + 1.5 * s, Y(0.54)], [2 * s, Y(0.56)]]))}" fill="${col}" stroke="${edge}" stroke-width="1.5" stroke-linejoin="round"/>`;
      for (const sd of [-1, 1]) g += `<polygon points="${leg(sd, wide ? 1.8 * s : 1.2 * s, wide ? 17 : 10)}" fill="${col}" stroke="${edge}" stroke-width="1.5" stroke-linejoin="round"/>`;
      g += `<line x1="${(cx - waistW / 2 - 1.5 * s).toFixed(1)}" y1="${Y(0.402).toFixed(1)}" x2="${(cx + waistW / 2 + 1.5 * s).toFixed(1)}" y2="${Y(0.402).toFixed(1)}" stroke="${edge}" stroke-width="3"/>`;
    }

    // بالاتنه
    const t = sel.top;
    if (t) {
      const col = t.color_hex, edge = shade(col, 0.72), long = t.style === 'shirt';
      if (long) for (const sd of [-1, 1]) g += armLine(sd, 0.98, 9.5, col);
      else for (const sd of [-1, 1]) g += armLine(sd, 0.36, 10, col);
      g += `<polygon points="${torso(1.5 * s, 0.5, 1.2 * s)}" fill="${col}" stroke="${edge}" stroke-width="1.5" stroke-linejoin="round"/>`;
      if (long) g += `<line x1="${cx}" y1="${Y(0.16).toFixed(1)}" x2="${cx}" y2="${Y(0.5).toFixed(1)}" stroke="${edge}" stroke-width="1"/>`;
      g += `<path d="M ${cx - 4.5 * s} ${Y(0.152).toFixed(1)} Q ${cx} ${Y(0.19).toFixed(1)} ${cx + 4.5 * s} ${Y(0.152).toFixed(1)}" fill="none" stroke="${edge}" stroke-width="2"/>`;
    }

    // مانتو / کت
    const o = sel.outer;
    if (o) {
      const col = o.color_hex, edge = shade(col, 0.7), long = o.style === 'long';
      const hem = long ? 0.8 : 0.62;
      for (const sd of [-1, 1]) g += armLine(sd, 1.0, 10.5, col);
      g += `<polygon points="${torso(2.6 * s, hem, long ? 3.2 * s : 1.8 * s)}" fill="${col}" stroke="${edge}" stroke-width="1.5" stroke-linejoin="round"/>`;
      g += `<line x1="${cx}" y1="${Y(0.155).toFixed(1)}" x2="${cx}" y2="${Y(hem).toFixed(1)}" stroke="${edge}" stroke-width="1.6"/>`;
      g += `<path d="M ${cx - 6 * s} ${Y(0.16).toFixed(1)} L ${cx} ${Y(0.23).toFixed(1)} L ${cx + 6 * s} ${Y(0.16).toFixed(1)}" fill="none" stroke="${edge}" stroke-width="2"/>`;
    }

    // کفش
    const sh = sel.shoes;
    for (const sd of [-1, 1]) {
      const ax = ankleX(sd), fy = Y(0.978);
      if (!sh) { if (!opts.hideBody) g += `<ellipse cx="${(ax + sd * 2 * s).toFixed(1)}" cy="${fy.toFixed(1)}" rx="${(5.2 * s).toFixed(1)}" ry="${(2.4 * s).toFixed(1)}" fill="${skin}"/>`; continue; }
      const col = sh.color_hex, edge = shade(col, 0.7);
      if (sh.style === 'boot') {
        g += `<rect x="${(ax - 4.6 * s).toFixed(1)}" y="${Y(0.905).toFixed(1)}" width="${(9.2 * s).toFixed(1)}" height="${(Y(0.985) - Y(0.905)).toFixed(1)}" rx="${(1.5 * s).toFixed(1)}" fill="${col}" stroke="${edge}" stroke-width="1.5"/>`;
        g += `<ellipse cx="${(ax + sd * 3 * s).toFixed(1)}" cy="${(fy + 0.6 * s).toFixed(1)}" rx="${(6.4 * s).toFixed(1)}" ry="${(2.5 * s).toFixed(1)}" fill="${col}" stroke="${edge}" stroke-width="1.5"/>`;
      } else {
        const rx = sh.style === 'flat' ? 6.2 : 6.9;
        g += `<ellipse cx="${(ax + sd * 2.8 * s).toFixed(1)}" cy="${fy.toFixed(1)}" rx="${(rx * s).toFixed(1)}" ry="${(2.6 * s).toFixed(1)}" fill="${col}" stroke="${edge}" stroke-width="1.5"/>`;
        if (sh.style === 'sneaker') g += `<ellipse cx="${(ax + sd * 2.8 * s).toFixed(1)}" cy="${(fy + 1.7 * s).toFixed(1)}" rx="${(rx * s).toFixed(1)}" ry="${(0.9 * s).toFixed(1)}" fill="#f3f3f3" stroke="${edge}" stroke-width="1"/>`;
      }
    }

    let vb = `0 0 320 ${(H * s + 70).toFixed(0)}`;
    if (opts.crop) {
      const y0 = Y(opts.crop[0]), y1 = Y(opts.crop[1]);
      const [xa, xw] = opts.crop[2] || [30, 260];
      vb = `${xa} ${y0.toFixed(0)} ${xw} ${(y1 - y0).toFixed(0)}`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="مانکن">${g}</svg>`;
  }

  const ICON_M = { height: 170, weight: 65, chest: 92, waist: 74, hip: 98 };
  const ICON_CROP = { top: [0.13, 0.53], outer: [0.13, 0.83], bottom: [0.38, 0.97], shoes: [0.86, 1.0, [95, 130]] };
  function iconSVG(p) {
    return figureSVG(ICON_M, { [p.category]: p }, { hideBody: true, crop: ICON_CROP[p.category] });
  }

  /* ---------- کاتالوگ و رندر ---------- */
  function selectedProducts() {
    const out = {};
    for (const [cat, id] of Object.entries(state.selection)) {
      const p = state.catalog.find(x => x.id === id);
      if (p) out[cat] = p;
    }
    return out;
  }

  function visibleProducts() {
    const m = resolveMeasures();
    let list = state.catalog.filter(p =>
      p.category === state.cat && (p.gender === 'unisex' || p.gender === state.gender));
    if (state.filters.shop) list = list.filter(p => p.shop === state.filters.shop);
    if (state.filters.mySize) list = list.filter(p => recommend(p, m).size && p.sizes.includes(recommend(p, m).size) && !recommend(p, m).note);
    if (state.filters.sort === 'asc') list.sort((a, b) => a.price - b.price);
    if (state.filters.sort === 'desc') list.sort((a, b) => b.price - a.price);
    return list;
  }

  function renderProducts() {
    const m = resolveMeasures();
    const ul = $('#products');
    const list = visibleProducts();
    if (!list.length) { ul.innerHTML = '<li class="empty">موردی پیدا نشد.</li>'; return; }
    ul.innerHTML = list.map(p => {
      const r = recommend(p, m);
      const sel = state.selection[p.category] === p.id;
      const sizes = p.sizes.map(s => `<span class="${s === r.size ? 'rec' : ''}">${s}</span>`).join('');
      return `<li class="product" data-selected="${sel}">
        <div class="thumb">${iconSVG(p)}</div>
        <div>
          <h4>${p.title}</h4>
          <div class="meta"><span>${p.shop}</span><span><i class="dot" style="background:${p.color_hex}"></i> ${p.color_name}</span></div>
          <div class="sizes" aria-label="سایزهای موجود">${sizes}</div>
          ${r.size ? `<p class="hint" style="margin:0">سایز پیشنهادی: <b dir="ltr">${r.size}</b></p>` : ''}
          ${r.note ? `<p class="note">${r.note}</p>` : ''}
          <div class="row"><span class="price">${fmtPrice(p.price)}</span>
            <button type="button" data-pick="${p.id}" class="${sel ? '' : 'primary'}">${sel ? 'برداشتن' : 'امتحان کن'}</button></div>
        </div></li>`;
    }).join('');
  }

  function renderSummary() {
    const m = resolveMeasures();
    const sel = selectedProducts();
    const cats = CATS.filter(c => sel[c.id]);
    const box = $('#summary');
    if (!cats.length) { box.innerHTML = '<p class="hint">هنوز لباسی انتخاب نشده است.</p>'; return; }
    let total = 0;
    const rows = cats.map(c => {
      const p = sel[c.id], r = recommend(p, m);
      total += p.price;
      return `<li><span>${CAT_LABEL[c.id]}: ${p.title} <span class="muted">(${p.shop}${r.size ? '، سایز ' + r.size : ''})</span></span>
        <span>${fmtPrice(p.price)}</span></li>`;
    }).join('');
    box.innerHTML = `<ul>${rows}<li class="total"><span>جمع</span><span>${fmtPrice(total)}</span></li></ul>
      <p class="hint">${cats.map(c => `<a href="${sel[c.id].url}" target="_blank" rel="noopener noreferrer">خرید ${CAT_LABEL[c.id]}</a>`).join(' · ')}</p>`;
  }

  function renderView() {
    const box = $('#view-box');
    const m = resolveMeasures();
    $('#estimate-hint').textContent = m.estimated.length
      ? 'اندازه‌های خالی از روی قد و وزن تخمین زده می‌شوند. برای سایز دقیق‌تر، دور بدن را وارد کنید.' : '';
    $('#view-tabs [data-view=photo]').hidden = !state.photo;
    $('#view-tabs [data-view=ai]').hidden = !state.aiImage;
    document.querySelectorAll('#view-tabs button').forEach(b =>
      b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
    if (state.view === 'photo' && state.photo) box.innerHTML = `<img alt="عکس شما" src="${state.photo}">`;
    else if (state.view === 'ai' && state.aiImage) box.innerHTML = `<img alt="تصویر ساخته‌شده با هوش مصنوعی" src="${state.aiImage}">`;
    else box.innerHTML = figureSVG(m, selectedProducts());
  }

  function renderAll() { renderProducts(); renderSummary(); renderView(); }

  /* ---------- ذخیره‌ی اندازه‌ها (فقط در همین مرورگر) ---------- */
  const KEY = 'tryon-mvp-body-v1';
  function saveBody() { try { localStorage.setItem(KEY, JSON.stringify({ gender: state.gender, m: state.m })); } catch (_) { /* ممنوع/پر */ } }
  function loadBody() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && d.m) { state.gender = d.gender === 'men' ? 'men' : 'women'; Object.assign(state.m, d.m); }
    } catch (_) { /* خراب */ }
  }
  function syncForm() {
    const f = $('#body-form');
    f.elements.gender.value = state.gender;
    for (const k of ['height', 'weight', 'chest', 'waist', 'hip', 'foot']) f.elements[k].value = state.m[k] ?? '';
  }

  /* ---------- رویدادها ---------- */
  function bind() {
    const f = $('#body-form');
    f.addEventListener('input', () => {
      state.gender = f.elements.gender.value;
      const h = num(f.elements.height.value), w = num(f.elements.weight.value);
      state.m.height = h && h >= 140 && h <= 210 ? h : state.m.height;
      state.m.weight = w && w >= 35 && w <= 160 ? w : state.m.weight;
      for (const k of ['chest', 'waist', 'hip', 'foot']) state.m[k] = num(f.elements[k].value);
      // انتخاب‌های ناسازگار با جنسیت حذف شوند
      for (const [cat, id] of Object.entries(state.selection)) {
        const p = state.catalog.find(x => x.id === id);
        if (p && p.gender !== 'unisex' && p.gender !== state.gender) delete state.selection[cat];
      }
      state.aiImage = null; if (state.view === 'ai') state.view = 'mannequin';
      saveBody(); renderAll();
    });
    f.addEventListener('submit', e => e.preventDefault());

    $('#cat-tabs').addEventListener('click', e => {
      const b = e.target.closest('button[data-cat]'); if (!b) return;
      state.cat = b.dataset.cat; renderCatTabs(); renderProducts();
    });
    $('#products').addEventListener('click', e => {
      const b = e.target.closest('button[data-pick]'); if (!b) return;
      const p = state.catalog.find(x => x.id === b.dataset.pick);
      if (state.selection[p.category] === p.id) delete state.selection[p.category];
      else state.selection[p.category] = p.id;
      state.aiImage = null; if (state.view === 'ai') state.view = 'mannequin';
      renderAll();
    });
    $('#f-shop').addEventListener('change', e => { state.filters.shop = e.target.value; renderProducts(); });
    $('#f-sort').addEventListener('change', e => { state.filters.sort = e.target.value; renderProducts(); });
    $('#f-mysize').addEventListener('change', e => { state.filters.mySize = e.target.checked; renderProducts(); });

    $('#view-tabs').addEventListener('click', e => {
      const b = e.target.closest('button[data-view]'); if (!b) return;
      state.view = b.dataset.view; renderView();
    });
    $('#btn-reset').addEventListener('click', () => { state.selection = {}; state.aiImage = null; state.view = 'mannequin'; renderAll(); });
    $('#btn-download').addEventListener('click', downloadFigure);

    $('#photo-input').addEventListener('change', onPhoto);
    $('#photo-clear').addEventListener('click', () => {
      state.photo = null; state.aiImage = null; state.view = 'mannequin';
      $('#photo-input').value = ''; $('#photo-clear').hidden = true; renderView();
    });

    $('#btn-ai').addEventListener('click', openAI);
    $('#ai-form').addEventListener('submit', e => {
      if (e.submitter && e.submitter.value === 'go') {
        e.preventDefault();
        if (!$('#ai-consent').checked) { alert('برای ادامه، رضایت لازم است.'); return; }
        if (provider() === 'gemini') {
          const key = $('#ai-key').value.trim();
          if (!key) { alert('کلید API را وارد کنید.'); return; }
          $('#ai-dialog').close(); runAI(key);
        } else {
          $('#ai-dialog').close(); runHF();
        }
      }
    });
    document.querySelectorAll('[name=provider]').forEach(r => r.addEventListener('change', syncProvider));
    $('#hf-preset').addEventListener('change', () => { $('#hf-space').value = HFTryOn.PRESETS[$('#hf-preset').value].space; });
    $('#hf-test').addEventListener('click', testHF);
  }

  function renderCatTabs() {
    $('#cat-tabs').innerHTML = CATS.map(c =>
      `<button role="tab" data-cat="${c.id}" aria-selected="${c.id === state.cat}">${c.label}${state.selection[c.id] ? ' ✓' : ''}</button>`).join('');
  }

  /* ---------- عکس ---------- */
  function onPhoto(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert('فقط فایل تصویر قابل قبول است.'); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1024, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      state.photo = c.toDataURL('image/jpeg', 0.9);
      URL.revokeObjectURL(url);
      state.view = 'photo'; $('#photo-clear').hidden = false; state.aiImage = null; renderView();
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('این عکس خوانده نشد.'); };
    img.src = url;
  }

  /* ---------- خروجی PNG و کمکی‌های تصویر ---------- */
  function svgToCanvas(svg, w, h, bg) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d');
        if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
        x.drawImage(img, 0, 0, w, h); resolve(c);
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  async function downloadFigure() {
    const m = resolveMeasures();
    const svg = figureSVG(m, selectedProducts()).replace('<svg ', '<svg width="640" height="' + Math.round((m.height * 3.2 + 70) * 2) + '" ');
    const c = await svgToCanvas(svg, 640, Math.round((m.height * 3.2 + 70) * 2), '#ffffff');
    const a = document.createElement('a'); a.download = 'mannequin.png'; a.href = c.toDataURL('image/png'); a.click();
  }

  /* ---------- حالت هوش مصنوعی (آزمایشی) ---------- */
  function openAI() {
    if (!state.photo) { alert('اول یک عکس تمام‌قد بارگذاری کنید.'); return; }
    if (!Object.keys(state.selection).length) { alert('حداقل یک لباس انتخاب کنید.'); return; }
    initHFDialog();
    $('#ai-dialog').showModal();
  }

  async function garmentImage(p) {
    if (p.image) {
      try {
        const r = await fetch(p.image); const b = await r.blob();
        const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });
        return { mime: b.type || 'image/jpeg', data: String(data).split(',')[1] };
      } catch (_) { /* CORS یا خطا؛ به آیکن برمی‌گردیم */ }
    }
    const c = await svgToCanvas(iconSVG(p).replace('<svg ', '<svg width="384" height="480" '), 384, 480, '#ffffff');
    return { mime: 'image/png', data: c.toDataURL('image/png').split(',')[1] };
  }

  async function runAI(key) {
    const box = $('#view-box'); const btn = $('#btn-ai');
    btn.disabled = true;
    box.innerHTML = '<p class="busy">در حال ساخت تصویر… ممکن است تا نیم دقیقه طول بکشد.</p>';
    try {
      const m = resolveMeasures();
      const sel = selectedProducts();
      const order = CATS.map(c => c.id).filter(id => sel[id]);
      const lines = order.map((id, i) => {
        const p = sel[id], r = recommend(p, m);
        return `Image ${i + 2}: ${id} garment — "${p.title}", color ${p.color_name}${r.size ? ', size ' + r.size : ''}`;
      });
      const prompt = [
        'You are a virtual try-on system. Image 1 is the customer. The other images are garments.',
        ...lines,
        `Dress the customer in ALL of these garments together as one outfit.`,
        `Rules: keep the customer's face, hair, skin tone, body shape, proportions, pose and the background exactly unchanged. Change only the clothing.`,
        `Scale and drape the garments realistically for a ${state.gender === 'men' ? 'male' : 'female'} body ${m.height} cm tall, ${m.weight} kg, chest ${m.chest} cm, waist ${m.waist} cm, hips ${m.hip} cm.`,
        `Output one photorealistic full-body image of the customer.`,
      ].join('\n');

      const parts = [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: state.photo.split(',')[1] } }];
      for (const id of order) { const g = await garmentImage(sel[id]); parts.push({ inline_data: { mime_type: g.mime, data: g.data } }); }

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts }] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json.error && json.error.message) || `HTTP ${res.status}`);
      const out = (((json.candidates || [])[0] || {}).content || {}).parts || [];
      const imgPart = out.find(p => p.inlineData || p.inline_data);
      if (!imgPart) throw new Error('مدل تصویری برنگرداند.' + (out.find(p => p.text) ? ' پیام مدل: ' + out.find(p => p.text).text.slice(0, 200) : ''));
      const d = imgPart.inlineData || imgPart.inline_data;
      state.aiImage = `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`;
      state.view = 'ai';
    } catch (err) {
      alert('ساخت تصویر ناموفق بود: ' + err.message);
    } finally {
      btn.disabled = false; $('#ai-key').value = ''; renderView();
    }
  }

  /* ---------- حالت رایگان Hugging Face ---------- */
  const garmentOverrides = {};   // { productId: dataURL }
  const provider = () => (document.querySelector('[name=provider]:checked') || {}).value || 'hf';

  function syncProvider() {
    $('#box-hf').hidden = provider() !== 'hf';
    $('#box-gemini').hidden = provider() !== 'gemini';
  }

  function initHFDialog() {
    const sel = $('#hf-preset');
    if (!sel.options.length) {
      sel.innerHTML = Object.entries(HFTryOn.PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
      $('#hf-space').value = HFTryOn.PRESETS[sel.value].space;
    }
    const box = $('#hf-garments');
    const items = Object.values(selectedProducts()).filter(p => p.category !== 'shoes');
    box.innerHTML = items.length ? items.map(p =>
      `<label class="field">${CAT_LABEL[p.category]}: ${p.title}
         <input type="file" accept="image/*" data-garment="${p.id}">
         <span class="hint">${garmentOverrides[p.id] ? 'عکس انتخاب شده است.' : 'بدون عکس: آیکن ساده'}</span></label>`).join('')
      : '<p class="hint">لباس قابل‌پوشیدن (غیر از کفش) انتخاب نشده است.</p>';
    box.querySelectorAll('input[data-garment]').forEach(inp => inp.addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { garmentOverrides[e.target.dataset.garment] = await fileToDataUrl(f, 768); e.target.nextElementSibling.textContent = 'عکس انتخاب شد.'; }
      catch (_) { alert('این عکس خوانده نشد.'); }
    }));
    syncProvider();
  }

  function fileToDataUrl(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.92));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')); };
      img.src = url;
    });
  }

  async function testHF() {
    const out = $('#hf-test-out'); out.hidden = false; out.textContent = 'در حال بررسی…';
    try { out.textContent = await HFTryOn.info($('#hf-space').value, $('#hf-token').value.trim()); }
    catch (e) { out.textContent = 'ناموفق: ' + e.message; }
  }

  async function runHF() {
    const box = $('#view-box'), btn = $('#btn-ai');
    const presetKey = $('#hf-preset').value, preset = HFTryOn.PRESETS[presetKey];
    const spaceId = $('#hf-space').value.trim(), token = $('#hf-token').value.trim();
    const sel = selectedProducts();
    // ترتیب لایه‌ها: شلوار، بالاتنه، مانتو/کت
    const order = ['bottom', 'top', 'outer'].filter(c => sel[c]);
    const skipped = Object.keys(sel).filter(c => !order.includes(c) || !preset.types[c]);
    const todo = order.filter(c => preset.types[c]);
    if (!todo.length) { alert('این مدل هیچ‌کدام از لباس‌های انتخاب‌شده را پشتیبانی نمی‌کند. مدل دیگری انتخاب کنید.'); return; }
    btn.disabled = true;
    try {
      const steps = [];
      for (const c of todo) {
        const p = sel[c];
        let g = garmentOverrides[p.id];
        if (!g) {
          const cv = await svgToCanvas(iconSVG(p).replace('<svg ', '<svg width="384" height="480" '), 384, 480, '#ffffff');
          g = cv.toDataURL('image/png');
        }
        steps.push({ cat: c, type: preset.types[c], label: p.title, garmentDataUrl: g });
      }
      const dataUrl = await HFTryOn.run({
        spaceId, presetKey, token, personDataUrl: state.photo, steps,
        onProgress: (i, n, label) => { box.innerHTML = `<p class="busy">مرحله ${i} از ${n}: ${label}<br>ممکن است هر مرحله تا چند دقیقه طول بکشد (صف رایگان).</p>`; },
      });
      state.aiImage = dataUrl; state.view = 'ai';
      if (skipped.length) setTimeout(() => alert('این موارد در تصویر نیامدند (پشتیبانی نمی‌شود): ' + skipped.map(c => CAT_LABEL[c]).join('، ')), 100);
    } catch (err) {
      alert('ساخت تصویر ناموفق بود: ' + err.message);
    } finally {
      btn.disabled = false; $('#hf-token').value = ''; renderView();
    }
  }

  /* ---------- شروع ---------- */
  async function init() {
    try {
      const [cat, charts] = await Promise.all([
        fetch('data/catalog.json').then(r => { if (!r.ok) throw new Error('catalog'); return r.json(); }),
        fetch('data/size_charts.json').then(r => { if (!r.ok) throw new Error('charts'); return r.json(); }),
      ]);
      state.catalog = cat.items; state.charts = charts;
      $('#catalog-info').textContent = `کاتالوگ نمونه: ${cat.count} کالا · به‌روزرسانی ${new Date(cat.updated_at).toLocaleDateString('fa-IR')}`;
    } catch (e) {
      document.querySelector('main').insertAdjacentHTML('afterbegin',
        '<p class="notice">کاتالوگ بارگذاری نشد. اگر این صفحه را روی کامپیوتر خودتان باز کرده‌اید، ابتدا «python3 scripts/build_catalog.py» را اجرا کنید و با یک سرور محلی باز کنید.</p>');
      return;
    }
    const shops = [...new Set(state.catalog.map(p => p.shop))];
    $('#f-shop').insertAdjacentHTML('beforeend', shops.map(s => `<option>${s}</option>`).join(''));
    loadBody(); syncForm(); renderCatTabs(); bind(); renderAll();
  }
  init();
})();
