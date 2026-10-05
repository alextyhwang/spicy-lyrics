import {test,expect} from 'bun:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function setup(){
  const animations:any[]=[];const values=new Map();const classes=new Set();
  const doc:any=new EventTarget();doc.focused=true;doc.visibilityState='visible';doc.hasFocus=()=>doc.focused;
  doc.getAnimations=()=>animations;doc.head={appendChild:()=>{}};doc.createElement=()=>({});
  doc.documentElement={classList:{add:(c:string)=>classes.add(c),remove:(c:string)=>classes.delete(c)}};
  class Animation{
    effect:any;playState='running';paused=0;resumed=0;
    constructor(target:any){this.effect={target};}
    pause(){this.playState='paused';this.paused++}
    play(){this.playState='running';this.resumed++}
  }
  class Element{
    ownerDocument:any;isConnected=true;lastArgs:any;id='';parentElement:Element|null=null;
    constructor(owner=doc){this.ownerDocument=owner;}
    closest(selector:string):Element|null{
      if(selector.split(',').some(part=>part.trim()===`#${this.id}`))return this;
      return this.parentElement?.closest(selector)??null;
    }
    animate(...args:any[]){this.lastArgs=args;const a=new Animation(this);
      animations.push(a);return a;
    }
  }
  const host:any=new EventTarget();host.requestAnimationFrame=()=>{};
  const media={play:()=>{}};const mediaPlay=media.play;
  const Spicetify={Menu:{Item:class{register(){}}}};host.Spicetify=Spicetify;
  const context:any={window:host,document:doc,Element,Reflect,Set,Spicetify,
    localStorage:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:any)=>values.set(k,v)},setTimeout:()=>{}};
  const raf=host.requestAnimationFrame;
  vm.runInNewContext(readFileSync(new URL('./spotify-background-performance.js',import.meta.url),'utf8'),context);
  return {host,doc,Element,animations,classes,api:host._spotify_background_performance,media,mediaPlay,raf};
}

test('focused animation creation preserves arguments and native animation objects',()=>{
  const {Element}=setup();const e=new Element();const frames=[{opacity:0},{opacity:1}],options={duration:700};
  const a=e.animate(frames,options);expect(e.lastArgs).toEqual([frames,options]);expect(a.effect.target).toBe(e);
  expect(a.playState).toBe('running');expect(a.paused).toBe(0);
});

test('blur pauses existing and future animations, then resumes only what the tweak paused',()=>{
  const {host,doc,Element,api}=setup();const e=new Element(),running=e.animate(),alreadyPaused=e.animate();alreadyPaused.pause();
  doc.focused=false;host.dispatchEvent(new Event('blur'));expect(running.playState).toBe('paused');
  const future=e.animate();expect(future.playState).toBe('paused');expect(api.status().pausedAnimations).toBe(2);
  doc.focused=true;host.dispatchEvent(new Event('focus'));
  expect(running.playState).toBe('running');expect(future.playState).toBe('running');expect(alreadyPaused.playState).toBe('paused');
});

test('minimize and opt-out restore behavior without modifying media or RAF APIs',()=>{
  const {doc,host,Element,api,media,mediaPlay,raf}=setup();const a=new Element().animate();
  doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));expect(a.playState).toBe('paused');
  api.setEnabled(false);expect(a.playState).toBe('running');expect(new Element().animate().playState).toBe('running');
  expect(media.play).toBe(mediaPlay);expect(host.requestAnimationFrame).toBe(raf);
});

test('replaced animations do not accumulate during long background playback',()=>{
  const {doc,host,Element,api}=setup();doc.focused=false;host.dispatchEvent(new Event('blur'));const e=new Element();let old:any;
  for(let n=0;n<1000;n++){if(old)old.playState='idle';old=e.animate();}
  expect(api.status().pausedAnimations).toBe(1);
});

test('new focused popup animations remain owned by the popup',()=>{
  const {doc,host,Element}=setup();doc.focused=false;host.dispatchEvent(new Event('blur'));
  const popup={visibilityState:'visible',hasFocus:()=>true};expect(new Element(popup).animate().playState).toBe('running');
});


test('an explicit owner pause while inactive is not resumed by the extension',()=>{
  const {doc,host,Element}=setup();const a=new Element().animate();
  doc.focused=false;host.dispatchEvent(new Event('blur'));a.pause();
  doc.focused=true;host.dispatchEvent(new Event('focus'));expect(a.playState).toBe('paused');
});

test('inactive popup animations remain owned by the popup',()=>{
  const {doc,host,Element}=setup();doc.focused=false;host.dispatchEvent(new Event('blur'));
  const popup={visibilityState:'hidden',hasFocus:()=>false};const a=new Element(popup).animate();
  expect(a.playState).toBe('running');doc.focused=true;host.dispatchEvent(new Event('focus'));expect(a.resumed).toBe(0);
});

