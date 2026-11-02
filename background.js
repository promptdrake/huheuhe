const DEFAULT_KEYBIND = 'Ctrl+Shift+H';
const DEFAULT_MODELS = {
  groq: ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  biznetgio: ['openai/gpt-oss-20b']
};
const extensionApi = globalThis.browser && globalThis.browser.runtime
  ? globalThis.browser
  : globalThis.chrome;
const PROVIDERS = {
  groq: {
    modelsUrl: 'https://api.groq.com/openai/v1/models',
    chatUrl: 'https://api.groq.com/openai/v1/chat/completions'
  },
  deepseek: {
    modelsUrl: 'https://api.deepseek.com/models',
    chatUrl: 'https://api.deepseek.com/chat/completions'
  },
  biznetgio: {
    chatUrl: 'https://api.biznetgio.ai/v1/chat/completions'
  }
};

let settings = {
  provider: 'groq',
  apiKeys: {},
  model: DEFAULT_MODELS.groq[0],
  models: DEFAULT_MODELS,
  keybind: DEFAULT_KEYBIND
};

extensionApi.storage.local.get(settings, (stored) => {
  settings = { ...settings, ...stored, apiKeys: stored.apiKeys || {}, models: stored.models || DEFAULT_MODELS };
});

async function requestJson(url, apiKey, body) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Provider request failed (${response.status}).`);
  return data;
}

async function validateProvider(provider, apiKey) {
  if (provider === 'biznetgio') {
    await requestJson(PROVIDERS.biznetgio.chatUrl, apiKey, {
      model: DEFAULT_MODELS.biznetgio[0],
      messages: [{ role: 'user', content: 'Respond with OK.' }],
      max_tokens: 2
    });
    return DEFAULT_MODELS.biznetgio;
  }
  const data = await requestJson(PROVIDERS[provider].modelsUrl, apiKey);
  const models = (data.data || []).map((model) => model.id).filter(Boolean);
  return models.length ? models : DEFAULT_MODELS[provider];
}

async function answerFields(fields) {
  const provider = settings.provider;
  const apiKey = settings.apiKeys[provider];
  if (!apiKey || !settings.model) throw new Error('Configure and validate an AI provider first.');
  const prompt = [
    'Read every question carefully. Return only valid JSON in this exact shape: {"answers":[{"id":"field-0","answer":"exact answer"}]}.',
    'Return exactly one answer object for every field ID. Use the exact visible option label for select/radio/checkbox fields. Never guess from field order or answer a different question.',
    JSON.stringify(fields)
  ].join('\n');
  const data = await requestJson(PROVIDERS[provider].chatUrl, apiKey, {
    model: settings.model,
    messages: [
      { role: 'system', content: 'You answer educational quiz questions accurately and concisely.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0
  });
  const content = data.choices?.[0]?.message?.content || '';
  const jsonMatch = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('The AI returned no usable answers. Try again.');
  const parsed = JSON.parse(jsonMatch[0]);
  const answers = Array.isArray(parsed) ? parsed.map((answer, index) => ({ id: `field-${index}`, answer })) : parsed.answers;
  if (!Array.isArray(answers)) throw new Error('The AI response did not contain an answers array.');
  return answers;
}

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'get-settings') {
    sendResponse({ ...settings, apiKeys: Object.fromEntries(Object.keys(settings.apiKeys).map((key) => [key, settings.apiKeys[key]])) });
    return false;
  }

  if (message.type === 'validate-provider') {
    validateProvider(message.provider, message.apiKey)
      .then((models) => {
        settings.models = { ...settings.models, [message.provider]: models };
        extensionApi.storage.local.set({ models: settings.models });
        sendResponse({ ok: true, models });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'save-api-key') {
    settings.apiKeys = { ...settings.apiKeys, [message.provider]: message.apiKey };
    extensionApi.storage.local.set({ apiKeys: settings.apiKeys });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'save-settings') {
    const next = message.settings;
    settings = {
      ...settings,
      provider: next.provider,
      model: next.model,
      keybind: next.keybind || DEFAULT_KEYBIND,
      apiKeys: { ...settings.apiKeys, [next.provider]: next.apiKey }
    };
    extensionApi.storage.local.set(settings);
    extensionApi.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id) {
          extensionApi.tabs.sendMessage(tab.id, { type: 'settings-updated', keybind: settings.keybind }, () => {});
        }
      });
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'answer-fields') {
    answerFields(message.fields)
      .then((answers) => sendResponse({ ok: true, answers }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
