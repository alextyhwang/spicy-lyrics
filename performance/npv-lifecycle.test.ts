import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Execute the real uiState persistence, NPV initializer, reconciler and click
// handlers. Only Spotify/DOM/layout dependencies are substituted.
function setup(open = true, expanded = true, enabled = true, reducedMotion = true) {
  const values = new Map([["SL:uiState", JSON.stringify({npvLyricsOpen: open, npvLyricsExpanded: expanded, unrelated: "keep"})]]);
  const writes: string[] = [];
  const atom = (initial: any) => {
    let value = initial;
    const listeners = new Set<Function>();
    const store = {get: () => value,
      listen: (f: Function) => {listeners.add(f); return () => listeners.delete(f);},
      subscribe: (f: Function) => {f(value); return store.listen(f);},
      set: (next: any) => {if (next === value) return; value = next; listeners.forEach(f => f(next));}};
    return store;
  };
  const onDemand = atom(enabled);
  const cssClasses = () => {
    const classes = new Set<string>();
    return {contains: (name: string) => classes.has(name),
      add: (...names: string[]) => names.forEach(name => classes.add(name)),
      remove: (...names: string[]) => names.forEach(name => classes.delete(name)),
      toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name)};
  };
  const nativeAnimations: any[] = [];
  let doc: any;
  class Element extends EventTarget {
    id = ""; classList = cssClasses(); isConnected = true;
    parentElement: Element | null = null; children: Element[] = [];
    controls = new Map<string, Element>(); ownerDocument: any;
    constructor() {super(); this.ownerDocument = doc;}
    set innerHTML(_html: string) {
      for (const key of ["#NPVCardExpand", "#NPVCardMaximize", "#NPVCardToggle", ".CardBody"]) {
        const child = new Element(); child.parentElement = this;
        this.controls.set(key, child); this.children.push(child);
      }
    }
    get firstElementChild() {return this.children[0];}
    get nextElementSibling() {return null;}
    prepend(child: Element) {child.parentElement = this; this.children.unshift(child);}
    appendChild(child: Element) {child.parentElement = this; this.children.push(child);}
    contains(child: any): boolean {return child === this || this.children.some(c => c.contains(child));}
    closest() {return null;}
    querySelector(selector: string): Element | null {return this.controls.get(selector) ?? null;}
    querySelectorAll() {return [...this.controls.values()].slice(0, 3);}
    getBoundingClientRect() {
      const collapsed = this.classList.contains("Collapsed") || this.parentElement?.classList.contains("Collapsed");
      return {width: 300, height: collapsed ? 44 : 250, left: collapsed ? 100 : 200, top: 0};
    }
    animate(...args: any[]) {
      const animation = {effect: {target: this}, args, finished: Promise.resolve()};
      nativeAnimations.push(animation); return animation;
    }
  }
  doc = new EventTarget(); doc.focused = true; doc.visibilityState = "visible";
  doc.hasFocus = () => doc.focused;
  doc.body = new Element(); doc.documentElement = new Element();
  doc.createElement = () => new Element();
  const npv = new Element(), panel = new Element(); npv.appendChild(panel);
  npv.controls.set('[data-testid="NPV_Panel_OpenDiv"]', panel);
  doc.querySelector = (selector: string) => selector === "aside.NowPlayingView" ? npv : null;
  const page: any = {IsOpened: false, opens: 0, destroys: 0,
    Open: async (body: Element) => {
      page.IsOpened = true; page.opens++;
      context.PageContainer = new Element(); body.appendChild(context.PageContainer);
    },
    Destroy: async () => {page.IsOpened = false; page.destroys++;}};
  const timers = new Map<number, Function>(); let nextTimer = 0;
  const context: any = {document: doc, window: {matchMedia: () => ({matches: reducedMotion})}, Element,
    atom, CSS: {supports: () => false}, PageView: page, PageContainer: null,
    Fullscreen: {IsOpen: false, CinemaViewOpen: false}, IsPIP: false, _IsPIP_after: false, IsPIPOpening: false,
    Session: {Navigate: () => {}}, Global: {Event: {listen: () => 1, unListen: () => {}}},
    Icons: {}, Maid: class {Give() {} CleanUp() {}}, Whentil: {When: () => {}},
    Logger: class {warn() {} debug() {} error() {}}, createTooltip: () => null,
    $disableNpvLyrics: atom(false), $hideNpvLyricsWhenUnavailable: atom(false), $currentLyricsData: atom(""),
    SpotifyPlayer: {GetUri: () => "spotify:track:one"},
    $experiment: () => onDemand, isExperimentEnabled: () => onDemand.get(),
    isAnimationDocumentActive: (owner: any) => owner.visibilityState === "visible" && owner.hasFocus(),
    MutationObserver: class {observe() {} disconnect() {}},
    setTimeout: (callback: Function) => {timers.set(++nextTimer, callback); return nextTimer;},
    clearTimeout: (id: number) => timers.delete(id),
    Spicetify: {TippyProps: {}, Platform: {History: {location: {pathname: "/home"}}},
      LocalStorage: {get: (key: string) => values.get(key) ?? null,
        set: (key: string, value: string) => {values.set(key, value); writes.push(value);}}}};
  const transpiler = new Bun.Transpiler({loader: "ts"});
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\n/gm, "").replace(/^export /gm, "");
  vm.createContext(context);
  vm.runInContext(transpiler.transformSync(source("../src/utils/uiState.ts")), context);
  vm.runInContext(transpiler.transformSync(source("../src/components/Utils/NPVLyrics.ts")) +
    "\nglobalThis.api = {initNPVLyrics, reconcile, GetNPVCardElement, NPVCardOwnsPage};", context);
  const saved = () => JSON.parse(values.get("SL:uiState")!);
  const card = () => context.api.GetNPVCardElement();
  const click = (selector: string) => card().querySelector(selector).dispatchEvent(new Event("click"));
  const flushEvaluate = async () => {
    const due = [...timers.values()]; timers.clear(); due.forEach(callback => callback());
    await new Promise(resolve => setImmediate(resolve));
  };
  return {api: context.api, onDemand, saved, writes, page, card, click, doc, nativeAnimations, values, timers, flushEvaluate};
}

