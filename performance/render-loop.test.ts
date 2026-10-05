import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function setup() {
  const atom = (initial: any) => {
    let value = initial;
    const listeners = new Set<Function>();
    return { get: () => value, listen: (f: Function) => listeners.add(f),
      set: (v: any) => { value = v; listeners.forEach(f => f(v)); } };
  };
  const makeHost = () => {
    const host: any = new EventTarget();
    const queue = new Map<number, Function>(); let next = 0;
    host.requestAnimationFrame = (f: Function) => { queue.set(++next, f); return next; };
    host.cancelAnimationFrame = (id: number) => queue.delete(id);
    const doc: any = new EventTarget();
    doc.focused = true; doc.visibilityState = "visible"; doc.hasFocus = () => doc.focused;
    doc.defaultView = host;
    doc.styles = [];
    doc.head = { appendChild: (style: any) => doc.styles.push(style.textContent) };
    doc.createElement = () => ({ textContent: "" });
    host.CSSAnimation = class CSSAnimation extends EventTarget {};
    host.CSSTransition = class CSSTransition extends EventTarget {};
    return { host, doc, queue, tick: (t: number) => {
      const due = [...queue.values()]; queue.clear(); due.forEach(f => f(t));
    } };
  };
  const main = makeHost();
  const feature = atom(true), capEnabled = atom(false), cap = atom(60);
  const observers: any[] = [];
  class MutationObserver {
    connected = false;
    constructor(public callback: Function) { observers.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
  }
  const context: any = {window:main.host, document:main.doc, MutationObserver,
    console: { error: () => {} },
    $animationFpsCap:cap, $animationFpsCapEnabled:capEnabled,
    $experiment:()=>feature, isExperimentEnabled:()=>feature.get()};
  const source = readFileSync(new URL('../src/utils/AnimationFrameLoop.ts', import.meta.url),'utf8')
    .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
  const js = new Bun.Transpiler({loader:'ts'}).transformSync(source);
  vm.runInNewContext(js+'\nglobalThis.api={setAnimationFrameView,onAnimationFrame,requestCappedFrame,cancelCappedFrame};',context);
  const root = (doc = main.doc, animations: any[] = []) => {
    const classes = new Set<string>();
    const element: any = { ownerDocument: doc, isConnected: true,
      contains: (target: any) => target === element || target.parent === element,
      getAnimations: () => animations,
      classList: { contains: (name: string) => classes.has(name),
        toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name) } };
    for (const animation of animations) animation.effect = { target: element };
    return element;
  };
  const animation = (state = "running", base = EventTarget) => {
    const a: any = new base();
    a.playState = state; a.pauses = 0; a.plays = 0;
    a.pause = function() { this.pauses++; this.playState = "paused"; };
    a.play = function() { this.plays++; this.playState = "running"; };
    a.cancel = function() { this.playState = "idle"; this.dispatchEvent(new Event("cancel")); };
    return a;
  };
  return {main, makeHost, feature, capEnabled, cap, api:context.api, root, animation,
    status: main.host._spicy_lyrics_performance.status,
    mutate: () => observers.filter(o => o.connected).forEach(o => o.callback()), observers};
}

test('closed view does no rendering; opening and closing start and stop one loop', () => {
  const {main,api,root}=setup(); let calls=0;
  api.onAnimationFrame(()=>calls++);
  expect(main.queue.size).toBe(0);
  api.setAnimationFrameView(root()); expect(main.queue.size).toBe(1);
  main.tick(0); expect(calls).toBe(1); expect(main.queue.size).toBe(1);
  api.setAnimationFrameView(null); expect(main.queue.size).toBe(0);
});

test('losing focus pauses JS and running WAAPI; returning resumes only those animations', () => {
  const {main,api,root,animation}=setup(); let calls=0;
  const moving=animation(), paused=animation('paused');
  api.onAnimationFrame(()=>calls++); api.setAnimationFrameView(root(main.doc,[moving,paused])); main.tick(0);
  main.doc.focused=false; main.host.dispatchEvent(new Event('blur'));
  expect(main.queue.size).toBe(0); expect(moving.playState).toBe('paused');
  main.doc.focused=true; main.host.dispatchEvent(new Event('focus'));
  expect(main.queue.size).toBe(1); expect(moving.playState).toBe('running'); expect(paused.playState).toBe('paused');
  main.tick(100000); expect(calls).toBe(2);
});

