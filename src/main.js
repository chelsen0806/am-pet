'use strict';

const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, Notification, safeStorage, screen, shell, Tray, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { DEFAULT_AI_CONFIG, normalizeAiConfig, chatCompletion, testAiConnection } = require('./ai-provider');

const WINDOW_WIDTH = 296;
const WINDOW_HEIGHT = 340;
const EDGE_MARGIN_X = 28;
const EDGE_MARGIN_Y = 18;
const SEARCH_WINDOW_WIDTH = 620;
const SEARCH_WINDOW_HEIGHT = 180;
const SEARCH_AI_WINDOW_HEIGHT = 560;
const DEFAULT_SEARCH_SHORTCUT = 'CommandOrControl+Shift+Space';
const POMODORO_WINDOW_WIDTH = 360;
const POMODORO_WINDOW_HEIGHT = 470;
const POMODORO_FOCUS_MINUTES = 25;
const POMODORO_BREAK_MINUTES = 5;
const POMODORO_FOCUS_MS = POMODORO_FOCUS_MINUTES * 60 * 1000;
const POMODORO_BREAK_MS = POMODORO_BREAK_MINUTES * 60 * 1000;
const REMINDER_WINDOW_WIDTH = 430;
const REMINDER_WINDOW_HEIGHT = 640;
const REMINDER_CHECK_MS = 3000;
const SEARCH_ENGINES = Object.freeze([
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=%s' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' }
]);
const TRANSLATION_LANGUAGES = Object.freeze([
  { id: 'auto', name: '自动检测', canSource: true, canTarget: false },
  { id: 'zh-CN', name: '中文', canSource: true, canTarget: true },
  { id: 'en', name: '英语', canSource: true, canTarget: true },
  { id: 'ja', name: '日语', canSource: true, canTarget: true },
  { id: 'ko', name: '韩语', canSource: true, canTarget: true },
  { id: 'fr', name: '法语', canSource: true, canTarget: true },
  { id: 'de', name: '德语', canSource: true, canTarget: true },
  { id: 'es', name: '西班牙语', canSource: true, canTarget: true },
  { id: 'ru', name: '俄语', canSource: true, canTarget: true }
]);
const REMINDER_DEFINITIONS = Object.freeze({
  water: {
    label: '喝水提醒',
    description: '离开屏幕喝几口水，别等口渴才想起来',
    intervals: [30, 45, 60, 90, 120]
  },
  stretch: {
    label: '久坐提醒',
    description: '起身活动肩颈和腰背，打断连续久坐',
    intervals: [30, 45, 60, 90, 120]
  },
  eyes: {
    label: '护眼提醒',
    description: '看看远处，给眼睛一点恢复时间',
    intervals: [20, 30, 45, 60, 90]
  },
  petWater: {
    label: '久未陪小猫',
    description: '很久没有摸小猫时，它会提醒你喝水和休息',
    intervals: [30, 60, 90, 120, 180]
  }
});
const DEFAULT_REMINDER_SETTINGS = Object.freeze({
  water: { enabled: true, intervalMinutes: 60 },
  stretch: { enabled: false, intervalMinutes: 60 },
  eyes: { enabled: false, intervalMinutes: 30 },
  petWater: { enabled: true, intervalMinutes: 90 }
});
const DEFAULT_SETTINGS = Object.freeze({
  scale: 1,
  opacity: 1,
  animationSpeed: 1,
  clickThrough: false,
  searchEngine: 'google',
  searchShortcut: DEFAULT_SEARCH_SHORTCUT,
  translationSource: 'auto',
  translationTarget: 'zh-CN'
});
const DEFAULT_AI_SETTINGS = Object.freeze({
  ...DEFAULT_AI_CONFIG,
  enabled: true
});

if (process.platform === 'linux' && !process.env.AM_PET_ALLOW_WAYLAND) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}

let win = null;
let settingsWindow = null;
let searchWindow = null;
let pomodoroWindow = null;
let reminderWindow = null;
let registeredSearchShortcut = null;
let pomodoroTickTimer = null;
let reminderTickTimer = null;
let searchPrefill = null;
let searchWindowMode = 'search';
let lastPetInteractionAt = null;
let tray = null;
let dragging = false;
let dragStartCursor = { x: 0, y: 0 };
let winStart = { x: 0, y: 0 };
let winSize = { width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
let cursorTimer = null;
let stateFilePath = null;
let aiApiKey = '';
let aiKeyStorageWarning = '';

const appState = {
  position: null,
  alwaysOnTop: true,
  lockedPosition: false,
  settings: { ...DEFAULT_SETTINGS },
  ai: { ...DEFAULT_AI_SETTINGS },
  aiKeyEncrypted: '',
  aiKeyFallback: '',
  reminders: {
    water: { ...DEFAULT_REMINDER_SETTINGS.water },
    stretch: { ...DEFAULT_REMINDER_SETTINGS.stretch },
    eyes: { ...DEFAULT_REMINDER_SETTINGS.eyes },
    petWater: { ...DEFAULT_REMINDER_SETTINGS.petWater }
  }
};

const reminderRuntime = {
  water: { nextAt: null },
  stretch: { nextAt: null },
  eyes: { nextAt: null },
  petWater: { nextAt: null, lastReminderAt: null }
};

const pomodoroState = {
  phase: 'focus',
  running: false,
  remainingMs: POMODORO_FOCUS_MS,
  endsAt: null,
  completedFocusCount: 0,
  statusText: '准备好后开始一轮专注'
};

function loadState() {
  stateFilePath = path.join(app.getPath('userData'), 'state.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return;

    if (parsed.position && Number.isFinite(parsed.position.x) && Number.isFinite(parsed.position.y)) {
      appState.position = {
        x: Math.round(parsed.position.x),
        y: Math.round(parsed.position.y)
      };
    }
    if (typeof parsed.alwaysOnTop === 'boolean') appState.alwaysOnTop = parsed.alwaysOnTop;
    if (typeof parsed.lockedPosition === 'boolean') appState.lockedPosition = parsed.lockedPosition;
    if (parsed.settings && typeof parsed.settings === 'object') {
      appState.settings.scale = normalizeScale(parsed.settings.scale);
      appState.settings.opacity = normalizeOpacity(parsed.settings.opacity);
      appState.settings.animationSpeed = normalizeAnimationSpeed(parsed.settings.animationSpeed);
      appState.settings.clickThrough = Boolean(parsed.settings.clickThrough);
      appState.settings.searchEngine = normalizeSearchEngine(parsed.settings.searchEngine);
      appState.settings.searchShortcut = normalizeSearchShortcut(parsed.settings.searchShortcut);
      appState.settings.translationSource = normalizeTranslationLanguage(parsed.settings.translationSource, { source: true });
      appState.settings.translationTarget = normalizeTranslationLanguage(parsed.settings.translationTarget);
    }
    appState.reminders = normalizeReminderSettings(parsed.reminders);
    try {
      if (parsed.ai && typeof parsed.ai === 'object') appState.ai = normalizeAiSettings(parsed.ai);
    } catch (error) {
      console.warn('Unable to normalize AI settings:', error.message);
    }

    aiApiKey = '';
    aiKeyStorageWarning = '';
    try {
      if (typeof parsed.aiKeyEncrypted === 'string' && parsed.aiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
        aiApiKey = safeStorage.decryptString(Buffer.from(parsed.aiKeyEncrypted, 'base64'));
      } else if (typeof parsed.aiKeyFallback === 'string' && parsed.aiKeyFallback) {
        aiApiKey = parsed.aiKeyFallback;
        aiKeyStorageWarning = '系统安全存储不可用，API Key 以本机明文保存';
      }
    } catch (error) {
      aiApiKey = '';
      aiKeyStorageWarning = 'API Key 解密失败，请在设置中重新填写';
      console.warn('Unable to decrypt AI API key:', error.message);
    }
  } catch (error) {
    if (error && error.code !== 'ENOENT') console.warn('Unable to load AM Pet state:', error.message);
  }
}

function prepareAiKeyForSave() {
  if (!aiApiKey) {
    appState.aiKeyEncrypted = '';
    appState.aiKeyFallback = '';
    return;
  }

  try {
    if (safeStorage.isEncryptionAvailable()) {
      appState.aiKeyEncrypted = safeStorage.encryptString(aiApiKey).toString('base64');
      appState.aiKeyFallback = '';
      aiKeyStorageWarning = '';
      return;
    }
  } catch (error) {
    console.warn('Unable to encrypt AI API key:', error.message);
  }

  appState.aiKeyEncrypted = '';
  appState.aiKeyFallback = aiApiKey;
  aiKeyStorageWarning = '系统安全存储不可用，API Key 以本机明文保存';
}

function saveState() {
  if (!stateFilePath) return;
  try {
    prepareAiKeyForSave();
    fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
    fs.writeFileSync(stateFilePath, JSON.stringify(appState, null, 2), 'utf8');
  } catch (error) {
    console.warn('Unable to save AM Pet state:', error.message);
  }
}

function clampPosition(x, y, width, height) {
  const display = screen.getDisplayNearestPoint({
    x: Math.round(x + width / 2),
    y: Math.round(y + height / 2)
  });
  const area = display.workArea;
  const maxX = Math.max(area.x, area.x + area.width - width);
  const maxY = Math.max(area.y, area.y + area.height - height);
  return {
    x: Math.min(Math.max(Math.round(x), area.x), maxX),
    y: Math.min(Math.max(Math.round(y), area.y), maxY)
  };
}

function getFallbackPosition(width, height) {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - width - EDGE_MARGIN_X,
    y: area.y + area.height - height - EDGE_MARGIN_Y
  };
}

