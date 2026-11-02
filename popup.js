const DEFAULT_KEYBIND = 'Ctrl+Shift+H';
const extensionApi = globalThis.browser && globalThis.browser.runtime
  ? globalThis.browser
  : globalThis.chrome;
const providerInputs = [...document.querySelectorAll('input[name="provider"]')];
const apiKeyInput = document.getElementById('apiKey');
const modelSelect = document.getElementById('model');
const validateButton = document.getElementById('validate');
const keybindInput = document.getElementById('keybind');
const saveButton = document.getElementById('save');
const status = document.getElementById('status');

function sendMessage(message) {
  return extensionApi.runtime.sendMessage(message);
}

function selectedProvider() {
  return providerInputs.find((input) => input.checked).value;
}

function setStatus(message) {
  status.textContent = message;
}

function getKeyName(event) {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return '';
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Meta');
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...modifiers, key].join('+');
}

function populateModels(models, selectedModel) {
  modelSelect.replaceChildren();
  models.forEach((model) => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    option.selected = model === selectedModel;
    modelSelect.appendChild(option);
  });
  modelSelect.disabled = models.length === 0;
}

async function loadSettings() {
  const settings = await sendMessage({ type: 'get-settings' });
  const provider = settings.provider || 'groq';
  providerInputs.forEach((input) => {
    input.checked = input.value === provider;
  });
  apiKeyInput.value = settings.apiKeys?.[provider] || '';
  keybindInput.value = settings.keybind || DEFAULT_KEYBIND;
  if (settings.models?.[provider]?.length) {
    populateModels(settings.models[provider], settings.models[provider].includes(settings.model) ? settings.model : settings.models[provider][0]);
  }
}

providerInputs.forEach((input) => {
  input.addEventListener('change', () => {
    sendMessage({ type: 'get-settings' }).then((settings) => {
      apiKeyInput.value = settings.apiKeys?.[input.value] || '';
    });
    modelSelect.disabled = true;
    modelSelect.replaceChildren(new Option('Validate your API key first'));
    setStatus(`Enter your ${input.value} API key, then validate it.`);
  });
});

apiKeyInput.addEventListener('input', () => {
  const apiKey = apiKeyInput.value.trim();
  if (apiKey) {
    sendMessage({ type: 'save-api-key', provider: selectedProvider(), apiKey });
  }
});

validateButton.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    setStatus('An API key is required.');
    return;
  }
  validateButton.disabled = true;
  setStatus('Validating API key and loading models...');
  try {
    const result = await sendMessage({ type: 'validate-provider', provider: selectedProvider(), apiKey });
    if (!result.ok) throw new Error(result.error);
    populateModels(result.models, result.models[0]);
    setStatus(`API key valid. ${result.models.length} model(s) available.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    validateButton.disabled = false;
  }
});

keybindInput.addEventListener('click', () => {
  keybindInput.focus();
  setStatus('Ready: press your key combination now.');
});

keybindInput.addEventListener('focus', () => {
  setStatus('Ready: press your key combination now.');
});

keybindInput.addEventListener('keydown', (event) => {
  event.preventDefault();
  event.stopPropagation();
  const keybind = getKeyName(event);
  if (keybind) {
    keybindInput.value = keybind;
    setStatus(`Captured: ${keybind}. Click Save settings.`);
  }
});

saveButton.addEventListener('click', async () => {
  const provider = selectedProvider();
  if (!apiKeyInput.value.trim()) {
    setStatus(`Enter a ${provider} API key first.`);
    return;
  }
  if (modelSelect.disabled) {
    setStatus('Validate the API key and select a model first.');
    return;
  }
  await sendMessage({
    type: 'save-settings',
    settings: {
      provider,
      apiKey: apiKeyInput.value.trim(),
      model: modelSelect.value,
      keybind: keybindInput.value || DEFAULT_KEYBIND
    }
  });
  setStatus('Settings saved.');
});

loadSettings().catch((error) => setStatus(error.message));
