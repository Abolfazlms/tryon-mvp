/* حالت رایگان: صدا زدن Space عمومی Hugging Face از طریق API مستند Gradio (REST).
 * بدون کتابخانه. نام endpoint و ترتیب پارامترها در PRESETS است؛ اگر Space عوض شد
 * فقط همین‌جا (یا دکمه‌ی «تست اتصال») باید دیده و اصلاح شود.
 */
(() => {
  'use strict';

  // person = FileData شخص؛ cloth = FileData لباس
  const PRESETS = {
    catvton: {
      label: 'CatVTON (بالاتنه، شلوار و مانتو)',
      space: 'zhengchong/CatVTON',
      api: '/submit_function',
      types: { top: 'upper', bottom: 'lower', outer: 'overall' },
      build: (person, cloth, type) => [
        { background: person, layers: [], composite: null }, cloth, type, 50, 2.5, 42, 'result only'],
    },
    idm: {
      label: 'IDM-VTON (فقط بالاتنه و مانتو)',
      space: 'yisol/IDM-VTON',
      api: '/tryon',
      types: { top: 'upper', outer: 'upper' },
      build: (person, cloth, _type, desc) => [
        { background: person, layers: [], composite: null }, cloth, desc || 'garment', true, false, 30, 42],
    },
  };

  const spaceHost = id => 'https://' + id.trim().toLowerCase().replace(/[/_.]/g, '-') + '.hf.space';
  const authHeaders = token => (token ? { Authorization: 'Bearer ' + token } : {});

  function dataUrlToBlob(u) {
    const [head, b64] = u.split(',');
    const mime = (head.match(/:(.*?);/) || [])[1] || 'image/png';
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  async function readError(res) {
    let t = ''; try { t = await res.text(); } catch (_) { /* خالی */ }
    let msg = t.slice(0, 300);
    try { const j = JSON.parse(t); msg = j.detail || j.error || j.message || msg; } catch (_) { /* متن ساده */ }
    if (res.status === 401 || res.status === 403) msg = 'توکن پذیرفته نشد یا دسترسی ندارد. ' + msg;
    if (res.status === 429) msg = 'سهمیه‌ی رایگان امروز تمام شده یا درخواست‌ها زیادند؛ بعداً دوباره امتحان کنید. ' + msg;
    if (res.status === 404 || res.status === 503) msg = 'Space در دسترس نیست یا خوابیده است (چند دقیقه بعد امتحان کنید) یا آدرسش عوض شده. ' + msg;
    return `HTTP ${res.status}: ${msg}`;
  }

  async function upload(host, token, blob, name) {
    const fd = new FormData(); fd.append('files', blob, name);
    const res = await fetch(host + '/gradio_api/upload', { method: 'POST', headers: authHeaders(token), body: fd });
    if (!res.ok) throw new Error(await readError(res));
    const paths = await res.json();
    if (!Array.isArray(paths) || !paths[0]) throw new Error('آپلود پاسخ معتبر نداد.');
    return { path: paths[0], orig_name: name, meta: { _type: 'gradio.FileData' } };
  }

  async function callApi(host, token, api, data, onWait) {
    const name = api.replace(/^\//, '');
    const res = await fetch(`${host}/gradio_api/call/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const { event_id } = await res.json();
    if (!event_id) throw new Error('event_id برنگشت.');
    const stream = await fetch(`${host}/gradio_api/call/${name}/${event_id}`, { headers: authHeaders(token) });
    if (!stream.ok) throw new Error(await readError(stream));
    const reader = stream.body.getReader(); const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = (block.match(/^event: *(.*)$/m) || [])[1];
        const dat = (block.match(/^data: *(.*)$/m) || [])[1];
        if (ev === 'complete') { reader.cancel().catch(() => {}); return JSON.parse(dat); }
        if (ev === 'error') {
          let m = dat; try { m = JSON.parse(dat); } catch (_) { /* متن */ }
          throw new Error('خطای Space: ' + (m && m !== 'null' ? (typeof m === 'string' ? m : JSON.stringify(m)) : 'نامشخص (معمولاً تمام‌شدن سهمیه‌ی GPU یا ورودی نامعتبر)'));
        }
        if (ev === 'heartbeat' && onWait) onWait();
      }
      if (done) break;
    }
    throw new Error('پاسخ Space ناتمام ماند.');
  }

  function findFile(out) {
    const stack = Array.isArray(out) ? [...out] : [out];
    while (stack.length) {
      const x = stack.shift();
      if (x && typeof x === 'object') {
        if (x.path || x.url) return x;
        stack.push(...Object.values(x));
      }
    }
    return null;
  }

  async function info(spaceId, token) {
    const host = spaceHost(spaceId);
    const res = await fetch(host + '/gradio_api/info', { headers: authHeaders(token) });
    if (!res.ok) throw new Error(await readError(res));
    const j = await res.json();
    const ne = j.named_endpoints || {};
    return Object.entries(ne).map(([k, v]) =>
      `${k}: ` + (v.parameters || []).map(p => `${p.parameter_name || p.label}${p.parameter_has_default ? '=' + JSON.stringify(p.parameter_default) : ''}`).join(', ')
    ).join('\n') || 'endpoint نامدار پیدا نشد.';
  }

  // steps: [{ cat, type, label, garmentDataUrl }] به ترتیب اجرا؛ خروجی هر مرحله ورودی مرحله‌ی بعد است.
  async function run({ spaceId, presetKey, token, personDataUrl, steps, onProgress }) {
    const preset = PRESETS[presetKey];
    const host = spaceHost(spaceId);
    let person = await upload(host, token, dataUrlToBlob(personDataUrl), 'person.jpg');
    let last = null;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      onProgress && onProgress(i + 1, steps.length, s.label);
      const cloth = await upload(host, token, dataUrlToBlob(s.garmentDataUrl), 'garment.png');
      const out = await callApi(host, token, preset.api, preset.build(person, cloth, s.type, s.label));
      const f = findFile(out);
      if (!f) throw new Error('Space تصویری برنگرداند.');
      last = f;
      // ورودی مرحله‌ی بعد: همان فایل روی همان Space
      person = { path: f.path || f.url, url: f.url, orig_name: f.orig_name || 'result.png', meta: { _type: 'gradio.FileData' } };
    }
    const url = last.url || `${host}/gradio_api/file=${last.path}`;
    // به data URL تبدیل می‌کنیم تا بعد از بسته‌شدن Space هم قابل نمایش باشد
    try {
      const r = await fetch(url, { headers: authHeaders(token) });
      if (r.ok) {
        const b = await r.blob();
        return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });
      }
    } catch (_) { /* CORS؛ آدرس مستقیم */ }
    return url;
  }

  window.HFTryOn = { PRESETS, spaceHost, info, run };
})();