function clampSetting(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeScale(value) {
  const scale = Number(value);
  return [0.75, 1, 1.25, 1.5].includes(scale) ? scale : DEFAULT_SETTINGS.scale;
}

function normalizeOpacity(value) {
  return clampSetting(value, 0.2, 1, DEFAULT_SETTINGS.opacity);
}

function normalizeAnimationSpeed(value) {
  return clampSetting(value, 0.25, 2, DEFAULT_SETTINGS.animationSpeed);
}

function normalizeSearchEngine(value) {
  const id = String(value || '').trim();
  return SEARCH_ENGINES.some((engine) => engine.id === id) ? id : DEFAULT_SETTINGS.searchEngine;
}

function normalizeReminderInterval(id, value) {
  const fallback = DEFAULT_REMINDER_SETTINGS[id].intervalMinutes;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const rounded = Math.round(number);
  return Math.min(24 * 60, Math.max(1, rounded));
}

function normalizeReminderSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  for (const id of Object.keys(DEFAULT_REMINDER_SETTINGS)) {
    const fallback = DEFAULT_REMINDER_SETTINGS[id];
    const item = source[id] && typeof source[id] === 'object' ? source[id] : {};
    result[id] = {
      enabled: typeof item.enabled === 'boolean' ? item.enabled : fallback.enabled,
      intervalMinutes: normalizeReminderInterval(id, item.intervalMinutes)
    };
  }
  return result;
}

function cloneReminderSettings() {
  return normalizeReminderSettings(appState.reminders);
}

function normalizeTranslationLanguage(value, { source = false } = {}) {
  const id = String(value || '').trim();
  const match = TRANSLATION_LANGUAGES.find((language) => {
    if (language.id !== id) return false;
    return source ? language.canSource : language.canTarget;
  });
  if (match) return match.id;
  return source ? 'auto' : 'zh-CN';
}

function validateSearchShortcut(value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, error: '请按下新的组合键' };

  const tokens = raw.split('+').map((token) => token.trim()).filter(Boolean);
  if (tokens.length < 2) return { ok: false, error: '快捷键至少需要一个修饰键和一个按键' };

  const modifiers = new Set();
  let key = null;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === 'commandorcontrol' || lower === 'cmdorctrl' || lower === 'ctrl' || lower === 'control') {
      modifiers.add('CommandOrControl');
      continue;
    }
    if (lower === 'alt' || lower === 'option') {
      modifiers.add('Alt');
      continue;
    }
    if (lower === 'shift') {
      modifiers.add('Shift');
      continue;
    }
    if (lower === 'super' || lower === 'meta' || lower === 'command' || lower === 'cmd' || lower === 'win') {
      modifiers.add('Super');
      continue;
    }

    if (key) return { ok: false, error: '快捷键只能包含一个主按键' };
    if (/^[a-z]$/i.test(token)) key = token.toUpperCase();
    else if (/^[0-9]$/.test(token)) key = token;
    else if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(token)) key = token.toUpperCase();
    else {
      const aliases = {
        esc: 'Esc',
        escape: 'Esc',
        enter: 'Enter',
        return: 'Enter',
        tab: 'Tab',
        space: 'Space',
        spacebar: 'Space',
        backspace: 'Backspace',
        delete: 'Delete',
        insert: 'Insert',
        home: 'Home',
        end: 'End',
        pageup: 'PageUp',
        pagedown: 'PageDown',
        up: 'Up',
        arrowup: 'Up',
        down: 'Down',
        arrowdown: 'Down',
        left: 'Left',
        arrowleft: 'Left',
        right: 'Right',
        arrowright: 'Right',
        plus: 'Plus'
      };
      const alias = aliases[lower];
      if (!alias) return { ok: false, error: '暂不支持这个按键，请换一个组合' };
      key = alias;
    }
  }

  if (!key) return { ok: false, error: '请再按一个字母、数字或功能键' };
  if (!modifiers.has('CommandOrControl') && !modifiers.has('Alt') && !modifiers.has('Super')) {
    return { ok: false, error: '请使用 Ctrl / Cmd、Alt 或 Super 作为修饰键' };
  }

  const ordered = [];
  if (modifiers.has('CommandOrControl')) ordered.push('CommandOrControl');
  if (modifiers.has('Alt')) ordered.push('Alt');
  if (modifiers.has('Shift')) ordered.push('Shift');
  if (modifiers.has('Super')) ordered.push('Super');
  ordered.push(key);
  return { ok: true, accelerator: ordered.join('+') };
}

function normalizeSearchShortcut(value) {
  const result = validateSearchShortcut(value);
  return result.ok ? result.accelerator : DEFAULT_SEARCH_SHORTCUT;
}

function formatShortcutForDisplay(value) {
  const result = validateSearchShortcut(value);
  if (!result.ok) return '';
  const primary = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
  const superKey = process.platform === 'darwin' ? 'Cmd' : 'Win';
  return result.accelerator
    .replace('CommandOrControl', primary)
    .replace('Super', superKey)
    .replace(/\+/g, ' + ');
}

function getScaledWindowSize() {
  return {
    width: Math.round(WINDOW_WIDTH * appState.settings.scale),
    height: Math.round(WINDOW_HEIGHT * appState.settings.scale)
  };
}

function normalizeAiSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const normalized = normalizeAiConfig(source, DEFAULT_AI_SETTINGS);
  return {
    ...DEFAULT_AI_SETTINGS,
    ...normalized,
    enabled: typeof source.enabled === 'boolean'
      ? source.enabled
      : (typeof appState.ai.enabled === 'boolean' ? appState.ai.enabled : true)
  };
}

