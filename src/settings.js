'use strict';

(function () {
  const DEFAULT_SEARCH_SHORTCUT = 'CommandOrControl+Shift+Space';
  const elements = {
    scale: document.getElementById('scale'),
    opacity: document.getElementById('opacity'),
    opacityValue: document.getElementById('opacity-value'),
    animationSpeed: document.getElementById('animation-speed'),
    animationSpeedValue: document.getElementById('animation-speed-value'),
    shortcutCapture: document.getElementById('shortcut-capture'),
    shortcutReset: document.getElementById('shortcut-reset'),
    alwaysOnTop: document.getElementById('always-on-top'),
    lockedPosition: document.getElementById('locked-position'),
    clickThrough: document.getElementById('click-through'),
    openReminders: document.getElementById('open-reminders'),
    aiCard: document.getElementById('ai-settings-card'),
    aiEnabled: document.getElementById('ai-enabled'),
    aiBaseUrl: document.getElementById('ai-base-url'),
    aiModel: document.getElementById('ai-model'),
    aiApiKey: document.getElementById('ai-api-key'),
    aiKeySave: document.getElementById('ai-key-save'),
    aiKeyClear: document.getElementById('ai-key-clear'),
    aiKeyStatus: document.getElementById('ai-key-status'),
    aiSystemPrompt: document.getElementById('ai-system-prompt'),
    aiTemperature: document.getElementById('ai-temperature'),
    aiMaxTokens: document.getElementById('ai-max-tokens'),
    aiTest: document.getElementById('ai-test'),
    aiTestResult: document.getElementById('ai-test-result'),
    aiOpenChat: document.getElementById('ai-open-chat'),
    status: document.getElementById('status'),
    close: document.getElementById('close')
  };

  let rendering = false;
  let recordingShortcut = false;
  let currentShortcut = DEFAULT_SEARCH_SHORTCUT;
  let currentShortcutDisplay = 'Ctrl + Shift + Space';

  function percentage(value) {
    return `${Math.round(Number(value) * 100)}%`;
  }

  function setStatus(message, isError) {
    elements.status.textContent = message;
    elements.status.style.color = isError ? '#b14f42' : '';
  }

  function setShortcutButton(label, recording) {
    elements.shortcutCapture.textContent = label;
    elements.shortcutCapture.classList.toggle('recording', Boolean(recording));
  }

  function stopShortcutRecording() {
    recordingShortcut = false;
    setShortcutButton(currentShortcutDisplay, false);
  }

  function render(settings) {
    if (!settings) return;
    rendering = true;
    currentShortcut = settings.searchShortcut || DEFAULT_SEARCH_SHORTCUT;
    currentShortcutDisplay = settings.searchShortcutDisplay || currentShortcut;
    elements.scale.value = String(settings.scale);
    elements.opacity.value = String(Math.round(settings.opacity * 100));
    elements.opacityValue.textContent = percentage(settings.opacity);
    elements.animationSpeed.value = String(Math.round(settings.animationSpeed * 100));
    elements.animationSpeedValue.textContent = percentage(settings.animationSpeed);
    elements.alwaysOnTop.checked = Boolean(settings.alwaysOnTop);
    elements.lockedPosition.checked = Boolean(settings.lockedPosition);
    elements.clickThrough.checked = Boolean(settings.clickThrough);
    renderAi(settings.ai);
    if (!recordingShortcut) setShortcutButton(currentShortcutDisplay, false);
    rendering = false;
  }

  function renderAi(ai, options = {}) {
    const config = ai && typeof ai === 'object' ? ai : {};
    elements.aiEnabled.checked = config.enabled !== false;
    elements.aiBaseUrl.value = config.baseUrl || '';
    elements.aiModel.value = config.model || '';
    elements.aiSystemPrompt.value = config.systemPrompt || '';
    elements.aiTemperature.value = String(config.temperature === undefined ? 0.7 : config.temperature);
    elements.aiMaxTokens.value = String(config.maxTokens === undefined ? 1024 : config.maxTokens);
    if (options.clearKey || !elements.aiApiKey.value) elements.aiApiKey.value = '';
    elements.aiApiKey.placeholder = config.hasApiKey
      ? '已保存；留空不修改'
      : '输入 API Key（Ollama 等本地服务可留空）';
    elements.aiKeyStatus.textContent = config.hasApiKey
      ? (config.storageAvailable ? '已使用系统安全存储保存' : '已保存到本机；系统安全存储不可用')
      : (config.storageWarning || '尚未保存 API Key');
    elements.aiKeyStatus.classList.toggle('warning-text', Boolean(config.storageWarning));
  }

  function collectAiConfig() {
    return {
      enabled: elements.aiEnabled.checked,
      baseUrl: elements.aiBaseUrl.value.trim(),
      model: elements.aiModel.value.trim(),
      systemPrompt: elements.aiSystemPrompt.value.trim(),
      temperature: Number(elements.aiTemperature.value),
      maxTokens: Number(elements.aiMaxTokens.value)
    };
  }

  async function updateAi(patch, successMessage) {
    if (rendering || !window.settingsAPI) return false;
    try {
      const result = await window.settingsAPI.setAiConfig(patch);
      if (!result || !result.ok) {
        setStatus((result && result.error) || 'AI 设置保存失败', true);
        if (result && result.ai) renderAi(result.ai);
        return false;
      }
      renderAi(result.ai);
      setStatus(successMessage || 'AI 设置已保存');
      return true;
    } catch (error) {
      setStatus('AI 设置保存失败，请重试', true);
      return false;
    }
  }

  function setAiTestResult(message, isError) {
    elements.aiTestResult.textContent = message;
    elements.aiTestResult.classList.toggle('error', Boolean(isError));
    elements.aiTestResult.classList.toggle('success', !isError && Boolean(message));
  }

  async function update(patch) {
    if (rendering || !window.settingsAPI) return;
    try {
      const settings = await window.settingsAPI.update(patch);
      render(settings);
      setStatus('已保存');
    } catch (error) {
      setStatus('保存失败，请重试', true);
    }
  }

  function keyFromEvent(event) {
    if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
    if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) return event.key.toUpperCase();

    const keys = {
      ' ': 'Space',
      Spacebar: 'Space',
      Enter: 'Enter',
      Tab: 'Tab',
      Backspace: 'Backspace',
      Delete: 'Delete',
      Insert: 'Insert',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      '+': 'Plus'
    };
    return keys[event.key] || null;
  }

  function acceleratorFromEvent(event) {
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    const key = keyFromEvent(event);
    if (!parts.length || !key) return null;
    parts.push(key);
    return parts.join('+');
  }

  async function saveShortcut(accelerator, successMessage) {
    if (!window.settingsAPI) return;
    try {
      const result = await window.settingsAPI.setSearchShortcut(accelerator);
      if (!result || !result.ok) {
        setStatus((result && result.error) || '快捷键保存失败', true);
        render(result && result.settings);
        return;
      }
      render(result.settings);
      setStatus(successMessage || '快捷键已更新');
    } catch (error) {
      setStatus('快捷键保存失败，请重试', true);
      stopShortcutRecording();
    }
  }

  elements.scale.addEventListener('change', () => {
    update({ scale: Number(elements.scale.value) });
  });

  elements.opacity.addEventListener('input', () => {
    elements.opacityValue.textContent = `${elements.opacity.value}%`;
  });
  elements.opacity.addEventListener('change', () => {
    update({ opacity: Number(elements.opacity.value) / 100 });
  });

  elements.animationSpeed.addEventListener('input', () => {
    elements.animationSpeedValue.textContent = `${elements.animationSpeed.value}%`;
  });
  elements.animationSpeed.addEventListener('change', () => {
    update({ animationSpeed: Number(elements.animationSpeed.value) / 100 });
  });

  elements.shortcutCapture.addEventListener('click', () => {
    if (recordingShortcut) {
      stopShortcutRecording();
      setStatus('已取消录制');
      return;
    }
    recordingShortcut = true;
    setShortcutButton('请按下新的组合键…', true);
    setStatus('等待按键，Esc 取消');
  });

  elements.shortcutReset.addEventListener('click', () => {
    stopShortcutRecording();
    saveShortcut(DEFAULT_SEARCH_SHORTCUT, '已恢复默认快捷键');
  });

  window.addEventListener('keydown', (event) => {
    if (!recordingShortcut) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      stopShortcutRecording();
      setStatus('已取消录制');
      return;
    }

    const accelerator = acceleratorFromEvent(event);
    if (!accelerator) {
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
        setStatus('继续按一个字母、数字或功能键', true);
      } else {
        setStatus('这个按键暂不支持，请换一个组合', true);
      }
      return;
    }

    stopShortcutRecording();
    saveShortcut(accelerator, '快捷键已更新');
  }, true);

  elements.alwaysOnTop.addEventListener('change', () => {
    update({ alwaysOnTop: elements.alwaysOnTop.checked });
  });

  elements.lockedPosition.addEventListener('change', () => {
    update({ lockedPosition: elements.lockedPosition.checked });
  });

  elements.clickThrough.addEventListener('change', () => {
    update({ clickThrough: elements.clickThrough.checked });
  });

  elements.openReminders.addEventListener('click', () => {
    if (window.settingsAPI) window.settingsAPI.openReminders();
  });

  elements.aiEnabled.addEventListener('change', () => {
    updateAi({ enabled: elements.aiEnabled.checked }, elements.aiEnabled.checked ? 'AI 已启用' : 'AI 已停用');
  });
  elements.aiBaseUrl.addEventListener('change', () => {
    updateAi({ baseUrl: elements.aiBaseUrl.value.trim() });
  });
  elements.aiModel.addEventListener('change', () => {
    updateAi({ model: elements.aiModel.value.trim() });
  });
  elements.aiSystemPrompt.addEventListener('change', () => {
    updateAi({ systemPrompt: elements.aiSystemPrompt.value.trim() });
  });
  elements.aiTemperature.addEventListener('change', () => {
    updateAi({ temperature: Number(elements.aiTemperature.value) });
  });
  elements.aiMaxTokens.addEventListener('change', () => {
    updateAi({ maxTokens: Number(elements.aiMaxTokens.value) });
  });

  elements.aiKeySave.addEventListener('click', async () => {
    const value = elements.aiApiKey.value.trim();
    if (!value) {
      setStatus('请输入 API Key；本地模型可保持为空', true);
      elements.aiApiKey.focus();
      return;
    }
    try {
      const result = await window.settingsAPI.setAiApiKey(value);
      if (!result || !result.ok) {
        setStatus((result && result.error) || 'API Key 保存失败', true);
        return;
      }
      renderAi(result.ai, { clearKey: true });
      setStatus('API Key 已保存');
    } catch (error) {
      setStatus('API Key 保存失败，请重试', true);
    }
  });

  elements.aiKeyClear.addEventListener('click', async () => {
    if (!window.confirm('清除已保存的 API Key？')) return;
    try {
      const result = await window.settingsAPI.clearAiApiKey();
      if (!result || !result.ok) {
        setStatus((result && result.error) || 'API Key 清除失败', true);
        return;
      }
      renderAi(result.ai, { clearKey: true });
      setStatus('API Key 已清除');
    } catch (error) {
      setStatus('API Key 清除失败，请重试', true);
    }
  });

  elements.aiTest.addEventListener('click', async () => {
    elements.aiTest.disabled = true;
    setAiTestResult('正在测试连接...', false);
    setStatus('正在测试 AI 连接...');
    try {
      const result = await window.settingsAPI.testAi({
        config: collectAiConfig(),
        apiKey: elements.aiApiKey.value.trim()
      });
      if (!result || !result.ok) {
        setAiTestResult((result && result.error) || '连接失败', true);
        setStatus('AI 连接测试失败', true);
        return;
      }
      if (result.ai) renderAi(result.ai);
      setAiTestResult(`连接成功：${result.reply || 'OK'}`, false);
      setStatus('AI 连接测试成功');
    } catch (error) {
      setAiTestResult('连接失败，请检查网络和配置', true);
      setStatus('AI 连接测试失败', true);
    } finally {
      elements.aiTest.disabled = false;
    }
  });

  elements.aiOpenChat.addEventListener('click', () => {
    if (window.settingsAPI && window.settingsAPI.openAiChat) window.settingsAPI.openAiChat();
  });

  elements.close.addEventListener('click', () => {
    if (window.settingsAPI) window.settingsAPI.close();
  });

  if (window.settingsAPI) {
    window.settingsAPI.onChanged(render);
    if (window.settingsAPI.onFocusAi) {
      window.settingsAPI.onFocusAi(() => {
        elements.aiCard.scrollIntoView({ block: 'start', behavior: 'smooth' });
        elements.aiBaseUrl.focus();
        setStatus('在此配置 AI 服务');
      });
    }
    window.settingsAPI.get().then(render).catch(() => {
      setStatus('无法读取设置', true);
    });
  }
})();
