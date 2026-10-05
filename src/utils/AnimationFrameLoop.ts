import { $animationFpsCap, $animationFpsCapEnabled } from "./stores.ts";
import { $experiment, isExperimentEnabled } from "./experiments.ts";

/**
 * One requestAnimationFrame loop shared by everything that repaints every frame
 * (the lyrics animator and the Kawarp backgrounds), capped by `$animationFpsCap`.
 *
 * Both have to render on the *same* frames: if each capped itself on its own
 * schedule, the page would still be repainted on the union of their frames.
 */

type FrameCallback = (timestamp: number) => void;

const callbacks = new Set<FrameCallback>();

// vsync timestamps jitter by a fraction of a millisecond. Without some slack a
// 60 fps cap on a 60 Hz display would drop every other frame.
const FRAME_SLACK_MS = 1;

// Same bounds and default as the settings slider. The value comes from the
// persisted settings blob, so it is validated rather than trusted.
const MIN_FPS_CAP = 15;
const MAX_FPS_CAP = 240;
const DEFAULT_FPS_CAP = 60;

const computeFrameInterval = (): number => {
  if (!$animationFpsCapEnabled.get()) return 0;
  const saved = Number($animationFpsCap.get());
  const fps = Number.isFinite(saved)
    ? Math.min(MAX_FPS_CAP, Math.max(MIN_FPS_CAP, saved))
    : DEFAULT_FPS_CAP;
  return 1000 / fps;
};

let frameInterval = computeFrameInterval();
const updateFrameInterval = () => {
  frameInterval = computeFrameInterval();
};
$animationFpsCapEnabled.listen(updateFrameInterval);
$animationFpsCap.listen(updateFrameInterval);

let lastRender = -Infinity;

const shouldRender = (timestamp: number): boolean => {
  if (frameInterval === 0) return true;
  const elapsed = timestamp - lastRender;
  if (elapsed < frameInterval - FRAME_SLACK_MS) return false;
  // Keep the phase so a 60 fps cap on a 144 Hz display averages out to 60,
  // but start over after a stall (hidden window, long task) instead of bursting.
  lastRender =
    elapsed >= frameInterval && elapsed < frameInterval * 2
      ? timestamp - (elapsed % frameInterval)
      : timestamp;
  return true;
};

// One-shot callbacks for the next rendered frame (see requestCappedFrame).
let pending = new Map<number, FrameCallback>();
let nextPendingId = 1;

const run = (callback: FrameCallback, timestamp: number) => {
  // One throwing subscriber must not stop the others (or the loop).
  try {
    callback(timestamp);
  } catch (err) {
    console.error("Spicy Lyrics: animation frame callback failed", err);
  }
};

let view: HTMLElement | null = null;
let frame: number | null = null;
let frameWindow: Window = window;
let removeViewListeners: (() => void) | null = null;
const INACTIVE_CLASS = "SpicyLyrics_RenderingInactive";
const styledDocuments = new WeakSet<Document>();
let viewDocument: Document | null = null;
let pageHidden = false;
let intersectionObserver: IntersectionObserver | null = null;
let intersectionGeneration = 0;
// Optimistic until the first real entry: async mounts and one-shot setup must
// be allowed to give the root its initial layout. No geometry reads or polling.
let viewIntersecting: boolean | null = null;

// Preserve the original experiment's full continuous-rendering opt-out.
const pausesOffscreen = (): boolean =>
  isExperimentEnabled("pauseInactiveRendering") && isExperimentEnabled("pauseOffscreenRendering");

function resetIntersectionObserver(): void {
  // disconnect() does not invalidate already queued callbacks.
  intersectionGeneration++;
  intersectionObserver?.disconnect();
  intersectionObserver = null;
  viewIntersecting = null;
}

