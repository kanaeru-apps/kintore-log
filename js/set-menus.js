/* Saved workout menus: drafts never mutate the daily log or stored menus. */
'use strict';
var SetMenus = (function () {
  var options, dialog, body, footer, draft, screen, selection, search = '', part = '', equip = '', changed = false, date, keyboardHeight = 0;
  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function button(action, label, extra) { return '<button type="button" class="btn small" data-menu-action="' + action + '" ' + (extra || '') + '>' + label + '</button>'; }
  function iconButton(action, label, extra) {
    var paths = {
      edit: '<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/>',
      copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'
    };
    var glyph = paths[action] ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[action] + '</svg>' : '<span aria-hidden="true">' + (action === 'up' ? '▲' : action === 'down' ? '▼' : '✕') + '</span>';
    return '<button type="button" class="program-icon' + (action === 'delete' || action === 'remove' ? ' set-del' : '') + '" data-menu-action="' + action + '" aria-label="' + esc(label) + '" title="' + esc(label) + '" ' + (extra || '') + '>' + glyph + '</button>';
  }
  function exerciseMeta(e) {
    var parts = {'胸':'chest','背中':'back','脚':'leg','肩':'shoulder','腕':'arm','腹':'core','体幹':'trunk','有酸素':'cardio','その他':'etc'};
    return '<div class="program-meta"><span class="chip p-' + (parts[e.part] || 'etc') + '">' + esc(e.part) + '</span>' + (e.equip ? '<span class="program-equip">' + esc(e.equip) + '</span>' : '') + '</div>';
  }
  function error(message) { $('setMenuError').textContent = message || ''; }
  function header(title, back) { $('setMenuTitle').textContent = title; $('setMenuBack').hidden = !back; error(); body.scrollTop = 0; }
  function close() {
    if (changed && !confirm('編集中の内容を保存せずに閉じますか？')) return;
    dialog.close(); changed = false; $('addSetMenuBtn').focus();
  }
  function list() {
    screen = 'list'; changed = false; header('プログラムメニュー', false);
    var menus = DB.getMenus();
    body.innerHTML = '<p class="menu-hint">よく使う種目の組み合わせをまとめて追加</p>' + (menus.length ? menus.map(function (m) {
      var data = 'data-id="' + esc(m.id) + '"';
      return '<article class="menu-card program-summary"><div class="program-card-head"><h4>' + esc(m.name) + '</h4>' + iconButton('delete', m.name + 'を削除', data) + '</div><p class="menu-hint">' + m.entries.length + '種目 · ' + esc(m.entries.map(function (e) { return e.name; }).join('／')) + '</p><div class="menu-actions program-list-actions">' + button('apply','追加',data) + '<div class="program-tools">' + iconButton('edit',m.name + 'を編集',data) + iconButton('copy',m.name + 'を複製',data) + '</div></div></article>';
    }).join('') : '<div class="menu-empty">保存したプログラムはまだありません。<br>好きな種目を組み合わせて作成できます。</div>');
    footer.innerHTML = button('new','＋ プログラムを作成') + button('today','この日の種目から保存');
  }
  function edit(menu) {
    draft = clone(menu); draft.entries.forEach(function (e) { e.count = Math.max(1, e.sets.length); }); renderEditor();
  }
  function renderEditor() {
    screen = 'edit'; header(draft.id ? 'プログラムを編集' : 'プログラムを作成', true);
    body.innerHTML = '<label class="menu-label" for="menuName">プログラム名</label><input id="menuName" maxlength="60" placeholder="例：胸の日、自宅トレ" value="' + esc(draft.name) + '">' +
      '<p class="menu-hint">種目の順番とセット数を決めて保存します。</p><div>' + draft.entries.map(function (e,i) {
        var data = 'data-index="' + i + '"';
        return '<article class="menu-card program-exercise"><div class="program-exercise-content"><h4>' + esc(e.name) + '</h4>' + exerciseMeta(e) + '<label class="program-set-count">セット数 <input class="menu-count" type="number" inputmode="numeric" min="1" max="100" aria-label="' + esc(e.name) + 'のセット数" data-count="' + i + '" value="' + esc(e.count) + '"></label></div><div class="program-exercise-tools"><div class="program-order">' + iconButton('up',e.name + 'を上へ',data + (i===0?' disabled':'')) + iconButton('down',e.name + 'を下へ',data + (i===draft.entries.length-1?' disabled':'')) + '</div>' + iconButton('remove',e.name + 'をプログラムから外す',data) + '</div></article>';
      }).join('') + '</div>' + button('pick','＋ 種目を選ぶ') + '<label class="menu-check"><input id="menuValues" type="checkbox" '+(draft.includeValues?'checked':'')+'>保存元の重量・回数・時間なども含める</label><p class="menu-hint">チェックなしの場合、呼び出した種目の数値は空欄になります。新しく選んだ種目も空欄です。</p>';
    footer.innerHTML = button('save','プログラムを保存');
  }
  function picker() {
    screen = 'pick'; selection = []; search = ''; part = ''; equip = ''; header('種目を選ぶ', true);
    body.innerHTML = '<input id="menuSearch" type="search" placeholder="種目名で検索" aria-label="種目名で検索"><div class="menu-filters"><select id="menuPart" aria-label="部位"><option value="">すべての部位</option>' + DB.PARTS.map(function(p){return '<option>'+esc(p)+'</option>';}).join('') + '</select><select id="menuEquip" aria-label="器具"><option value="">すべての器具</option>' + DB.EQUIPS.map(function(p){return '<option>'+esc(p)+'</option>';}).join('') + '</select></div><div id="menuChoices"></div>';
    choices();
  }
  function choices() {
    var exercises = DB.getExercises().filter(function(e){return (!part || e.part===part) && (!equip || e.equip===equip) && e.name.toLocaleLowerCase().indexOf(search.toLocaleLowerCase())>=0;});
    $('menuChoices').innerHTML = exercises.map(function(e){
      var added = draft.entries.some(function(d){return d.exId===e.id;});
      return '<label class="menu-choice"><span><b>'+esc(e.name)+'</b><small>'+esc(e.part+' · '+(e.equip||''))+(added?' · 選択済み':'')+'</small></span><input type="checkbox" data-ex="'+esc(e.id)+'" '+(added?'disabled checked':selection.indexOf(e.id)>=0?'checked':'')+'></label>';
    }).join('') || '<p class="menu-empty">該当する種目がありません</p>';
    footer.innerHTML = button('selected','選んだ種目を追加（'+selection.length+'）',selection.length?'':'disabled');
  }
  function act(target) {
    var a=target.dataset.menuAction, id=target.dataset.id, i=Number(target.dataset.index), menus, m;
    error();
    if (a==='new') { changed=false; edit({name:'',entries:[],includeValues:false}); }
    if (a==='today') {
      var w=DB.getWorkout(date);
      if (!w || !w.entries.length) return error('この日には種目がありません');
      changed=true; edit({name:'',entries:clone(w.entries),includeValues:false});
    }
    if (['edit','copy','delete','apply'].indexOf(a)>=0) {
      menus=DB.getMenus(); m=menus.find(function(x){return x.id===id;});
      if (!m) return error('プログラムが見つかりません');
      if (a==='edit') { changed=false; edit(m); }
      if (a==='copy') { delete m.id; m.name=m.name.slice(0,54)+'（コピー）'; changed=true; edit(m); }
      if (a==='delete' && confirm('「'+m.name+'」を削除しますか？ 日々の記録は残ります。')) { DB.deleteMenu(id); options.changed(); list(); }
      if (a==='apply') {
        var existing=DB.getWorkout(date);
        var duplicates=existing && existing.entries.some(function(e){return m.entries.some(function(x){return x.exId===e.exId;});});
        if (duplicates && !confirm('同じ種目がこの日にあります。別の記録として追加しますか？')) return;
        var count=DB.appendMenu(date,id); options.changed(); dialog.close(); options.notify(count+'種目を追加しました'); $('addSetMenuBtn').focus();
      }
    }
    if (a==='pick') picker();
    if (a==='selected') {
      selection.forEach(function(id){var e=DB.getExercise(id); if (!e) return; var item=clone(e); item.exId=e.id; delete item.id; item.count=e.part==='有酸素'?1:3; item.sets=[]; draft.entries.push(item);});
      changed=true; renderEditor();
    }
    if (a==='up' || a==='down') { var j=i+(a==='up'?-1:1); if(j<0 || j>=draft.entries.length)return; var e=draft.entries.splice(i,1)[0];draft.entries.splice(j,0,e);changed=true;renderEditor(); }
    if (a==='remove') {draft.entries.splice(i,1);changed=true;renderEditor();}
    if (a==='save') { DB.saveMenu(draft.id,draft.name,draft.entries,draft.includeValues); options.changed(); list(); options.notify('プログラムを保存しました'); }
  }
  function sizeDialog() {
    if (!dialog || !dialog.open) return;
    var v=window.visualViewport;
    var height = Math.min(v ? v.height : window.innerHeight, window.innerHeight - keyboardHeight);
    dialog.style.height='calc(' + Math.max(180, height-20) + 'px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))';
    dialog.style.top='calc(' + ((v ? v.offsetTop : 0)+10) + 'px + env(safe-area-inset-top, 0px))';
  }
  function init(opts) {
    options=opts; dialog=$('setMenuDialog');body=$('setMenuBody');footer=$('setMenuFooter');
    $('addSetMenuBtn').onclick=function(){date=options.date();list();dialog.showModal();sizeDialog();};
    $('setMenuClose').onclick=close;
    var focusedInput = null;
    dialog.addEventListener('focusin', function(e) {
      if (e.target.matches('input:not([type=checkbox])')) { focusedInput=e.target; $('setMenuDone').hidden=false; }
    });
    dialog.addEventListener('focusout', function() {
      setTimeout(function() { if (!dialog.contains(document.activeElement) || !document.activeElement.matches('input:not([type=checkbox]), #setMenuDone')) $('setMenuDone').hidden=true; }, 0);
    });
    $('setMenuDone').onclick=function() { if(focusedInput) focusedInput.blur(); $('setMenuDone').hidden=true; $('setMenuClose').focus(); };
    dialog.addEventListener('keydown', function(e) { if (e.key==='Enter' && e.target.matches('input:not([type=checkbox])')) { e.preventDefault(); e.target.blur(); $('setMenuClose').focus(); } });
    $('setMenuBack').onclick=function(){if(screen==='pick')renderEditor();else if(!changed || confirm('編集中の内容を破棄して戻りますか？'))list();};
    dialog.addEventListener('cancel',function(e){e.preventDefault();close();});
    dialog.addEventListener('click',function(e){var b=e.target.closest('[data-menu-action]');if(b)try{act(b);}catch(err){error(err.message || '保存できませんでした。空き容量を確認してください');}});
    dialog.addEventListener('input',function(e){
      var t=e.target;
      if(t.id==='menuName'){draft.name=t.value;changed=true;}
      if(t.dataset.count!=null){draft.entries[Number(t.dataset.count)].count=t.value;changed=true;}
      if(t.id==='menuSearch'){search=t.value;choices();}
    });
    dialog.addEventListener('change',function(e){
      var t=e.target;
      if(t.id==='menuValues'){draft.includeValues=t.checked;changed=true;}
      if(t.id==='menuPart'){part=t.value;choices();}
      if(t.id==='menuEquip'){equip=t.value;choices();}
      if(t.dataset.ex){if(t.checked)selection.push(t.dataset.ex);else selection=selection.filter(function(id){return id!==t.dataset.ex;});choices();}
    });
    window.addEventListener('resize',sizeDialog);
    if(window.visualViewport)window.visualViewport.addEventListener('resize',sizeDialog);
    var keyboard=window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard;
    if(keyboard) {
      keyboard.addListener('keyboardWillShow',function(info){keyboardHeight=info.keyboardHeight || 0; sizeDialog();});
      keyboard.addListener('keyboardWillHide',function(){keyboardHeight=0;sizeDialog();});
    }
  }
  return {init:init};
})();
