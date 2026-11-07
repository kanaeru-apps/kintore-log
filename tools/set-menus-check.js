'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const values=new Map();let fail=false;
const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>{if(fail)throw Error('quota');values.set(k,String(v));},removeItem:k=>values.delete(k)};
function boot(){const c={console,localStorage:storage};vm.createContext(c);vm.runInContext(fs.readFileSync('js/db.js','utf8'),c);return c.DB;}
let db=boot();const day='2026-11-06';
const ex=db.getExercises().find(e=>e.part==='胸');
const existing=db.addEntry(day,ex.id); db.updateSet(day,existing.id,0,'r',10);db.setMemo(day,'keep me');
const before=JSON.stringify(db.getWorkout(day));
const id=db.saveMenu(null,'胸の日',[{...ex,exId:ex.id,count:2,sets:[{w:25,r:8},{w:30,r:6}]}],false);
assert.equal(JSON.stringify(db.getWorkout(day)),before,'save does not change daily log');
assert.equal(db.getMenus()[0].entries[0].sets[0].r,'');
assert.equal(db.appendMenu(day,id),1);
assert.equal(JSON.stringify(db.getWorkout(day).entries[0]),JSON.stringify(JSON.parse(before).entries[0]));
assert.equal(db.getWorkout(day).memo,'keep me');
const appended=db.getWorkout(day).entries[1];assert.notEqual(appended.id,existing.id);
db.updateSet(day,appended.id,0,'r',20);assert.equal(db.getMenus()[0].entries[0].sets[0].r,'');
db=boot();assert.equal(db.getMenus()[0].name,'胸の日');
const saved=db.exportStateJSON();db.deleteMenu(id);assert.equal(db.getMenus().length,0);assert(db.restoreStateJSON(saved));assert.equal(db.getMenus().length,1);
const mixed=db.getExercises().filter(e=>e.part==='体幹'||e.part==='有酸素').slice(-3).map(e=>({...e,exId:e.id,count:1,sets:[{seconds:20,reps:5,t:10,d:2}]}));
const mixedId=db.saveMenu(null,'mixed',mixed,true);db.appendMenu(day,mixedId);
assert.equal(db.getMenus().find(m=>m.id===mixedId).entries.length,mixed.length);
const full=db.exportStateJSON();fail=true;assert.throws(()=>db.saveMenu(null,'failed',[{...ex,count:3}],false));assert.equal(db.exportStateJSON(),full);assert.throws(()=>db.appendMenu(day,id));assert.equal(db.exportStateJSON(),full);fail=false;
assert.throws(()=>db.saveMenu(null,'',[],false));assert.throws(()=>db.saveMenu(null,'bad',[{...ex,count:0}],false));
db.deleteExercise(ex.id);db.appendMenu('2026-11-07',id);assert(db.getExercise(db.getWorkout('2026-11-07').entries[0].exId));
console.log('PASS: menu save/load, isolated edits, append preservation, restore, deleted exercise, validation and storage rollback');

// Exercise UI event wiring against the actual DB, without browser or device claims.
const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{id,innerHTML:'',textContent:'',style:{},classList:{add(){},remove(){},toggle(){}},handlers:{},dataset:{},addEventListener(name,fn){this.handlers[name]=fn;},focus(){},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);}
const dialog=element('setMenuDialog');let confirmed=true, notices=[];
const viewportEvents={},keyboardEvents={};
const viewport={height:800,offsetTop:0,addEventListener:(name,fn)=>viewportEvents[name]=fn};
const uiContext={DB:db,console,document:{getElementById:element},window:{innerHeight:800,visualViewport:viewport,Capacitor:{Plugins:{Keyboard:{addListener:(name,fn)=>keyboardEvents[name]=fn}}},addEventListener(){}},confirm:()=>confirmed,setTimeout};
vm.createContext(uiContext);vm.runInContext(fs.readFileSync('js/set-menus.js','utf8'),uiContext);
uiContext.SetMenus.init({date:()=> '2026-11-08',changed:()=>{},notify:m=>notices.push(m)});
function click(action,extra={}){dialog.handlers.click({target:{closest:selector=>selector==='[data-menu-action]'?({dataset:{menuAction:action,...extra}}):null}});}
function input(id,value,dataset={}){dialog.handlers.input({target:{id,value,dataset}});}
function toggle(id){dialog.handlers.change({target:{dataset:{ex:id},checked:true}});}
element('addSetMenuBtn').onclick();click('new');assert.doesNotMatch(element('setMenuBody').innerHTML,/menuValues/);input('menuName','UI menu');click('pick');
const picks=db.getExercises().slice(0,2);picks.forEach(e=>toggle(e.id));click('selected');
assert.match(element('setMenuBody').innerHTML,/value="3"/);
input('', '4', {count:'0'});click('down',{index:'0'});click('save');
assert.equal(element('setMenuError').textContent,'');
const uiMenu=db.getMenus().find(m=>m.name==='UI menu');assert(uiMenu);assert.equal(uiMenu.entries.length,2);assert.equal(uiMenu.entries[1].sets.length,4);
assert.equal(db.getWorkout('2026-11-08'),null,'UI save is not workout insertion');
click('apply',{id:uiMenu.id});assert.equal(db.getWorkout('2026-11-08').entries.length,2);assert.equal(dialog.open,false);
element('addSetMenuBtn').onclick();click('edit',{id:uiMenu.id});input('menuName','discard this');confirmed=false;element('setMenuClose').onclick();assert(dialog.open);confirmed=true;element('setMenuClose').onclick();assert.equal(db.getMenus().find(m=>m.id===uiMenu.id).name,'UI menu');
element('addSetMenuBtn').onclick();click('today');input('menuName','snapshot');click('save');assert(db.getMenus().find(m=>m.name==='snapshot'));
console.log('PASS: menu UI new/pick/reorder/count/save/apply/day snapshot and discard confirmation');