function observeViewIntersection(): void {
  if (!view || !pausesOffscreen()) return;
  const element = view;
  const doc = element.ownerDocument;
  // PiP must observe the viewport/clipping ancestors in its own realm.
  const Observer = (doc.defaultView as (Window & typeof globalThis) | null)?.IntersectionObserver;
  if (typeof Observer !== "function") return; // Fail open in older hosts.
  const generation = intersectionGeneration;
  try {
    intersectionObserver = new Observer((entries) => {
      if (generation !== intersectionGeneration || view !== element || viewDocument !== doc ||
          element.ownerDocument !== doc) return;
      let intersecting = viewIntersecting;
      for (const entry of entries) {
        if (entry.target === element) intersecting = entry.isIntersecting;
      }
      if (intersecting === viewIntersecting) return;
      // A partial intersection suffices. Native IO applies ancestor clipping;
      // it does not detect another app covering Spotify. Edge contact remains
      // active so a threshold-0 notification cannot strand the view at an edge.
      viewIntersecting = intersecting;
      syncFrameLoop();
    }, { root: null, threshold: 0 });
    intersectionObserver.observe(element);
  } catch (err) {
    resetIntersectionObserver();
    console.error("Spicy Lyrics: intersection observation failed", err);
  }
}

type PausedAnimation = {
  release: () => void;
  resume: () => void;
};
const pausedAnimations = new Map<Animation, PausedAnimation>();
let renderedFrames = 0;
let inFrame = false;

/** PiP deliberately follows the same focus requirement as the main window. */
export const isAnimationDocumentActive = (doc: Document): boolean =>
  !isExperimentEnabled("pauseInactiveRendering") ||
  (doc.visibilityState === "visible" && doc.hasFocus());

const isActive = (): boolean => {
  if (!isExperimentEnabled("pauseInactiveRendering")) return true;
  return !!view?.isConnected && !pageHidden && isAnimationDocumentActive(view.ownerDocument) &&
    (!pausesOffscreen() || viewIntersecting !== false);
};

function ensureInactiveStyle(doc: Document): void {
  if (styledDocuments.has(doc)) return;
  const style = doc.createElement("style");
  // CSS retains ownership, including animations introduced after blur and
  // pseudo-elements. Removing the class restores the author's play-state.
  style.textContent = `
    #SpicyLyricsPage.${INACTIVE_CLASS},
    #SpicyLyricsPage.${INACTIVE_CLASS} *,
    #SpicyLyricsPage.${INACTIVE_CLASS}::before,
    #SpicyLyricsPage.${INACTIVE_CLASS}::after,
    #SpicyLyricsPage.${INACTIVE_CLASS} *::before,
    #SpicyLyricsPage.${INACTIVE_CLASS} *::after {
      animation-play-state: paused !important;
    }`;
  (doc.head ?? doc.documentElement).appendChild(style);
  styledDocuments.add(doc);
}

function setInactiveClass(element: HTMLElement, inactive: boolean): void {
  if (element.classList.contains(INACTIVE_CLASS) !== inactive) {
    element.classList.toggle(INACTIVE_CLASS, inactive);
  }
}

function isCssAnimation(animation: Animation): boolean {
  const target = (animation.effect as KeyframeEffect | null)?.target;
  // Adopted elements can retain objects created in their previous realm.
  const realms = [target?.ownerDocument.defaultView, viewDocument?.defaultView, window];
  return realms.some((realm) => {
    const constructors = realm as (Window & typeof globalThis) | null;
    return !!constructors &&
      ((typeof constructors.CSSAnimation === "function" && animation instanceof constructors.CSSAnimation) ||
       (typeof constructors.CSSTransition === "function" && animation instanceof constructors.CSSTransition));
  }) || Object.prototype.toString.call(animation) === "[object CSSAnimation]" ||
    Object.prototype.toString.call(animation) === "[object CSSTransition]";
}

function isLiveAnimation(animation: Animation, requireInView = true): boolean {
  const target = (animation.effect as KeyframeEffect | null)?.target;
  return !!target?.isConnected && (!requireInView || !!view?.contains(target)) &&
    animation.playState !== "idle" && animation.playState !== "finished";
}

function releaseAnimations(resume: boolean): void {
  for (const [animation, entry] of pausedAnimations) {
    try {
      if (resume && isLiveAnimation(animation, false) && animation.playState === "paused") entry.resume();
    } catch (err) {
      console.error("Spicy Lyrics: animation resume failed", err);
    } finally {
      entry.release();
    }
  }
}

