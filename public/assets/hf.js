(() => {
  'use strict';

  const DEFAULT_SPACE = 'PrathamMMallya999/fastfit-tryon';
  const API_NAME = '/generation_wrapper';

  function getHost(spaceId) {
    const normalized = String(spaceId || '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(normalized)) {
      throw new Error('Enter a valid Hugging Face Space ID in owner/space-name format.');
    }
    return 'https://' + normalized.toLowerCase().replace(/[/_.]/g, '-') + '.hf.space';
  }

  function authHeaders(token) {
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  function dataUrlToBlob(dataUrl) {
    const response = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
    if (!response) throw new Error('Invalid image data.');
    const mime = response[1] || 'application/octet-stream';
    const payload = response[3];
    if (response[2]) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(payload)], { type: mime });
  }

  async function readError(response) {
    let body = '';
    try { body = (await response.text()).slice(0, 700); } catch (_) {}
    try {
      const parsed = JSON.parse(body);
      body = parsed.detail || parsed.error || parsed.message || body;
    } catch (_) {}
    if (response.status === 401 || response.status === 403) {
      body = 'Authentication or permission error. ' + body;
    } else if (response.status === 429) {
      body = 'Rate limit reached. ' + body;
    } else if (response.status === 404 || response.status === 503) {
      body = 'Space unavailable or starting up. ' + body;
    }
    return 'HTTP ' + response.status + (body ? ': ' + body : '');
  }

  async function upload(host, token, dataUrl, filename) {
    const formData = new FormData();
    formData.append('files', dataUrlToBlob(dataUrl), filename);
    const response = await fetch(host + '/gradio_api/upload', {
      method: 'POST',
      headers: authHeaders(token),
      body: formData
    });
    if (!response.ok) throw new Error(await readError(response));
    const paths = await response.json();
    if (!Array.isArray(paths) || !paths[0]) throw new Error('The Space upload endpoint returned no file path.');
    return { path: paths[0], orig_name: filename, meta: { _type: 'gradio.FileData' } };
  }

  async function callApi(host, token, data, onWait) {
    const response = await fetch(host + '/gradio_api/call/' + API_NAME.replace(/^\//, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ data })
    });
    if (!response.ok) throw new Error(await readError(response));
    const payload = await response.json();
    if (!payload.event_id) throw new Error('The Space did not return an event ID.');
    const eventResponse = await fetch(host + '/gradio_api/call/' + API_NAME.replace(/^\//, '') + '/' + encodeURIComponent(payload.event_id), {
      headers: authHeaders(token)
    });
    if (!eventResponse.ok) throw new Error(await readError(eventResponse));
    const text = await eventResponse.text();
    const events = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).filter(Boolean);
    for (const event of events) {
      let parsed;
      try { parsed = JSON.parse(event); } catch (_) { continue; }
      if (Array.isArray(parsed) && parsed.length) return parsed;
      if (parsed && parsed.error) throw new Error(String(parsed.error));
    }
    if (onWait) onWait('The model returned no output payload.');
    throw new Error('No result was returned. The Space may be busy or its API schema may have changed.');
  }

  function findFile(value) {
    if (!value) return null;
    if (Array.isArray(value)) {
      for (const item of value) { const found = findFile(item); if (found) return found; }
    } else if (typeof value === 'object') {
      if (typeof value.url === 'string' || typeof value.path === 'string') return value;
      for (const key of Object.keys(value)) { const found = findFile(value[key]); if (found) return found; }
    }
    return null;
  }

  async function fetchResultAsDataUrl(host, token, file) {
    const url = file.url
      ? new URL(file.url, host).href
      : host + '/gradio_api/file=' + String(file.path).replace(/^\/+/, '');
    const response = await fetch(url, { headers: authHeaders(token) });
    if (!response.ok) throw new Error(await readError(response));
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read the generated image.'));
      reader.readAsDataURL(blob);
    });
  }

  async function generate(options) {
    const host = getHost(options.spaceId || DEFAULT_SPACE);
    const token = (options.token || '').trim();
    const imageKeys = ['person', 'upper', 'lower', 'dress', 'shoes', 'bag'];
    for (const key of imageKeys) {
      if (!options.images || !options.images[key]) {
        throw new Error('Missing required image: ' + key + '. The current API schema expects all six image inputs.');
      }
    }

    if (options.onStatus) options.onStatus('Uploading six images to the Hugging Face Space…');
    const labels = {
      person: 'person.png',
      upper: 'upper.png',
      lower: 'lower.png',
      dress: 'dress.png',
      shoes: 'shoes.png',
      bag: 'bag.png'
    };
    const uploaded = {};
    for (const key of imageKeys) {
      if (options.onStatus) options.onStatus('Uploading ' + key + ' image…');
      uploaded[key] = await upload(host, token, options.images[key], labels[key]);
    }

    const data = [
      uploaded.person,
      uploaded.upper,
      uploaded.lower,
      uploaded.dress,
      uploaded.shoes,
      uploaded.bag,
      Number(options.refSize || 512),
      Number(options.steps || 30),
      Number(options.guidance || 2.5),
      Boolean(options.squareMask),
      Number(options.seed ?? 42),
      Boolean(options.poseGuidance)
    ];

    if (options.onStatus) options.onStatus('Generating outfit. The model may take several minutes…');
    const result = await callApi(host, token, data, options.onStatus);
    const file = findFile(result[0]);
    if (!file) throw new Error('The Space completed but no output image was found in its response.');
    if (options.onStatus) options.onStatus('Downloading generated image…');
    const imageDataUrl = await fetchResultAsDataUrl(host, token, file);
    return { imageDataUrl, raw: result };
  }

  async function testConnection(spaceId, token) {
    const host = getHost(spaceId || DEFAULT_SPACE);
    const response = await fetch(host + '/config', { headers: authHeaders((token || '').trim()) });
    if (!response.ok) throw new Error(await readError(response));
    const config = await response.json();
    const api = config && config.named_endpoints && config.named_endpoints[API_NAME];
    return { host, endpoint: API_NAME, available: Boolean(api), config };
  }

  window.FastFitTryOn = { DEFAULT_SPACE, generate, testConnection };
})();
