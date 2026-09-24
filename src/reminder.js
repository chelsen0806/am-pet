'use strict';

(function () {
  const list = document.getElementById('reminder-list');
  const status = document.getElementById('status');
  const resetButton = document.getElementById('reset');
  const closeButton = document.getElementById('close');
  const cards = new Map();
  let payload = null;
  let pending = false;

  function setStatus(message, isError) {
    status.textContent = message;
    status.style.color = isError ? '#b14f42' : '';
  }

  function formatDuration(ms) {
    const totalMinutes = Math.max(0, Math.floor(Number(ms) / 60000));
    if (totalMinutes < 1) return '不到 1 分钟';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return minutes ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
    return `${minutes} 分钟`;
  }

  function updateTimes() {
    if (!payload) return;
    const now = Date.now();
    const idleMs = Math.max(0, now - Number(payload.lastPetInteractionAt || now));
    for (const id of cards.keys()) {
      const card = cards.get(id);
      const settings = payload.settings[id];
      const runtime = payload.runtime[id] || {};
      card.element.classList.toggle('disabled', !settings.enabled);
      if (!settings.enabled) {
        card.nextTime.textContent = '已关闭';
        card.idleText.textContent = id === 'petWater' ? `已 ${formatDuration(idleMs)} 未互动` : '';
        continue;
      }
      const remaining = Number.isFinite(runtime.nextAt) ? Math.max(0, runtime.nextAt - now) : settings.intervalMinutes * 60000;
      card.nextTime.textContent = remaining <= 1000 ? '即将提醒' : `距下次约 ${formatDuration(remaining)}`;
      card.idleText.textContent = id === 'petWater' ? `已 ${formatDuration(idleMs)} 未互动` : '';
    }
  }

  function createCard(definition) {
    const card = document.createElement('article');
    card.className = 'reminder-card';
    card.dataset.id = definition.id;

    const titleLine = document.createElement('div');
    titleLine.className = 'card-title-line';
    const title = document.createElement('strong');
    title.className = 'card-title';
    title.textContent = definition.label;
    titleLine.appendChild(title);

    const switchLabel = document.createElement('label');
    switchLabel.className = 'switch';
    switchLabel.title = '开启或关闭提醒';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    const switchTrack = document.createElement('span');
    switchTrack.className = 'switch-track';
    switchLabel.appendChild(enabled);
    switchLabel.appendChild(switchTrack);

    const description = document.createElement('p');
    description.className = 'card-description';
    description.textContent = definition.description;

    const intervalLine = document.createElement('div');
    intervalLine.className = 'interval-current';
    const intervalInput = document.createElement('input');
    intervalInput.className = 'interval-input';
    intervalInput.type = 'number';
    intervalInput.min = '1';
    intervalInput.max = '1440';
    intervalInput.step = '1';
    intervalInput.setAttribute('aria-label', `${definition.label}间隔分钟数`);
    const unit = document.createElement('span');
    unit.textContent = '分钟一次';
    intervalLine.appendChild(intervalInput);
    intervalLine.appendChild(unit);

    const nextLine = document.createElement('div');
    nextLine.className = 'next-line';
    const idleText = document.createElement('span');
    const nextTime = document.createElement('span');
    nextTime.className = 'next-time';
    nextLine.appendChild(idleText);
    nextLine.appendChild(nextTime);

    const presets = document.createElement('div');
    presets.className = 'preset-line';
    for (const minutes of definition.intervals || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset-button';
      button.textContent = `${minutes} 分钟`;
      button.addEventListener('click', () => update({ [definition.id]: { intervalMinutes: minutes } }));
      presets.appendChild(button);
    }

    card.appendChild(titleLine);
    card.appendChild(switchLabel);
    card.appendChild(description);
    card.appendChild(intervalLine);
    card.appendChild(nextLine);
    card.appendChild(presets);

    enabled.addEventListener('change', () => update({ [definition.id]: { enabled: enabled.checked } }));
    intervalInput.addEventListener('change', () => update({ [definition.id]: { intervalMinutes: intervalInput.value } }));
    list.appendChild(card);
    cards.set(definition.id, { element: card, enabled, intervalInput, nextTime, idleText });
  }

  function render(nextPayload) {
    if (!nextPayload) return;
    payload = nextPayload;
    for (const definition of Object.values(payload.definitions || {})) {
      if (!cards.has(definition.id)) createCard(definition);
      const card = cards.get(definition.id);
      const settings = payload.settings[definition.id];
      card.enabled.checked = settings.enabled;
      if (document.activeElement !== card.intervalInput) card.intervalInput.value = String(settings.intervalMinutes);
    }
    updateTimes();
  }

  async function update(patch) {
    if (pending || !window.reminderAPI) return;
    pending = true;
    try {
      const nextPayload = await window.reminderAPI.update(patch);
      render(nextPayload);
      setStatus('已保存，新的时间已生效');
    } catch (error) {
      setStatus('保存失败，请重试', true);
    } finally {
      pending = false;
    }
  }

  resetButton.addEventListener('click', () => update({ reset: true }));
  closeButton.addEventListener('click', () => window.reminderAPI.close());
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      window.reminderAPI.close();
    }
  });

  if (window.reminderAPI) {
    window.reminderAPI.get().then(render).catch(() => setStatus('无法读取提醒设置', true));
    window.reminderAPI.onChanged(render);
  } else {
    setStatus('提醒接口不可用', true);
  }
  setInterval(updateTimes, 1000);
})();