test('CSS animations and transitions retain CSS ownership',()=>{
  const {doc,host,Element,animations,api}=setup();
  new Element().animate();
  // Model CSS object identity without making a browser-specific Animation constructor.
  host.CSSAnimation=class {};host.CSSTransition=class {};
  const css=new host.CSSAnimation(),transition=new host.CSSTransition();
  for(const a of [css,transition])Object.assign(a,{playState:'running',effect:{target:new Element()},pause(){throw Error('CSS ownership lost')}});
  animations.push(css,transition);doc.focused=false;host.dispatchEvent(new Event('blur'));
  expect(css.playState).toBe('running');expect(transition.playState).toBe('running');
  expect(api.status().pausedAnimations).toBe(1);
});

for(const trigger of ['opt-out','focus'] as const){
  test(`detach and reinsert releases the temporary pause on ${trigger}`,()=>{
    const {doc,host,Element,api}=setup();const target=new Element(),a=target.animate();
    const nativePause=a.pause;
    doc.focused=false;host.dispatchEvent(new Event('blur'));target.isConnected=false;
    if(trigger==='opt-out')api.setEnabled(false);
    else {doc.focused=true;host.dispatchEvent(new Event('focus'));}
    expect(a.playState).toBe('running');expect(a.resumed).toBe(1);
    expect(api.status().pausedAnimations).toBe(0);expect(a.pause).toBe(nativePause);
    expect(Object.hasOwn(a,'pause')).toBe(false);
    target.isConnected=true;doc.focused=true;host.dispatchEvent(new Event('focus'));
    expect(a.playState).toBe('running');expect(a.resumed).toBe(1);
  });

  test(`detach and reinsert preserves an explicit owner pause on ${trigger}`,()=>{
    const {doc,host,Element,api}=setup();const target=new Element(),a=target.animate();
    doc.focused=false;host.dispatchEvent(new Event('blur'));target.isConnected=false;a.pause();
    if(trigger==='opt-out')api.setEnabled(false);
    else {doc.focused=true;host.dispatchEvent(new Event('focus'));}
    target.isConnected=true;doc.focused=true;host.dispatchEvent(new Event('focus'));
    expect(a.playState).toBe('paused');expect(a.resumed).toBe(0);expect(api.status().pausedAnimations).toBe(0);
    expect(Object.hasOwn(a,'pause')).toBe(false);
  });
}

test('detached animations are released on new creation and are not reacquired while disconnected',()=>{
  const {doc,host,Element,api}=setup();const target=new Element(),a=target.animate();
  doc.focused=false;host.dispatchEvent(new Event('blur'));target.isConnected=false;
  const next=new Element().animate();expect(a.playState).toBe('running');expect(a.resumed).toBe(1);
  host.dispatchEvent(new Event('blur'));expect(a.paused).toBe(1);expect(next.playState).toBe('paused');
  expect(target.animate().playState).toBe('running');expect(api.status().pausedAnimations).toBe(1);
});

test('foreign-document animations returned by getAnimations are never acquired',()=>{
  const {doc,host,Element,api}=setup();const popup={};const a=new Element(popup).animate();
  doc.focused=false;host.dispatchEvent(new Event('blur'));
  expect(a.playState).toBe('running');expect(a.paused).toBe(0);expect(api.status().pausedAnimations).toBe(0);
});

test('adoption releases a temporary pause on the next main-document animation creation',()=>{
  const {doc,host,Element,api}=setup();const target=new Element(),a=target.animate();const nativePause=a.pause;
  doc.focused=false;host.dispatchEvent(new Event('blur'));target.ownerDocument={hasFocus:()=>true};
  new Element().animate();expect(a.playState).toBe('running');expect(a.resumed).toBe(1);
  expect(a.pause).toBe(nativePause);expect(api.status().pausedAnimations).toBe(1);
  // Even if enumeration includes the transferred animation, another blur cannot acquire it.
  host.dispatchEvent(new Event('blur'));expect(a.paused).toBe(1);
  doc.focused=true;host.dispatchEvent(new Event('focus'));expect(a.resumed).toBe(1);
});

test('adoption discovered on visibility change releases a pause while the main window remains inactive',()=>{
  const {doc,host,Element,api}=setup();const target=new Element(),a=target.animate();
  doc.focused=false;host.dispatchEvent(new Event('blur'));target.ownerDocument={hasFocus:()=>true};
  doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));
  expect(a.playState).toBe('running');expect(a.resumed).toBe(1);expect(api.status().pausedAnimations).toBe(0);
});

