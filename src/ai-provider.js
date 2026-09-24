'use strict';

const DEFAULT_AI_CONFIG = Object.freeze({
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  systemPrompt: '你是 AM Pet 桌宠的 AI 助手。回答要准确、简洁、友好，默认使用中文。',
  temperature: 0.7,
  maxTokens: 1024,
  timeoutMs: 60000
});

const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 8000;
const MAX_TOTAL_CHARS = 24000;
const ALLOWED_ROLES = new Set(['system', 'user', 'assistant']);

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return DEFAULT_AI_CONFIG.baseUrl;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new Error('AI Base URL 不是有效网址');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('AI Base URL 只支持 http 或 https');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function normalizeAiConfig(value, current = DEFAULT_AI_CONFIG) {
  const source = value && typeof value === 'object' ? value : {};
  const base = current && typeof current === 'object' ? current : DEFAULT_AI_CONFIG;
  const model = String(source.model === undefined ? base.model : source.model).trim().slice(0, 200);
  const systemPrompt = String(source.systemPrompt === undefined ? base.systemPrompt : source.systemPrompt).trim().slice(0, 4000);
  return {
    baseUrl: normalizeBaseUrl(source.baseUrl === undefined ? base.baseUrl : source.baseUrl),
    model: model || DEFAULT_AI_CONFIG.model,
    systemPrompt,
    temperature: clampNumber(source.temperature === undefined ? base.temperature : source.temperature, 0, 2, DEFAULT_AI_CONFIG.temperature),
    maxTokens: Math.round(clampNumber(source.maxTokens === undefined ? base.maxTokens : source.maxTokens, 1, 8192, DEFAULT_AI_CONFIG.maxTokens)),
    timeoutMs: Math.round(clampNumber(source.timeoutMs === undefined ? base.timeoutMs : source.timeoutMs, 5000, 120000, DEFAULT_AI_CONFIG.timeoutMs))
  };
}

function getChatCompletionsUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  return normalized + '/chat/completions';
}

function normalizeMessages(value) {
  const list = Array.isArray(value) ? value : [];
  const result = [];
  let totalChars = 0;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const role = String(item.role || '').trim();
    const content = String(item.content || '').trim();
    if (!ALLOWED_ROLES.has(role) || !content) continue;
    const clipped = content.slice(0, MAX_MESSAGE_CHARS);
    if (totalChars + clipped.length > MAX_TOTAL_CHARS) break;
    totalChars += clipped.length;
    result.push({ role, content: clipped });
    if (result.length >= MAX_MESSAGES) break;
  }
  return result;
}

function extractAssistantContent(payload) {
  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const content = choice && choice.message ? choice.message.content : null;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

function friendlyHttpError(status, payload, fallbackText) {
  const apiMessage = payload && payload.error && (payload.error.message || payload.error.code);
  const detail = String(apiMessage || fallbackText || '').trim().slice(0, 300);
  if (status === 401 || status === 403) return 'API Key 无效或没有访问权限' + (detail ? '：' + detail : '');
  if (status === 404) return '接口地址或模型不存在，请检查 Base URL 和模型名' + (detail ? '：' + detail : '');
  if (status === 408) return 'AI 服务响应超时，请稍后重试';
  if (status === 429) return '请求过于频繁或额度不足，请检查账户额度' + (detail ? '：' + detail : '');
  if (status >= 500) return 'AI 服务暂时不可用，请稍后重试' + (detail ? '：' + detail : '');
  return 'AI 请求失败（HTTP ' + status + '）' + (detail ? '：' + detail : '');
}

async function chatCompletion(options = {}) {
  const config = normalizeAiConfig(options.config);
  const messages = normalizeMessages(options.messages);
  if (!messages.some((message) => message.role === 'user')) throw new Error('至少需要一条用户消息');

  const requestMessages = messages.slice();
  if (config.systemPrompt && !requestMessages.some((message) => message.role === 'system')) {
    requestMessages.unshift({ role: 'system', content: config.systemPrompt });
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持网络请求');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const externalSignal = options.signal;
  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onAbort, { once: true });
  }

  const headers = { 'Content-Type': 'application/json' };
  const apiKey = String(options.apiKey || '').trim();
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;

  const body = {
    model: config.model,
    messages: requestMessages,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    stream: false
  };

  try {
    const response = await fetchImpl(getChatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const responseText = await response.text();
    let payload = null;
    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch (error) {
      payload = null;
    }
    if (!response.ok) throw new Error(friendlyHttpError(response.status, payload, responseText));
    const content = extractAssistantContent(payload);
    if (!content) throw new Error('AI 服务返回了空内容');
    return {
      ok: true,
      content,
      model: String((payload && payload.model) || config.model),
      usage: payload && payload.usage ? payload.usage : null
    };
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('AI 请求超时或已取消');
    if (error instanceof TypeError) throw new Error('无法连接 AI 服务，请检查网络、Base URL 或服务是否启动');
    throw error;
  } finally {
    clearTimeout(timeout);
    if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
  }
}

async function testAiConnection(options = {}) {
  const result = await chatCompletion({
    ...options,
    messages: [{ role: 'user', content: '请只回复：OK' }],
    config: {
      ...normalizeAiConfig(options.config),
      maxTokens: 16
    }
  });
  return { ok: true, message: '连接成功', reply: result.content, model: result.model };
}

module.exports = {
  DEFAULT_AI_CONFIG,
  normalizeBaseUrl,
  normalizeAiConfig,
  getChatCompletionsUrl,
  normalizeMessages,
  extractAssistantContent,
  chatCompletion,
  testAiConnection
};