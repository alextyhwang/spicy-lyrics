// NAME: Spotify Background Performance
// DESCRIPTION: Pause background visual animations; audio and timers remain untouched.
// VERSION: 1.1.0
// LICENSE: MIT
(() => {
  'use strict';
  if (window._spotify_background_performance) return;
  const KEY = 'spotify-performance:pause-background-animations';
  const CLASS = 'spotify-performance-background';
  const nativeAnimate = Element.prototype.animate;
  const paused = new Map();
  let enabled = localStorage.getItem(KEY) !== 'false';
  let blockedAnimations = 0;
  const active = () => !enabled || (document.visibilityState === 'visible' && document.hasFocus());
  const connected = a => a.effect?.target?.isConnected !== false;
  // These targets have their own RAF/WAAPI and PiP lifecycle in the lyrics fork.
  const forkOwned = a => !!a.effect?.target?.closest?.('#SpicyLyricsPage, #SpicyLyricsNPVCard');
  const mainOwned = a => a.effect?.target?.ownerDocument === document && !forkOwned(a);
  const cssOwned = a => (typeof window.CSSAnimation === 'function' && a instanceof window.CSSAnimation)
    || (typeof window.CSSTransition === 'function' && a instanceof window.CSSTransition);

  function release(a, resume = false) {
    const state = paused.get(a);
    paused.delete(a);
    if (!state) return;
    try {
      // Do not replace a method changed by the owner while the animation was inactive.
      if (a.pause === state.wrapper) {
        if (state.descriptor) Object.defineProperty(a, 'pause', state.descriptor);
        else delete a.pause;
      }
    } catch { /* Native animation state remains usable even if a property is locked. */ }
    // Relinquish a live temporary pause even when its target was detached/adopted.
    // Explicit owner pause calls use release(a) and therefore never resume playback.
    if (resume) {
      try { if (a.playState === 'paused') a.play(); } catch { /* isolate failures */ }
    }
  }
  function prune() {
    for (const a of paused.keys()) {
      if (!connected(a) || !mainOwned(a) || a.playState === 'idle' || a.playState === 'finished') release(a, true);
    }
  }
  function pause(a) {
    // CSS retains ownership of CSS animations/transitions. The inactive class handles keyframes.
    if (!connected(a) || !mainOwned(a) || cssOwned(a) || a.playState !== 'running' || paused.has(a)) return;
    const originalPause = a.pause;
    const descriptor = Object.getOwnPropertyDescriptor(a, 'pause');
    const state = {descriptor, wrapper: null};
    state.wrapper = function (...args) {
      // An explicit owner pause supersedes the temporary background pause.
      if (this === a) release(a);
      return Reflect.apply(originalPause, this, args);
    };
    try {
      Reflect.apply(originalPause, a, []);
      Object.defineProperty(a, 'pause', {configurable: true, writable: true, value: state.wrapper});
      paused.set(a, state);
      blockedAnimations++;
    } catch {
      // A successful native animate() must never throw because of this guard.
      try { if (a.playState === 'paused') a.play(); } catch { /* best effort */ }
    }
  }
  const style = document.createElement('style');
  style.id = 'spotify-background-performance-style';
  style.textContent = `html.${CLASS} *, html.${CLASS} *::before, html.${CLASS} *::after {
    animation-play-state: paused !important;
  }`;
  document.head.appendChild(style);
  function sync() {
    prune();
    if (active()) {
      document.documentElement.classList.remove(CLASS);
      for (const a of paused.keys()) {
        release(a, true);
      }
    } else {
      for (const a of document.getAnimations()) pause(a);
      document.documentElement.classList.add(CLASS);
    }
  }
  Element.prototype.animate = function (...args) {
    const a = Reflect.apply(nativeAnimate, this, args);
    // Generic transfers are checked on lifecycle events/new main-document animations,
    // not continuously. Fork-owned lyrics are excluded before any pause, including PiP.
    if (enabled && this.ownerDocument === document) {
      try { prune(); if (!active()) pause(a); } catch { /* keep native return semantics */ }
    }
    return a;
  };
  window.addEventListener('focus', sync);
  window.addEventListener('blur', sync);
  document.addEventListener('visibilitychange', sync);
  window._spotify_background_performance = {
    status: () => ({version: '1.1.0', enabled, active: active(), pausedAnimations: paused.size, blockedAnimations}),
    setEnabled(value) { enabled = !!value; localStorage.setItem(KEY, String(enabled)); sync(); },
  };
  sync();
  let attempts = 0;
  function registerMenu() {
    if (window.Spicetify?.Menu?.Item) {
      const item = new Spicetify.Menu.Item('Pause animations in background', enabled, self => {
        window._spotify_background_performance.setEnabled(!enabled); self.isEnabled = enabled;
      });
      item.register();
    } else if (++attempts < 30) setTimeout(registerMenu, 100);
  }
  registerMenu();
})();
