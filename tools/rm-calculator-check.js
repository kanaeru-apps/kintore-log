const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const path = require('path');
const root = process.argv[2] || path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const events = {};
const document = {activeElement:null, addEventListener(type, fn) {(events[type] ||= []).push(fn);}};
const classList={add(){},remove(){}};
document.body={classList,closest(){return null;}};
document.documentElement={style:{setProperty(){}}};
document.activeElement=document.body;
const frames = [];
const elements = {};
function element(id) {
  return elements[id] ||= {
    id, value:'', style:{}, scrollLeft:0, offsetHeight:54, listeners:{},
    classList:{add(){},remove(){}},
    addEventListener(type, fn) {(this.listeners[type] ||= []).push(fn);},
    dispatch(type, e={}) {(this.listeners[type] || []).forEach(fn=>fn(e));},
    matches(selector) {return selector.includes('#'+id);},
    closest() {return null;},
    getAttribute() {return '重量（kg、0から300）';},
    dispatchEvent(e) {this.dispatch(e.type,e);},
    select() {this.selected=true;},
    focus() {document.activeElement=this;this.dispatch('focus');(events.focusin||[]).forEach(fn=>fn({target:this}));},
    blur() {document.activeElement=document.body;this.dispatch('blur');(events.focusout||[]).forEach(fn=>fn());}
  };
}
const context = vm.createContext({document, $:s=>element(s.slice(1)),
  requestAnimationFrame:fn=>frames.push(fn),setTimeout:fn=>frames.push(fn),Event:class{constructor(type){this.type=type;}}, window:{innerHeight:800,addEventListener(){}},
  isNativeApp:()=>false});
const section=app.slice(app.indexOf('  var calc = {'),app.indexOf('  /* ================== インターバルタイマー'));
const bar=app.slice(app.indexOf('  var numberEditing = null;'),app.indexOf('  /* ================== 重量±ボタン'));
vm.runInContext(section+'\n'+bar+'\ncalcInit(); bindNumberEditing();',context);
const flush=()=>{while(frames.length) frames.shift()();};
const input=element('calcWeightVal'), dial=element('dialScroll');
function enter(raw, expected) {
  input.focus(); input.value=raw;
  element('numberInputDone').onclick();flush();
  assert.equal(input.value,expected.toFixed(1));
  assert.equal(dial.scrollLeft,Math.round(expected*60));
  assert.equal(element('numberInputBar').hidden,true);
}
assert.equal(input.value,'60.0');
input.focus();assert.equal(input.selected,true);
assert.equal(element('numberInputLabel').textContent,'重量（kg、0から300）');
assert.equal(element('numberInputBar').hidden,false);
enter('90.5',90.5);enter('０９０．５',90.5);enter('',90.5);enter('abc',90.5);
enter('-1',90.5);enter('1e3',90.5);enter('90kg',90.5);enter('1.2.3',90.5);
enter('999',300);enter('0',0);enter('.5',0.5);enter('62.56',62.6);
input.focus();input.value='100';input.dispatch('keydown',{key:'Escape',preventDefault(){}});flush();
assert.equal(input.value,'62.6');
input.focus();input.value='90';input.dispatch('keydown',{key:'Enter',preventDefault(){}});flush();
assert.equal(input.value,'90.0');
for(let i=0;i<4;i++)element('repsPlus').onclick();
assert.equal(element('calcRepsVal').textContent,5);
assert.match(element('calcTable').innerHTML,/>98.78<\/b>/);
assert.match(element('calcTable').innerHTML,/class="rm-row current"[^]*?>90<\/b>/);
dial.scrollLeft=6000;dial.dispatch('scroll');flush();assert.equal(input.value,'100.0');
input.focus();input.value='85.5';dial.scrollLeft=6012;dial.dispatch('scroll');flush();
assert.equal(input.value,'85.5');
input.blur();flush();assert.equal(dial.scrollLeft,5130);
const cardio=element('cardio-test');cardio.matches=()=>true;cardio.focus();
assert.equal(element('numberInputBar').hidden,false);
element('numberInputDone').onclick();flush();assert.equal(document.activeElement,document.body);
console.log('PASS: decimal/full-width input, invalid/empty preservation, limits, rounding, Done, Enter/Escape, RM calculation, dial synchronization, cardio Done regression');