// Program selection only changes the highlight; it never adds a workout.
const highlights=[false,false];
const cards=highlights.map((_,i)=>({classList:{toggle:(_,v)=>{highlights[i]=v;}}}));
element('setMenuBody').querySelectorAll=()=>cards;
const beforeSelection=db.exportStateJSON();
dialog.handlers.click({target:{closest:s=>s==='[data-program-id]'?cards[1]:null}});
assert.deepEqual(highlights,[false,true]);assert.equal(db.exportStateJSON(),beforeSelection);
// Editing has a keyboard-adjacent Done action and cancellation restores the draft.
let blurCount=0;
const field={id:'menuName',value:'original',dataset:{},matches:()=>true,getAttribute:()=>null,blur:()=>blurCount++,dispatchEvent:()=>dialog.handlers.input({target:field})};
const menuBody=element('setMenuBody');
menuBody.scrollTop=0;
let bodyBottom=700,fieldTop=180;
menuBody.getBoundingClientRect=()=>({top:140,bottom:bodyBottom});
element('setMenuInputBar').getBoundingClientRect=()=>({top:bodyBottom});
field.getBoundingClientRect=()=>({top:fieldTop-menuBody.scrollTop,bottom:fieldTop-menuBody.scrollTop+52,height:52});
uiContext.Event=function(){};
element('addSetMenuBtn').onclick();click('new');
dialog.handlers.focusin({target:field});assert.equal(element('setMenuInputBar').hidden,false);
field.value='changed';input('menuName',field.value);element('setMenuInputCancel').onclick();
assert.equal(field.value,'original');assert.equal(element('setMenuInputBar').hidden,true);
dialog.handlers.focusin({target:field});element('setMenuDone').onclick();assert.equal(element('setMenuInputBar').hidden,true);assert.equal(blurCount,2);
console.log('PASS: new-program options hidden, selection isolated, keyboard Done and cancel');

// Native resize:none leaves the viewport unchanged while the keyboard covers the lower field.
fieldTop=620;menuBody.scrollTop=0;bodyBottom=700;
dialog.handlers.focusin({target:field});assert.equal(menuBody.scrollTop,0);
bodyBottom=420;keyboardEvents.keyboardWillShow({keyboardHeight:320});
function assertFieldVisible(){const rect=field.getBoundingClientRect();assert(rect.top>=152);assert(rect.bottom<=bodyBottom-12);}
assertFieldVisible();assert.match(dialog.style.height,/470px/);
// A late layout change at animation completion must also be corrected.
menuBody.scrollTop=0;keyboardEvents.keyboardDidShow({keyboardHeight:320});assertFieldVisible();
const settled=menuBody.scrollTop;keyboardEvents.keyboardDidShow({keyboardHeight:320});assert.equal(menuBody.scrollTop,settled);
// Browser keyboard and viewport panning follow the same visibility rule.
keyboardEvents.keyboardDidHide();viewport.height=440;bodyBottom=380;menuBody.scrollTop=0;
viewportEvents.resize();assertFieldVisible();
viewport.offsetTop=30;menuBody.scrollTop=0;viewportEvents.scroll();assertFieldVisible();assert.match(dialog.style.top,/40px/);
// Switching to an earlier input scrolls upwards; Done stops further auto-scrolling.
fieldTop=180;dialog.handlers.focusin({target:field});assertFieldVisible();
element('setMenuDone').onclick();const finished=menuBody.scrollTop;
fieldTop=900;viewportEvents.resize();assert.equal(menuBody.scrollTop,finished);
console.log('PASS: program input visibility for native keyboard, viewport resize/pan, field switching and Done');