function getAiPayload() {
  let storageAvailable = false;
  try { storageAvailable = safeStorage.isEncryptionAvailable(); } catch (error) {}
  return {
    ...appState.ai,
    hasApiKey: Boolean(aiApiKey),
    storageAvailable,
    storageWarning: aiKeyStorageWarning
  };
}

function applyAiConfig(patch) {
  try {
    appState.ai = normalizeAiSettings({ ...appState.ai, ...(patch && typeof patch === 'object' ? patch : {}) });
    saveState();
    broadcastSearch();
    broadcastSettings();
    return { ok: true, ai: getAiPayload() };
  } catch (error) {
    return { ok: false, error: error.message || 'AI 设置保存失败', ai: getAiPayload() };
  }
}

function setAiApiKey(value) {
  aiApiKey = String(value || '').trim();
  aiKeyStorageWarning = '';
  saveState();
  broadcastSearch();
  broadcastSettings();
  return { ok: true, ai: getAiPayload() };
}

function clearAiApiKey() {
  aiApiKey = '';
  aiKeyStorageWarning = '';
  saveState();
  broadcastSearch();
  broadcastSettings();
  return { ok: true, ai: getAiPayload() };
}

function getSettingsPayload() {
  return {
    ai: getAiPayload(),
    scale: appState.settings.scale,
    opacity: appState.settings.opacity,
    animationSpeed: appState.settings.animationSpeed,
    clickThrough: appState.settings.clickThrough,
    alwaysOnTop: appState.alwaysOnTop,
    lockedPosition: appState.lockedPosition,
    searchEngine: appState.settings.searchEngine,
    searchShortcut: appState.settings.searchShortcut,
    searchShortcutDisplay: formatShortcutForDisplay(appState.settings.searchShortcut),
    visible: Boolean(win && !win.isDestroyed() && win.isVisible())
  };
}

function getSearchPayload() {
  return {
    mode: searchWindowMode,
    ai: getAiPayload(),
    engine: appState.settings.searchEngine,
    engines: SEARCH_ENGINES.map(({ id, name }) => ({ id, name })),
    shortcut: appState.settings.searchShortcut,
    shortcutDisplay: formatShortcutForDisplay(appState.settings.searchShortcut),
    translationSource: appState.settings.translationSource,
    translationTarget: appState.settings.translationTarget,
    translationLanguages: TRANSLATION_LANGUAGES.map(({ id, name, canSource, canTarget }) => ({ id, name, canSource, canTarget }))
  };
}

function getReminderPayload() {
  const now = Date.now();
  const definitions = {};
  const runtime = {};
  for (const id of Object.keys(REMINDER_DEFINITIONS)) {
    const definition = REMINDER_DEFINITIONS[id];
    const state = reminderRuntime[id] || {};
    definitions[id] = {
      id,
      label: definition.label,
      description: definition.description,
      intervals: definition.intervals.slice()
    };
    runtime[id] = {
      nextAt: Number.isFinite(state.nextAt) ? state.nextAt : null,
      remainingMs: Number.isFinite(state.nextAt) ? Math.max(0, state.nextAt - now) : null,
      lastReminderAt: Number.isFinite(state.lastReminderAt) ? state.lastReminderAt : null
    };
  }
  return {
    settings: cloneReminderSettings(),
    definitions,
    runtime,
    lastPetInteractionAt,
    idleMs: Number.isFinite(lastPetInteractionAt) ? Math.max(0, now - lastPetInteractionAt) : 0,
    notificationsSupported: Notification.isSupported()
  };
}

function broadcastSearch() {
  if (searchWindow && !searchWindow.isDestroyed()) {
    searchWindow.webContents.send('search:changed', getSearchPayload());
  }
}

function broadcastReminders() {
  if (reminderWindow && !reminderWindow.isDestroyed() && reminderWindow.isVisible()) {
    reminderWindow.webContents.send('reminders:changed', getReminderPayload());
  }
}

function getReminderIntervalMs(id) {
  const settings = appState.reminders[id];
  const minutes = settings ? settings.intervalMinutes : DEFAULT_REMINDER_SETTINGS[id].intervalMinutes;
  return Math.max(1, Number(minutes) || 1) * 60 * 1000;
}

function setReminderNextAt(id, now = Date.now()) {
  if (!reminderRuntime[id]) reminderRuntime[id] = {};
  reminderRuntime[id].nextAt = now + getReminderIntervalMs(id);
}

function refreshReminderSchedule({ reset = false } = {}) {
  const now = Date.now();
  for (const id of Object.keys(REMINDER_DEFINITIONS)) {
    const runtime = reminderRuntime[id] || (reminderRuntime[id] = {});
    const settings = appState.reminders[id];
    if (!settings || !settings.enabled) {
      runtime.nextAt = null;
      continue;
    }
    if (reset || !Number.isFinite(runtime.nextAt)) {
      runtime.nextAt = now + getReminderIntervalMs(id);
    }
  }
}

function notifyReminder(id) {
  const now = Date.now();
  const runtime = reminderRuntime[id] || (reminderRuntime[id] = {});
  runtime.lastReminderAt = now;
  runtime.nextAt = now + getReminderIntervalMs(id);


  if (!Notification.isSupported()) return;

  const settings = appState.reminders[id];
  const bodies = {
    water: '小猫提醒你：喝几口水，再顺手伸个懒腰吧。',
    stretch: '你已经坐了一会儿，起来走走，活动一下肩颈和腰背。',
    eyes: '把视线移到窗外或远处，让眼睛休息 20 秒。',
    petWater: '你已经 ' + settings.intervalMinutes + ' 分钟没摸小猫啦，喝点水、活动一下再回来陪它吧。'
  };
  const titles = {
    water: '该喝水啦',
    stretch: '起来动一动',
    eyes: '让眼睛歇一会儿',
    petWater: '小猫想你了'
  };

  try {
    const notification = new Notification({
      title: titles[id] || 'AM Pet 提醒',
      body: bodies[id] || '该起来活动一下了。'
    });
    notification.on('click', openReminderWindow);
    notification.show();
  } catch (error) {
    console.warn('Unable to show reminder notification:', error.message);
  }
}

function markPetInteraction() {
  lastPetInteractionAt = Date.now();
  if (appState.reminders.petWater && appState.reminders.petWater.enabled) {
    setReminderNextAt('petWater');
  }
  broadcastReminders();
}

function ensureReminderTimer() {
  if (reminderTickTimer) return;
  reminderTickTimer = setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const id of Object.keys(REMINDER_DEFINITIONS)) {
      const settings = appState.reminders[id];
      if (!settings || !settings.enabled) continue;
      const runtime = reminderRuntime[id] || (reminderRuntime[id] = {});
      if (!Number.isFinite(runtime.nextAt)) {
        runtime.nextAt = now + getReminderIntervalMs(id);
        changed = true;
        continue;
      }
      if (now >= runtime.nextAt) {
        notifyReminder(id);
        changed = true;
      }
    }
    if (changed) broadcastReminders();
  }, REMINDER_CHECK_MS);
}

