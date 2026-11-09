'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const events = {}, keyboard = {}, frames = [], elements = [];
function element() {
  const classes = new Set();
  const props = {};
  const el = { hidden: false, scrollTop: 0, style: {setProperty:(k,v)=>props[k]=v, removeProperty:k=>delete props[k]}, props,
    classList:{toggle:(k,v)=>v?classes.add(k):classes.delete(k),remove:k=>classes.delete(k)}, classes,
    appendChild(){}, addEventListener(k,f){this[k]=f;} };
  elements.push(el); return el;
}
const sheet = element(), body = element(), root = element();
const doc = {body, documentElement:root, createElement:element, getElementById:()=>sheet,
  addEventListener:(k,f)=>events[k]=f};
let scrolled = 0;
const viewport = {offsetTop:0,height:800,addEventListener:(k,f)=>events['viewport-'+k]=f};
const window = {innerHeight:800, visualViewport:viewport, scrollBy:(x,y)=>scrolled+=y,
  addEventListener:(k,f)=>events['window-'+k]=f,
  Capacitor:{Plugins:{Keyboard:{addListener:(k,f)=>keyboard[k]=f}}}};
const c=vm.createContext({document:doc,window,requestAnimationFrame:f=>{frames.push(f);return frames.length;},setTimeout:()=>1,clearTimeout(){}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/text-input.js'),'utf8'),c);
const bar=elements.find(e=>e.id==='textInputBar');
const flush=()=>{while(frames.length) frames.shift()();};
function focus({inSheet=false,excluded=false,numeric=false,tag='INPUT'}={}) {
  const input={tagName:tag,matches:s=>s.startsWith('textarea') || numeric,
    closest:()=>excluded, getBoundingClientRect:()=>({top:680,bottom:730,height:50}),
    blur(){doc.activeElement=null;events.focusout();}};
  sheet.contains=()=>inSheet; doc.activeElement=input; events.focusin();flush();return input;
}
focus({inSheet:true});
keyboard.keyboardWillShow({keyboardHeight:320});flush();
assert.equal(bar.style.top,'424px');
assert.equal(sheet.props['--text-sheet-height'],'424px');
assert.ok(sheet.scrollTop>0);
viewport.offsetTop=30;viewport.height=420;events['viewport-scroll']();flush();
assert.equal(bar.style.top,'394px');
assert.equal(sheet.props['--text-sheet-top'],'30px');
focus();assert.ok(scrolled>0);assert.ok(body.classes.has('text-input-active'));
focus({excluded:true});assert.equal(bar.hidden,true);
focus({numeric:true});assert.equal(bar.hidden,true);
const memo=focus({tag:'TEXTAREA'});let prevented=false;
events.keydown({target:memo,key:'Enter',preventDefault(){prevented=true;}});assert.equal(prevented,false);
const name=focus();events.keydown({target:name,key:'Enter',isComposing:true,preventDefault(){prevented=true;}});
assert.equal(doc.activeElement,name,'IME composition must not dismiss input');
elements.find(e=>e.textContent==='完了').click();flush();
assert.equal(bar.hidden,true);assert.equal(body.classes.has('text-input-active'),false);
keyboard.keyboardDidHide();flush();assert.equal(sheet.classes.has('text-input-active'),false);
console.log('Text input viewport checks passed: native/browser keyboard, pan, sheet/page, editor isolation, IME, Done and cleanup');
