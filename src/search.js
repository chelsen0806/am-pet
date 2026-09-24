'use strict';

(function () {
  const elements = {
    searchMode: document.getElementById('mode-search'),
    translateMode: document.getElementById('mode-translate'),
    aiMode: document.getElementById('mode-ai'),
    searchForm: document.getElementById('search-form'),
    translationForm: document.getElementById('translation-form'),
    aiPanel: document.getElementById('ai-panel'),
    query: document.getElementById('query'),
    translationText: document.getElementById('translation-text'),
    engine: document.getElementById('engine'),
    source: document.getElementById('translation-source'),
    target: document.getElementById('translation-target'),
    submit: document.getElementById('submit'),
    translateSubmit: document.getElementById('translate-submit'),
    clipboard: document.getElementById('clipboard'),
    status: document.getElementById('status'),
    shortcut: document.getElementById('shortcut'),
    aiSettings: document.getElementById('ai-settings'),
    aiConfigHint: document.getElementById('ai-config-hint'),
    aiMessages: document.getElementById('ai-messages'),
    aiForm: document.getElementById('ai-form'),
    aiInput: document.getElementById('ai-input'),
    aiSend: document.getElementById('ai-send'),
    aiClear: document.getElementById('ai-clear')
  };

  let payload = null;
  let activeMode = 'search';
  let rendering = false;
  let hasAppliedPrefill = false;
  let aiMessages = [];
  let aiBusy = false;

  function normalizeMode(mode) {
    return mode === 'translate' || mode === 'ai' ? mode : 'search';
  }

  function setStatus(message, isError) {
    elements.status.textContent = message;
    elements.status.classList.toggle('error', Boolean(isError));
  }

  function setMode(mode, options = {}) {
    const nextMode = normalizeMode(mode);
    const focus = options.focus !== false;
    const notifyMain = options.notifyMain !== false;
    const changed = nextMode !== activeMode;
    activeMode = nextMode;

    const translating = activeMode === 'translate';
    const chatting = activeMode === 'ai';
    elements.searchForm.classList.toggle('hidden', translating || chatting);
    elements.translationForm.classList.toggle('hidden', !translating);
    elements.aiPanel.classList.toggle('hidden', !chatting);
    elements.searchMode.classList.toggle('active', activeMode === 'search');
    elements.translateMode.classList.toggle('active', translating);
    elements.aiMode.classList.toggle('active', chatting);
    elements.searchMode.setAttribute('aria-selected', String(activeMode === 'search'));
    elements.translateMode.setAttribute('aria-selected', String(translating));
    elements.aiMode.setAttribute('aria-selected', String(chatting));

    if (translating && !elements.translationText.value && elements.query.value) elements.translationText.value = elements.query.value;
    if (activeMode === 'search' && !elements.query.value && elements.translationText.value) elements.query.value = elements.translationText.value;
    setStatus(translating ? 'Enter 翻译 · Esc 关闭' : (chatting ? 'Enter 发送 · Esc 关闭' : 'Enter 搜索 · Esc 关闭'));

    if (changed && notifyMain && window.searchAPI && window.searchAPI.setMode) {
      window.searchAPI.setMode(activeMode).then((result) => {
        if (result && result.payload) render(result.payload);
      }).catch(() => {});
    }
    if (focus) activeInput().focus();
  }

  function activeInput() {
    if (activeMode === 'translate') return elements.translationText;
    if (activeMode === 'ai') return elements.aiInput;
    return elements.query;
  }

  function fillSelect(select, items, selectedId) {
    select.innerHTML = '';
    for (const item of items || []) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      select.appendChild(option);
    }
    if (selectedId) select.value = selectedId;
  }

  function updateAiHint() {
    const ai = payload && payload.ai ? payload.ai : {};
    if (ai.enabled === false) {
      elements.aiConfigHint.textContent = 'AI 未启用，请先到设置中开启';
      return;
    }
    if (ai.hasApiKey) {
      elements.aiConfigHint.textContent = `${ai.model || 'AI 模型'} · 已配置密钥`;
      return;
    }
    elements.aiConfigHint.textContent = `${ai.model || 'AI 模型'} · 未配置 API Key`;
  }

  function renderAiMessages() {
    elements.aiMessages.innerHTML = '';
    if (!aiMessages.length) {
      const empty = document.createElement('div');
      empty.className = 'ai-empty';
      empty.textContent = '输入问题开始对话。未配置服务时，请先点击右上角“配置”。';
      elements.aiMessages.appendChild(empty);
      return;
    }
    for (const message of aiMessages) {
      const item = document.createElement('div');
      item.className = `ai-message ${message.role}`;
      const role = document.createElement('div');
      role.className = 'ai-message-role';
      role.textContent = message.role === 'user' ? '你' : '小猫';
      const content = document.createElement('div');
      content.className = 'ai-message-content';
      content.textContent = message.content;
      item.appendChild(role);
      item.appendChild(content);
      elements.aiMessages.appendChild(item);
    }
    elements.aiMessages.scrollTop = elements.aiMessages.scrollHeight;
  }

  function addAiMessage(role, content) {
    const text = String(content || '').trim();
    if (!text) return;
    aiMessages.push({ role, content: text });
    if (aiMessages.length > 24) aiMessages = aiMessages.slice(-24);
    renderAiMessages();
  }

  function applyPrefill(prefill) {
    if (!prefill) return false;
    hasAppliedPrefill = true;
    setMode(prefill.mode || 'search');
    activeInput().value = prefill.text || '';
    if (prefill.notice) setStatus(prefill.notice, true);
    else setStatus(prefill.mode === 'translate' ? '已读取剪贴板，按 Enter 翻译' : (prefill.mode === 'ai' ? '已填入内容，按 Enter 发送' : '已读取剪贴板，按 Enter 搜索'));
    activeInput().focus();
    if (activeMode !== 'ai') activeInput().select();
    if (window.searchAPI && window.searchAPI.ackPrefill) window.searchAPI.ackPrefill();
    return true;
  }

  function render(nextPayload) {
    if (!nextPayload) return;
    payload = nextPayload;
    rendering = true;
    fillSelect(elements.engine, payload.engines, payload.engine);
    fillSelect(elements.source, (payload.translationLanguages || []).filter((item) => item.canSource), payload.translationSource);
    fillSelect(elements.target, (payload.translationLanguages || []).filter((item) => item.canTarget), payload.translationTarget);
    if (payload.shortcutDisplay) elements.shortcut.textContent = `${payload.shortcutDisplay} 唤出`;
    updateAiHint();
    rendering = false;
    if (payload.mode && normalizeMode(payload.mode) !== activeMode) {
      setMode(payload.mode, { focus: false, notifyMain: false });
    }
  }

  async function submitSearch() {
    const value = elements.query.value.trim();
    if (!value) {
      setStatus('请输入搜索内容', true);
      elements.query.focus();
      return;
    }
    elements.submit.disabled = true;
    setStatus('正在打开搜索...');
    try {
      const result = await window.searchAPI.submit(value);
      if (!result || !result.ok) {
        setStatus((result && result.error) || '打开失败', true);
        return;
      }
      elements.query.value = '';
      setStatus('已打开搜索结果');
      elements.query.focus();
    } catch (error) {
      setStatus('打开失败，请重试', true);
    } finally {
      elements.submit.disabled = false;
    }
  }

  async function submitTranslation() {
    const value = elements.translationText.value.trim();
    if (!value) {
      setStatus('请输入要翻译的内容', true);
      elements.translationText.focus();
      return;
    }
    elements.translateSubmit.disabled = true;
    setStatus('正在打开翻译...');
    try {
      const result = await window.searchAPI.translate({ text: value, source: elements.source.value, target: elements.target.value });
      if (!result || !result.ok) {
        setStatus((result && result.error) || '翻译打开失败', true);
        return;
      }
      setStatus('已打开翻译页面，可在浏览器中查看结果');
      elements.translationText.focus();
      elements.translationText.select();
    } catch (error) {
      setStatus('翻译打开失败，请重试', true);
    } finally {
      elements.translateSubmit.disabled = false;
    }
  }

  async function sendAiMessage() {
    const value = elements.aiInput.value.trim();
    if (!value) {
      setStatus('请输入要问 AI 的内容', true);
      elements.aiInput.focus();
      return;
    }
    if (!payload || !payload.ai || payload.ai.enabled === false) {
      setStatus('AI 未启用，请先到设置中开启', true);
      return;
    }
    if (aiBusy) return;

    aiBusy = true;
    elements.aiSend.disabled = true;
    elements.aiInput.value = '';
    addAiMessage('user', value);
    setStatus('AI 正在思考...');
    try {
      const result = await window.searchAPI.aiChat({ messages: aiMessages });
      if (!result || !result.ok) {
        setStatus((result && result.error) || 'AI 请求失败', true);
        return;
      }
      addAiMessage('assistant', result.content || 'AI 没有返回内容');
      setStatus('回答完成');
    } catch (error) {
      setStatus('AI 请求失败，请检查网络和配置', true);
    } finally {
      aiBusy = false;
      elements.aiSend.disabled = false;
      elements.aiInput.focus();
      renderAiMessages();
    }
  }

  async function readClipboard() {
    try {
      const result = await window.searchAPI.readClipboard();
      if (!result || !result.ok) {
        setStatus((result && result.error) || '剪贴板里没有可用文本', true);
        return;
      }
      const input = activeInput();
      input.value = result.text;
      input.focus();
      if (activeMode !== 'ai') input.select();
      setStatus('已读取剪贴板，按 Enter 继续');
    } catch (error) {
      setStatus('读取剪贴板失败', true);
    }
  }

  elements.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitSearch();
  });
  elements.translationForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitTranslation();
  });
  elements.aiForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sendAiMessage();
  });
  elements.aiInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendAiMessage();
    }
  });
  elements.aiClear.addEventListener('click', () => {
    aiMessages = [];
    renderAiMessages();
    setStatus('对话已清空');
    elements.aiInput.focus();
  });
  elements.aiSettings.addEventListener('click', () => {
    if (window.searchAPI && window.searchAPI.openAiSettings) window.searchAPI.openAiSettings();
  });
  elements.searchMode.addEventListener('click', () => setMode('search'));
  elements.translateMode.addEventListener('click', () => setMode('translate'));
  elements.aiMode.addEventListener('click', () => setMode('ai'));
  elements.clipboard.addEventListener('click', readClipboard);

  elements.engine.addEventListener('change', async () => {
    if (rendering) return;
    try {
      render(await window.searchAPI.setEngine(elements.engine.value));
      setStatus('搜索引擎已更新');
    } catch (error) {
      setStatus('设置保存失败', true);
    }
  });

  async function updateTranslationLanguage() {
    if (rendering) return;
    try {
      render(await window.searchAPI.setTranslationLanguage({ source: elements.source.value, target: elements.target.value }));
      setStatus('翻译语言已保存');
    } catch (error) {
      setStatus('语言设置保存失败', true);
    }
  }

  elements.source.addEventListener('change', updateTranslationLanguage);
  elements.target.addEventListener('change', updateTranslationLanguage);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      window.searchAPI.close();
    }
  });
  window.addEventListener('focus', () => {
    activeInput().focus();
    if (activeMode !== 'ai') activeInput().select();
  });

  if (window.searchAPI) {
    window.searchAPI.get().then((nextPayload) => {
      render(nextPayload);
      if (!hasAppliedPrefill) setMode(nextPayload.mode || 'search', { focus: false, notifyMain: false });
    }).catch(() => setStatus('无法读取设置', true));
    if (window.searchAPI.getPrefill) {
      window.searchAPI.getPrefill().then(applyPrefill).catch(() => {});
    }
    window.searchAPI.onChanged(render);
    window.searchAPI.onFocus(() => {
      activeInput().focus();
      if (activeMode !== 'ai') activeInput().select();
    });
    window.searchAPI.onPrefill(applyPrefill);
  } else {
    setStatus('搜索接口不可用', true);
  }

  renderAiMessages();
  setMode('search', { focus: false, notifyMain: false });
  elements.query.focus();
})();