test('minimized visibility stops work and does not resume until focused', () => {
  const {main,api,root}=setup(); api.onAnimationFrame(()=>{}); api.setAnimationFrameView(root());
  main.doc.visibilityState='hidden'; main.doc.dispatchEvent(new Event('visibilitychange'));
  expect(main.queue.size).toBe(0);
  main.doc.focused=false; main.doc.visibilityState='visible'; main.doc.dispatchEvent(new Event('visibilitychange'));
  expect(main.queue.size).toBe(0);
  main.doc.focused=true; main.host.dispatchEvent(new Event('focus')); expect(main.queue.size).toBe(1);
});

test('callbacks requesting another frame do not multiply native RAF loops', () => {
  const {main,api,root}=setup(); let once=0;
  api.onAnimationFrame(()=>api.requestCappedFrame(()=>once++)); api.setAnimationFrameView(root());
  for(let i=0;i<30;i++){main.tick(i*17);expect(main.queue.size).toBe(1)}
  expect(once).toBe(30);
});

test('turning off the experiment restores continuous rendering with no view', () => {
  const {main,api,feature}=setup(); api.onAnimationFrame(()=>{});
  expect(main.queue.size).toBe(0); feature.set(false); expect(main.queue.size).toBe(1);
  main.tick(0); expect(main.queue.size).toBe(1); feature.set(true); expect(main.queue.size).toBe(0);
});

test('a popup uses its own window focus, visibility, and frame scheduling', () => {
  const {main,makeHost,api,root}=setup(); const pip=makeHost(); main.doc.visibilityState='hidden';
  api.onAnimationFrame(()=>{}); api.setAnimationFrameView(root(pip.doc));
  expect(main.queue.size).toBe(0); expect(pip.queue.size).toBe(1);
  pip.doc.focused=false;pip.host.dispatchEvent(new Event('blur'));expect(pip.queue.size).toBe(0);
  pip.doc.focused=true;pip.host.dispatchEvent(new Event('focus'));expect(pip.queue.size).toBe(1);
});

test('unsubscribing the last consumer cancels idle native frames', () => {
  const {main,api,root}=setup(); const unsubscribe=api.onAnimationFrame(()=>{});
  api.setAnimationFrameView(root());expect(main.queue.size).toBe(1);
  unsubscribe();expect(main.queue.size).toBe(0);
});

test('the existing FPS cap still bounds rendered frames', () => {
  const {main,api,root,capEnabled}=setup();let calls=0;capEnabled.set(true);
  api.onAnimationFrame(()=>calls++);api.setAnimationFrameView(root());
  for(let i=0;i<120;i++)main.tick(i*1000/120);
  expect(calls).toBeGreaterThanOrEqual(59);expect(calls).toBeLessThanOrEqual(61);
});

const inactiveClass = "SpicyLyrics_RenderingInactive";

test("CSS animations and transitions in PiP never receive JS pause/play overrides", () => {
  const {api, makeHost, root, animation} = setup();
  const pip = makeHost();
  const css = animation("running", pip.host.CSSAnimation);
  const transition = animation("running", pip.host.CSSTransition);
  const element = root(pip.doc, [css, transition]);
  api.setAnimationFrameView(element);
  pip.doc.focused = false; pip.host.dispatchEvent(new Event("blur"));
  expect(element.classList.contains(inactiveClass)).toBe(true);
  expect(css.pauses).toBe(0); expect(transition.pauses).toBe(0);
  // The stylesheet is installed in the owning document, independent of companion.
  expect(pip.doc.styles[0]).toContain("animation-play-state: paused !important");
  expect(pip.doc.styles[0]).toContain("*::before");
  expect(pip.doc.styles[0]).not.toContain("transition:");
  const later = animation("running", pip.host.CSSAnimation);
  later.effect = {target: element};
  // Later CSS animations inherit the still-present inactive selector.
  expect(element.classList.contains(inactiveClass)).toBe(true);
  pip.doc.focused = true; pip.host.dispatchEvent(new Event("focus"));
  expect(element.classList.contains(inactiveClass)).toBe(false);
  expect(css.plays).toBe(0); expect(transition.plays).toBe(0); expect(later.plays).toBe(0);
});