function pauseAnimation(animation: Animation): void {
  if (pausedAnimations.has(animation) || isCssAnimation(animation) || !isLiveAnimation(animation) ||
      animation.playState !== "running") return;
  const pause = animation.pause;
  const play = animation.play;
  const pauseDescriptor = Object.getOwnPropertyDescriptor(animation, "pause");
  const playDescriptor = Object.getOwnPropertyDescriptor(animation, "play");
  let wrappedPause: Animation["pause"] | undefined;
  let wrappedPlay: Animation["play"] | undefined;
  const restoreMethod = (name: "pause" | "play", descriptor?: PropertyDescriptor) => {
    if (animation[name] !== (name === "pause" ? wrappedPause : wrappedPlay)) return;
    if (descriptor) Object.defineProperty(animation, name, descriptor);
    else delete (animation as any)[name];
  };
  const release = () => {
    pausedAnimations.delete(animation);
    animation.removeEventListener("cancel", release);
    animation.removeEventListener("finish", release);
    for (const [name, descriptor] of [["pause", pauseDescriptor], ["play", playDescriptor]] as const) {
      try { restoreMethod(name, descriptor); } catch (err) {
        console.error("Spicy Lyrics: animation method cleanup failed", err);
      }
    }
  };
  // Wrap only the animations this view paused, never a global prototype.
  // An explicit owner pause relinquishes our resume claim. An explicit play
  // while inactive remains gated until focus returns.
  try {
    pause.call(animation);
    wrappedPause = () => {
      release();
      pause.call(animation);
    };
    wrappedPlay = () => {
      play.call(animation);
      if (!isActive() && isLiveAnimation(animation)) pause.call(animation);
      else release();
    };
    Object.defineProperty(animation, "pause", { configurable: true, writable: true, value: wrappedPause });
    Object.defineProperty(animation, "play", { configurable: true, writable: true, value: wrappedPlay });
    animation.addEventListener("cancel", release);
    animation.addEventListener("finish", release);
    pausedAnimations.set(animation, { release, resume: () => play.call(animation) });
  } catch (err) {
    // A guard failure must not prevent other animations or RAF subscribers.
    try { release(); } catch { /* A non-configurable owner method stays owned. */ }
    try { if ((animation as Animation).playState === "paused") play.call(animation); } catch { /* Best effort. */ }
    console.error("Spicy Lyrics: animation pause failed", err);
  }
}

function syncFrameLoop(): void {
  const active = isActive();
  if (view) setInactiveClass(view, !active);
  for (const [animation, entry] of pausedAnimations) {
    try {
      if (!isLiveAnimation(animation) || animation.playState !== "paused") {
        // A still-connected target moved out of this root: return it to its
        // owner before forgetting it. Detached/dead objects need no replay.
        if (isLiveAnimation(animation, false) && animation.playState === "paused") entry.resume();
        entry.release();
      }
    } catch (err) {
      entry.release();
      console.error("Spicy Lyrics: animation cleanup failed", err);
    }
  }
  if (!active) {
    if (frame !== null) frameWindow.cancelAnimationFrame(frame);
    frame = null;
    try {
      for (const animation of view?.getAnimations({ subtree: true }) ?? []) {
        try { pauseAnimation(animation); } catch (err) {
          console.error("Spicy Lyrics: animation inspection failed", err);
        }
      }
    } catch (err) {
      console.error("Spicy Lyrics: animation enumeration failed", err);
    }
    return;
  }
  releaseAnimations(true);
  if (!inFrame && frame === null && (callbacks.size > 0 || pending.size > 0)) {
    lastRender = -Infinity;
    frameWindow = view?.ownerDocument.defaultView ?? window;
    frame = frameWindow.requestAnimationFrame(loop);
  }
}

