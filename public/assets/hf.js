```javascript
(() => {
  'use strict';

  const PRESETS = {
    fastfit: {
      label: 'FastFit (Multi-Garment + Shoes)',
      space: 'PrathamMMallya999/fastfit-tryon',
      api: '/generation_wrapper',

      types: {
        top: 'upper',
        upper: 'upper',
        upper_body: 'upper',
        shirt: 'upper',
        blouse: 'upper',

        bottom: 'lower',
        lower: 'lower',
        lower_body: 'lower',
        pants: 'lower',
        trousers: 'lower',

        outer: 'upper',
        jacket: 'upper',
        coat: 'upper',
        manteau: 'upper',

        dress: 'dress',
        overall: 'dress',
        onepiece: 'dress',

        shoe: 'shoe',
        shoes: 'shoe',
        footwear: 'shoe',

        bag: 'bag',
        handbag: 'bag',
      },

      build: (person, garments) => [
        person,
        garments.upper,
        garments.lower,
        garments.dress,
        garments.shoe,
        garments.bag,
        512,
        30,
        2.5,
        false,
        42,
        true,
      ],
    },

    leffa: {
      label: 'Leffa',
      space: 'franciszzj/Leffa',
      api: '/leffa_predict_vt',

      types: {
        top: 'upper_body|viton_hd',
        bottom: 'lower_body|dress_code',
        outer: 'dresses|dress_code',
      },

      build: (person, cloth, type) => {
        const [garmentType, modelType] = type.split('|');

        return [
          person,
          cloth,
          false,
          30,
          2.5,
          42,
          modelType,
          garmentType,
          false,
        ];
      },
    },

    catvton: {
      label: 'CatVTON',
      space: 'zhengchong/CatVTON',
      api: '/submit_function',

      types: {
        top: 'upper',
        bottom: 'lower',
        outer: 'overall',
      },

      build: (person, cloth, type) => [
        {
          background: person,
          layers: [],
          composite: null,
        },
        cloth,
        type,
        50,
        2.5,
        42,
        'result only',
      ],
    },

    idm: {
      label: 'IDM-VTON',
      space: 'yisol/IDM-VTON',
      api: '/tryon',

      types: {
        top: 'upper',
        outer: 'upper',
      },

      build: (person, cloth, _type, description) => [
        {
          background: person,
          layers: [],
          composite: null,
        },
        cloth,
        description || 'garment',
        true,
        false,
        30,
        42,
      ],
    },
  };

  const spaceHost = (spaceId) =>
    'https://' +
    spaceId.trim().toLowerCase().replace(/[/_.]/g, '-') +
    '.hf.space';

  const authHeaders = (token) =>
    token ? { Authorization: 'Bearer ' + token } : {};

  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const header = parts[0];
    const base64 = parts[1];

    if (!header || !base64) {
      throw new Error('Invalid image data URL.');
    }

    const mime =
      (header.match(/:(.*?);/) || [])[1] || 'image/png';

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new Blob([bytes], { type: mime });
  }

  async function readError(response) {
    let message = '';

    try {
      message = await response.text();
    } catch (_) {
      message = '';
    }

    message = message.slice(0, 500);

    try {
      const json = JSON.parse(message);
      message =
        json.detail ||
        json.error ||
        json.message ||
        message;
    } catch (_) {
      // Keep the original response text.
    }

    if (response.status === 401 || response.status === 403) {
      message = 'Authentication or permission error. ' + message;
    } else if (response.status === 429) {
      message = 'Rate limit reached. ' + message;
    } else if (
      response.status === 404 ||
      response.status === 503
    ) {
      message = 'Space unavailable or starting up. ' + message;
    }

    return `HTTP ${response.status}: ${message}`;
  }

  async function upload(host, token, blob, filename) {
    const formData = new FormData();

    formData.append('files', blob, filename);

    const response = await fetch(
      host + '/gradio_api/upload',
      {
        method: 'POST',
        headers: authHeaders(token),
        body: formData,
      }
    );

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const paths = await response.json();

    if (!Array.isArray(paths) || !paths[0]) {
      throw new Error('Upload returned no file path.');
    }

    return {
      path: paths[0],
      orig_name: filename,
      meta: {
        _type: 'gradio.FileData',
      },
    };
  }

  async function callApi(host, token, api, data, onWait) {
    const endpoint = api.replace(/^\//, '');

    const response = await fetch(
      `${host}/gradio_api/call/${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(token),
        },
        body: JSON.stringify({ data }),
      }
    );

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const payload = await response.json();
    const eventId = payload.event_id;

    if (!eventId) {
      throw new Error('API did not return an event ID.');
    }

    const streamResponse = await fetch(
      `${host}/gradio_api/call/${endpoint}/${eventId}`,
      {
        headers: authHeaders(token),
      }
    );

    if (!streamResponse.ok) {
      throw new Error(await readError(streamResponse));
    }

    if (!streamResponse.body) {
      throw new Error('Streaming response is unavailable.');
    }

    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();

    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();

      if (value) {
        buffer += decoder.decode(value, { stream: true });
      }

      let separatorIndex;

      while (
        (separatorIndex = buffer.indexOf('\n\n')) !== -1
      ) {
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);

        const eventMatch = block.match(/^event:\s*(.*)$/m);
        const dataMatch = block.match(/^data:\s*(.*)$/m);

        const eventName = eventMatch ? eventMatch[1] : '';
        const eventData = dataMatch ? dataMatch[1] : '';

        if (eventName === 'complete') {
          await reader.cancel().catch(() => {});

          try {
            return JSON.parse(eventData);
          } catch (_) {
            throw new Error('Invalid completion response.');
          }
        }

        if (eventName === 'error') {
          let detail = eventData;

          try {
            detail = JSON.parse(eventData);
          } catch (_) {
            // Keep the original error text.
          }

          throw new Error(
            'Space execution failed: ' +
            (
              typeof detail === 'string'
                ? detail
                : JSON.stringify(detail)
            )
          );
        }

        if (eventName === 'heartbeat' && onWait) {
          onWait();
        }
      }

      if (done) {
        break;
      }
    }

    throw new Error('The API response ended before completion.');
  }

  function findFile(output) {
    const stack = Array.isArray(output)
      ? [...output]
      : [output];

    const visited = new Set();

    while (stack.length) {
      const item = stack.shift();

      if (!item || typeof item !== 'object') {
        continue;
      }

      if (visited.has(item)) {
        continue;
      }

      visited.add(item);

      if (item.path || item.url) {
        return item;
      }

      stack.push(...Object.values(item));
    }

    return null;
  }

  async function info(spaceId, token) {
    const host = spaceHost(spaceId);

    const response = await fetch(
      host + '/gradio_api/info',
      {
        headers: authHeaders(token),
      }
    );

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const json = await response.json();
    const endpoints = json.named_endpoints || {};

    const details = Object.entries(endpoints).map(
      ([name, endpoint]) => {
        const parameters = (endpoint.parameters || [])
          .map((parameter) => {
            const parameterName =
              parameter.parameter_name ||
              parameter.label ||
              'unknown';

            const defaultValue =
              parameter.parameter_has_default
                ? '=' +
                  JSON.stringify(parameter.parameter_default)
                : '';

            return parameterName + defaultValue;
          });

        return `${name}: ${parameters.join(', ')}`;
      }
    );

    return details.join('\n') || 'No named endpoints found.';
  }

  async function fetchResultAsDataUrl(
    host,
    token,
    file
  ) {
    const url =
      file.url ||
      `${host}/gradio_api/file=${file.path}`;

    const response = await fetch(url, {
      headers: authHeaders(token),
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const blob = await response.blob();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(
        new Error('Failed to read the generated image.')
      );

      reader.readAsDataURL(blob);
    });
  }

  async function runFastFit({
    host,
    token,
    preset,
    personDataUrl,
    steps,
    onProgress,
  }) {
    if (!personDataUrl) {
      throw new Error('A person image is required.');
    }

    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error('Select at least one garment.');
    }

    const person = await upload(
      host,
      token,
      dataUrlToBlob(personDataUrl),
      'person.png'
    );

    const garments = {
      upper: null,
      lower: null,
      dress: null,
      shoe: null,
      bag: null,
    };

    const usedCategories = new Set();

    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];

      const rawType = String(
        step.cat || step.type || ''
      )
        .trim()
        .toLowerCase();

      const category = preset.types[rawType];

      if (!category) {
        throw new Error(
          `Unsupported garment category: ${rawType}`
        );
      }

      if (!step.garmentDataUrl) {
        throw new Error(
          `Missing garment image: ${step.label || category}`
        );
      }

      if (usedCategories.has(category)) {
        throw new Error(
          `Only one image per category is supported: ${category}`
        );
      }

      usedCategories.add(category);

      if (onProgress) {
        onProgress(
          index + 1,
          steps.length,
          step.label || category
        );
      }

      garments[category] = await upload(
        host,
        token,
        dataUrlToBlob(step.garmentDataUrl),
        `${category}.png`
      );
    }

    if (
      garments.dress &&
      (garments.upper || garments.lower)
    ) {
      throw new Error(
        'A one-piece garment cannot be combined with separate upper or lower garments.'
      );
    }

    if (onProgress) {
      onProgress(
        steps.length,
        steps.length,
        'Generating final image'
      );
    }

    const output = await callApi(
      host,
      token,
      preset.api,
      preset.build(person, garments),
      () => {
        if (onProgress) {
          onProgress(
            steps.length,
            steps.length,
            'Waiting for FastFit'
          );
        }
      }
    );

    const outputFile = findFile(output);

    if (!outputFile) {
      throw new Error(
        'FastFit returned no image. Check the API response and optional image inputs.'
      );
    }

    try {
      return await fetchResultAsDataUrl(
        host,
        token,
        outputFile
      );
    } catch (_) {
      return (
        outputFile.url ||
        `${host}/gradio_api/file=${outputFile.path}`
      );
    }
  }

  async function run({
    spaceId,
    presetKey,
    token = '',
    personDataUrl,
    steps,
    onProgress,
  }) {
    const preset = PRESETS[presetKey];

    if (!preset) {
      throw new Error(`Unknown preset: ${presetKey}`);
    }

    const selectedSpace = spaceId || preset.space;
    const host = spaceHost(selectedSpace);

    if (presetKey === 'fastfit') {
      return runFastFit({
        host,
        token,
        preset,
        personDataUrl,
        steps,
        onProgress,
      });
    }

    if (!personDataUrl) {
      throw new Error('A person image is required.');
    }

    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error('Select at least one garment.');
    }

    let person = await upload(
      host,
      token,
      dataUrlToBlob(personDataUrl),
      'person.png'
    );

    let lastOutput = null;

    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];

      if (!step.garmentDataUrl) {
        throw new Error(
          `Missing garment image: ${step.label || 'garment'}`
        );
      }

      if (onProgress) {
        onProgress(
          index + 1,
          steps.length,
          step.label || 'Processing garment'
        );
      }

      const cloth = await upload(
        host,
        token,
        dataUrlToBlob(step.garmentDataUrl),
        'garment.png'
      );

      const garmentType =
        preset.types[step.type || step.cat];

      if (!garmentType) {
        throw new Error(
          `Unsupported garment type: ${step.type || step.cat}`
        );
      }

      const output = await callApi(
        host,
        token,
        preset.api,
        preset.build(
          person,
          cloth,
          garmentType,
          step.label
        ),
        () => {
          if (onProgress) {
            onProgress(
              index + 1,
              steps.length,
              'Waiting for model'
            );
          }
        }
      );

      lastOutput = findFile(output);

      if (!lastOutput) {
        throw new Error(
          'The model returned no image output.'
        );
      }

      if (index < steps.length - 1) {
        person = {
          path: lastOutput.path,
          url: lastOutput.url,
          orig_name: lastOutput.orig_name || 'result.png',
          meta: {
            _type: 'gradio.FileData',
          },
        };
      }
    }

    try {
      return await fetchResultAsDataUrl(
        host,
        token,
        lastOutput
      );
    } catch (_) {
      return (
        lastOutput.url ||
        `${host}/gradio_api/file=${lastOutput.path}`
      );
    }
  }

  window.HFTryOn = {
    PRESETS,
    spaceHost,
    info,
    run,
  };
})();
```