test("same-view registration retains ownership and does not multiply RAF or observers", () => {
  const {main, api, root, animation, observers, status} = setup();
  const moving = animation(); const element = root(main.doc, [moving]);
  api.onAnimationFrame(() => {}); api.setAnimationFrameView(element);
  api.setAnimationFrameView(element); expect(main.queue.size).toBe(1);
  main.doc.focused = false; main.host.dispatchEvent(new Event("blur"));
  for (let i = 0; i < 10; i++) api.setAnimationFrameView(element);
  expect(status().pausedAnimations).toBe(1); expect(observers.length).toBe(1);
  main.doc.focused = true; main.host.dispatchEvent(new Event("focus"));
  expect(moving.playState).toBe("running"); expect(moving.plays).toBe(1);
});

test("adopting the retained view restores and rebinds animations to the PiP owner", () => {
  const {main, makeHost, api, root, animation, observers} = setup();
  const moving = animation(); const css = animation("running", main.host.CSSAnimation);
  const element = root(main.doc, [moving, css]); const pip = makeHost();
  api.onAnimationFrame(() => {}); api.setAnimationFrameView(element);
  main.doc.focused = false; main.host.dispatchEvent(new Event("blur"));
  element.ownerDocument = pip.doc; api.setAnimationFrameView(element);
  expect(moving.playState).toBe("running"); expect(css.pauses).toBe(0);
  expect(pip.doc.styles.length).toBe(1); expect(pip.queue.size).toBe(1);
  expect(observers.filter(o => o.connected).length).toBe(1);
  main.host.dispatchEvent(new Event("blur")); expect(moving.playState).toBe("running");
  pip.doc.focused = false; pip.host.dispatchEvent(new Event("blur"));
  expect(moving.playState).toBe("paused"); expect(pip.queue.size).toBe(0);
  pip.doc.focused = true; pip.host.dispatchEvent(new Event("focus"));
  expect(moving.playState).toBe("running");
});

test("transfer or unbinding restores a live retained view and removes its inactive class", () => {
  const {main, api, root, animation, status} = setup();
  const moving = animation(); const old = root(main.doc, [moving]);
  api.setAnimationFrameView(old); main.doc.focused = false;
  main.host.dispatchEvent(new Event("blur")); api.setAnimationFrameView(root());
  expect(moving.playState).toBe("running"); expect(old.classList.contains(inactiveClass)).toBe(false);
  const second = animation(); const retained = root(main.doc, [second]);
  api.setAnimationFrameView(retained); api.setAnimationFrameView(null);
  expect(second.playState).toBe("running"); expect(status().pausedAnimations).toBe(0);
});

test("cancelled, finished and detached animations are pruned without an idle poller", () => {
  const {main, api, root, animation, mutate, status} = setup();
  const animations = [animation(), animation(), animation(), animation()];
  const element = root(main.doc, animations); api.setAnimationFrameView(element);
  main.doc.focused = false; main.host.dispatchEvent(new Event("blur"));
  expect(status().pausedAnimations).toBe(4);
  animations[0].cancel(); expect(status().pausedAnimations).toBe(3);
  animations[1].playState = "finished"; animations[1].dispatchEvent(new Event("finish"));
  expect(status().pausedAnimations).toBe(2);
  animations[2].effect = { target: {isConnected: false, ownerDocument: main.doc} };
  mutate(); expect(status().pausedAnimations).toBe(1); expect(main.queue.size).toBe(0);
  main.doc.focused = true; main.host.dispatchEvent(new Event("focus"));
  expect(animations[0].plays).toBe(0); expect(animations[1].plays).toBe(0);
  expect(animations[2].plays).toBe(0); expect(animations[3].plays).toBe(1);
});