function stopReminderTimer() {
  if (reminderTickTimer) {
    clearInterval(reminderTickTimer);
    reminderTickTimer = null;
  }
}
function applyReminderPatch(patch) {
  if (!patch || typeof patch !== 'object') return getReminderPayload();
  let changed = false;
  const reset = patch.reset === true;
  if (reset) {
    appState.reminders = normalizeReminderSettings(DEFAULT_REMINDER_SETTINGS);
    changed = true;
  }

  for (const id of Object.keys(DEFAULT_REMINDER_SETTINGS)) {
    const next = patch[id];
    if (!next || typeof next !== 'object') continue;
    const current = appState.reminders[id];
    if (typeof next.enabled === 'boolean' && next.enabled !== current.enabled) {
      current.enabled = next.enabled;
      if (next.enabled) setReminderNextAt(id);
      else if (reminderRuntime[id]) reminderRuntime[id].nextAt = null;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(next, 'intervalMinutes')) {
      const interval = normalizeReminderInterval(id, next.intervalMinutes);
      if (interval !== current.intervalMinutes) {
        current.intervalMinutes = interval;
        if (current.enabled) setReminderNextAt(id);
        changed = true;
      }
    }
  }

  if (reset) {
    refreshReminderSchedule({ reset: true });
    changed = true;
  } else {
    refreshReminderSchedule();
  }
  if (changed) {
    saveState();
    ensureReminderTimer();
    broadcastReminders();
  }
  return getReminderPayload();
}
function broadcastSettings() {
  const payload = getSettingsPayload();
  if (win && !win.isDestroyed()) win.webContents.send('settings:changed', payload);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('settings:changed', payload);
  }
}

function resizePetWindow() {
  if (!win || win.isDestroyed()) return;
  const size = getScaledWindowSize();
  const oldBounds = win.getContentBounds();
  const x = Math.round(oldBounds.x - (size.width - oldBounds.width) / 2);
  const y = Math.round(oldBounds.y - (size.height - oldBounds.height) / 2);
  const position = clampPosition(x, y, size.width, size.height);

  win.setContentBounds({
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height
  });
  appState.position = position;
}

function applySettingsPatch(patch) {
  if (!patch || typeof patch !== 'object') return getSettingsPayload();
  const has = (key) => Object.prototype.hasOwnProperty.call(patch, key);
  let sizeChanged = false;

  if (has('scale')) {
    const nextScale = normalizeScale(patch.scale);
    if (nextScale !== appState.settings.scale) {
      appState.settings.scale = nextScale;
      sizeChanged = true;
    }
  }

  if (has('opacity')) {
    appState.settings.opacity = normalizeOpacity(patch.opacity);
  }

  if (has('animationSpeed')) {
    appState.settings.animationSpeed = normalizeAnimationSpeed(patch.animationSpeed);
  }

  if (has('alwaysOnTop')) {
    const nextAlwaysOnTop = Boolean(patch.alwaysOnTop);
    if (nextAlwaysOnTop !== appState.alwaysOnTop) {
      appState.alwaysOnTop = nextAlwaysOnTop;
      if (win && !win.isDestroyed()) {
        if (appState.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');
        else win.setAlwaysOnTop(false);
      }
    }
  }

  if (has('lockedPosition')) {
    const nextLocked = Boolean(patch.lockedPosition);
    if (nextLocked !== appState.lockedPosition) {
      appState.lockedPosition = nextLocked;
      if (win && !win.isDestroyed()) {
        win.webContents.send('position:lock', appState.lockedPosition);
      }
    }
  }

  if (has('clickThrough')) {
    const nextClickThrough = Boolean(patch.clickThrough);
    if (nextClickThrough !== appState.settings.clickThrough) {
      appState.settings.clickThrough = nextClickThrough;
      if (win && !win.isDestroyed()) {
        win.setIgnoreMouseEvents(appState.settings.clickThrough, { forward: true });
      }
    }
  }

  if (sizeChanged) resizePetWindow();
  saveState();
  broadcastSettings();
  refreshTrayMenu();
  return getSettingsPayload();
}

function registerSearchShortcut(value) {
  const validation = validateSearchShortcut(value);
  if (!validation.ok) return { ok: false, error: validation.error };
  const accelerator = validation.accelerator;
  if (registeredSearchShortcut === accelerator) return { ok: true, accelerator };

  try {
    if (!globalShortcut.register(accelerator, toggleSearchWindow)) {
      return { ok: false, error: '这个快捷键已被其他应用占用' };
    }
  } catch (error) {
    return { ok: false, error: '这个快捷键无法注册，请换一个组合' };
  }

  const previous = registeredSearchShortcut;
  registeredSearchShortcut = accelerator;
  if (previous && previous !== accelerator) globalShortcut.unregister(previous);
  return { ok: true, accelerator };
}

function setSearchShortcut(value) {
  const result = registerSearchShortcut(value);
  if (!result.ok) {
    return { ok: false, error: result.error, settings: getSettingsPayload() };
  }

  appState.settings.searchShortcut = result.accelerator;
  saveState();
  broadcastSettings();
  broadcastSearch();
  refreshTrayMenu();
  return { ok: true, settings: getSettingsPayload() };
}

function initializeSearchShortcut() {
  const preferred = appState.settings.searchShortcut;
  const result = registerSearchShortcut(preferred);
  if (result.ok) return result;

  if (preferred !== DEFAULT_SEARCH_SHORTCUT) {
    const fallback = registerSearchShortcut(DEFAULT_SEARCH_SHORTCUT);
    if (fallback.ok) {
      appState.settings.searchShortcut = DEFAULT_SEARCH_SHORTCUT;
      saveState();
      return fallback;
    }
  }

  console.warn('Unable to register search shortcut: ' + preferred);
  return result;
}

function setWindowAlwaysOnTop(enabled) {
  return applySettingsPatch({ alwaysOnTop: Boolean(enabled) });
}

function setWindowLocked(locked) {
  return applySettingsPatch({ lockedPosition: Boolean(locked) });
}

function getAutoLaunchEnabled() {
  if (process.platform === 'linux') return false;
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (error) {
    return false;
  }
}

function setAutoLaunchEnabled(enabled) {
  if (process.platform === 'linux') return;
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  } catch (error) {
    console.warn('Unable to change auto-launch setting:', error.message);
  }
  refreshTrayMenu();
}

function toggleWindowVisibility() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isVisible()) {
    win.hide();
  } else {
    ensureWindowVisible();
    win.showInactive();
    win.setIgnoreMouseEvents(true, { forward: true });
  }
  refreshTrayMenu();
}

function showWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  ensureWindowVisible();
  win.showInactive();
  refreshTrayMenu();
}

function createSettingsWindow() {
  const settingsWorkArea = screen.getPrimaryDisplay().workArea;
  const settingsHeight = Math.min(760, Math.max(560, settingsWorkArea.height - 40));
  const panel = new BrowserWindow({
    width: 400,
    height: settingsHeight,
    show: false,
    frame: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: 'AM Pet 设置',
    backgroundColor: '#f4f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  panel.setMenu(null);
  panel.loadFile(path.join(__dirname, 'settings.html'));
  panel.on('closed', () => {
    if (settingsWindow === panel) settingsWindow = null;
  });
  panel.webContents.once('did-finish-load', () => {
    if (!panel.isDestroyed()) panel.webContents.send('settings:changed', getSettingsPayload());
  });
  return panel;
}

function openSettingsWindow() {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    settingsWindow = createSettingsWindow();
  }
  if (settingsWindow.isMinimized()) settingsWindow.restore();
  settingsWindow.show();
  settingsWindow.focus();
  settingsWindow.webContents.send('settings:changed', getSettingsPayload());
}

function openAiSettings() {
  openSettingsWindow();
  const focusAiSettings = () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('settings:focus-ai');
    }
  };
  if (settingsWindow.webContents.isLoading()) {
    settingsWindow.webContents.once('did-finish-load', focusAiSettings);
  } else {
    focusAiSettings();
  }
}

