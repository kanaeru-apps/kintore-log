/* ============================================================
   app.js — 画面制御・レンダリング・イベント
   ============================================================ */
'use strict';

(function () {
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var PART_CLASS = { '胸': 'chest', '背中': 'back', '脚': 'leg', '肩': 'shoulder', '腕': 'arm', '腹': 'core', '有酸素': 'cardio', 'その他': 'etc' };
  var CARDIO_PART = '有酸素';
  /* 有酸素カードで表示する記録項目（時間は時/分/秒ホイールの専用ボタンで別扱い） */
  var CARDIO_FIELDS = [
    { k: 'd', label: '距離', unit: 'km', step: '0.1' },
    { k: 'sp', label: '速度', unit: 'km/h', step: '0.1' },
    { k: 'inc', label: '傾斜', unit: '%', step: '1' },
    { k: 'cal', label: 'カロリー', unit: 'kcal', step: '1' },
    { k: 'hr', label: '心拍', unit: 'bpm', step: '1' }
  ];
  /* 実施セット判定・CSV用の全キー（時間は t=分・ts=秒 の2フィールド） */
  var CARDIO_KEYS_ALL = ['t', 'ts'].concat(CARDIO_FIELDS.map(function (f) { return f.k; }));
  function isCardio(e) { return e && e.part === CARDIO_PART; }
  /* 時間(分)+秒 を「1時間05分30秒」のように整形。未入力ならnull */
  function fmtCardioTime(s) {
    if (s.t === '' && s.ts === '') return null;
    var t = +s.t || 0, ts = +s.ts || 0;
    var h = Math.floor(t / 60), m = t % 60;
    var mm = h > 0 ? ('0' + m).slice(-2) : String(m);
    var ss = ('0' + ts).slice(-2);
    return (h > 0 ? h + '時間' : '') + mm + '分' + ss + '秒';
  }

  var ui = { tab: 'log', date: DB.todayStr(), pickerPart: '胸', expanded: {}, sheetEdit: false, exExpanded: {} };
  var dateCal = { year: null, month: null };

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
  /* 何か1項目でも入力されたセットだけを「実施セット」として数える（有酸素は7項目のいずれか） */
  function filledSets(e) {
    if (isCardio(e)) {
      return e.sets.filter(function (s) {
        return CARDIO_KEYS_ALL.some(function (k) { return (+s[k] || 0) > 0; });
      });
    }
    return e.sets.filter(function (s) { return (+s.w || 0) > 0 || (+s.r || 0) > 0; });
  }
  function workoutSets(w) {
    return (w.entries || []).reduce(function (a, e) { return a + filledSets(e).length; }, 0);
  }
  function dayStats(w) {
    var st = { ex: 0, sets: 0, reps: 0, vol: 0, time: 0, dist: 0, hasStr: false, hasCardio: false };
    ((w && w.entries) || []).forEach(function (e) {
      var f = filledSets(e);
      if (f.length) st.ex++;
      st.sets += f.length;
      if (isCardio(e)) {
        if (f.length) st.hasCardio = true;
        f.forEach(function (s) {
          st.time += (+s.t || 0);
          st.dist += (+s.d || 0);
        });
      } else {
        if (f.length) st.hasStr = true;
        f.forEach(function (s) {
          st.reps += (+s.r || 0);
          st.vol += (+s.w || 0) * (+s.r || 0);
        });
      }
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
  /* ---------- ダンベルSVG（空状態アイコン・ソリッド） ---------- */
  function dumbbellSvg() {
    return '<svg class="dumbbell-ic" viewBox="0 0 140 72" fill="currentColor" aria-hidden="true">' +
      '<rect x="17" y="27" width="9" height="18" rx="4"/>' +
      '<rect x="28" y="20" width="13" height="32" rx="5"/>' +
      '<rect x="43" y="14" width="12" height="44" rx="5"/>' +
      '<rect x="55" y="31" width="30" height="10" rx="5"/>' +
      '<rect x="85" y="14" width="12" height="44" rx="5"/>' +
      '<rect x="99" y="20" width="13" height="32" rx="5"/>' +
      '<rect x="114" y="27" width="9" height="18" rx="4"/>' +
      '<g fill="#0b0c0f" opacity="0.28">' +
        '<rect x="63" y="33" width="2" height="6" rx="1"/>' +
        '<rect x="69" y="33" width="2" height="6" rx="1"/>' +
        '<rect x="75" y="33" width="2" height="6" rx="1"/>' +
      '</g>' +
    '</svg>';
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
    // 直接入力欄にも反映（入力中（フォーカス中）は上書きしない）
    var input = $('#drumDirectInput');
    if (input && document.activeElement !== input) input.value = drumFmt(index * DRUM_STEP);
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
    var cur = (s && s.w !== '' && s.w != null) ? +s.w : 50; // 空なら50kgから
    cur = Math.max(0, Math.min(DRUM_MAX, cur));
    var index = Math.round(cur / DRUM_STEP);

    var w = DB.getWorkout(ui.date);
    var ent = ((w && w.entries) || []).filter(function (x) { return x.id === entryId; })[0];
    $('#drumTitle').textContent = (ent ? ent.name : '') + '　' + (idx + 1) + 'セット目';

    $('#drumBackdrop').classList.add('show');
    $('#drumSheet').classList.add('show');
    $('#drumDirectInput').value = drumFmt(index * DRUM_STEP);

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

    // 数字の直接入力 → ホイールをその値へスクロールして同期させる
    $('#drumDirectInput').addEventListener('input', function (e) {
      var v = parseFloat(e.target.value);
      if (isNaN(v)) return;
      v = Math.max(0, Math.min(DRUM_MAX, v));
      var index = Math.round(v / DRUM_STEP);
      scroll.scrollTop = index * DRUM_ITEM_H;
      setDrumSel(index);
    });
  }

  /* ================== 有酸素：時間（時/分/秒）ピッカー ================== */
  var CTIME_ITEM_H = 44;
  var CTIME_H_MAX = 5;    // 0〜5時間
  var CTIME_MS_MAX = 59;  // 分・秒は0〜59
  var ctimeTarget = null; // { entryId, idx }
  var ctimeSel = { h: -1, m: -1, s: -1 };
  var ctimeBuilt = false;
  var CTIME_LIST_ID = { h: '#ctimeHList', m: '#ctimeMList', s: '#ctimeSList' };
  var CTIME_SCROLL_ID = { h: '#ctimeHScroll', m: '#ctimeMScroll', s: '#ctimeSScroll' };
  var CTIME_INPUT_ID = { h: '#ctimeHInput', m: '#ctimeMInput', s: '#ctimeSInput' };

  function ctimeBuildLists() {
    if (ctimeBuilt) return;
    var hHtml = '', mHtml = '', sHtml = '';
    for (var h = 0; h <= CTIME_H_MAX; h++) hHtml += '<div class="drum-item num">' + h + '</div>';
    for (var i = 0; i <= CTIME_MS_MAX; i++) {
      var v = ('0' + i).slice(-2);
      mHtml += '<div class="drum-item num">' + v + '</div>';
      sHtml += '<div class="drum-item num">' + v + '</div>';
    }
    $('#ctimeHList').innerHTML = hHtml;
    $('#ctimeMList').innerHTML = mHtml;
    $('#ctimeSList').innerHTML = sHtml;
    ctimeBuilt = true;
  }

  function ctimeSetSel(col, index) {
    if (ctimeSel[col] === index) return;
    var kids = $(CTIME_LIST_ID[col]).children;
    if (ctimeSel[col] >= 0 && kids[ctimeSel[col]]) kids[ctimeSel[col]].classList.remove('sel');
    if (kids[index]) kids[index].classList.add('sel');
    ctimeSel[col] = index;
    var input = $(CTIME_INPUT_ID[col]);
    if (input && document.activeElement !== input) input.value = (col === 'h') ? String(index) : ('0' + index).slice(-2);
  }

  function ctimeIndexFromScroll(col, max) {
    var scroll = $(CTIME_SCROLL_ID[col]);
    var index = Math.round(scroll.scrollTop / CTIME_ITEM_H);
    return Math.max(0, Math.min(max, index));
  }

  function openCtime(entryId, idx) {
    ctimeBuildLists();
    ctimeTarget = { entryId: entryId, idx: idx };

    var s = DB.getSet(ui.date, entryId, idx);
    var t = (s && s.t !== '' && s.t != null) ? +s.t : 0;
    var ts = (s && s.ts !== '' && s.ts != null) ? +s.ts : 0;
    var h = Math.max(0, Math.min(CTIME_H_MAX, Math.floor(t / 60)));
    var m = Math.max(0, Math.min(CTIME_MS_MAX, t % 60));
    var sec = Math.max(0, Math.min(CTIME_MS_MAX, ts));

    var w = DB.getWorkout(ui.date);
    var ent = ((w && w.entries) || []).filter(function (x) { return x.id === entryId; })[0];
    $('#ctimeTitle').textContent = (ent ? ent.name : '') + '　' + (idx + 1) + 'セッション目';

    $('#ctimeBackdrop').classList.add('show');
    $('#ctimeSheet').classList.add('show');
    $('#ctimeHInput').value = String(h);
    $('#ctimeMInput').value = ('0' + m).slice(-2);
    $('#ctimeSInput').value = ('0' + sec).slice(-2);

    ctimeSel = { h: -1, m: -1, s: -1 };
    requestAnimationFrame(function () {
      $('#ctimeHScroll').scrollTop = h * CTIME_ITEM_H;
      $('#ctimeMScroll').scrollTop = m * CTIME_ITEM_H;
      $('#ctimeSScroll').scrollTop = sec * CTIME_ITEM_H;
      ctimeSetSel('h', h);
      ctimeSetSel('m', m);
      ctimeSetSel('s', sec);
    });
  }

  function closeCtime(commit) {
    if (commit && ctimeTarget) {
      var h = ctimeSel.h >= 0 ? ctimeSel.h : 0;
      var m = ctimeSel.m >= 0 ? ctimeSel.m : 0;
      var sec = ctimeSel.s >= 0 ? ctimeSel.s : 0;
      DB.updateSet(ui.date, ctimeTarget.entryId, ctimeTarget.idx, 't', h * 60 + m);
      DB.updateSet(ui.date, ctimeTarget.entryId, ctimeTarget.idx, 'ts', sec);
    }
    $('#ctimeBackdrop').classList.remove('show');
    $('#ctimeSheet').classList.remove('show');
    ctimeTarget = null;
    if (commit) renderLog();
  }

  function bindCtimeCol(col, max) {
    var scroll = $(CTIME_SCROLL_ID[col]);
    var ticking = false;
    scroll.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; ctimeSetSel(col, ctimeIndexFromScroll(col, max)); });
    });
    var drag = { active: false, startY: 0, startScroll: 0 };
    scroll.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return;
      drag.active = true; drag.startY = e.clientY; drag.startScroll = scroll.scrollTop;
      scroll.setPointerCapture(e.pointerId);
    });
    scroll.addEventListener('pointermove', function (e) {
      if (!drag.active) return;
      scroll.scrollTop = drag.startScroll - (e.clientY - drag.startY);
    });
    var endDrag = function () {
      if (!drag.active) return;
      drag.active = false;
      var index = ctimeIndexFromScroll(col, max);
      scroll.scrollTop = index * CTIME_ITEM_H;
      ctimeSetSel(col, index);
    };
    scroll.addEventListener('pointerup', endDrag);
    scroll.addEventListener('pointercancel', endDrag);
  }

  function bindCtime() {
    bindCtimeCol('h', CTIME_H_MAX);
    bindCtimeCol('m', CTIME_MS_MAX);
    bindCtimeCol('s', CTIME_MS_MAX);

    $('#ctimeDone').onclick = function () { closeCtime(true); };
    $('#ctimeCancel').onclick = function () { closeCtime(false); };
    $('#ctimeBackdrop').onclick = function () { closeCtime(false); };

    function bindDirectInput(col, max) {
      $(CTIME_INPUT_ID[col]).addEventListener('input', function (e) {
        var v = parseInt(e.target.value, 10);
        if (isNaN(v)) return;
        v = Math.max(0, Math.min(max, v));
        $(CTIME_SCROLL_ID[col]).scrollTop = v * CTIME_ITEM_H;
        ctimeSetSel(col, v);
      });
    }
    bindDirectInput('h', CTIME_H_MAX);
    bindDirectInput('m', CTIME_MS_MAX);
    bindDirectInput('s', CTIME_MS_MAX);
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

    var w = DB.getWorkout(ui.date);

    // 日メモ（入力中は上書きしない）
    var memoEl = $('#dayMemo');
    if (document.activeElement !== memoEl) memoEl.value = (w && w.memo) ? w.memo : '';

    // サマリータイル（内容がある種類だけ表示。筋トレ=レップ/負荷量、有酸素=時間/距離）
    var st = dayStats(w);
    var tiles = statTile('合計種目数', st.ex) + statTile('合計セット数', st.sets);
    if (st.hasStr) tiles += statTile('合計レップ数', st.reps) + statTile('合計負荷量', fmtNum(st.vol), 'kg');
    if (st.hasCardio) tiles += statTile('合計時間', fmtNum(st.time), '分') + statTile('合計距離', fmtNum(st.dist), 'km');
    if (!st.hasStr && !st.hasCardio) tiles += statTile('合計レップ数', 0) + statTile('合計負荷量', 0, 'kg');
    $('#dayStats').innerHTML = tiles;

    // 種目カード
    var entries = (w && w.entries) || [];
    if (!entries.length) {
      $('#entries').innerHTML =
        '<div class="empty"><div class="ph-icon">' + dumbbellSvg() + '</div><p>まだ記録がありません。<br>「＋ 種目を追加」からはじめましょう。</p></div>';
    } else {
      $('#entries').innerHTML = entries.map(entryHtml).join('');
    }
  }

  function entryHtml(e, i) {
    return isCardio(e) ? cardioEntryHtml(e, i) : strengthEntryHtml(e, i);
  }

  /* カード見出し（部位チップ・種目名・削除ボタン）は共通 */
  function entryHead(e) {
    return '<div class="entry-head">' + partChip(e.part) +
      '<h3 data-action="ex-info">' + esc(e.name) + equipTag(e.equip) + '<span class="info-hint">ⓘ</span></h3>' +
      '<button class="link danger" data-action="del-entry">削除</button></div>';
  }

  /* 前回記録の参考表示（部位で表示内容を変える） */
  function prevLine(e) {
    var prev = DB.prevRecord(e.exId, ui.date);
    if (!prev) return '';
    var pd = parseDate(prev.date);
    var body;
    if (isCardio(e)) {
      body = prev.sets.map(function (s) {
        var parts = [];
        if (+s.t) parts.push(esc(s.t) + '分');
        if (+s.d) parts.push(esc(s.d) + 'km');
        if (+s.cal) parts.push(esc(s.cal) + 'kcal');
        return parts.join(' ') || '—';
      }).join(' / ');
    } else {
      body = prev.sets.map(function (s) { return esc(s.w || 0) + '×' + esc(s.r || 0); }).join(' / ');
    }
    return '<p class="prev"><span>前回 ' + (pd.getMonth() + 1) + '/' + pd.getDate() + '</span>' + body + '</p>';
  }

  /* 筋トレ種目：重量kg × 回数 */
  function strengthEntryHtml(e, i) {
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
      entryHead(e) +
      prevLine(e) +
      '<div class="sets">' + rows + '</div>' +
      '<div class="entry-foot">' +
        '<button class="btn ghost small" data-action="add-set">＋ セット追加</button>' +
        '<span class="vol">VOL <b class="num">' + fmtNum(setVol(e.sets)) + '</b> kg</span>' +
      '</div>' +
    '</article>';
  }

  /* 有酸素種目：時間・距離・速度・傾斜・カロリー・心拍 */
  function cardioEntryHtml(e, i) {
    var rows = e.sets.map(function (s, idx) {
      var timeVal = fmtCardioTime(s);
      var timeCell = '<label class="cf">' +
        '<span class="cf-label">時間</span>' +
        '<span class="cf-inputwrap">' +
          '<button class="cf-time-btn num' + (timeVal ? '' : ' empty') + '" data-action="ctime-open" type="button">' + (timeVal || '分') + '</button>' +
        '</span>' +
      '</label>';
      var cells = timeCell + CARDIO_FIELDS.map(function (f) {
        return '<label class="cf">' +
          '<span class="cf-label">' + f.label + '</span>' +
          '<span class="cf-inputwrap">' +
            '<input type="number" inputmode="decimal" step="' + f.step + '" min="0" data-field="' + f.k + '" value="' + esc(s[f.k]) + '" placeholder="0">' +
            '<span class="cf-unit">' + f.unit + '</span>' +
          '</span>' +
        '</label>';
      }).join('');
      return '<div class="cardio-set" data-idx="' + idx + '">' +
        '<div class="cardio-set-head">' +
          '<span class="set-no num">' + (idx + 1) + '</span>' +
          '<span class="cardio-set-label">セッション ' + (idx + 1) + '</span>' +
          '<button class="set-del" data-action="del-set" aria-label="セッション削除">✕</button>' +
        '</div>' +
        '<div class="cardio-grid">' + cells + '</div>' +
      '</div>';
    }).join('');

    var totT = 0, totD = 0;
    e.sets.forEach(function (s) { totT += (+s.t || 0); totD += (+s.d || 0); });

    return '<article class="entry" data-entry="' + e.id + '" style="animation-delay:' + Math.min(i * 50, 300) + 'ms">' +
      entryHead(e) +
      prevLine(e) +
      '<div class="sets cardio-sets">' + rows + '</div>' +
      '<div class="entry-foot">' +
        '<button class="btn ghost small" data-action="add-set">＋ セッション追加</button>' +
        '<span class="vol">計 <b class="num">' + fmtNum(totT) + '</b>分 · <b class="num">' + fmtNum(totD) + '</b>km</span>' +
      '</div>' +
    '</article>';
  }

  /* ================== 日付選択カレンダー（記録タブの日付タップで表示） ================== */
  /* 何かしら記録した日（部位を問わない）の集合を返す */
  function trainedDatesAny() {
    var set = {};
    DB.datesWithData().forEach(function (date) {
      var w = DB.getWorkout(date);
      var any = (w.entries || []).some(function (e) { return filledSets(e).length > 0; });
      if (any) set[date] = true;
    });
    return set;
  }
  function renderDateCal() {
    var y = dateCal.year, m = dateCal.month;
    var first = new Date(y, m, 1);
    var startDow = first.getDay();
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var prevDays = new Date(y, m, 0).getDate();
    var trained = trainedDatesAny();
    var todayStr = DB.todayStr();

    var cells = '';
    for (var i = 0; i < startDow; i++) {
      cells += '<span class="cal-day other-month">' + (prevDays - startDow + 1 + i) + '</span>';
    }
    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = y + '-' + ('0' + (m + 1)).slice(-2) + '-' + ('0' + d).slice(-2);
      var cls = 'cal-day';
      if (trained[dateStr]) cls += ' trained';
      if (dateStr === todayStr) cls += ' today';
      if (dateStr === ui.date) cls += ' selected';
      cells += '<span class="' + cls + '" data-date="' + dateStr + '">' + d + '</span>';
    }
    var total = startDow + daysInMonth;
    var trailing = (7 - (total % 7)) % 7;
    for (var j = 1; j <= trailing; j++) cells += '<span class="cal-day other-month">' + j + '</span>';

    $('#dateCalGrid').innerHTML = cells;
    $('#dateCalMonthLabel').textContent = y + '年' + (m + 1) + '月';
  }
  function shiftDateCalMonth(delta) {
    var d = new Date(dateCal.year, dateCal.month + delta, 1);
    dateCal.year = d.getFullYear();
    dateCal.month = d.getMonth();
    renderDateCal();
  }
  function openDateCal() {
    var d = parseDate(ui.date);
    dateCal.year = d.getFullYear();
    dateCal.month = d.getMonth();
    renderDateCal();
    $('#dateCalBackdrop').classList.add('show');
    $('#dateCalSheet').classList.add('show');
  }
  function closeDateCal() {
    $('#dateCalBackdrop').classList.remove('show');
    $('#dateCalSheet').classList.remove('show');
  }
  function bindDateCal() {
    $('#dateCalPrev').onclick = function () { shiftDateCalMonth(-1); };
    $('#dateCalNext').onclick = function () { shiftDateCalMonth(1); };
    $('#dateCalClose').onclick = closeDateCal;
    $('#dateCalBackdrop').onclick = closeDateCal;
    $('#dateCalToday').onclick = function () {
      ui.date = DB.todayStr();
      closeDateCal();
      renderLog(true);
    };
    $('#dateCalGrid').addEventListener('click', function (e) {
      var el = e.target.closest('[data-date]');
      if (!el) return;
      ui.date = el.dataset.date;
      closeDateCal();
      renderLog(true);
    });
  }

  function bindLog() {
    $('#prevDay').onclick = function () { ui.date = shiftDate(ui.date, -1); renderLog(true); };
    $('#nextDay').onclick = function () { ui.date = shiftDate(ui.date, 1); renderLog(true); };
    $('#todayBtn').onclick = function () { ui.date = DB.todayStr(); renderLog(true); };
    $('#dateLabel').onclick = openDateCal;
    bindDateCal();

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
      var rowEl = e.target.closest('[data-idx]');
      var idx = rowEl ? +rowEl.dataset.idx : -1;
      var a = btn.dataset.action;

      if (a === 'ex-info') {
        var wi = DB.getWorkout(ui.date);
        var enti = ((wi && wi.entries) || []).filter(function (x) { return x.id === id; })[0];
        if (enti) openExInfo(enti.exId, enti);
      } else if (a === 'w-drum') {
        openDrum(id, idx);
      } else if (a === 'ctime-open') {
        openCtime(id, idx);
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
      var rowEl = e.target.closest('[data-idx]');
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
      if (DB.findExercise(name, ui.pickerPart, equip)) {
        toast('「' + name + (equip ? '（' + equip + '）' : '') + '」はすでに登録されています');
        return;
      }
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
      var setsStr;
      if (isCardio(e)) {
        setsStr = e.sets.map(function (s) {
          var parts = [];
          if (+s.t) parts.push(s.t + '分');
          if (+s.d) parts.push(s.d + 'km');
          if (+s.cal) parts.push(s.cal + 'kcal');
          return parts.join(' ') || '—';
        }).join(' / ') || '—';
      } else {
        setsStr = e.sets.map(function (s) { return (s.w || 0) + '×' + (s.r || 0); }).join(' / ') || '—';
      }
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
      // 部位内は種目名のあいうえお順（同名なら器具順）に並べる → 同名種目が離れずまとまる
      var sorted = byPart[p].slice().sort(function (a, b) {
        var byName = a.name.localeCompare(b.name, 'ja');
        if (byName !== 0) return byName;
        return equipOrder.indexOf(a.equip || '') - equipOrder.indexOf(b.equip || '');
      });
      var open = !!ui.exExpanded[p];
      return '<button class="ex-part' + (open ? ' open' : '') + '" data-part="' + esc(p) + '" type="button">' +
        '<span>' + esc(p) + '</span>' +
        '<span class="ex-part-count">' + sorted.length + '件</span>' +
        '<span class="ex-part-arrow">›</span>' +
      '</button>' +
      (open ? '<div class="panel-list">' + sorted.map(function (x) {
        return '<div class="s-row" data-ex="' + x.id + '">' +
          '<div class="s-main" data-action="info-ex"><b>' + esc(x.name) + equipTag(x.equip) + '</b></div>' +
          '<button class="link" data-action="rename">名称変更</button>' +
          '<button class="link danger" data-action="del-ex">削除</button>' +
        '</div>';
      }).join('') + '</div>' : '');
    }).join('');
    $('#storageInfo').textContent = 'ブラウザ内に保存中 · 約 ' + DB.sizeKB() + ' KB';
  }

  function bindSettings() {
    $('#addExBtn').onclick = function () {
      var name = $('#newExName').value.trim();
      if (!name) { toast('種目名を入力してください'); return; }
      var part = $('#newExPart').value;
      var equip = $('#newExEquip').value;
      if (DB.findExercise(name, part, equip)) {
        toast('「' + name + (equip ? '（' + equip + '）' : '') + '」はすでに登録されています');
        return;
      }
      DB.addExercise(name, part, equip);
      $('#newExName').value = '';
      $('#newExEquip').value = '';
      // 追加した部位だけを開いた状態にする（他は閉じる）
      ui.exExpanded = {};
      ui.exExpanded[part] = true;
      renderSettings();
      toast('種目を追加しました');
    };

    $('#exList').addEventListener('click', function (e) {
      var partBtn = e.target.closest('.ex-part');
      if (partBtn) {
        var p = partBtn.dataset.part;
        ui.exExpanded[p] = !ui.exExpanded[p];
        renderSettings();
        return;
      }
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
      ui.exExpanded = {};
      renderLog();
      renderSettings();
      toast('データを初期化しました');
    };
  }

  /* ================== CSVエクスポート ================== */
  function exportCSV() {
    var dates = DB.datesWithData();
    if (!dates.length) { toast('書き出す記録がありません'); return; }
    var head = ['日付', '曜日', '部位', '種目', '器具', 'セット',
      '重量kg', '回数', 'ボリュームkg',
      '時間min', '時間秒', '距離km', '速度kmh', '傾斜%', 'カロリーkcal', '心拍bpm', 'メモ'];
    var lines = [head.join(',')];
    var csv = function (v) {
      v = String(v == null ? '' : v);
      return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var val = function (x) { return (x === '' || x == null) ? '' : x; };
    dates.forEach(function (date) {
      var w = DB.getWorkout(date);
      var d = parseDate(date);
      (w.entries || []).forEach(function (e) {
        var cardio = isCardio(e);
        e.sets.forEach(function (s, i) {
          lines.push([
            date, WD[d.getDay()], e.part, e.name, e.equip || '', i + 1,
            cardio ? '' : val(s.w),
            cardio ? '' : val(s.r),
            cardio ? '' : (+s.w || 0) * (+s.r || 0),
            cardio ? val(s.t) : '',
            cardio ? val(s.ts) : '',
            cardio ? val(s.d) : '',
            cardio ? val(s.sp) : '',
            cardio ? val(s.inc) : '',
            cardio ? val(s.cal) : '',
            cardio ? val(s.hr) : '',
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

  /* ================== インターバルタイマー ================== */
  var TW_ITEM_H = 44;     // ホイール各項目の高さ(px)。CSSと一致させること
  var TW_MAX_MIN = 15;    // カスタムの最大（分）
  var timer = {
    total: 0, endAt: 0, remaining: 0,
    running: false, paused: false, finished: false,
    tick: null, wakeLock: null, audioCtx: null, beepNodes: [],
    customMin: 3,
    twBuilt: false, twBound: false, twSel: -1
  };

  var SOUND_PATTERNS = [
    { key: 'beep', label: 'ビープ（現在の音）' },
    { key: 'bell', label: 'ベル' },
    { key: 'chime', label: 'チャイム' },
    { key: 'digital', label: '電子音' },
    { key: 'soft', label: 'ソフト' }
  ];
  var timerSettings = { sound: 'beep', soundOn: true, vibrateOn: true, notifyOn: true };

  function loadTimerSettings() {
    try {
      var s = localStorage.getItem('kintore_timer_sound');
      if (s && SOUND_PATTERNS.some(function (p) { return p.key === s; })) timerSettings.sound = s;
      var on = localStorage.getItem('kintore_timer_sound_on');
      if (on !== null) timerSettings.soundOn = on === '1';
      var vib = localStorage.getItem('kintore_timer_vibrate_on');
      if (vib !== null) timerSettings.vibrateOn = vib === '1';
      var nt = localStorage.getItem('kintore_timer_notify_on');
      if (nt !== null) timerSettings.notifyOn = nt === '1';
    } catch (e) { /* noop */ }
  }
  function saveTimerSettings() {
    try {
      localStorage.setItem('kintore_timer_sound', timerSettings.sound);
      localStorage.setItem('kintore_timer_sound_on', timerSettings.soundOn ? '1' : '0');
      localStorage.setItem('kintore_timer_vibrate_on', timerSettings.vibrateOn ? '1' : '0');
      localStorage.setItem('kintore_timer_notify_on', timerSettings.notifyOn ? '1' : '0');
    } catch (e) { /* noop */ }
  }

  function fmtClock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2);
  }

  /* ---- カスタム値の保存/復元 ---- */
  function loadCustomMin() {
    try {
      var v = +localStorage.getItem('kintore_timer_min');
      if (v >= 1 && v <= TW_MAX_MIN) timer.customMin = v;
    } catch (e) { /* noop */ }
  }
  function saveCustomMin() {
    try { localStorage.setItem('kintore_timer_min', String(timer.customMin)); } catch (e) { /* noop */ }
  }

  /* ---- カスタムホイール ---- */
  function buildTwList() {
    if (timer.twBuilt) return;
    var html = '';
    for (var i = 1; i <= TW_MAX_MIN; i++) html += '<div class="tw-item num">' + i + '</div>';
    $('#twList').innerHTML = html;
    timer.twBuilt = true;
  }
  function twSetSel(index) {
    if (index === timer.twSel) return;
    var kids = $('#twList').children;
    if (timer.twSel >= 0 && kids[timer.twSel]) kids[timer.twSel].classList.remove('sel');
    if (kids[index]) kids[index].classList.add('sel');
    timer.twSel = index;
    timer.customMin = index + 1;
  }
  function twIndexFromScroll() {
    var sc = $('#twScroll');
    var idx = Math.round(sc.scrollTop / TW_ITEM_H);
    return Math.max(0, Math.min(TW_MAX_MIN - 1, idx));
  }

  /* ---- 音（Web Audio。タップ時にアンロックし、終了時にビープ） ---- */
  function unlockAudio() {
    try {
      if (!timer.audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) timer.audioCtx = new AC();
      }
      if (timer.audioCtx && timer.audioCtx.state === 'suspended') timer.audioCtx.resume();
    } catch (e) { /* noop */ }
  }
  /* 1音分をスケジュール（音色・周波数・長さ・音量を指定） */
  function scheduleTone(ctx, t0, freq, dur, type, peak) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    var attack = Math.min(0.02, dur * 0.2);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak || 0.4, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    timer.beepNodes.push(o);
  }
  /* ベルの1打（基音＋倍音を重ねて金属的な減衰音にする） */
  function scheduleBellStrike(ctx, t0) {
    [[523.25, 0.5, 1.3], [1046.5, 0.28, 1.0], [1318.5, 0.18, 0.8]].forEach(function (p) {
      scheduleTone(ctx, t0, p[0], p[2], 'sine', 0.5 * p[1]);
    });
  }
  /* チャイムの3音（ドミソの上昇アルペジオ） */
  function scheduleChimeTriplet(ctx, t0) {
    [523.25, 659.25, 783.99].forEach(function (freq, i) {
      scheduleTone(ctx, t0 + i * 0.28, freq, 0.6, 'triangle', 0.35);
    });
  }
  /* 選んだ音のパターンをスケジュール（full=終了時の約5秒／false=設定画面での短いプレビュー） */
  function schedulePattern(ctx, key, full) {
    var t0 = ctx.currentTime, i;
    if (key === 'bell') {
      var bellReps = full ? 4 : 1;
      for (i = 0; i < bellReps; i++) scheduleBellStrike(ctx, t0 + i * 1.4);
    } else if (key === 'chime') {
      var chimeReps = full ? 3 : 1;
      for (i = 0; i < chimeReps; i++) scheduleChimeTriplet(ctx, t0 + i * 2.2);
    } else if (key === 'digital') {
      var digiCount = full ? 22 : 3;
      for (i = 0; i < digiCount; i++) scheduleTone(ctx, t0 + i * 0.22, (i % 2 === 0) ? 1318.5 : 1046.5, 0.11, 'square', 0.22);
    } else if (key === 'soft') {
      var softCount = full ? 6 : 1;
      for (i = 0; i < softCount; i++) scheduleTone(ctx, t0 + i * 0.9, (i % 2 === 0) ? 440 : 523.25, 0.7, 'triangle', 0.22);
    } else {
      var beepCount = full ? 11 : 2; // 約5秒間（0〜5.0秒に0.5秒間隔でビープ）
      for (i = 0; i < beepCount; i++) scheduleTone(ctx, t0 + i * 0.5, (i % 2 === 0) ? 880 : 988, 0.32, 'sine', 0.4);
    }
  }
  /* タイマー終了時のアラーム音（設定でオフなら鳴らさない） */
  function playAlarmSound() {
    if (!timerSettings.soundOn) return;
    try {
      var ctx = timer.audioCtx;
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      stopBeep();
      schedulePattern(ctx, timerSettings.sound, true);
    } catch (e) { /* noop */ }
  }
  /* 設定画面での試聴（短いプレビュー） */
  function previewSound(key) {
    unlockAudio();
    try {
      var ctx = timer.audioCtx;
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      stopBeep();
      schedulePattern(ctx, key, false);
    } catch (e) { /* noop */ }
  }
  function stopBeep() {
    (timer.beepNodes || []).forEach(function (o) { try { o.stop(); o.disconnect(); } catch (e) { /* noop */ } });
    timer.beepNodes = [];
  }
  /* バイブ（対応端末のみ。iPhoneのSafari/PWAは非対応のため無効。設定でオフなら振動しない） */
  function vibrateAlarm() {
    if (!timerSettings.vibrateOn) return;
    try {
      if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400, 200, 400, 200, 400, 200, 400, 200, 400, 200, 400, 200, 400]);
    } catch (e) { /* noop */ }
  }
  function stopVibrate() {
    try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) { /* noop */ }
  }

  /* ---- OS通知（許可時のみ）・バッジ ---- */
  function askNotify() {
    try {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    } catch (e) { /* noop */ }
  }
  function showTimerNotification() {
    if (!timerSettings.notifyOn) return;
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      var opts = { body: '休憩終了！ 次のセットへ', tag: 'kintore-timer', renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) { reg.showNotification('筋トレ記録', opts); }).catch(function () {});
      } else {
        new Notification('筋トレ記録', opts);
      }
    } catch (e) { /* noop */ }
  }
  function setBadge() { try { if (navigator.setAppBadge) navigator.setAppBadge(1); } catch (e) { /* noop */ } }
  function clearBadge() { try { if (navigator.clearAppBadge) navigator.clearAppBadge(); } catch (e) { /* noop */ } }

  /* ---- 画面スリープ抑止（Wake Lock） ---- */
  function requestWakeLock() {
    try {
      if (!('wakeLock' in navigator)) return;
      navigator.wakeLock.request('screen').then(function (wl) { timer.wakeLock = wl; }).catch(function () {});
    } catch (e) { /* noop */ }
  }
  function releaseWakeLock() {
    try { if (timer.wakeLock) { timer.wakeLock.release(); timer.wakeLock = null; } } catch (e) { /* noop */ }
  }

  /* ---- カウントダウン本体（終了時刻の実時刻ベース＝復帰時に自己補正） ---- */
  function startTick() { stopTick(); timer.tick = setInterval(tickTimer, 200); }
  function stopTick() { if (timer.tick) { clearInterval(timer.tick); timer.tick = null; } }
  function tickTimer() {
    if (!timer.running || timer.paused) return;
    timer.remaining = (timer.endAt - Date.now()) / 1000;
    if (timer.remaining <= 0) { timer.remaining = 0; finishTimer(); return; }
    renderTimer();
  }

  function startTimer(seconds) {
    unlockAudio();
    askNotify();
    clearBadge();
    stopBeep();
    stopVibrate();
    timer.total = seconds;
    timer.endAt = Date.now() + seconds * 1000;
    timer.remaining = seconds;
    timer.running = true;
    timer.paused = false;
    timer.finished = false;
    requestWakeLock();
    startTick();
    setTimerView('running');
    renderTimer();
  }
  function finishTimer() {
    stopTick();
    timer.running = false;
    timer.paused = false;
    timer.finished = true;
    timer.remaining = 0;
    releaseWakeLock();
    playAlarmSound();
    vibrateAlarm();
    showTimerNotification();
    setBadge();
    setTimerView('finished');
    renderTimer();
  }
  function pauseResumeTimer() {
    if (timer.finished) return;
    if (timer.paused) {
      timer.endAt = Date.now() + timer.remaining * 1000;
      timer.paused = false;
      requestWakeLock();
      startTick();
    } else {
      timer.remaining = (timer.endAt - Date.now()) / 1000;
      timer.paused = true;
      stopTick();
      releaseWakeLock();
    }
    renderTimer();
  }
  function addTime(sec) {
    if (timer.finished) return;
    timer.total += sec;
    if (timer.paused) timer.remaining += sec;
    else { timer.endAt += sec * 1000; timer.remaining = (timer.endAt - Date.now()) / 1000; }
    // −30秒で残りが尽きたら終了扱い（一時停止中はtickが動かないためここで確定させる）
    if (timer.remaining <= 0) { finishTimer(); return; }
    renderTimer();
  }
  function resetTimer() {
    stopTick();
    stopBeep();
    stopVibrate();
    timer.running = false; timer.paused = false; timer.finished = false;
    releaseWakeLock();
    clearBadge();
    setTimerView('setup');
    renderTimer();
    scrollTwToCustom();
  }
  function againTimer() { startTimer(timer.total); }

  function setTimerView(state) {
    var v = $('#view-timer');
    v.classList.toggle('running', state !== 'setup');
    v.classList.toggle('finished', state === 'finished');
  }

  function renderTimer() {
    var rem = timer.finished ? 0 : Math.max(0, timer.remaining);
    var timeEl = $('#trTime');
    if (timeEl) timeEl.textContent = fmtClock(rem);

    var ringEl = $('#trRing');
    if (ringEl) {
      var C = 2 * Math.PI * 110;
      ringEl.style.strokeDasharray = C.toFixed(1);
      var prog = timer.total > 0 ? Math.max(0, Math.min(1, rem / timer.total)) : 0;
      ringEl.style.strokeDashoffset = (C * (1 - prog)).toFixed(1);
    }
    var labelEl = $('#trLabel');
    if (labelEl) labelEl.textContent = timer.finished ? 'TIME UP' : (timer.paused ? '一時停止中' : '残り');

    var pause = $('#trPause'), minus = $('#trMinus30'), plus = $('#trPlus30'), again = $('#trAgain'), reset = $('#trReset');
    if (pause) { pause.style.display = timer.finished ? 'none' : ''; pause.textContent = timer.paused ? '再開' : '一時停止'; }
    if (minus) minus.style.display = timer.finished ? 'none' : '';
    if (plus) plus.style.display = timer.finished ? 'none' : '';
    if (again) again.style.display = timer.finished ? '' : 'none';
    if (reset) reset.textContent = timer.finished ? '閉じる' : 'リセット';
  }

  function scrollTwToCustom() {
    var idx = timer.customMin - 1;
    requestAnimationFrame(function () {
      var sc = $('#twScroll');
      if (!sc) return;
      sc.scrollTop = idx * TW_ITEM_H;
      twSetSel(idx);
    });
  }

  function bindTimer() {
    timer.twBound = true;
    var sc = $('#twScroll');
    var ticking = false;
    sc.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; twSetSel(twIndexFromScroll()); });
    });
    // マウスの上下ドラッグ（タッチはネイティブスクロール＋スナップに任せる）
    var drag = { active: false, startY: 0, startScroll: 0 };
    sc.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return;
      drag.active = true; drag.startY = e.clientY; drag.startScroll = sc.scrollTop;
      sc.setPointerCapture(e.pointerId);
    });
    sc.addEventListener('pointermove', function (e) {
      if (!drag.active) return;
      sc.scrollTop = drag.startScroll - (e.clientY - drag.startY);
    });
    var endDrag = function () {
      if (!drag.active) return;
      drag.active = false;
      var i = twIndexFromScroll();
      sc.scrollTop = i * TW_ITEM_H;
      twSetSel(i);
    };
    sc.addEventListener('pointerup', endDrag);
    sc.addEventListener('pointercancel', endDrag);
    sc.addEventListener('wheel', function (e) { if (e.deltaY === 0) return; e.preventDefault(); sc.scrollTop += e.deltaY; }, { passive: false });

    $$('#timerSetup .preset-btn').forEach(function (b) {
      b.addEventListener('click', function () { startTimer(+b.dataset.sec); });
    });
    $('#twStart').addEventListener('click', function () { saveCustomMin(); startTimer(timer.customMin * 60); });
    $('#trPause').addEventListener('click', pauseResumeTimer);
    $('#trMinus30').addEventListener('click', function () { addTime(-30); });
    $('#trPlus30').addEventListener('click', function () { addTime(30); });
    $('#trAgain').addEventListener('click', againTimer);
    $('#trReset').addEventListener('click', resetTimer);

    // バックグラウンド復帰時：経過を反映し、必要ならWake Lockを取り直す
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (timer.running && !timer.paused && !timer.finished) {
        timer.remaining = (timer.endAt - Date.now()) / 1000;
        if (timer.remaining <= 0) { finishTimer(); }
        else { requestWakeLock(); if (!timer.tick) startTick(); renderTimer(); }
      }
    });
  }

  function timerInit() {
    buildTwList();
    if (!timer.twBound) { loadCustomMin(); bindTimer(); }
    if (!timer.running && !timer.finished) { setTimerView('setup'); scrollTwToCustom(); }
    renderTimer();
  }

  /* ================== 設定：タイマー（アラーム音・通知） ================== */
  function openTimerSettings() {
    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    $('#view-settings-timer').classList.add('active');
    renderTimerSettings();
    window.scrollTo(0, 0);
  }
  function closeTimerSettings() {
    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    $('#view-settings').classList.add('active');
    window.scrollTo(0, 0);
  }
  function renderTimerSettings() {
    $('#soundList').innerHTML = SOUND_PATTERNS.map(function (p) {
      return '<button class="sound-row' + (p.key === timerSettings.sound ? ' selected' : '') + '" data-sound="' + p.key + '" type="button">' +
        '<span class="sound-name">' + esc(p.label) + '</span>' +
        '<span class="sound-check">✓</span>' +
      '</button>';
    }).join('');
    $('#toggleSoundOn').checked = timerSettings.soundOn;
    $('#toggleVibrateOn').checked = timerSettings.vibrateOn;
    $('#toggleNotifyOn').checked = timerSettings.notifyOn;
  }
  var timerSettingsBound = false;
  function bindTimerSettingsOnce() {
    if (timerSettingsBound) return;
    timerSettingsBound = true;
    $('#openTimerSettingsBtn').addEventListener('click', openTimerSettings);
    $('#backFromTimerSettings').addEventListener('click', closeTimerSettings);
    $('#soundList').addEventListener('click', function (e) {
      var row = e.target.closest('[data-sound]');
      if (!row) return;
      timerSettings.sound = row.dataset.sound;
      saveTimerSettings();
      renderTimerSettings();
      previewSound(timerSettings.sound);
    });
    $('#toggleSoundOn').addEventListener('change', function (e) {
      timerSettings.soundOn = e.target.checked;
      saveTimerSettings();
    });
    $('#toggleVibrateOn').addEventListener('change', function (e) {
      timerSettings.vibrateOn = e.target.checked;
      saveTimerSettings();
    });
    $('#toggleNotifyOn').addEventListener('change', function (e) {
      timerSettings.notifyOn = e.target.checked;
      saveTimerSettings();
      if (timerSettings.notifyOn) askNotify();
    });
  }

  /* ================== タブ切り替え・初期化 ================== */
  function switchTab(tab) {
    ui.tab = tab;
    $$('#tabbar button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + tab); });
    if (tab === 'log') renderLog(true);
    else if (tab === 'history') renderHistory();
    else if (tab === 'charts') Charts.init();
    else if (tab === 'timer') timerInit();
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
  bindCtime();
  loadTimerSettings();
  bindTimerSettingsOnce();
  renderLog(true);
})();
