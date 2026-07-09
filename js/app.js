/* ============================================================
   app.js — 画面制御・レンダリング・イベント
   ============================================================ */
'use strict';

(function () {
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var PART_CLASS = { '胸': 'chest', '背中': 'back', '脚': 'leg', '肩': 'shoulder', '腕': 'arm', '腹': 'core', '有酸素': 'cardio', 'その他': 'etc' };

  var ui = { tab: 'log', date: DB.todayStr(), pickerPart: '胸', expanded: {}, sheetEdit: false };

  /* ---------- ユーティリティ ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtNum(n) { return (Math.round(n * 10) / 10).toLocaleString('ja-JP'); }
  function parseDate(str) {
    var p = str.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function toStr(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function shiftDate(str, days) {
    var d = parseDate(str);
    d.setDate(d.getDate() + days);
    return toStr(d);
  }
  function setVol(sets) {
    return sets.reduce(function (a, s) { return a + ((+s.w || 0) * (+s.r || 0)); }, 0);
  }
  function workoutVol(w) {
    return (w.entries || []).reduce(function (a, e) { return a + setVol(e.sets); }, 0);
  }
  /* 重量か回数が入力されたセットだけを「実施セット」として数える */
  function filledSets(e) {
    return e.sets.filter(function (s) { return (+s.w || 0) > 0 || (+s.r || 0) > 0; });
  }
  function workoutSets(w) {
    return (w.entries || []).reduce(function (a, e) { return a + filledSets(e).length; }, 0);
  }
  function dayStats(w) {
    var st = { ex: 0, sets: 0, reps: 0, vol: 0 };
    ((w && w.entries) || []).forEach(function (e) {
      var f = filledSets(e);
      if (f.length) st.ex++;
      st.sets += f.length;
      f.forEach(function (s) {
        st.reps += (+s.r || 0);
        st.vol += (+s.w || 0) * (+s.r || 0);
      });
    });
    return st;
  }
  function partChip(p) {
    return '<span class="chip p-' + (PART_CLASS[p] || 'etc') + '">' + esc(p) + '</span>';
  }
  function equipTag(e) {
    return e ? '<span class="equip-tag">' + esc(e) + '</span>' : '';
  }
  function equipOptions() {
    return '<option value="">器具なし</option>' + DB.EQUIPS.map(function (q) {
      return '<option value="' + esc(q) + '">' + esc(q) + '</option>';
    }).join('');
  }
  /* ---------- 人体図SVG（自作・部位ハイライト） ---------- */
  function bodySvg(part) {
    var hl = {
      '胸': 'seg-chest', '背中': 'seg-back', '肩': 'seg-shoulder',
      '腕': 'seg-arm', '腹': 'seg-core', '脚': 'seg-leg'
    }[part] || '';
    var c = function (base) { return 'seg ' + base + (hl === base ? ' hl' : ''); };
    var heartCls = 'heart' + (part === '有酸素' ? ' hl' : '');
    return '<svg viewBox="0 0 220 132" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="鍛えられる部位">' +
      /* 前面 */
      '<circle class="seg" cx="60" cy="14" r="9"/>' +
      '<rect class="seg" x="56" y="22" width="8" height="6" rx="2"/>' +
      '<rect class="' + c('seg-chest') + '" x="46" y="27" width="28" height="14" rx="5"/>' +
      '<rect class="' + c('seg-core') + '" x="48" y="42" width="24" height="14" rx="4"/>' +
      '<rect class="seg" x="48" y="57" width="24" height="9" rx="3"/>' +
      '<circle class="' + c('seg-shoulder') + '" cx="43" cy="31" r="6"/>' +
      '<circle class="' + c('seg-shoulder') + '" cx="77" cy="31" r="6"/>' +
      '<rect class="' + c('seg-arm') + '" x="35" y="37" width="8" height="27" rx="4"/>' +
      '<rect class="' + c('seg-arm') + '" x="77" y="37" width="8" height="27" rx="4"/>' +
      '<rect class="' + c('seg-leg') + '" x="49" y="67" width="9" height="42" rx="4"/>' +
      '<rect class="' + c('seg-leg') + '" x="62" y="67" width="9" height="42" rx="4"/>' +
      '<path class="' + heartCls + '" d="M63 30 c1.5-2.5 5-2.5 6 0 c1-2.5 4.5-2.5 6 0 c1.5 2.8-2 6-6 8.5 c-4-2.5-7.5-5.7-6-8.5z"/>' +
      /* 背面 */
      '<circle class="seg" cx="160" cy="14" r="9"/>' +
      '<rect class="seg" x="156" y="22" width="8" height="6" rx="2"/>' +
      '<rect class="' + c('seg-back') + '" x="146" y="27" width="28" height="19" rx="5"/>' +
      '<rect class="' + c('seg-back') + '" x="149" y="47" width="22" height="9" rx="4"/>' +
      '<rect class="seg" x="148" y="57" width="24" height="9" rx="3"/>' +
      '<circle class="' + c('seg-shoulder') + '" cx="143" cy="31" r="6"/>' +
      '<circle class="' + c('seg-shoulder') + '" cx="177" cy="31" r="6"/>' +
      '<rect class="' + c('seg-arm') + '" x="135" y="37" width="8" height="27" rx="4"/>' +
      '<rect class="' + c('seg-arm') + '" x="177" y="37" width="8" height="27" rx="4"/>' +
      '<rect class="' + c('seg-leg') + '" x="149" y="67" width="9" height="42" rx="4"/>' +
      '<rect class="' + c('seg-leg') + '" x="162" y="67" width="9" height="42" rx="4"/>' +
      '<text x="60" y="126">FRONT</text><text x="160" y="126">BACK</text>' +
    '</svg>';
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  /* ================== 種目情報モーダル ================== */
  var infoExId = null;

  function videoSearchHref(ex) {
    var q = [];
    if (ex.equip && ex.equip !== '自重') q.push(ex.equip);
    q.push(ex.name);
    q.push('やり方');
    return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q.join(' '));
  }

  function openExInfo(exId, snapshot) {
    var master = DB.getExercise(exId);
    var ex = master || snapshot;
    if (!ex) return;
    infoExId = master ? exId : null;

    $('#exModalTitle').innerHTML = partChip(ex.part) + '<b>' + esc(ex.name) + '</b>' + equipTag(ex.equip);
    var href = ex.video || videoSearchHref(ex);
    var html =
      '<div class="bmap">' + bodySvg(ex.part) + '</div>' +
      '<a id="exVideoBtn" class="btn primary video-btn" href="' + esc(href) + '" target="_blank" rel="noopener">▶ 動きを見る（YouTube）</a>' +
      '<p class="video-note">' + (ex.video
        ? '登録済みの参考動画を開きます　<a class="link" href="' + esc(videoSearchHref(ex)) + '" target="_blank" rel="noopener">検索で探し直す</a>'
        : '「やり方」の検索結果を開きます') + '</p>';
    if (master) {
      html +=
        '<label class="modal-label" for="exVideoInput">参考動画URL（登録すると次回からワンタップで開けます）</label>' +
        '<input id="exVideoInput" type="url" placeholder="https://www.youtube.com/..." value="' + esc(ex.video || '') + '">' +
        '<label class="modal-label" for="exNoteInput">フォームメモ</label>' +
        '<textarea id="exNoteInput" rows="2" placeholder="フォームの注意点など（自由記載）">' + esc(ex.note || '') + '</textarea>';
    } else {
      html += '<p class="video-note">（種目リストから削除された種目のため、URL登録はできません）</p>';
    }
    $('#exModalBody').innerHTML = html;
    $('#exModalBackdrop').classList.add('show');
    $('#exModal').classList.add('show');
  }

  function closeExInfo() {
    $('#exModalBackdrop').classList.remove('show');
    $('#exModal').classList.remove('show');
  }

  function bindExInfo() {
    $('#exModalClose').onclick = closeExInfo;
    $('#exModalBackdrop').onclick = closeExInfo;
    // 入力したら即保存
    $('#exModalBody').addEventListener('change', function (e) {
      if (!infoExId) return;
      var ex = DB.getExercise(infoExId);
      if (!ex) return;
      if (e.target.id === 'exVideoInput') {
        var v = e.target.value.trim();
        if (v && !/^https?:\/\//.test(v)) { toast('http(s)から始まるURLを入力してください'); return; }
        DB.updateExercise(infoExId, { video: v });
        $('#exVideoBtn').href = v || videoSearchHref(ex);
        toast(v ? '参考動画を登録しました' : '参考動画の登録を解除しました');
      } else if (e.target.id === 'exNoteInput') {
        DB.updateExercise(infoExId, { note: e.target.value });
        toast('メモを保存しました');
      }
    });
  }

  /* ================== 重量ドラムロールピッカー ================== */
  var DRUM_STEP = 0.5;      // 0.5kg刻み
  var DRUM_MAX = 300;       // 最大300kg
  var DRUM_ITEM_H = 44;     // 各項目の高さ(px)。CSSと一致させること
  var drumTarget = null;    // { entryId, idx }
  var drumSelIndex = -1;
  var drumBuilt = false;

  function drumFmt(v) { return (v % 1 === 0) ? String(v) : v.toFixed(1); }

  function buildDrumList() {
    if (drumBuilt) return;
    var n = Math.round(DRUM_MAX / DRUM_STEP);
    var html = '';
    for (var i = 0; i <= n; i++) {
      var v = i * DRUM_STEP;
      html += '<div class="drum-item num">' + drumFmt(v) + '</div>';
    }
    $('#drumList').innerHTML = html;
    drumBuilt = true;
  }

  function setDrumSel(index) {
    if (index === drumSelIndex) return;
    var kids = $('#drumList').children;
    if (drumSelIndex >= 0 && kids[drumSelIndex]) kids[drumSelIndex].classList.remove('sel');
    if (kids[index]) kids[index].classList.add('sel');
    drumSelIndex = index;
  }

  function drumIndexFromScroll() {
    var scroll = $('#drumScroll');
    var index = Math.round(scroll.scrollTop / DRUM_ITEM_H);
    return Math.max(0, Math.min(Math.round(DRUM_MAX / DRUM_STEP), index));
  }

  function openDrum(entryId, idx) {
    buildDrumList();
    drumTarget = { entryId: entryId, idx: idx };

    var s = DB.getSet(ui.date, entryId, idx);
    var cur = (s && s.w !== '' && s.w != null) ? +s.w : 20; // 空なら20kgから
    cur = Math.max(0, Math.min(DRUM_MAX, cur));
    var index = Math.round(cur / DRUM_STEP);

    var w = DB.getWorkout(ui.date);
    var ent = ((w && w.entries) || []).filter(function (x) { return x.id === entryId; })[0];
    $('#drumTitle').textContent = (ent ? ent.name : '') + '　' + (idx + 1) + 'セット目';

    $('#drumBackdrop').classList.add('show');
    $('#drumSheet').classList.add('show');

    drumSelIndex = -1;
    var scroll = $('#drumScroll');
    requestAnimationFrame(function () {
      scroll.scrollTop = index * DRUM_ITEM_H;
      setDrumSel(index);
    });
  }

  function closeDrum(commit) {
    if (commit && drumTarget) {
      var v = drumSelIndex >= 0 ? drumSelIndex * DRUM_STEP : 0;
      DB.updateSet(ui.date, drumTarget.entryId, drumTarget.idx, 'w', v);
    }
    $('#drumBackdrop').classList.remove('show');
    $('#drumSheet').classList.remove('show');
    drumTarget = null;
    if (commit) renderLog();
  }

  function bindDrum() {
    var scroll = $('#drumScroll');
    var ticking = false;
    scroll.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; setDrumSel(drumIndexFromScroll()); });
    });

    // マウスの上下ドラッグに対応（タッチはネイティブスクロール＋スナップに任せる）
    var drag = { active: false, startY: 0, startScroll: 0 };
    scroll.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return;
      drag.active = true;
      drag.startY = e.clientY;
      drag.startScroll = scroll.scrollTop;
      scroll.setPointerCapture(e.pointerId);
    });
    scroll.addEventListener('pointermove', function (e) {
      if (!drag.active) return;
      scroll.scrollTop = drag.startScroll - (e.clientY - drag.startY);
    });
    var endDrag = function () {
      if (!drag.active) return;
      drag.active = false;
      var index = drumIndexFromScroll();
      scroll.scrollTop = index * DRUM_ITEM_H; // 最寄りにスナップ
      setDrumSel(index);
    };
    scroll.addEventListener('pointerup', endDrag);
    scroll.addEventListener('pointercancel', endDrag);

    $('#drumDone').onclick = function () { closeDrum(true); };
    $('#drumCancel').onclick = function () { closeDrum(false); };
    $('#drumBackdrop').onclick = function () { closeDrum(false); };
  }

  /* ================== 記録タブ ================== */
  function statTile(label, value, unit) {
    return '<div class="stat"><span class="stat-label">' + label + '</span>' +
      '<span class="stat-value num">' + value + (unit ? '<small>' + unit + '</small>' : '') + '</span></div>';
  }

  function renderLog(animate) {
    var d = parseDate(ui.date);
    var pad2 = function (n) { return ('0' + n).slice(-2); };
    // アニメーションは日付切り替え・タブ切り替え時のみ（入力のたびに再生されるとチラつくため）
    $('#entries').classList.toggle('no-anim', !animate);
    $('#eyebrow').textContent = 'TRAINING LOG';
    $('#dateLabel').innerHTML = d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) +
      ' <span class="wd">(' + WD[d.getDay()] + ')</span>';
    $('#todayBtn').style.display = (ui.date === DB.todayStr()) ? 'none' : 'inline-block';
    $('#datePicker').value = ui.date;

    var w = DB.getWorkout(ui.date);

    // 日メモ（入力中は上書きしない）
    var memoEl = $('#dayMemo');
    if (document.activeElement !== memoEl) memoEl.value = (w && w.memo) ? w.memo : '';

    // サマリータイル
    var st = dayStats(w);
    $('#dayStats').innerHTML =
      statTile('合計種目数', st.ex) +
      statTile('合計セット数', st.sets) +
      statTile('合計レップ数', st.reps) +
      statTile('合計負荷量', fmtNum(st.vol), 'kg');

    // 種目カード
    var entries = (w && w.entries) || [];
    if (!entries.length) {
      $('#entries').innerHTML =
        '<div class="empty"><div class="ph-icon">🏋️</div><p>まだ記録がありません。<br>「＋ 種目を追加」からはじめましょう。</p></div>';
    } else {
      $('#entries').innerHTML = entries.map(entryHtml).join('');
    }
  }

  function entryHtml(e, i) {
    var prevHtml = '';
    var prev = DB.prevRecord(e.exId, ui.date);
    if (prev) {
      var pd = parseDate(prev.date);
      prevHtml = '<p class="prev"><span>前回 ' + (pd.getMonth() + 1) + '/' + pd.getDate() + '</span>' +
        prev.sets.map(function (s) { return esc(s.w || 0) + '×' + esc(s.r || 0); }).join(' / ') + '</p>';
    }
    var rows = e.sets.map(function (s, idx) {
      return '<div class="set-row" data-idx="' + idx + '">' +
        '<span class="set-no num">' + (idx + 1) + '</span>' +
        '<div class="stepper">' +
          '<button data-action="w-" aria-label="重量を減らす">−</button>' +
          '<button class="w-display num' + (s.w === '' ? ' empty' : '') + '" data-action="w-drum" aria-label="重量を選択">' +
            (s.w === '' ? 'kg' : esc(s.w)) + '</button>' +
          '<button data-action="w+" aria-label="重量を増やす">＋</button>' +
        '</div>' +
        '<span class="times">kg ×</span>' +
        '<div class="stepper">' +
          '<button data-action="r-" aria-label="回数を減らす">−</button>' +
          '<input type="number" inputmode="numeric" step="1" min="0" data-field="r" value="' + esc(s.r) + '" placeholder="回">' +
          '<button data-action="r+" aria-label="回数を増やす">＋</button>' +
        '</div>' +
        '<button class="set-del" data-action="del-set" aria-label="セット削除">✕</button>' +
      '</div>';
    }).join('');

    return '<article class="entry" data-entry="' + e.id + '" style="animation-delay:' + Math.min(i * 50, 300) + 'ms">' +
      '<div class="entry-head">' + partChip(e.part) + '<h3 data-action="ex-info">' + esc(e.name) + equipTag(e.equip) + '<span class="info-hint">ⓘ</span></h3>' +
        '<button class="link danger" data-action="del-entry">削除</button></div>' +
      prevHtml +
      '<div class="sets">' + rows + '</div>' +
      '<div class="entry-foot">' +
        '<button class="btn ghost small" data-action="add-set">＋ セット追加</button>' +
        '<span class="vol">VOL <b class="num">' + fmtNum(setVol(e.sets)) + '</b> kg</span>' +
      '</div>' +
    '</article>';
  }

  function bindLog() {
    $('#prevDay').onclick = function () { ui.date = shiftDate(ui.date, -1); renderLog(true); };
    $('#nextDay').onclick = function () { ui.date = shiftDate(ui.date, 1); renderLog(true); };
    $('#todayBtn').onclick = function () { ui.date = DB.todayStr(); renderLog(true); };
    $('#dateLabel').onclick = function () {
      var p = $('#datePicker');
      if (p.showPicker) { try { p.showPicker(); } catch (e) { p.click(); } } else { p.click(); }
    };
    $('#datePicker').onchange = function (e) {
      if (e.target.value) { ui.date = e.target.value; renderLog(true); }
    };

    var memoTimer = null;
    $('#dayMemo').addEventListener('input', function (e) {
      clearTimeout(memoTimer);
      var val = e.target.value;
      memoTimer = setTimeout(function () { DB.setMemo(ui.date, val); }, 400);
    });

    $('#addExerciseBtn').onclick = openSheet;

    // 種目カード内の操作（イベント委譲）
    $('#entries').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var entryEl = e.target.closest('.entry');
      if (!entryEl) return;
      var id = entryEl.dataset.entry;
      var rowEl = e.target.closest('.set-row');
      var idx = rowEl ? +rowEl.dataset.idx : -1;
      var a = btn.dataset.action;

      if (a === 'ex-info') {
        var wi = DB.getWorkout(ui.date);
        var enti = ((wi && wi.entries) || []).filter(function (x) { return x.id === id; })[0];
        if (enti) openExInfo(enti.exId, enti);
      } else if (a === 'w-drum') {
        openDrum(id, idx);
      } else if (a === 'del-entry') {
        var w0 = DB.getWorkout(ui.date);
        var ent = ((w0 && w0.entries) || []).filter(function (x) { return x.id === id; })[0];
        var name = ent ? ent.name : '';
        if (confirm('「' + name + '」のこの日の記録を削除しますか？')) {
          DB.removeEntry(ui.date, id);
          renderLog();
        }
      } else if (a === 'add-set') {
        DB.addSet(ui.date, id);
        renderLog();
      } else if (a === 'del-set') {
        DB.removeSet(ui.date, id, idx);
        renderLog();
      } else if (a === 'w-' || a === 'w+' || a === 'r-' || a === 'r+') {
        var field = (a.charAt(0) === 'w') ? 'w' : 'r';
        var delta = (a.charAt(1) === '+' ? 1 : -1) * (field === 'w' ? 2.5 : 1);
        var s = DB.getSet(ui.date, id, idx);
        var val = Math.max(0, ((s && +s[field]) || 0) + delta);
        val = Math.round(val * 100) / 100;
        DB.updateSet(ui.date, id, idx, field, val);
        renderLog();
      }
    });

    // 直接入力（blur時に保存）
    $('#entries').addEventListener('change', function (e) {
      var input = e.target.closest('input[data-field]');
      if (!input) return;
      var entryEl = e.target.closest('.entry');
      var rowEl = e.target.closest('.set-row');
      if (!entryEl || !rowEl) return;
      var v = (input.value === '') ? '' : Math.max(0, parseFloat(input.value) || 0);
      DB.updateSet(ui.date, entryEl.dataset.entry, +rowEl.dataset.idx, input.dataset.field, v);
      renderLog();
    });
  }

  /* ================== 種目選択シート ================== */
  function openSheet() {
    exitSheetEdit();
    renderSheet();
    $('#backdrop').classList.add('show');
    $('#sheet').classList.add('show');
  }
  function closeSheet() {
    exitSheetEdit();
    $('#backdrop').classList.remove('show');
    $('#sheet').classList.remove('show');
  }
  function enterSheetEdit() {
    ui.sheetEdit = true;
    $('#sheetList').classList.add('editing');
    $('#sheetEditBar').classList.add('show');
    $('#sheetHeadTitle').textContent = '並べ替え';
  }
  function exitSheetEdit() {
    ui.sheetEdit = false;
    $('#sheetList').classList.remove('editing');
    $('#sheetEditBar').classList.remove('show');
    $('#sheetHeadTitle').textContent = '種目を追加';
  }
  function renderSheet() {
    $('#partChips').innerHTML = DB.PARTS.map(function (p) {
      return '<button class="pchip' + (p === ui.pickerPart ? ' active' : '') + '" data-part="' + esc(p) + '">' + esc(p) + '</button>';
    }).join('');

    var w = DB.getWorkout(ui.date);
    var added = {};
    ((w && w.entries) || []).forEach(function (e) { added[e.exId] = true; });

    // 器具ごとにグルーピングして表示
    var list = DB.getExercises().filter(function (x) { return x.part === ui.pickerPart; });
    var groups = {};
    list.forEach(function (x) {
      var k = x.equip || '';
      (groups[k] = groups[k] || []).push(x);
    });
    var order = DB.EQUIPS.concat(['']);
    var itemHtml = function (x) {
      return '<button class="sheet-item' + (added[x.id] ? ' added' : '') + '" data-ex="' + x.id + '">' +
        '<span class="sheet-item-name">' + esc(x.name) + '</span>' +
        '<span class="sheet-item-right">' +
          (added[x.id] ? '<span class="added-mark">追加済み ✓</span>' : '') +
          '<span class="sheet-info" data-info="' + x.id + '" aria-label="種目の情報">ⓘ</span>' +
          '<span class="sheet-grip" aria-label="長押しで並べ替え">' +
            '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 6.5h14M3 10h14M3 13.5h14"/></svg>' +
          '</span>' +
        '</span>' +
      '</button>';
    };
    $('#sheetList').innerHTML = list.length
      ? order.filter(function (k) { return groups[k]; }).map(function (k) {
          return '<h5 class="sheet-group">' + esc(k || '器具指定なし') + '</h5>' +
            '<div class="sheet-group-items" data-equip="' + esc(k) + '">' + groups[k].map(itemHtml).join('') + '</div>';
        }).join('')
      : '<p class="sheet-empty">この部位の種目はまだありません</p>';

    $('#sheetList').classList.toggle('editing', ui.sheetEdit);
    $('#sheetEditBar').classList.toggle('show', ui.sheetEdit);

    // 新規作成フォームの器具ドロップダウン（初回のみ生成）
    var eqSel = $('#sheetNewEquip');
    if (!eqSel.options.length) eqSel.innerHTML = equipOptions();
  }

  /* 並べ替え：現在の部位の表示順を state へ保存 */
  function saveSheetOrder() {
    var ids = [];
    $$('#sheetList .sheet-group-items .sheet-item').forEach(function (el) {
      if (el.dataset.ex) ids.push(el.dataset.ex);
    });
    if (ids.length) DB.reorderWithinPart(ui.pickerPart, ids);
  }

  /* ドラッグによる入れ替え（同じ器具グループ内で移動） */
  var sheetDrag = null;
  function startSheetDrag(itemEl, clientY) {
    sheetDrag = { el: itemEl, container: itemEl.parentNode, startY: clientY };
    itemEl.classList.add('drag-active');
    itemEl.style.pointerEvents = 'none';
    document.addEventListener('pointermove', onSheetDragMove, { passive: false });
    document.addEventListener('pointerup', onSheetDragEnd);
    document.addEventListener('pointercancel', onSheetDragEnd);
  }
  function onSheetDragMove(e) {
    if (!sheetDrag) return;
    e.preventDefault();
    var dy = e.clientY - sheetDrag.startY;
    sheetDrag.el.style.transform = 'translateY(' + dy + 'px)';
    var under = document.elementFromPoint(e.clientX, e.clientY);
    under = under && under.closest ? under.closest('.sheet-item') : null;
    if (under && under !== sheetDrag.el && under.parentNode === sheetDrag.container) {
      var rect = under.getBoundingClientRect();
      var before = e.clientY < rect.top + rect.height / 2;
      sheetDrag.container.insertBefore(sheetDrag.el, before ? under : under.nextSibling);
      sheetDrag.startY = e.clientY;
      sheetDrag.el.style.transform = 'translateY(0px)';
    }
  }
  function onSheetDragEnd() {
    if (!sheetDrag) return;
    sheetDrag.el.style.transform = '';
    sheetDrag.el.style.pointerEvents = '';
    sheetDrag.el.classList.remove('drag-active');
    document.removeEventListener('pointermove', onSheetDragMove);
    document.removeEventListener('pointerup', onSheetDragEnd);
    document.removeEventListener('pointercancel', onSheetDragEnd);
    sheetDrag = null;
    saveSheetOrder();
  }

  function bindSheet() {
    $('#backdrop').onclick = closeSheet;
    $('#sheetClose').onclick = closeSheet;
    $('#sheetEditDone').onclick = exitSheetEdit;

    $('#partChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-part]');
      if (!b) return;
      ui.pickerPart = b.dataset.part;
      renderSheet();
    });

    // グリップ操作：未編集時は長押しで編集モード＋そのままドラッグ開始、編集時は即ドラッグ
    $('#sheetList').addEventListener('pointerdown', function (e) {
      var grip = e.target.closest('.sheet-grip');
      if (!grip) return;
      var item = grip.closest('.sheet-item');
      if (!item) return;
      e.preventDefault();

      if (ui.sheetEdit) { startSheetDrag(item, e.clientY); return; }

      var sx = e.clientX, sy = e.clientY;
      var lpTimer = setTimeout(function () {
        cleanup();
        enterSheetEdit();
        startSheetDrag(item, sy);
        toast('並べ替えモード：ドラッグで入れ替え');
      }, 450);
      var onMove = function (ev) {
        if (Math.abs(ev.clientY - sy) > 10 || Math.abs(ev.clientX - sx) > 10) cleanup();
      };
      var onUp = function () { cleanup(); };
      var cleanup = function () {
        clearTimeout(lpTimer);
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });

    $('#sheetList').addEventListener('click', function (e) {
      if (ui.sheetEdit) return; // 編集モード中はタップで追加しない
      var info = e.target.closest('[data-info]');
      if (info) { openExInfo(info.dataset.info); return; }
      var b = e.target.closest('[data-ex]');
      if (!b) return;
      if (b.classList.contains('added')) { toast('この日はすでに追加済みです'); return; }
      DB.addEntry(ui.date, b.dataset.ex);
      closeSheet();
      renderLog();
    });

    $('#sheetNewAdd').onclick = function () {
      var name = $('#sheetNewName').value.trim();
      if (!name) { toast('種目名を入力してください'); return; }
      var equip = $('#sheetNewEquip').value;
      var ex = DB.addExercise(name, ui.pickerPart, equip);
      DB.addEntry(ui.date, ex.id);
      $('#sheetNewName').value = '';
      $('#sheetNewEquip').value = '';
      closeSheet();
      renderLog();
      toast('「' + name + (equip ? '（' + equip + '）' : '') + '」を追加しました');
    };
  }

  /* ================== 履歴タブ ================== */
  function renderHistory() {
    var dates = DB.datesWithData().slice().reverse();
    if (!dates.length) {
      $('#historyList').innerHTML =
        '<div class="placeholder"><div class="ph-icon">📓</div><p>まだ記録がありません</p></div>';
      return;
    }
    var html = '';
    var curMonth = '';
    dates.forEach(function (date) {
      var d = parseDate(date);
      var mKey = d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
      if (mKey !== curMonth) {
        curMonth = mKey;
        html += '<h4 class="month-h">' + mKey + '</h4>';
      }
      var w = DB.getWorkout(date);
      var parts = [];
      (w.entries || []).forEach(function (e) { if (parts.indexOf(e.part) < 0) parts.push(e.part); });
      var open = !!ui.expanded[date];

      html += '<div class="h-card' + (open ? ' open' : '') + '" data-date="' + date + '">' +
        '<button class="h-head">' +
          '<div class="h-top">' +
            '<span class="h-date num">' + (d.getMonth() + 1) + '/' + d.getDate() + '</span>' +
            '<span class="h-wd">(' + WD[d.getDay()] + ')</span>' +
            '<span class="h-parts">' + parts.map(partChip).join('') + '</span>' +
          '</div>' +
          '<div class="h-meta">' + (w.entries || []).length + '種目 · ' + workoutSets(w) + 'セット · VOL <b class="num">' + fmtNum(workoutVol(w)) + '</b> kg</div>' +
        '</button>' +
        (open ? hBodyHtml(w) : '') +
      '</div>';
    });
    $('#historyList').innerHTML = html;
  }

  function hBodyHtml(w) {
    var rows = (w.entries || []).map(function (e) {
      var setsStr = e.sets.map(function (s) { return (s.w || 0) + '×' + (s.r || 0); }).join(' / ') || '—';
      return '<div class="h-entry">' + partChip(e.part) + '<b>' + esc(e.name) + '</b>' + equipTag(e.equip) +
        '<span class="h-sets">' + esc(setsStr) + '</span></div>';
    }).join('');
    return '<div class="h-body">' + rows +
      (w.memo ? '<p class="h-memo">' + esc(w.memo) + '</p>' : '') +
      '<div class="h-actions">' +
        '<button class="link" data-action="open-day">この日を開く</button>' +
        '<button class="link danger" data-action="del-day">この日の記録を削除</button>' +
      '</div>' +
    '</div>';
  }

  function bindHistory() {
    $('#historyList').addEventListener('click', function (e) {
      var card = e.target.closest('.h-card');
      if (!card) return;
      var date = card.dataset.date;
      var act = e.target.closest('[data-action]');
      if (act) {
        if (act.dataset.action === 'open-day') {
          ui.date = date;
          switchTab('log');
        } else if (act.dataset.action === 'del-day') {
          if (confirm(date + ' の記録をすべて削除しますか？')) {
            DB.deleteWorkout(date);
            delete ui.expanded[date];
            renderHistory();
            toast('削除しました');
          }
        }
        return;
      }
      if (e.target.closest('.h-head')) {
        ui.expanded[date] = !ui.expanded[date];
        renderHistory();
      }
    });
  }

  /* ================== 設定タブ ================== */
  function renderSettings() {
    var sel = $('#newExPart');
    if (!sel.options.length) {
      sel.innerHTML = DB.PARTS.map(function (p) {
        return '<option value="' + esc(p) + '">' + esc(p) + '</option>';
      }).join('');
    }
    var eqSel = $('#newExEquip');
    if (!eqSel.options.length) eqSel.innerHTML = equipOptions();

    var byPart = {};
    DB.getExercises().forEach(function (x) {
      (byPart[x.part] = byPart[x.part] || []).push(x);
    });
    var equipOrder = DB.EQUIPS.concat(['']);
    $('#exList').innerHTML = DB.PARTS.filter(function (p) { return byPart[p] && byPart[p].length; }).map(function (p) {
      // 部位内は器具順に並べる
      var sorted = byPart[p].slice().sort(function (a, b) {
        return equipOrder.indexOf(a.equip || '') - equipOrder.indexOf(b.equip || '');
      });
      return '<h5 class="ex-part">' + esc(p) + '</h5><div class="panel-list">' +
        sorted.map(function (x) {
          return '<div class="s-row" data-ex="' + x.id + '">' +
            '<div class="s-main" data-action="info-ex"><b>' + esc(x.name) + equipTag(x.equip) + '</b></div>' +
            '<button class="link" data-action="rename">名称変更</button>' +
            '<button class="link danger" data-action="del-ex">削除</button>' +
          '</div>';
        }).join('') +
      '</div>';
    }).join('');
    $('#storageInfo').textContent = 'ブラウザ内に保存中 · 約 ' + DB.sizeKB() + ' KB';
  }

  function bindSettings() {
    $('#addExBtn').onclick = function () {
      var name = $('#newExName').value.trim();
      if (!name) { toast('種目名を入力してください'); return; }
      DB.addExercise(name, $('#newExPart').value, $('#newExEquip').value);
      $('#newExName').value = '';
      $('#newExEquip').value = '';
      renderSettings();
      toast('種目を追加しました');
    };

    $('#exList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var row = e.target.closest('[data-ex]');
      if (!row) return;
      var ex = DB.getExercise(row.dataset.ex);
      if (!ex) return;
      if (btn.dataset.action === 'info-ex') {
        openExInfo(ex.id);
      } else if (btn.dataset.action === 'rename') {
        var name = prompt('新しい種目名', ex.name);
        if (name && name.trim()) {
          DB.renameExercise(ex.id, name.trim());
          renderSettings();
        }
      } else if (btn.dataset.action === 'del-ex') {
        if (confirm('「' + ex.name + '」を種目リストから削除しますか？\n（過去の記録はそのまま残ります）')) {
          DB.deleteExercise(ex.id);
          renderSettings();
        }
      }
    });

    $('#exportCsvBtn').onclick = exportCSV;

    $('#wipeBtn').onclick = function () {
      if (!confirm('すべての記録・種目データを削除します。よろしいですか？')) return;
      if (!confirm('本当に削除しますか？ この操作は取り消せません。')) return;
      DB.wipe();
      ui.expanded = {};
      renderLog();
      renderSettings();
      toast('データを初期化しました');
    };
  }

  /* ================== CSVエクスポート ================== */
  function exportCSV() {
    var dates = DB.datesWithData();
    if (!dates.length) { toast('書き出す記録がありません'); return; }
    var head = ['日付', '曜日', '部位', '種目', '器具', 'セット', '重量kg', '回数', 'ボリュームkg', 'メモ'];
    var lines = [head.join(',')];
    var csv = function (v) {
      v = String(v == null ? '' : v);
      return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    dates.forEach(function (date) {
      var w = DB.getWorkout(date);
      var d = parseDate(date);
      (w.entries || []).forEach(function (e) {
        e.sets.forEach(function (s, i) {
          lines.push([
            date, WD[d.getDay()], e.part, e.name, e.equip || '', i + 1,
            s.w === '' ? '' : s.w,
            s.r === '' ? '' : s.r,
            (+s.w || 0) * (+s.r || 0),
            w.memo || ''
          ].map(csv).join(','));
        });
      });
    });
    var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv' }); // BOM付きでExcel文字化け防止
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '筋トレ記録_' + DB.todayStr() + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('CSVを書き出しました');
  }

  /* ================== RM計算機 ================== */
  var calc = { w: 60, r: 1, inited: false };
  var DIAL_PX = 6;      // 0.1kg あたりのピクセル幅
  var DIAL_MAX = 300;   // ダイヤルの最大kg

  function rmCoef(n) { return 1 + 0.0244 * (n - 1); }

  function calcInit() {
    if (calc.inited) { renderCalcResult(); return; }
    calc.inited = true;

    // ダイヤルの目盛りトラックを生成（1kgごとに数字ラベル）
    var track = $('#dialTrack');
    track.style.width = (DIAL_MAX * 10 * DIAL_PX) + 'px';
    var labels = '';
    for (var i = 0; i <= DIAL_MAX; i++) {
      labels += '<span class="dial-num num" style="left:' + (i * 10 * DIAL_PX) + 'px">' + i + '</span>';
    }
    track.innerHTML = labels;

    // スクロール位置 → 重量（0.1kg刻み）
    var scroll = $('#dialScroll');
    var ticking = false;
    scroll.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var v = Math.round(scroll.scrollLeft / DIAL_PX) / 10;
        v = Math.max(0, Math.min(DIAL_MAX, v));
        if (v !== calc.w) { calc.w = v; renderCalcResult(); }
      });
    });

    // マウスでの左右ドラッグに対応（タッチはネイティブのスワイプがそのまま効く）
    var drag = { active: false, startX: 0, startScroll: 0 };
    scroll.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return; // タッチはネイティブスクロールに任せる
      drag.active = true;
      drag.startX = e.clientX;
      drag.startScroll = scroll.scrollLeft;
      scroll.classList.add('dragging');
      scroll.setPointerCapture(e.pointerId);
    });
    scroll.addEventListener('pointermove', function (e) {
      if (!drag.active) return;
      scroll.scrollLeft = drag.startScroll - (e.clientX - drag.startX);
    });
    var endDrag = function () {
      if (!drag.active) return;
      drag.active = false;
      scroll.classList.remove('dragging');
    };
    scroll.addEventListener('pointerup', endDrag);
    scroll.addEventListener('pointercancel', endDrag);
    // マウスホイールの縦回転を横スクロールに変換（デスクトップの操作性向上）
    scroll.addEventListener('wheel', function (e) {
      if (e.deltaY === 0) return;
      e.preventDefault();
      scroll.scrollLeft += e.deltaY;
    }, { passive: false });

    $('#repsMinus').onclick = function () { calc.r = Math.max(1, calc.r - 1); renderCalcResult(); };
    $('#repsPlus').onclick = function () { calc.r = Math.min(30, calc.r + 1); renderCalcResult(); };

    scroll.scrollLeft = Math.round(calc.w * 10 * DIAL_PX);
    renderCalcResult();
  }

  function renderCalcResult() {
    $('#calcWeightVal').innerHTML = calc.w.toFixed(1) + '<small> kg</small>';
    $('#calcRepsVal').textContent = calc.r;
    var rm = calc.w * rmCoef(calc.r);
    var rows = '';
    for (var n = 1; n <= 12; n++) {
      var wn = Math.round((rm / rmCoef(n)) * 100) / 100;
      rows += '<div class="rm-row' + (n === calc.r ? ' current' : '') + '">' +
        '<span class="rm-cat">' + (n <= 3 ? '筋力アップ' : '筋肥大') + '</span>' +
        '<span class="rm-reps"><b class="num">' + n + '</b> Reps</span>' +
        '<span class="rm-w"><b class="num">' + wn + '</b> kg</span>' +
      '</div>';
    }
    $('#calcTable').innerHTML = rows;
  }

  /* ================== タブ切り替え・初期化 ================== */
  function switchTab(tab) {
    ui.tab = tab;
    $$('#tabbar button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + tab); });
    if (tab === 'log') renderLog(true);
    else if (tab === 'history') renderHistory();
    else if (tab === 'calc') calcInit();
    else if (tab === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }

  $$('#tabbar button').forEach(function (b) {
    b.addEventListener('click', function () { switchTab(b.dataset.tab); });
  });

  bindLog();
  bindSheet();
  bindHistory();
  bindSettings();
  bindExInfo();
  bindDrum();
  renderLog(true);
})();