test('adoption preserves an explicit popup-owner pause across main focus',()=>{
  const {doc,host,Element,api}=setup();const target=new Element(),a=target.animate();
  doc.focused=false;host.dispatchEvent(new Event('blur'));target.ownerDocument={hasFocus:()=>true};a.pause();
  doc.focused=true;host.dispatchEvent(new Event('focus'));
  expect(a.playState).toBe('paused');expect(a.resumed).toBe(0);expect(api.status().pausedAnimations).toBe(0);
});

for(const id of ['SpicyLyricsPage','SpicyLyricsNPVCard']){
  test(`${id} and its descendants retain fork ownership before and after PiP adoption`,()=>{
    const {doc,host,Element,api}=setup();const root=new Element(),child=new Element();root.id=id;child.parentElement=root;
    const existing=[root.animate(),child.animate()];doc.focused=false;host.dispatchEvent(new Event('blur'));
    const future=[root.animate(),child.animate()];
    expect(api.status().pausedAnimations).toBe(0);
    root.ownerDocument=child.ownerDocument={hasFocus:()=>true};
    // No main-document event is needed to free lyrics: the companion never paused them.
    for(const a of [...existing,...future]){expect(a.playState).toBe('running');expect(a.paused).toBe(0);}
    doc.focused=true;host.dispatchEvent(new Event('focus'));
    for(const a of [...existing,...future])expect(a.resumed).toBe(0);
  });
}

test('moving an already-paused target under a fork-owned root relinquishes ownership',()=>{
  const {doc,host,Element,api}=setup();const root=new Element(),target=new Element();root.id='SpicyLyricsPage';
  const a=target.animate();doc.focused=false;host.dispatchEvent(new Event('blur'));target.parentElement=root;
  host.dispatchEvent(new Event('blur'));expect(a.playState).toBe('running');expect(a.resumed).toBe(1);
  expect(api.status().pausedAnimations).toBe(0);
});

test('release restores the original own pause descriptor',()=>{
  const {doc,host,Element}=setup();const a=new Element().animate();
  Object.defineProperty(a,'pause',{value:a.pause,writable:false,enumerable:true,configurable:true});
  const descriptor=Object.getOwnPropertyDescriptor(a,'pause');
  doc.focused=false;host.dispatchEvent(new Event('blur'));expect(a.pause).not.toBe(descriptor!.value);
  doc.focused=true;host.dispatchEvent(new Event('focus'));
  expect(Object.getOwnPropertyDescriptor(a,'pause')).toEqual(descriptor);expect(a.playState).toBe('running');
});

test('explicit owner pause restores its descriptor and preserves owner method replacements',()=>{
  const {doc,host,Element}=setup();const a=new Element().animate(),b=new Element().animate();
  Object.defineProperty(a,'pause',{value:a.pause,writable:false,enumerable:true,configurable:true});
  const descriptor=Object.getOwnPropertyDescriptor(a,'pause');
  doc.focused=false;host.dispatchEvent(new Event('blur'));a.pause();
  const replacement=()=>{};b.pause=replacement;
  doc.focused=true;host.dispatchEvent(new Event('focus'));
  expect(Object.getOwnPropertyDescriptor(a,'pause')).toEqual(descriptor);expect(a.playState).toBe('paused');
  expect(b.pause).toBe(replacement);
});

test('cancelled and finished animations are forgotten without replaying them',()=>{
  const {doc,host,Element,api}=setup();const idle=new Element().animate(),finished=new Element().animate();
  doc.focused=false;host.dispatchEvent(new Event('blur'));idle.playState='idle';finished.playState='finished';
  doc.focused=true;host.dispatchEvent(new Event('focus'));
  expect(idle.playState).toBe('idle');expect(finished.playState).toBe('finished');
  for(const a of [idle,finished]){expect(a.resumed).toBe(0);expect(Object.hasOwn(a,'pause')).toBe(false);}
  expect(api.status().pausedAnimations).toBe(0);
});

test('pause and resume failures are isolated and locked animations roll back',()=>{
  const {doc,host,Element,api,classes}=setup();const badPause=new Element().animate(),locked=new Element().animate();
  const badPlay=new Element().animate(),normal=new Element().animate();
  badPause.pause=()=>{throw Error('pause failed')};Object.preventExtensions(locked);
  badPlay.play=()=>{throw Error('play failed')};
  doc.focused=false;host.dispatchEvent(new Event('blur'));
  expect(badPause.playState).toBe('running');expect(locked.playState).toBe('running');
  expect(api.status().pausedAnimations).toBe(2);
  badPlay.effect.target.isConnected=false;normal.effect.target.isConnected=false;
  api.setEnabled(false);expect(normal.playState).toBe('running');expect(normal.resumed).toBe(1);
  expect(api.status().pausedAnimations).toBe(0);expect(classes.has('spotify-performance-background')).toBe(false);
  expect(Object.hasOwn(badPlay,'pause')).toBe(false);
});