test("on-demand launch keeps saved open/expanded state intact and avoids starting the pipeline", async () => {
  const {api, card, page, writes, saved} = setup();
  api.initNPVLyrics(); api.initNPVLyrics(); await api.reconcile();
  expect(writes.length).toBe(0); expect(saved()).toEqual({npvLyricsOpen: true, npvLyricsExpanded: true, unrelated: "keep"});
  expect(card().classList.contains("Collapsed")).toBe(true);
  expect(card().classList.contains("Expanded")).toBe(false); expect(page.opens).toBe(0);
});

test("live opt-out restores the complete remembered state; re-enabling waits until next launch", async () => {
  const {api, card, page, writes, onDemand, saved} = setup();
  api.initNPVLyrics(); await api.reconcile(); onDemand.set(false); await api.reconcile();
  expect(page.opens).toBe(1); expect(api.NPVCardOwnsPage()).toBe(true);
  expect(card().classList.contains("Collapsed")).toBe(false); expect(card().classList.contains("Expanded")).toBe(true);
  onDemand.set(true); await api.reconcile();
  expect(page.destroys).toBe(0); expect(writes.length).toBe(0); expect(saved().npvLyricsExpanded).toBe(true);
});

test("first explicit open chooses the normal card and persists that preference for opt-out/restart", async () => {
  const {api, onDemand, click, card, saved, page} = setup();
  api.initNPVLyrics(); await api.reconcile(); click("#NPVCardToggle"); await api.reconcile();
  expect(page.opens).toBe(1); expect(saved().npvLyricsOpen).toBe(true); expect(saved().npvLyricsExpanded).toBe(false);
  expect(card().classList.contains("Collapsed")).toBe(false); expect(card().classList.contains("Expanded")).toBe(false);
  onDemand.set(false); await api.reconcile(); expect(saved().npvLyricsExpanded).toBe(false);
  const restarted = setup(saved().npvLyricsOpen, saved().npvLyricsExpanded, false);
  restarted.api.initNPVLyrics(); await restarted.api.reconcile();
  expect(restarted.page.opens).toBe(1); expect(restarted.card().classList.contains("Expanded")).toBe(false);
});