test("owner pause and cancellation while inactive must not be replayed", () => {
  const {main, api, root, animation} = setup();
  const deliberate = animation(), cancelled = animation(), restarted = animation();
  api.setAnimationFrameView(root(main.doc, [deliberate, cancelled, restarted]));
  main.doc.focused = false; main.host.dispatchEvent(new Event("blur"));
  deliberate.pause(); cancelled.cancel(); restarted.play();
  expect(restarted.playState).toBe("paused");
  main.doc.focused = true; main.host.dispatchEvent(new Event("focus"));
  expect(deliberate.playState).toBe("paused"); expect(cancelled.playState).toBe("idle");
  expect(restarted.playState).toBe("running");
});

test("DOM arrivals while inactive are gated and errors do not block other animations or RAF", () => {
  const {main, api, root, animation, mutate, status} = setup();
  const badPause = animation(), badPlay = animation(), healthy = animation();
  badPause.pause = () => { throw new Error("pause failed"); };
  badPlay.play = () => { throw new Error("play failed"); };
  const animations = [badPause, badPlay, healthy]; const element = root(main.doc, animations);
  let frames = 0; api.onAnimationFrame(() => frames++); api.setAnimationFrameView(element);
  main.doc.focused = false; main.host.dispatchEvent(new Event("blur"));
  const later = animation(); later.effect = {target: element}; animations.push(later); mutate();
  expect(later.playState).toBe("paused"); expect(main.queue.size).toBe(0);
  main.doc.focused = true; main.host.dispatchEvent(new Event("focus")); main.tick(10000);
  expect(healthy.playState).toBe("running"); expect(later.playState).toBe("running");
  expect(frames).toBe(1); expect(status().pausedAnimations).toBe(0);
});

test("opt-out restores CSS control and owned WAAPI while still unfocused", () => {
  const {main, api, root, animation, feature} = setup(); const moving = animation();
  const element = root(main.doc, [moving]); api.setAnimationFrameView(element);
  main.doc.focused = false; main.host.dispatchEvent(new Event("blur")); feature.set(false);
  expect(moving.playState).toBe("running"); expect(element.classList.contains(inactiveClass)).toBe(false);
});

test("pagehide stops a visible focused document until pageshow", () => {
  const {main, api, root} = setup(); api.onAnimationFrame(() => {}); api.setAnimationFrameView(root());
  main.host.dispatchEvent(new Event("pagehide")); expect(main.queue.size).toBe(0);
  main.host.dispatchEvent(new Event("focus")); expect(main.queue.size).toBe(0);
  main.host.dispatchEvent(new Event("pageshow")); expect(main.queue.size).toBe(1);
});


test("a live descendant moved to a replacement root is restored on transfer", () => {
  const {main, makeHost, api, root, animation} = setup();
  const moving = animation(); const oldRoot = root(main.doc, [moving]);
  const child: any = {ownerDocument: main.doc, isConnected: true, parent: oldRoot};
  moving.effect = {target: child}; api.setAnimationFrameView(oldRoot);
  main.doc.focused = false; main.host.dispatchEvent(new Event("blur"));
  expect(moving.playState).toBe("paused");
  const pip = makeHost(); const replacement = root(pip.doc);
  child.parent = replacement; child.ownerDocument = pip.doc; oldRoot.isConnected = false;
  api.setAnimationFrameView(replacement); expect(moving.playState).toBe("running");
});

test("a connected animation moved outside the root regains owner control on mutation", () => {
  const {main, api, root, animation, mutate, status} = setup();
  const moving = animation(); const element = root(main.doc, [moving]);
  const child: any = {ownerDocument: main.doc, isConnected: true, parent: element};
  moving.effect = {target: child}; api.setAnimationFrameView(element);
  main.doc.focused = false; main.host.dispatchEvent(new Event("blur"));
  child.parent = null; mutate();
  expect(moving.playState).toBe("running"); expect(status().pausedAnimations).toBe(0);
});
