'use strict';

(function () {
  const elements = {
    ring: document.getElementById('timer-ring'),
    phase: document.getElementById('phase'),
    time: document.getElementById('time'),
    rounds: document.getElementById('rounds'),
    status: document.getElementById('status'),
    primary: document.getElementById('primary'),
    reset: document.getElementById('reset'),
    skip: document.getElementById('skip'),
    close: document.getElementById('close')
  };

  let payload = null;
  let pending = false;

  function formatTime(remainingMs) {
    const totalSeconds = Math.max(0, Math.ceil(Number(remainingMs) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  function setStatus(message, isError) {
    elements.status.textContent = message;
    elements.status.classList.toggle('error', Boolean(isError));
  }

  function render(nextPayload) {
    if (!nextPayload) return;
    payload = nextPayload;
    document.body.dataset.phase = payload.phase;
    elements.ring.style.setProperty('--remaining', String(Math.max(0, Math.min(1, payload.remainingRatio || 0))));
    elements.phase.textContent = payload.phaseLabel;
    elements.time.textContent = formatTime(payload.remainingMs);
    elements.rounds.textContent = `已完成 ${payload.completedFocusCount} 轮`;
    setStatus(payload.statusText || '', false);

    if (payload.running) {
      elements.primary.textContent = '暂停';
      elements.primary.classList.add('running');
    } else {
      const untouched = payload.remainingMs >= payload.durationMs;
      elements.primary.textContent = untouched ? '开始' : '继续';
      elements.primary.classList.remove('running');
    }
  }

  async function runAction(action) {
    if (pending || !window.pomodoroAPI) return;
    pending = true;
    elements.primary.disabled = true;
    elements.reset.disabled = true;
    elements.skip.disabled = true;
    try {
      const nextPayload = await window.pomodoroAPI[action]();
      render(nextPayload);
    } catch (error) {
      setStatus('操作失败，请重试', true);
    } finally {
      pending = false;
      elements.primary.disabled = false;
      elements.reset.disabled = false;
      elements.skip.disabled = false;
    }
  }

  elements.primary.addEventListener('click', () => {
    if (!payload) return;
    runAction(payload.running ? 'pause' : 'start');
  });

  elements.reset.addEventListener('click', () => runAction('reset'));
  elements.skip.addEventListener('click', () => runAction('skip'));
  elements.close.addEventListener('click', () => window.pomodoroAPI.close());

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      window.pomodoroAPI.close();
    }
  });

  if (window.pomodoroAPI) {
    window.pomodoroAPI.get().then(render).catch(() => setStatus('无法读取计时状态', true));
    window.pomodoroAPI.onChanged(render);
  } else {
    setStatus('番茄钟接口不可用', true);
  }
})();