test("explicit maximize during the launch override opens and saves expanded mode", async () => {
  const {api, click, saved, card, onDemand, page} = setup(true, false);
  api.initNPVLyrics(); await api.reconcile(); click("#NPVCardMaximize"); await api.reconcile();
  expect(saved().npvLyricsOpen).toBe(true); expect(saved().npvLyricsExpanded).toBe(true);
  expect(card().classList.contains("Expanded")).toBe(true); expect(page.opens).toBe(1);
  onDemand.set(false); await api.reconcile(); expect(card().classList.contains("Expanded")).toBe(true);
});

test("explicit hide exits expanded mode and stays remembered after experiment changes", async () => {
  const {api, click, saved, card, onDemand, page} = setup(true, true, false);
  api.initNPVLyrics(); await api.reconcile(); click("#NPVCardToggle"); await api.reconcile();
  expect(saved().npvLyricsOpen).toBe(false); expect(saved().npvLyricsExpanded).toBe(false); expect(page.destroys).toBe(1);
  onDemand.set(true); onDemand.set(false); await api.reconcile();
  expect(card().classList.contains("Collapsed")).toBe(true); expect(page.opens).toBe(1);
});

test("off at launch follows both saved preference values without writes", async () => {
  for (const [open, expanded] of [[false, false], [false, true], [true, false], [true, true]]) {
    const state = setup(open, expanded, false); state.api.initNPVLyrics(); await state.api.reconcile();
    expect(state.writes.length).toBe(0); expect(state.page.opens).toBe(open ? 1 : 0);
    expect(state.card().classList.contains("Expanded")).toBe(open && expanded);
  }
});

test("owned NPV native animate paths are skipped on background mutations while applying the state", async () => {
  const {api, click, saved, doc, nativeAnimations} = setup(true, true, true, false);
  api.initNPVLyrics(); await api.reconcile(); doc.focused = false;
  click("#NPVCardToggle"); await api.reconcile();
  expect(nativeAnimations.length).toBe(0); expect(saved().npvLyricsOpen).toBe(true);
  click("#NPVCardMaximize"); expect(nativeAnimations.length).toBe(0); expect(saved().npvLyricsExpanded).toBe(true);
});

test("focused NPV morphs still call native animate with their original keyframes and options", async () => {
  const {api, click, nativeAnimations, card} = setup(true, false, true, false);
  api.initNPVLyrics(); await api.reconcile(); click("#NPVCardToggle");
  expect(nativeAnimations.length).toBe(4);
  expect(nativeAnimations[0].effect.target).toBe(card());
  expect(nativeAnimations[0].args).toEqual([
    [{width: "300px", height: "44px"}, {width: "300px", height: "250px"}],
    {duration: 350, easing: "cubic-bezier(0.22, 1, 0.36, 1)"},
  ]);
});


test("an explicit open starts the pipeline even when the saved atoms already equal the user's choice", async () => {
  const {api, click, page, writes, flushEvaluate} = setup(true, false);
  api.initNPVLyrics(); await api.reconcile(); click("#NPVCardToggle"); await flushEvaluate();
  expect(writes.length).toBe(0); expect(page.opens).toBe(1); expect(api.NPVCardOwnsPage()).toBe(true);
});

test("explicit maximize reconciles unchanged saved expanded preferences", async () => {
  const {api, click, page, writes, flushEvaluate} = setup(true, true);
  api.initNPVLyrics(); await api.reconcile(); click("#NPVCardMaximize"); await flushEvaluate();
  expect(writes.length).toBe(0); expect(page.opens).toBe(1); expect(api.NPVCardOwnsPage()).toBe(true);
});

test("opt-out schedules live reconciliation without a persisted atom change", async () => {
  const {api, onDemand, page, writes, flushEvaluate, card} = setup(true, true);
  api.initNPVLyrics(); await api.reconcile(); onDemand.set(false); await flushEvaluate();
  expect(writes.length).toBe(0); expect(page.opens).toBe(1); expect(card().classList.contains("Expanded")).toBe(true);
});
