/* 更新前の保存領域を維持して新しいDBを起動する回帰テスト。実機更新試験は別途必要。 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const fixture = {
  version: 2,
  exercises: [
    {id:'strength',name:'カスタムプレス',part:'胸',equip:'ダンベル',video:'https://example.com/form',note:'肩をすくめない\nゆっくり下ろす'},
    {id:'cardio',name:'ランニング',part:'有酸素',equip:'自重'},
    {id:'unused',name:'未使用の種目',part:'背中',equip:'ケーブル',note:'記録がなくても保持'}
  ],
  workouts: {
    '2026-08-28': {memo:'更新前の記録\n2行目',condition:'good',entries:[
      {id:'entry1',exId:'strength',name:'カスタムプレス',part:'胸',equip:'ダンベル',sets:[{w:22.5,r:12},{w:25,r:8}]},
      {id:'entry2',exId:'cardio',name:'ランニング',part:'有酸素',equip:'自重',sets:[{t:20,ts:30,d:3,sp:8.8,inc:2,cal:180,hr:130,z:'hi'}]}
    ]},
    '2026-08-29': {memo:'メモだけの日',entries:[]}
  },
  dirtyDates:{'2026-08-28':true},dirtyExercises:true,
  deletedExercises:[{part:'脚',name:'削除した種目',equip:'マシン'}]
};
const settings = {
  kintore_theme:'light',kintore_weight_step:'2.5',kintore_timer_sound:'bell',
  kintore_timer_sound_on:'0',kintore_timer_vibrate_on:'1',kintore_timer_notify_on:'1',
  kintore_timer_ignore_silent:'0',kintore_interval_cfg:'{"work":45,"rest":15}',
  kintore_hist_cal_open:'0',kintore_v1_preimport_backup:JSON.stringify(fixture)
};
const values = new Map(Object.entries({...settings,kintore_v1:JSON.stringify(fixture)}));
const storage = {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
function boot() {
  const c={console,localStorage:storage,document:{documentElement:{}},getComputedStyle:()=>({getPropertyValue:()=>''})};
  vm.createContext(c);vm.runInContext(read('js/db.js'),c);return c.DB;
}
let db=boot();
assert.deepEqual(JSON.parse(storage.getItem(db.PRE_CORE_KEY)),fixture,'移行前DBを完全保存');
assert.deepEqual(JSON.parse(db.exportStateJSON()).workouts,fixture.workouts,'既存履歴を変更しない');
assert.equal(db.getExercises().filter(e=>e.part==='体幹').length,6);
for(const [key,value] of Object.entries(settings)) assert.equal(storage.getItem(key),value,key);
db.setMemo('2026-09-07','更新後の新しい記録');
db=boot();
const after=JSON.parse(db.exportStateJSON());
assert.deepEqual(after.exercises.filter(e=>e.part!=='体幹'),fixture.exercises);
for(const [date,workout] of Object.entries(fixture.workouts)) assert.deepEqual(after.workouts[date],workout);
assert.deepEqual(after.deletedExercises,fixture.deletedExercises);
assert.equal(after.workouts['2026-09-07'].memo,'更新後の新しい記録');
// 履歴のない利用者の種目マスターも初期化しない。
storage.setItem('kintore_v1',JSON.stringify({...fixture,workouts:{}}));
assert.deepEqual(JSON.parse(boot().exportStateJSON()).exercises.filter(e=>e.part!=='体幹'),fixture.exercises);
// アプリ識別子・WebViewの保存先を変えると、同じキーでも別の保存領域になる。
const config=JSON.parse(read('capacitor.config.json'));
assert.equal(config.appId,'com.kanaeru.kintore');
assert.equal(config.server?.hostname??'localhost','localhost');
assert.equal(config.server?.iosScheme??'capacitor','capacitor');
const project=read('ios/App/App.xcodeproj/project.pbxproj');
const bundleIds=[...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map(m=>m[1]);
assert.equal(bundleIds.length,2);assert(bundleIds.every(v=>v===config.appId));
async function checkNativeBackup() {
  // 更新起動時に古いDocumentsバックアップが既存履歴を上書きしない。
  storage.setItem('kintore_v1',JSON.stringify(fixture));
  const existingDB=boot();
  let reads=0;
  const writes=[];
  const c={DB:existingDB,localStorage:storage,Date,Promise,
    isNativeApp:()=>true,
    nativePlugin:()=>({readFile:args=>{reads++;if(args.path==='kintore-pre-core-20260923.json') return Promise.reject(new Error('not found'));return Promise.resolve({data:JSON.stringify({...fixture,workouts:{}})});},writeFile:args=>{writes.push(args);return Promise.resolve();}}),
    renderStorageInfo(){},renderLog(){},renderSettings(){},toast(){}
  };
  vm.createContext(c);
  const source=read('js/app.js');
  const start=source.indexOf("  var NATIVE_BACKUP_FILE =");
  const end=source.indexOf('  /* ---- 消音モード',start);
  assert(start>=0 && end>start);
  vm.runInContext(source.slice(start,end),c);
  c.restoreNativeBackupIfEmpty();
  assert.equal(reads,0,'既存履歴がある更新では古いバックアップを読み込まない');
  assert.equal(await c.writeNativeBackup(),true);
  assert.equal(writes[0].path,'kintore-pre-core-20260923.json');
  assert.deepEqual(JSON.parse(writes[0].data),fixture);
  assert.equal(writes[1].path,'kintore-backup.json');
  assert.equal(writes[1].directory,'DOCUMENTS');
  assert.deepEqual(JSON.parse(writes[1].data).workouts,fixture.workouts);
  assert.deepEqual(JSON.parse(writes[1].data).exercises.filter(e=>e.part!=='体幹'),fixture.exercises);
  for(const [key,value] of Object.entries(settings)) assert.equal(storage.getItem(key),value,key);
}
checkNativeBackup().then(()=>console.log('Upgrade check passed: existing DB / exercise IDs and metadata / strength and cardio history / memo-only days / settings storage / relaunch / app identity / native backup preserves existing records')).catch(error=>{console.error(error);process.exitCode=1;});