/** Register the actual lyrics view, including a document Picture-in-Picture view. */
export function setAnimationFrameView(element: HTMLElement | null): void {
  if (element === view && element?.ownerDocument === viewDocument) {
    syncFrameLoop();
    return;
  }
  if (frame !== null) frameWindow.cancelAnimationFrame(frame);
  frame = null;
  removeViewListeners?.();
  removeViewListeners = null;
  resetIntersectionObserver();
  // Restore retained/adopted live objects before moving ownership. Detached,
  // cancelled and finished objects are simply forgotten.
  releaseAnimations(true);
  if (view) setInactiveClass(view, false);
  view = element;
  viewDocument = element?.ownerDocument ?? null;
  pageHidden = false;
  if (element) {
    const doc = element.ownerDocument;
    const host = doc.defaultView ?? window;
    ensureInactiveStyle(doc);
    const onPageHide = () => { pageHidden = true; syncFrameLoop(); };
    const onPageShow = () => { pageHidden = false; syncFrameLoop(); };
    host.addEventListener("focus", syncFrameLoop);
    host.addEventListener("blur", syncFrameLoop);
    doc.addEventListener("visibilitychange", syncFrameLoop);
    host.addEventListener("pagehide", onPageHide);
    host.addEventListener("pageshow", onPageShow);
    // Event-driven pruning and discovery after async lyrics/DOM replacement.
    // CSS arrivals need no observer: the inactive rule already covers them.
    const observer = new MutationObserver(() => {
      if (!isActive() || pausedAnimations.size) syncFrameLoop();
    });
    observer.observe(element, { childList: true, subtree: true });
    // Also see removal of the root itself; its subtree observer cannot see that.
    if (element.parentNode) observer.observe(element.parentNode, { childList: true });
    removeViewListeners = () => {
      host.removeEventListener("focus", syncFrameLoop);
      host.removeEventListener("blur", syncFrameLoop);
      doc.removeEventListener("visibilitychange", syncFrameLoop);
      host.removeEventListener("pagehide", onPageHide);
      host.removeEventListener("pageshow", onPageShow);
      observer.disconnect();
    };
    observeViewIntersection();
  } else {
    // One-shot work belonged to the view being destroyed, not its replacement.
    pending.clear();
  }
  syncFrameLoop();
}

const updateRenderingExperiments = () => {
  resetIntersectionObserver();
  observeViewIntersection();
  syncFrameLoop();
};
$experiment("pauseInactiveRendering").listen(updateRenderingExperiments);
$experiment("pauseOffscreenRendering").listen(updateRenderingExperiments);

// Read-only diagnostics for checking that background rendering really stops.
Object.defineProperty(window, "_spicy_lyrics_performance", {
  configurable: true,
  value: {
    status: () => ({
      version: "1.2.1",
      active: isActive(),
      scheduled: frame !== null,
      viewOpen: !!view?.isConnected,
      offscreenPauseEnabled: pausesOffscreen(),
      offscreenObserverAttached: intersectionObserver !== null,
      viewIntersecting,
      offscreen: viewIntersecting === false,
      renderedFrames,
      pausedAnimations: pausedAnimations.size,
    }),
  },
});

const loop = (timestamp: number) => {
  frame = null;
  if (!isActive()) {
    syncFrameLoop();
    return;
  }
  inFrame = true;
  if (shouldRender(timestamp)) {
    renderedFrames++;
    for (const callback of callbacks) run(callback, timestamp);
    if (pending.size > 0) {
      // Swap first: callbacks that schedule themselves again land on the next frame.
      const due = pending;
      pending = new Map();
      for (const callback of due.values()) run(callback, timestamp);
    }
  }
  inFrame = false;
  if (frame === null && isActive() && (callbacks.size > 0 || pending.size > 0)) {
    frame = frameWindow.requestAnimationFrame(loop);
  }
};

/** Run `callback` on every rendered frame. Returns a function that unsubscribes it. */
export function onAnimationFrame(callback: FrameCallback): () => void {
  callbacks.add(callback);
  syncFrameLoop();
  return () => {
    callbacks.delete(callback);
    if (callbacks.size === 0 && pending.size === 0 && frame !== null) {
      frameWindow.cancelAnimationFrame(frame);
      frame = null;
    }
  };
}

/**
 * requestAnimationFrame, but on the next frame the cap lets through. For
 * JS-driven motion that should not redraw the page more often than the lyrics do.
 */
export function requestCappedFrame(callback: FrameCallback): number {
  const id = nextPendingId++;
  pending.set(id, callback);
  syncFrameLoop();
  return id;
}

export function cancelCappedFrame(id: number): void {
  pending.delete(id);
  if (callbacks.size === 0 && pending.size === 0 && frame !== null) {
    frameWindow.cancelAnimationFrame(frame);
    frame = null;
  }
}
