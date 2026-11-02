const DEFAULT_KEYBIND = 'Ctrl+Shift+H';
const extensionApi = globalThis.browser && globalThis.browser.runtime
  ? globalThis.browser
  : globalThis.chrome;
let activeKeybind = DEFAULT_KEYBIND;

function getKeybind(event) {
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Meta');
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...modifiers, key].join('+');
}

function showModal(message, error = false) {
  document.getElementById('ai-quisioner-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'ai-quisioner-modal';
  modal.textContent = message;
  Object.assign(modal.style, {
    position: 'fixed',
    left: '16px',
    bottom: '16px',
    zIndex: '2147483647',
    maxWidth: '360px',
    padding: '16px 20px',
    color: error ? '#991b1b' : '#111827',
    background: '#fff',
    border: `1px solid ${error ? '#fca5a5' : '#d1d5db'}`,
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0, 0, 0, .2)',
    font: '16px Arial, sans-serif'
  });
  document.body.appendChild(modal);
  setTimeout(() => modal.remove(), error ? 4000 : 5000);
}

function questionText(control) {
  const container = control.closest('.que, fieldset, .form-group, [class*="question"]');
  return (container?.innerText || control.parentElement?.innerText || '').trim().slice(0, 1200);
}

function optionLabel(input) {
  const label = input.labels?.[0];
  if (label) return label.innerText.trim();
  return input.parentElement?.innerText?.trim() || input.value;
}

function collectFields(root = document) {
  const controls = [...root.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]), textarea, select')];
  const fields = [];
  const seenRadioGroups = new Set();
  const entries = [];
  controls.forEach((control) => {
    if (control.type === 'radio') {
      const groupKey = `${control.closest('.que, fieldset, .form-group, [class*="question"]')?.outerHTML.slice(0, 80)}:${control.name}`;
      if (seenRadioGroups.has(groupKey)) return;
      seenRadioGroups.add(groupKey);
    }
    const container = control.closest('.que, fieldset, .form-group, [class*="question"]');
    const group = control.type === 'radio' || control.type === 'checkbox'
      ? [...(container || root).querySelectorAll(`input[name="${CSS.escape(control.name)}"]`)]
      : [control];
    const options = control.tagName === 'SELECT'
      ? [...control.options].map((option) => option.textContent.trim())
      : control.type === 'radio' || control.type === 'checkbox'
        ? group.map(optionLabel)
        : [];
    const field = {
      id: `field-${fields.length}`,
      type: control.tagName === 'SELECT' ? 'select' : control.type || 'text',
      question: questionText(control),
      options
    };
    fields.push(field);
    entries.push({ field, controls: group });
  });
  return { entries, fields };
}

function questionContainer() {
  const selection = window.getSelection();
  const selectedElement = selection?.anchorNode?.parentElement;
  const activeElement = document.activeElement;
  return selectedElement?.closest('.que, fieldset, .form-group, [class*="question"]')
    || activeElement?.closest('.que, fieldset, .form-group, [class*="question"]')
    || null;
}

function applyAnswers(entries, answers) {
  const answerById = new Map(answers.map((item) => [
    typeof item === 'object' ? item.id : null,
    typeof item === 'object' ? item.answer : item
  ]));
  entries.forEach(({ field, controls }) => {
    const answer = String(answerById.get(field.id) || '').trim();
    const normalized = answer.toLowerCase();
    const control = controls[0];
    if (control.type === 'radio') {
      const selected = controls.find((item) => item.value.toLowerCase() === normalized || optionLabel(item).toLowerCase() === normalized);
      if (selected) selected.checked = true;
    } else if (control.tagName === 'SELECT') {
      const option = [...control.options].find((item) => item.textContent.trim().toLowerCase() === normalized || item.value.toLowerCase() === normalized);
      if (option) control.value = option.value;
    } else if (control.type === 'checkbox') {
      control.checked = ['true', 'yes', '1', 'checked'].includes(normalized);
    } else {
      control.value = answer;
    }
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

extensionApi.runtime.sendMessage({ type: 'get-settings' }, (settings) => {
  if (settings?.keybind) activeKeybind = settings.keybind;
});

extensionApi.runtime.onMessage.addListener((message) => {
  if (message.type === 'settings-updated') activeKeybind = message.keybind || DEFAULT_KEYBIND;
});

document.addEventListener('keydown', (event) => {
  if (getKeybind(event) !== activeKeybind) return;
  event.preventDefault();
  event.stopPropagation();
  const selectedText = window.getSelection()?.toString().trim().replace(/\s+/g, ' ').slice(0, 1200);
  const selectedQuestion = questionContainer();
  const { entries, fields } = collectFields(selectedQuestion || document);
  if (selectedText && fields.length) {
    fields.forEach((field) => {
      field.question = selectedText;
    });
  }
  if (!fields.length) {
    showModal('No quiz inputs found.', true);
    return;
  }
  const questionPreview = (selectedText || fields.map((field) => field.question).join('\n')).slice(0, 180);
  const shortQuestion = questionPreview.length === 180 ? `${questionPreview}...` : questionPreview;
  showModal(`Question asked:\n${shortQuestion}`);
  setTimeout(() => {
    showModal('Thinking...');
    extensionApi.runtime.sendMessage({ type: 'answer-fields', fields }, (result) => {
      if (!result?.ok) {
        showModal(result?.error || 'Could not answer the quiz.', true);
        return;
      }
      applyAnswers(entries, result.answers || []);
      showModal(`Answer: ${result.answers?.map((item) => item.answer || item).join(', ') || 'No answer returned.'}`);
    });
  }, 700);
}, true);
