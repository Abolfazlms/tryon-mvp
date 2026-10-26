(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const imageState = { person: null, upper: null, lower: null, dress: null, shoes: null, bag: null };
  const fileNames = { person: 'person-image', upper: 'upper-image', lower: 'lower-image', dress: 'dress-image', shoes: 'shoes-image', bag: 'bag-image' };
  const previewIds = { person: 'person-preview', upper: 'upper-preview', lower: 'lower-preview', dress: 'dress-preview', shoes: 'shoes-preview', bag: 'bag-preview' };

  const status = (message, kind = '') => {
    const node = $('#status');
    node.textContent = message;
    node.className = 'status' + (kind ? ' ' + kind : '');
  };

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No file selected.'));
      if (!file.type.startsWith('image/')) return reject(new Error('Please select an image file.'));
      if (file.size > 15 * 1024 * 1024) return reject(new Error('Each image must be 15 MB or smaller.'));
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read the selected image.'));
      reader.readAsDataURL(file);
    });
  }

  async function handleImageInput(key) {
    const file = $('#' + fileNames[key]).files[0];
    const preview = $('#' + previewIds[key]);
    if (!file) {
      imageState[key] = null;
      preview.replaceChildren(document.createElement('span'));
      preview.firstChild.textContent = 'No image selected';
      return;
    }
    try {
      const dataUrl = await loadImage(file);
      imageState[key] = dataUrl;
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = key + ' preview';
      preview.replaceChildren(img);
      status('Loaded ' + key + ' image.');
    } catch (error) {
      imageState[key] = null;
      $('#' + fileNames[key]).value = '';
      preview.textContent = error.message;
      status(error.message, 'error');
    }
  }

  function settings() {
    const steps = Number($('#steps').value);
    const guidance = Number($('#guidance').value);
    const seed = Number($('#seed').value);
    const refSize = Number($('#ref-size').value);
    if (!Number.isInteger(steps) || steps < 10 || steps > 60) throw new Error('Inference steps must be an integer from 10 to 60.');
    if (!Number.isFinite(guidance) || guidance < 1 || guidance > 10) throw new Error('Guidance scale must be between 1 and 10.');
    if (!Number.isInteger(seed) || seed < 0) throw new Error('Seed must be a non-negative integer.');
    return {
      spaceId: $('#hf-space').value.trim(),
      token: $('#hf-token').value.trim(),
      refSize,
      steps,
      guidance,
      seed,
      squareMask: $('#square-mask').checked,
      poseGuidance: $('#pose-guidance').checked
    };
  }

  function validateTryOnInputs() {
    const missing = Object.keys(imageState).filter(key => !imageState[key]);
    if (missing.length) {
      throw new Error('Please upload all required images before generating: ' + missing.join(', ') + '. The current FastFit API schema marks all six image inputs as required.');
    }
  }

  async function generate() {
    const button = $('#generate-btn');
    button.disabled = true;
    $('#download-result').hidden = true;
    try {
      validateTryOnInputs();
      const options = { ...settings(), images: { ...imageState }, onStatus: message => status(message) };
      const result = await window.FastFitTryOn.generate(options);
      const image = document.createElement('img');
      image.src = result.imageDataUrl;
      image.alt = 'AI-generated virtual try-on result';
      $('#result').replaceChildren(image);
      const download = $('#download-result');
      download.href = result.imageDataUrl;
      download.hidden = false;
      status('Generation completed.', 'success');
    } catch (error) {
      status(error.message || String(error), 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function testConnection() {
    const button = $('#test-btn');
    button.disabled = true;
    try {
      const result = await window.FastFitTryOn.testConnection($('#hf-space').value, $('#hf-token').value);
      if (result.available) status('Space is reachable and endpoint ' + result.endpoint + ' is listed in its config.', 'success');
      else status('Space is reachable, but the expected endpoint was not found in the returned config. Check the API name in hf.js.', 'error');
    } catch (error) {
      status('Connection test failed: ' + (error.message || String(error)), 'error');
    } finally {
      button.disabled = false;
    }
  }

  function restoreToken() {
    try {
      const saved = localStorage.getItem('fastfit_hf_token');
      if (saved) {
        $('#hf-token').value = saved;
        $('#remember-token').checked = true;
      }
    } catch (_) {}
  }

  function saveTokenPreference() {
    try {
      if ($('#remember-token').checked) localStorage.setItem('fastfit_hf_token', $('#hf-token').value.trim());
      else localStorage.removeItem('fastfit_hf_token');
    } catch (_) {
      status('Browser storage is unavailable; token was not remembered.', 'error');
    }
  }

  Object.keys(fileNames).forEach(key => {
    $('#' + fileNames[key]).addEventListener('change', () => handleImageInput(key));
  });
  $('#generate-btn').addEventListener('click', generate);
  $('#test-btn').addEventListener('click', testConnection);
  $('#remember-token').addEventListener('change', saveTokenPreference);
  $('#hf-token').addEventListener('change', saveTokenPreference);
  restoreToken();
})();