function isUrlLike(value) {
  const text = String(value || '').trim();
  if (!text || /\s/.test(text)) return false;
  if (/^https?:\/\/[^\s]+$/i.test(text)) return true;
  return /^(localhost(?::\d+)?|(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?)(?:[/?#].*)?$/i.test(text);
}

function normalizeUrl(value) {
  const text = String(value || '').trim();
  return /^https?:\/\//i.test(text) ? text : 'https://' + text;
}

function buildSearchUrl(query, engineId) {
  const text = String(query || '').trim();
  if (!text) return '';
  if (isUrlLike(text)) return normalizeUrl(text);

  const engine = SEARCH_ENGINES.find((item) => item.id === normalizeSearchEngine(engineId)) || SEARCH_ENGINES[0];
  return engine.url.replace('%s', encodeURIComponent(text));
}

function getSearchWindowPosition(width, height) {
  if (!win || win.isDestroyed()) {
    const area = screen.getPrimaryDisplay().workArea;
    return {
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + area.height * 0.18)
    };
  }

  const petBounds = win.getContentBounds();
  const area = screen.getDisplayMatching(petBounds).workArea;
  let x = Math.round(petBounds.x + (petBounds.width - width) / 2);
  let y = Math.round(petBounds.y - height - 14);
  if (y < area.y + 8) y = Math.round(petBounds.y + petBounds.height + 14);
  return clampPosition(x, y, width, height);
}

function normalizePanelMode(mode) {
  return mode === 'translate' || mode === 'ai' ? mode : 'search';
}

function getSearchPanelHeight(mode) {
  return normalizePanelMode(mode) === 'ai' ? SEARCH_AI_WINDOW_HEIGHT : SEARCH_WINDOW_HEIGHT;
}

function createSearchWindow(mode = 'search') {
  const height = getSearchPanelHeight(mode);
  const position = getSearchWindowPosition(SEARCH_WINDOW_WIDTH, height);
  const panel = new BrowserWindow({
    x: position.x,
    y: position.y,
    width: SEARCH_WINDOW_WIDTH,
    height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    title: 'AM Pet 搜索',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'search-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  panel.setMenu(null);
  panel.setAlwaysOnTop(true, 'floating');
  try { panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (error) {}
  lockRendererZoom(panel);
  panel.loadFile(path.join(__dirname, 'search.html'));
  panel.on('blur', () => hideSearchWindow());
  panel.on('closed', () => {
    if (searchWindow === panel) searchWindow = null;
  });
  panel.webContents.once('did-finish-load', () => {
    if (!panel.isDestroyed()) {
      panel.webContents.send('search:changed', getSearchPayload());
      flushSearchPrefill(panel);
      panel.webContents.send('search:focus');
    }
  });
  return panel;
}

function openSearchWindow(options = {}) {
  const mode = normalizePanelMode(options && options.mode);
  searchWindowMode = mode;
  if (options && (typeof options.text === 'string' || options.notice)) {
    searchPrefill = {
      text: typeof options.text === 'string' ? options.text : '',
      mode,
      notice: typeof options.notice === 'string' ? options.notice : ''
    };
  }
  if (!searchWindow || searchWindow.isDestroyed()) searchWindow = createSearchWindow(mode);
  const height = getSearchPanelHeight(mode);
  const position = getSearchWindowPosition(SEARCH_WINDOW_WIDTH, height);
  searchWindow.setBounds({
    x: position.x,
    y: position.y,
    width: SEARCH_WINDOW_WIDTH,
    height
  });
  searchWindow.show();
  searchWindow.focus();
  searchWindow.webContents.send('search:changed', getSearchPayload());
  flushSearchPrefill(searchWindow);
  searchWindow.webContents.send('search:focus');
}

function setSearchPanelMode(mode) {
  searchWindowMode = normalizePanelMode(mode);
  if (searchWindow && !searchWindow.isDestroyed()) {
    const bounds = searchWindow.getBounds();
    const height = getSearchPanelHeight(searchWindowMode);
    const position = getSearchWindowPosition(bounds.width, height);
    searchWindow.setBounds({
      x: position.x,
      y: position.y,
      width: SEARCH_WINDOW_WIDTH,
      height
    });
  }
  broadcastSearch();
  return { ok: true, mode: searchWindowMode, payload: getSearchPayload() };
}

function hideSearchWindow() {
  if (searchWindow && !searchWindow.isDestroyed() && searchWindow.isVisible()) searchWindow.hide();
}

function toggleSearchWindow() {
  if (searchWindow && !searchWindow.isDestroyed() && searchWindow.isVisible()) hideSearchWindow();
  else openSearchWindow({ mode: searchWindowMode });
}

function openAiChat() {
  openSearchWindow({ mode: 'ai' });
}

async function readClipboardText() {
  try {
    const value = await clipboard.readText();
    return String(value || '').trim().slice(0, 500);
  } catch (error) {
    console.warn('Unable to read clipboard:', error.message);
    return '';
  }
}

function flushSearchPrefill(panel = searchWindow) {
  if (!panel || panel.isDestroyed() || !searchPrefill) return;
  if (panel.webContents.isLoading()) return;
  panel.webContents.send('search:prefill', searchPrefill);
}

async function openSearchWithClipboard(mode = 'search') {
  const text = await readClipboardText();
  const normalizedMode = mode === 'translate' ? 'translate' : 'search';
  const error = text ? '' : '剪贴板里没有可用的文本';
  openSearchWindow({ text, mode: normalizedMode, notice: error });
  return { ok: Boolean(text), text, mode: normalizedMode, error };
}

function buildTranslationUrl(text, source, target) {
  const value = String(text || '').trim();
  if (!value) return '';
  let sourceId = normalizeTranslationLanguage(source, { source: true });
  let targetId = normalizeTranslationLanguage(target);
  if (sourceId !== 'auto' && sourceId === targetId) {
    targetId = targetId === 'zh-CN' ? 'en' : 'zh-CN';
  }
  return 'https://translate.google.com/?sl=' + encodeURIComponent(sourceId) +
    '&tl=' + encodeURIComponent(targetId) +
    '&text=' + encodeURIComponent(value) +
    '&op=translate';
}
function getPomodoroDuration(phase) {
  return phase === 'break' ? POMODORO_BREAK_MS : POMODORO_FOCUS_MS;
}

function stopPomodoroTimer() {
  if (pomodoroTickTimer) {
    clearInterval(pomodoroTickTimer);
    pomodoroTickTimer = null;
  }
}

function syncPomodoroRemaining() {
  if (!pomodoroState.running || !Number.isFinite(pomodoroState.endsAt)) return pomodoroState.remainingMs;
  pomodoroState.remainingMs = Math.max(0, pomodoroState.endsAt - Date.now());
  return pomodoroState.remainingMs;
}

function getPomodoroPayload() {
  const remainingMs = Math.max(0, syncPomodoroRemaining());
  const durationMs = getPomodoroDuration(pomodoroState.phase);
  return {
    phase: pomodoroState.phase,
    phaseLabel: pomodoroState.phase === 'focus' ? '专注' : '休息',
    running: pomodoroState.running,
    remainingMs,
    durationMs,
    remainingRatio: durationMs > 0 ? Math.min(1, Math.max(0, remainingMs / durationMs)) : 0,
    completedFocusCount: pomodoroState.completedFocusCount,
    focusMinutes: POMODORO_FOCUS_MINUTES,
    breakMinutes: POMODORO_BREAK_MINUTES,
    statusText: pomodoroState.statusText
  };
}

function broadcastPomodoro() {
  if (pomodoroWindow && !pomodoroWindow.isDestroyed()) {
    pomodoroWindow.webContents.send('pomodoro:changed', getPomodoroPayload());
  }
}

function showPomodoroNotification(completedPhase) {
  if (!Notification.isSupported()) return;
  const focusFinished = completedPhase === 'focus';
  try {
    const notification = new Notification({
      title: focusFinished ? '专注完成' : '休息结束',
      body: focusFinished
        ? '已完成 ' + pomodoroState.completedFocusCount + ' 轮专注，开始 ' + POMODORO_BREAK_MINUTES + ' 分钟休息。'
        : '休息结束，开始下一轮 ' + POMODORO_FOCUS_MINUTES + ' 分钟专注。'
    });
    notification.on('click', openPomodoroWindow);
    notification.show();
  } catch (error) {
    console.warn('Unable to show pomodoro notification:', error.message);
  }
}

function ensurePomodoroTimer() {
  if (!pomodoroState.running || pomodoroTickTimer) return;
  pomodoroTickTimer = setInterval(() => {
    if (!pomodoroState.running) {
      stopPomodoroTimer();
      return;
    }
    if (syncPomodoroRemaining() <= 0) {
      advancePomodoroPhase({ natural: true });
      return;
    }
    broadcastPomodoro();
  }, 250);
}

function advancePomodoroPhase({ natural = false } = {}) {
  const completedPhase = pomodoroState.phase;
  const shouldRun = natural || pomodoroState.running;
  if (natural && completedPhase === 'focus') pomodoroState.completedFocusCount += 1;
  if (natural) showPomodoroNotification(completedPhase);

  pomodoroState.phase = completedPhase === 'focus' ? 'break' : 'focus';
  pomodoroState.remainingMs = getPomodoroDuration(pomodoroState.phase);
  pomodoroState.running = shouldRun;
  pomodoroState.endsAt = shouldRun ? Date.now() + pomodoroState.remainingMs : null;
  pomodoroState.statusText = pomodoroState.phase === 'break'
    ? '休息一下，放松眼睛和肩颈'
    : '保持专注，完成这一轮';

  if (pomodoroState.running) ensurePomodoroTimer();
  else stopPomodoroTimer();
  broadcastPomodoro();
}

function startPomodoro() {
  if (pomodoroState.running) return getPomodoroPayload();
  if (pomodoroState.remainingMs <= 0) pomodoroState.remainingMs = getPomodoroDuration(pomodoroState.phase);
  pomodoroState.running = true;
  pomodoroState.endsAt = Date.now() + pomodoroState.remainingMs;
  pomodoroState.statusText = pomodoroState.phase === 'break'
    ? '休息进行中'
    : '专注进行中，先做好眼前这一件事';
  ensurePomodoroTimer();
  broadcastPomodoro();
  return getPomodoroPayload();
}

function pausePomodoro() {
  if (!pomodoroState.running) return getPomodoroPayload();
  syncPomodoroRemaining();
  pomodoroState.running = false;
  pomodoroState.endsAt = null;
  pomodoroState.statusText = '已暂停，准备好后继续';
  stopPomodoroTimer();
  broadcastPomodoro();
  return getPomodoroPayload();
}

function resetPomodoro() {
  pomodoroState.remainingMs = getPomodoroDuration(pomodoroState.phase);
  pomodoroState.running = false;
  pomodoroState.endsAt = null;
  pomodoroState.statusText = '计时已重置，可以重新开始';
  stopPomodoroTimer();
  broadcastPomodoro();
  return getPomodoroPayload();
}

function skipPomodoro() {
  advancePomodoroPhase({ natural: false });
  pomodoroState.statusText = pomodoroState.running ? '已跳过当前阶段，下一阶段继续计时' : '已跳过当前阶段';
  broadcastPomodoro();
  return getPomodoroPayload();
}

function getPomodoroWindowPosition(width, height) {
  if (!win || win.isDestroyed()) {
    const area = screen.getPrimaryDisplay().workArea;
    return {
      x: Math.round(area.x + area.width - width - EDGE_MARGIN_X),
      y: Math.round(area.y + area.height - height - EDGE_MARGIN_Y)
    };
  }

  const petBounds = win.getContentBounds();
  const area = screen.getDisplayMatching(petBounds).workArea;
  let x = Math.round(petBounds.x + (petBounds.width - width) / 2);
  let y = Math.round(petBounds.y - height - 14);
  if (y < area.y + 8) y = area.y + 18;
  return clampPosition(x, y, width, height);
}

function createPomodoroWindow() {
  const position = getPomodoroWindowPosition(POMODORO_WINDOW_WIDTH, POMODORO_WINDOW_HEIGHT);
  const panel = new BrowserWindow({
    x: position.x,
    y: position.y,
    width: POMODORO_WINDOW_WIDTH,
    height: POMODORO_WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    title: 'AM Pet 番茄钟',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'pomodoro-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  panel.setMenu(null);
  panel.setAlwaysOnTop(true, 'floating');
  try { panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (error) {}
  lockRendererZoom(panel);
  panel.loadFile(path.join(__dirname, 'pomodoro.html'));
  panel.on('closed', () => {
    if (pomodoroWindow === panel) pomodoroWindow = null;
  });
  panel.webContents.once('did-finish-load', () => {
    if (!panel.isDestroyed()) panel.webContents.send('pomodoro:changed', getPomodoroPayload());
  });
  return panel;
}

function openPomodoroWindow() {
  if (!pomodoroWindow || pomodoroWindow.isDestroyed()) pomodoroWindow = createPomodoroWindow();
  const position = getPomodoroWindowPosition(POMODORO_WINDOW_WIDTH, POMODORO_WINDOW_HEIGHT);
  pomodoroWindow.setBounds({
    x: position.x,
    y: position.y,
    width: POMODORO_WINDOW_WIDTH,
    height: POMODORO_WINDOW_HEIGHT
  });
  pomodoroWindow.show();
  pomodoroWindow.focus();
  pomodoroWindow.webContents.send('pomodoro:changed', getPomodoroPayload());
}

function hidePomodoroWindow() {
  if (pomodoroWindow && !pomodoroWindow.isDestroyed() && pomodoroWindow.isVisible()) pomodoroWindow.hide();
}

function togglePomodoroWindow() {
  if (pomodoroWindow && !pomodoroWindow.isDestroyed() && pomodoroWindow.isVisible()) hidePomodoroWindow();
  else openPomodoroWindow();
}

function getReminderWindowPosition(width, height) {
  if (!win || win.isDestroyed()) {
    const area = screen.getPrimaryDisplay().workArea;
    return {
      x: Math.round(area.x + area.width - width - EDGE_MARGIN_X),
      y: Math.round(area.y + (area.height - height) / 2)
    };
  }

  const petBounds = win.getContentBounds();
  const area = screen.getDisplayMatching(petBounds).workArea;
  const gap = 16;
  let x = Math.round(petBounds.x - width - gap);
  if (x < area.x + 8) x = Math.round(petBounds.x + petBounds.width + gap);
  if (x + width > area.x + area.width - 8) x = Math.round(area.x + (area.width - width) / 2);
  let y = Math.round(petBounds.y + petBounds.height - height);
  if (y < area.y + 8) y = Math.round(area.y + (area.height - height) / 2);
  return clampPosition(x, y, width, height);
}

function createReminderWindow() {
  const position = getReminderWindowPosition(REMINDER_WINDOW_WIDTH, REMINDER_WINDOW_HEIGHT);
  const panel = new BrowserWindow({
    x: position.x,
    y: position.y,
    width: REMINDER_WINDOW_WIDTH,
    height: REMINDER_WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    title: 'AM Pet 提醒中心',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'reminder-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  panel.setMenu(null);
  panel.setAlwaysOnTop(true, 'floating');
  try { panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (error) {}
  lockRendererZoom(panel);
  panel.loadFile(path.join(__dirname, 'reminder.html'));
  panel.on('closed', () => {
    if (reminderWindow === panel) reminderWindow = null;
  });
  panel.webContents.once('did-finish-load', () => {
    if (!panel.isDestroyed()) panel.webContents.send('reminders:changed', getReminderPayload());
  });
  return panel;
}

function openReminderWindow() {
  if (!reminderWindow || reminderWindow.isDestroyed()) reminderWindow = createReminderWindow();
  const position = getReminderWindowPosition(REMINDER_WINDOW_WIDTH, REMINDER_WINDOW_HEIGHT);
  reminderWindow.setBounds({
    x: position.x,
    y: position.y,
    width: REMINDER_WINDOW_WIDTH,
    height: REMINDER_WINDOW_HEIGHT
  });
  reminderWindow.show();
  reminderWindow.focus();
  reminderWindow.webContents.send('reminders:changed', getReminderPayload());
}

function hideReminderWindow() {
  if (reminderWindow && !reminderWindow.isDestroyed() && reminderWindow.isVisible()) reminderWindow.hide();
}

function toggleReminderWindow() {
  if (reminderWindow && !reminderWindow.isDestroyed() && reminderWindow.isVisible()) hideReminderWindow();
  else openReminderWindow();
}
function buildMenuTemplate() {
  const visible = Boolean(win && !win.isDestroyed() && win.isVisible());
  const template = [
    { label: 'AM Pet', enabled: false },
    { type: 'separator' },
    { label: '搜索...', click: () => openSearchWindow({ mode: 'search' }) },
    { label: 'AI 对话...', click: openAiChat },
    { label: '搜索剪贴板', click: () => openSearchWithClipboard('search') },
    { label: '翻译剪贴板', click: () => openSearchWithClipboard('translate') },
    { type: 'separator' },
    { label: '提醒中心...', click: openReminderWindow },
    { label: '番茄钟...', click: openPomodoroWindow },
    { label: '设置...', click: openSettingsWindow },
    { label: visible ? '隐藏小猫' : '显示小猫', click: toggleWindowVisibility },
    {
      label: '锁定位置',
      type: 'checkbox',
      checked: appState.lockedPosition,
      click: (item) => setWindowLocked(item.checked)
    },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: appState.alwaysOnTop,
      click: (item) => setWindowAlwaysOnTop(item.checked)
    },
    {
      label: '点击穿透',
      type: 'checkbox',
      checked: appState.settings.clickThrough,
      click: (item) => applySettingsPatch({ clickThrough: item.checked })
    }
  ];

  if (process.platform !== 'linux') {
    template.push({
      label: '开机自动启动',
      type: 'checkbox',
      checked: getAutoLaunchEnabled(),
      click: (item) => setAutoLaunchEnabled(item.checked)
    });
  }

  template.push(
    { type: 'separator' },
    { label: '退出 AM Pet', click: () => app.quit() }
  );
  return template;
}

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  try {
    tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate()));
  } catch (error) {
    console.warn('Unable to refresh tray menu:', error.message);
  }
}

function createTrayIcon() {
  const iconPath = path.join(__dirname, 'assets', 'frames', 'idle', '014.png');
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) return nativeImage.createEmpty();

  const size = image.getSize();
  const cropX = Math.max(0, Math.round(size.width * 0.2));
  const cropY = Math.max(0, Math.round(size.height * 0.08));
  const cropWidth = Math.max(1, Math.min(size.width - cropX, Math.round(size.width * 0.62)));
  const cropHeight = Math.max(1, Math.min(size.height - cropY, Math.round(size.height * 0.55)));
  const cropped = image.crop({ x: cropX, y: cropY, width: cropWidth, height: cropHeight });
  const targetSize = process.platform === 'darwin' ? 18 : 22;
  return cropped.resize({ width: targetSize, height: targetSize });
}

function createTray() {
  if (tray && !tray.isDestroyed()) return;
  try {
    tray = new Tray(createTrayIcon());
    tray.setToolTip('AM Pet');
    if (process.platform !== 'darwin') tray.on('click', toggleWindowVisibility);
    refreshTrayMenu();
  } catch (error) {
    console.warn('Unable to create tray icon:', error.message);
    tray = null;
  }
}

function createWindow() {
  const initialSize = getScaledWindowSize();
  win = new BrowserWindow({
    width: initialSize.width,
    height: initialSize.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    title: 'AM Pet',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      zoomFactor: 1
    }
  });

  win.setMenu(null);
  if (appState.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');
  else win.setAlwaysOnTop(false);
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (error) {}

  win.loadFile(path.join(__dirname, 'index.html'));
  lockRendererZoom(win);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.on('closed', () => {
    win = null;
    stopCursorPoll();
    refreshTrayMenu();
  });
}

function lockRendererZoom(windowRef) {
  const resetZoom = () => {
    if (!windowRef || windowRef.isDestroyed()) return;
    windowRef.webContents.setZoomFactor(1);
    try { windowRef.webContents.setZoomLevel(0); } catch (error) {}
  };

  windowRef.webContents.on('did-finish-load', () => {
    resetZoom();
    windowRef.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  });

  windowRef.webContents.on('zoom-changed', (event) => {
    event.preventDefault();
    resetZoom();
  });
}

function fitWindow(size) {
  if (!win || win.isDestroyed()) return;
  const width = Math.max(80, Math.round(size.w));
  const height = Math.max(80, Math.round(size.h));
  const requested = appState.position || getFallbackPosition(width, height);
  const position = clampPosition(requested.x, requested.y, width, height);

  win.setContentBounds({
    x: position.x,
    y: position.y,
    width,
    height
  });
  appState.position = position;
  saveState();
  if (!win.isVisible()) win.showInactive();
  refreshTrayMenu();
}

function ensureWindowVisible() {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getContentBounds();
  const position = clampPosition(bounds.x, bounds.y, bounds.width, bounds.height);
  if (position.x !== bounds.x || position.y !== bounds.y) {
    win.setContentBounds({
      x: position.x,
      y: position.y,
      width: bounds.width,
      height: bounds.height
    });
    appState.position = position;
    saveState();
  }
}

function startCursorPoll() {
  stopCursorPoll();
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed() || dragging || !win.isVisible()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getContentBounds();
    win.webContents.send('cursor:move', {
      x: cursor.x - bounds.x,
      y: cursor.y - bounds.y
    });
  }, 70);
}

function stopCursorPoll() {
  if (cursorTimer) {
    clearInterval(cursorTimer);
    cursorTimer = null;
  }
}

ipcMain.handle('app:get-state', () => getSettingsPayload());
ipcMain.handle('settings:get', () => getSettingsPayload());
ipcMain.handle('settings:update', (_event, patch) => applySettingsPatch(patch));
ipcMain.handle('settings:set-search-shortcut', (_event, accelerator) => setSearchShortcut(accelerator));
ipcMain.handle('settings:open-ai', () => { openAiSettings(); return { ok: true }; });
ipcMain.handle('settings:open-chat', () => { openAiChat(); return { ok: true }; });
ipcMain.handle('ai:get-config', () => getAiPayload());
ipcMain.handle('ai:set-config', (_event, patch) => applyAiConfig(patch));
ipcMain.handle('ai:set-api-key', (_event, value) => setAiApiKey(value));
ipcMain.handle('ai:clear-api-key', () => clearAiApiKey());
ipcMain.handle('ai:test', async (_event, input) => {
  try {
    const request = input && typeof input === 'object' ? input : {};
    const patch = request.config && typeof request.config === 'object' ? request.config : request;
    const config = normalizeAiSettings({ ...appState.ai, ...patch });
    const requestedKey = typeof request.apiKey === 'string' ? request.apiKey.trim() : '';
    const result = await testAiConnection({ config, apiKey: requestedKey || aiApiKey });
    return { ...result, ai: getAiPayload() };
  } catch (error) {
    return { ok: false, error: error.message || 'AI 连接测试失败', ai: getAiPayload() };
  }
});
ipcMain.handle('ai:chat', async (_event, input) => {
  try {
    if (!appState.ai.enabled) return { ok: false, error: 'AI 未启用，请先到设置中开启' };
    const messages = input && Array.isArray(input.messages)
      ? input.messages
      : [{ role: 'user', content: String((input && input.prompt) || '') }];
    const result = await chatCompletion({ config: appState.ai, apiKey: aiApiKey, messages });
    return { ok: true, content: result.content, model: result.model, usage: result.usage };
  } catch (error) {
    return { ok: false, error: error.message || 'AI 请求失败' };
  }
});
ipcMain.on('settings:close', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
});
ipcMain.on('settings:open-reminders', () => openReminderWindow());

ipcMain.handle('search:get', () => getSearchPayload());
ipcMain.handle('search:set-mode', (_event, mode) => setSearchPanelMode(mode));
ipcMain.handle('search:set-engine', (_event, engineId) => {
  appState.settings.searchEngine = normalizeSearchEngine(engineId);
  saveState();
  broadcastSearch();
  refreshTrayMenu();
  return getSearchPayload();
});
ipcMain.handle('search:get-prefill', () => searchPrefill);
ipcMain.on('search:prefill-consumed', () => { searchPrefill = null; });
ipcMain.handle('search:read-clipboard', async () => {
  const text = await readClipboardText();
  return { ok: Boolean(text), text, error: text ? '' : '剪贴板里没有可用文本' };
});
ipcMain.handle('search:set-translation-language', (_event, patch) => {
  if (patch && typeof patch === 'object') {
    appState.settings.translationSource = normalizeTranslationLanguage(patch.source, { source: true });
    let target = normalizeTranslationLanguage(patch.target);
    if (appState.settings.translationSource !== 'auto' && appState.settings.translationSource === target) {
      target = target === 'zh-CN' ? 'en' : 'zh-CN';
    }
    appState.settings.translationTarget = target;
    saveState();
    broadcastSearch();
  }
  return getSearchPayload();
});
ipcMain.handle('search:translate', async (_event, input) => {
  const text = String((input && input.text) || '').trim();
  if (!text) return { ok: false, error: '请输入要翻译的内容' };
  const source = normalizeTranslationLanguage(input && input.source, { source: true });
  const target = normalizeTranslationLanguage(input && input.target);
  const targetUrl = buildTranslationUrl(text, source, target);
  try {
    await shell.openExternal(targetUrl);
    return { ok: true };
  } catch (error) {
    console.warn('Unable to open translation target:', error.message);
    return { ok: false, error: '无法打开翻译页面，请重试' };
  }
});
ipcMain.handle('clipboard:search', () => openSearchWithClipboard('search'));
ipcMain.handle('clipboard:translate', () => openSearchWithClipboard('translate'));
ipcMain.handle('search:submit', async (_event, query) => {
  const target = buildSearchUrl(query, appState.settings.searchEngine);
  if (!target) return { ok: false, error: '请输入搜索内容或网址' };
  try {
    await shell.openExternal(target);
    return { ok: true };
  } catch (error) {
    console.warn('Unable to open search target:', error.message);
    return { ok: false, error: '无法打开浏览器，请重试' };
  }
});
ipcMain.on('search:close', () => hideSearchWindow());
ipcMain.on('search:open', () => openSearchWindow());

ipcMain.handle('pomodoro:get', () => getPomodoroPayload());
ipcMain.handle('pomodoro:start', () => startPomodoro());
ipcMain.handle('pomodoro:pause', () => pausePomodoro());
ipcMain.handle('pomodoro:reset', () => resetPomodoro());
ipcMain.handle('pomodoro:skip', () => skipPomodoro());
ipcMain.on('pomodoro:close', () => hidePomodoroWindow());

ipcMain.handle('reminders:get', () => getReminderPayload());
ipcMain.handle('reminders:update', (_event, patch) => applyReminderPatch(patch));
ipcMain.on('reminders:close', () => hideReminderWindow());

ipcMain.on('window:fit', (_event, size) => fitWindow(size));

ipcMain.on('drag:start', () => {
  if (!win || win.isDestroyed() || appState.lockedPosition) return;
  dragging = true;
  dragStartCursor = screen.getCursorScreenPoint();

  // Keep the content size fixed while moving. This avoids the Windows
  // fractional-DPI resize bug and keeps the pet at its native 296x340 size.
  const bounds = win.getContentBounds();
  winStart = { x: bounds.x, y: bounds.y };
  winSize = { width: bounds.width, height: bounds.height };
});

ipcMain.on('drag:move', () => {
  if (!win || win.isDestroyed() || !dragging) return;
  const cursor = screen.getCursorScreenPoint();
  win.setContentBounds({
    x: winStart.x + (cursor.x - dragStartCursor.x),
    y: winStart.y + (cursor.y - dragStartCursor.y),
    width: winSize.width,
    height: winSize.height
  });
});

ipcMain.on('drag:end', () => {
  if (!win || win.isDestroyed()) {
    dragging = false;
    return;
  }
  dragging = false;
  const bounds = win.getContentBounds();
  const position = clampPosition(bounds.x, bounds.y, bounds.width, bounds.height);
  if (position.x !== bounds.x || position.y !== bounds.y) {
    win.setContentBounds({
      x: position.x,
      y: position.y,
      width: bounds.width,
      height: bounds.height
    });
  }
  appState.position = position;
  saveState();
});

ipcMain.on('pet:interaction', () => markPetInteraction());

ipcMain.on('hit:ignore', (_event, ignore) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(Boolean(ignore) || appState.settings.clickThrough, { forward: true });
});

ipcMain.on('menu:open', () => {
  if (!win || win.isDestroyed()) return;
  Menu.buildFromTemplate(buildMenuTemplate()).popup({ window: win });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('before-quit', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.destroy();
  settingsWindow = null;
  if (searchWindow && !searchWindow.isDestroyed()) searchWindow.destroy();
  searchWindow = null;
  stopPomodoroTimer();
  stopReminderTimer();
  if (pomodoroWindow && !pomodoroWindow.isDestroyed()) pomodoroWindow.destroy();
  pomodoroWindow = null;
  if (reminderWindow && !reminderWindow.isDestroyed()) reminderWindow.destroy();
  reminderWindow = null;
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
});

app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.anotherme.ampet');
  loadState();
  lastPetInteractionAt = Date.now();
  createWindow();
  createTray();
  initializeSearchShortcut();
  ensureReminderTimer();
  screen.on('display-metrics-changed', ensureWindowVisible);
  screen.on('display-removed', ensureWindowVisible);
  screen.on('display-added', ensureWindowVisible);

  win.webContents.once('did-finish-load', () => {
    startCursorPoll();
    if (win && !win.isDestroyed()) {
      win.webContents.send('position:lock', appState.lockedPosition);
      win.webContents.send('settings:changed', getSettingsPayload());
      refreshTrayMenu();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
});

module.exports = {
  DEFAULT_AI_SETTINGS,
  getAiPayload,
  normalizeAiSettings,
  applyAiConfig,
  setAiApiKey,
  clearAiApiKey,
  openAiChat,
  openAiSettings,
  buildSearchUrl,
  buildTranslationUrl,
  normalizeTranslationLanguage,
  normalizeReminderSettings,
  readClipboardText,
  openSearchWithClipboard,
  getReminderPayload,
  applyReminderPatch,
  isUrlLike,
  normalizeSearchEngine,
  validateSearchShortcut,
  normalizeSearchShortcut,
  formatShortcutForDisplay,
  setSearchShortcut,
  openSettingsWindow,
  getPomodoroPayload,
  startPomodoro,
  pausePomodoro,
  resetPomodoro,
  skipPomodoro,
  openPomodoroWindow,
  openReminderWindow
};



