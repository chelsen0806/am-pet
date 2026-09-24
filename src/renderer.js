'use strict';

(function () {
  const WIDTH = 296;
  const HEIGHT = 340;
  const FPS = 30;
  const FRAME_MS = 1000 / FPS;
  const manifest = window.AM_PET_FRAMES || {};
  const ACTIONS = {
    idle: { count: manifest.idle || 1, loop: true },
    jump: { count: manifest.jump || 1, loop: false },
    shake: { count: manifest.shake || 1, loop: false },
    shake2: { count: manifest.shake2 || 1, loop: false },
    shy_shake: { count: manifest.shy_shake || 1, loop: false }
  };
  const BELLY_ACTIONS = ['shake', 'shake2', 'shy_shake'];

  const petEl = document.getElementById('pet');
  const hitCanvas = document.createElement('canvas');
  const hitCtx = hitCanvas.getContext('2d', { willReadFrequently: true });
  hitCanvas.width = WIDTH;
  hitCanvas.height = HEIGHT;

  const cache = new Map();
  let state = 'idle';
  let frame = 1;
  let lastFrameAt = performance.now();
  let acting = false;
  let ignoring = true;
  let lockedPosition = false;
  let petScale = 1;
  let animationSpeed = 1;
  let clickThrough = false;
  let drag = { active: false, moved: false, sx: 0, sy: 0, locked: false };
  let lastClickAt = 0;
  let lastClickPoint = { x: 0, y: 0 };
  const DOUBLE_CLICK_MS = 350;
  const DOUBLE_CLICK_DISTANCE = 8;

  function framePath(name, index) {
    return `assets/frames/${name}/${String(index).padStart(3, '0')}.png`;
  }

  function preloadFrames(name) {
    const action = ACTIONS[name];
    for (let i = 1; i <= action.count; i++) {
      const src = framePath(name, i);
      const img = new Image();
      img.src = src;
      cache.set(src, img);
    }
  }

  Object.keys(ACTIONS).forEach(preloadFrames);

  function imageFor(name, index) {
    const src = framePath(name, index);
    return cache.get(src) || null;
  }

  function drawHitFrame() {
    const img = imageFor(state, frame);
    if (!img || !img.complete || img.naturalWidth === 0) return false;
    hitCtx.clearRect(0, 0, WIDTH, HEIGHT);
    hitCtx.drawImage(img, 0, 0, WIDTH, HEIGHT);
    return true;
  }

  function alphaAt(x, y) {
    const baseX = x / petScale;
    const baseY = y / petScale;
    if (baseX < 0 || baseY < 0 || baseX >= WIDTH || baseY >= HEIGHT) return 0;
    if (!drawHitFrame()) return 255;
    return hitCtx.getImageData(Math.floor(baseX), Math.floor(baseY), 1, 1).data[3];
  }

  function overPet(x, y) {
    return alphaAt(x, y) > 24;
  }

  function setIgnore(ignore) {
    const next = clickThrough ? true : Boolean(ignore);
    if (next === ignoring) return;
    ignoring = next;
    if (window.petAPI) window.petAPI.setIgnore(next);
  }

  function play(name) {
    if (acting || !ACTIONS[name]) return;
    state = name;
    frame = 1;
    acting = name !== 'idle';
    lastFrameAt = performance.now();
    petEl.src = framePath(state, frame);
  }

  function finishAction() {
    state = 'idle';
    frame = 1;
    acting = false;
    lastFrameAt = performance.now();
    petEl.src = framePath(state, frame);
  }

  function tick(t) {
    const frameMs = FRAME_MS / animationSpeed;
    if (t - lastFrameAt >= frameMs) {
      const action = ACTIONS[state];
      const steps = Math.max(1, Math.floor((t - lastFrameAt) / frameMs));
      lastFrameAt += steps * frameMs;
      frame += steps;
      if (frame > action.count) {
        if (action.loop) frame = ((frame - 1) % action.count) + 1;
        else finishAction();
      }
      petEl.src = framePath(state, frame);
    }
    requestAnimationFrame(tick);
  }

  function regionAt(x, y) {
    if (!overPet(x, y)) return null;
    const baseY = y / petScale;
    if (baseY < HEIGHT / 3) return 'ear';
    if (baseY < HEIGHT * 2 / 3) return 'belly';
    return 'body';
  }

  function react(region) {
    if (acting) return;
    if (region === 'ear') play('jump');
    else if (region === 'belly') play(BELLY_ACTIONS[(Math.random() * BELLY_ACTIONS.length) | 0]);
  }

  function applySettings(settings, resizeWindow) {
    if (!settings) return;
    if (Number.isFinite(settings.scale)) {
      petScale = Math.min(2, Math.max(0.5, settings.scale));
    }
    if (Number.isFinite(settings.opacity)) {
      petEl.style.opacity = String(Math.min(1, Math.max(0.2, settings.opacity)));
    }
    if (Number.isFinite(settings.animationSpeed)) {
      animationSpeed = Math.min(2, Math.max(0.25, settings.animationSpeed));
    }
    if (typeof settings.lockedPosition === 'boolean') {
      lockedPosition = settings.lockedPosition;
    }
    if (typeof settings.clickThrough === 'boolean') {
      clickThrough = settings.clickThrough;
    }
    if (clickThrough) setIgnore(true);
    else if (!drag.active) setIgnore(false);
    if (resizeWindow && window.petAPI) {
      window.petAPI.fit(Math.round(WIDTH * petScale), Math.round(HEIGHT * petScale));
    }
  }
  function blockBrowserZoom(event) {
    event.preventDefault();
  }

  window.addEventListener('wheel', blockBrowserZoom, { passive: false, capture: true });
  window.addEventListener('gesturestart', blockBrowserZoom, { passive: false, capture: true });
  window.addEventListener('gesturechange', blockBrowserZoom, { passive: false, capture: true });
  window.addEventListener('gestureend', blockBrowserZoom, { passive: false, capture: true });
  window.addEventListener('dragstart', blockBrowserZoom, true);
  window.addEventListener('selectstart', blockBrowserZoom, true);

  window.addEventListener('mousemove', (event) => {
    if (drag.active) {
      if (drag.locked) return;
      if (Math.abs(event.screenX - drag.sx) + Math.abs(event.screenY - drag.sy) > 4) {
        drag.moved = true;
      }
      if (window.petAPI) window.petAPI.dragMove();
      return;
    }
    setIgnore(!overPet(event.clientX, event.clientY));
  }, true);

  window.addEventListener('mousedown', (event) => {
    if (clickThrough || event.button !== 0 || !overPet(event.clientX, event.clientY)) return;
    drag = { active: true, moved: false, sx: event.screenX, sy: event.screenY, locked: lockedPosition };
    if (window.petAPI && !drag.locked) window.petAPI.dragStart(event.screenX, event.screenY);
    event.preventDefault();
  }, true);

  window.addEventListener('mouseup', (event) => {
    if (!drag.active) return;
    const moved = drag.moved;
    const wasLocked = drag.locked;
    drag.active = false;
    if (window.petAPI && !wasLocked) window.petAPI.dragEnd();
    if (window.petAPI && window.petAPI.interact) window.petAPI.interact();
    if (!moved) {
      const now = Date.now();
      const isDoubleClick = now - lastClickAt <= DOUBLE_CLICK_MS &&
        Math.abs(event.screenX - lastClickPoint.x) <= DOUBLE_CLICK_DISTANCE &&
        Math.abs(event.screenY - lastClickPoint.y) <= DOUBLE_CLICK_DISTANCE;

      if (isDoubleClick) {
        lastClickAt = 0;
        if (window.petAPI && window.petAPI.openSearch) window.petAPI.openSearch();
      } else {
        lastClickAt = now;
        lastClickPoint = { x: event.screenX, y: event.screenY };
        react(regionAt(event.clientX, event.clientY));
      }
    }
    setIgnore(!overPet(event.clientX, event.clientY));
  }, true);

  window.addEventListener('blur', () => {
    if (!drag.active) return;
    const wasLocked = drag.locked;
    drag.active = false;
    if (window.petAPI && !wasLocked) window.petAPI.dragEnd();
    if (window.petAPI && window.petAPI.interact) window.petAPI.interact();
  });

  window.addEventListener('contextmenu', (event) => {
    if (clickThrough || !overPet(event.clientX, event.clientY)) return;
    event.preventDefault();
    if (window.petAPI) window.petAPI.openMenu();
  }, true);

  if (window.petAPI) {
    window.petAPI.onCursor((pos) => {
      if (!drag.active) setIgnore(!overPet(pos.x, pos.y));
    });
    if (window.petAPI.onLock) {
      window.petAPI.onLock((locked) => { lockedPosition = Boolean(locked); });
    }
    if (window.petAPI.onSettings) {
      window.petAPI.onSettings((settings) => applySettings(settings, false));
    }
    if (window.petAPI.getState) {
      window.petAPI.getState().then((s) => applySettings(s, true)).catch(() => {
        window.petAPI.fit(WIDTH, HEIGHT);
      });
    } else {
      window.petAPI.fit(WIDTH, HEIGHT);
    }
  }

  petEl.src = framePath(state, frame);
  requestAnimationFrame(tick);
})();
