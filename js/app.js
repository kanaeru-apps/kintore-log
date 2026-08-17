/* ============================================================
   app.js — 画面制御・レンダリング・イベント
   ============================================================ */
'use strict';

(function () {
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  /* ---- アプリ内で起きた例外を記録する ----
     ネイティブ版はブラウザの開発者ツールが使えないため、JSがどこかで落ちても
     画面上は「表示が更新されないだけ」になり、実機では何も分からなくなる。
     ここで拾って設定画面の「アプリ内エラー」に出す。
     診断用の soundDiag は後方で定義されるので、それより前に起きた例外も
     取りこぼさないよう、この変数に貯めておく。 */
  var lastAppError = '';
  function noteAppError(label, e) {
    var msg = '';
    if (e && e.message) msg = e.message;
    else if (typeof e === 'string') msg = e;
    else if (e && e.reason) msg = String(e.reason.message || e.reason);
    else msg = String(e);
    lastAppError = label + ': ' + msg.slice(0, 120);
  }
  window.addEventListener('error', function (ev) {
    noteAppError('例外', ev && (ev.error || ev.message));
  });
  window.addEventListener('unhandledrejection', function (ev) {
    noteAppError('未処理のPromise', ev);
  });

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
  /* 実施セット判定・CSV用の全キー（時間は t=分・ts=秒 の2フィールド）。
     強度(z)は数値ではなくラベルなので、ここには含めない＝強度だけ付いた空セッションは「実施した」と数えない */
  var CARDIO_KEYS_ALL = ['t', 'ts'].concat(CARDIO_FIELDS.map(function (f) { return f.k; }));
  /* インターバルの強度ラベル。csvはスプレッドシート・CSVに書き出す文字列 */
  var ZONES = {
    hi: { label: 'WORK', cls: 'z-hi', csv: 'WORK' },
    rec: { label: 'REST', cls: 'z-rec', csv: 'REST' }
  };
  /* チップをタップしたときの巡回順（WORK → REST → タグなし） */
  var ZONE_ORDER = ['hi', 'rec', ''];
  function zoneOf(s) { return (s && ZONES[s.z]) ? s.z : ''; }
  function zoneCsv(z) { return ZONES[z] ? ZONES[z].csv : ''; }
  /* CSV・スプレッドシートの文字列 → 内部キー。手で「強」「緩」と書かれていても拾う */
  function zoneFromCsv(v) {
    var t = String(v == null ? '' : v).trim().toUpperCase();
    if (t === 'WORK' || t === '強' || t === 'HI') return 'hi';
    if (t === 'REST' || t === '緩' || t === 'REC') return 'rec';
    return '';
  }
  function hasZone(e) {
    return isCardio(e) && e.sets.some(function (s) { return zoneOf(s); });
  }
  function isCardio(e) { return e && e.part === CARDIO_PART; }
  /* 時間(分)+秒 を「1時間05分30秒」のように整形。未入力ならnull */
  function fmtCardioTime(s) {
    if (s.t === '' && s.ts === '') return null;
    return fmtSeconds(setSeconds(s));
  }
  /* セッションの長さを秒で返す（t=分・ts=秒） */
  function setSeconds(s) { return (+s.t || 0) * 60 + (+s.ts || 0); }
  /* 秒 → 「16分00秒」「1時間05分30秒」「30秒」。
     インターバルの30秒・90秒を「0分30秒」と書くと読みづらいので、0分のときは分を省く */
  function fmtSeconds(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (!h && !m) return s + '秒';
    var mm = h > 0 ? ('0' + m).slice(-2) : String(m);
    return (h > 0 ? h + '時間' : '') + mm + '分' + ('0' + s).slice(-2) + '秒';
  }

  /* lapOpen: インターバル行のうち今開いているもの（キーは entryId + '/' + セッション番号）。
     再描画のたびに閉じてしまわないよう、DOMではなくここで状態を持つ */
  var ui = { tab: 'log', date: DB.todayStr(), pickerPart: '胸', expanded: {}, sheetEdit: false, exExpanded: {}, lapOpen: {} };
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
          // 分(t)だけを足すとインターバルの30秒・90秒がすべて0分になってしまうため秒(ts)も含める
          st.time += setSeconds(s) / 60;
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

  /* その種目・その日の合計ボリュームがTOP3入りしていたらメダルをトースト表示する。
     同じ順位を連続で出さないよう、種目×日付ごとに直近表示した順位を覚えておく（画面再読み込みでリセット）。 */
  var recordToastShown = {};
  function checkRecordToast(entryId) {
    var w = DB.getWorkout(ui.date);
    var entry = ((w && w.entries) || []).filter(function (x) { return x.id === entryId; })[0];
    if (!entry) return;
    var rank = DB.rankOnDate(entry.exId, ui.date);
    if (!rank) return;
    var key = entry.exId + '|' + ui.date;
    if (recordToastShown[key] === rank) return;
    recordToastShown[key] = rank;
    var medal = rank === 1 ? '🥇' : (rank === 2 ? '🥈' : '🥉');
    toast(medal + ' ' + entry.name + ' 自己ベスト更新！(' + rank + '位)');
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

  /* ================== 重量±ボタンの刻み幅（設定で変更可） ================== */
  var WEIGHT_STEP_OPTIONS = [0.5, 1, 1.25, 2.5, 5];
  var weightStepSettings = { step: 2.5 }; // 既定値は従来どおり2.5kg
  function loadWeightStepSettings() {
    try {
      var v = parseFloat(localStorage.getItem('kintore_weight_step'));
      if (WEIGHT_STEP_OPTIONS.indexOf(v) !== -1) weightStepSettings.step = v;
    } catch (e) { /* noop */ }
  }
  function saveWeightStepSettings() {
    try { localStorage.setItem('kintore_weight_step', String(weightStepSettings.step)); } catch (e) { /* noop */ }
  }

  /* ================== 外観（ライト / ダーク） ==================
     端末に保存するのはユーザーの選択（system / light / dark）だけ。実際に適用したほうは
     <html data-theme="light|dark"> に入れ、CSSはこの2値しか見ない（style.css の :root を参照）。
     起動直後のちらつき（ダークが一瞬見えてからライトになる）を防ぐため、属性の初期設定は
     index.html の <head> のインラインスクリプトでも先に行っている。同じキーを読むので、
     キー名や既定値を変えるときは必ず両方を直すこと。 */
  var THEME_KEY = 'kintore_theme';
  var THEME_OPTIONS = ['system', 'light', 'dark'];
  var themePref = 'system';

  function loadThemePref() {
    try {
      var v = localStorage.getItem(THEME_KEY);
      if (THEME_OPTIONS.indexOf(v) !== -1) themePref = v;
    } catch (e) { /* noop */ }
  }
  function systemTheme() {
    try {
      return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    } catch (e) { return 'dark'; }   /* 判定できない環境は従来どおりダーク */
  }
  /* 選択をアプリ全体に反映する。<html> の属性を差し替えたあと、JSが色を直接書き込んでいる
     場所（履歴カレンダーの塗り・グラフのSVG）を描き直す。CSS変数だけで色が決まる部分は
     属性の切り替えだけで自動的に変わる */
  function applyTheme() {
    var actual = themePref === 'system' ? systemTheme() : themePref;
    document.documentElement.setAttribute('data-theme', actual);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', DB.cssVar('--bg', actual === 'light' ? '#f2f3f5' : '#0b0c0f'));
    DB.refreshThemeColors();
    if (ui.tab === 'history') renderHistory();
    else if (ui.tab === 'charts') Charts.init();
  }
  function setThemePref(v) {
    if (THEME_OPTIONS.indexOf(v) === -1) return;
    themePref = v;
    try { localStorage.setItem(THEME_KEY, v); } catch (e) { /* noop */ }
    applyTheme();
    renderThemeSettings();
  }
  function initTheme() {
    loadThemePref();
    applyTheme();
    /* 「システム」の間はOS側の切り替え（時間帯による自動切替を含む）に追従する */
    try {
      var mq = window.matchMedia('(prefers-color-scheme: light)');
      var onChange = function () {
        if (themePref !== 'system') return;
        applyTheme();
        renderThemeSettings();
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);   /* iOS 13 など旧Safari */
    } catch (e) { /* 追従できなくても手動選択は動く */ }
  }
  function renderThemeSettings() {
    var box = $('#themeSeg');
    if (!box) return;
    $$('#themeSeg [data-theme-opt]').forEach(function (b) {
      var on = b.dataset.themeOpt === themePref;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var note = $('#themeNote');
    if (!note) return;
    note.textContent = themePref === 'system'
      ? '端末の設定に合わせて自動で切り替わります（今は' + (systemTheme() === 'light' ? 'ライト' : 'ダーク') + '）'
      : (themePref === 'light' ? 'いつもライトで表示します' : 'いつもダークで表示します');
  }

  /* ================== 重量ドラムロールピッカー ================== */
  var DRUM_STEP = 0.25;     // 0.25kg刻み（0.5/1.25/2.5kgなど主要なプレート単位すべてにピッタリ止まれる）
  var DRUM_MAX = 300;       // 最大300kg
  var DRUM_ITEM_H = 44;     // 各項目の高さ(px)。CSSと一致させること
  var drumTarget = null;    // { entryId, idx }
  var drumSelIndex = -1;
  var drumBuilt = false;

  function drumFmt(v) { return (v % 1 === 0) ? String(v) : String(Math.round(v * 100) / 100); }

  /* ピッカー表示中は、ホイールを端まで回したときのスクロール連鎖や
     直接入力のキーボード表示で背後のページがスクロールしてしまうことがある（特にiOS）。
     開いた時点の位置を覚えておき、閉じるときにそこへ戻す */
  var pickerScrollY = 0;
  function rememberPageScroll() { pickerScrollY = window.scrollY; }
  function restorePageScroll() {
    var y = pickerScrollY;
    window.scrollTo(0, y);
    // iOSはキーボードが閉じたあとに位置を再調整することがあるため、少し遅れてもう一度戻す
    setTimeout(function () { window.scrollTo(0, y); }, 250);
  }

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
    // 直接入力欄には反映しない：値が入っていると消してから打ち直す手間が生じるため、
    // 入力欄は常に手入力専用の空欄にしておく（確定値はホイール選択が持つ）
  }

  function drumIndexFromScroll() {
    var scroll = $('#drumScroll');
    var index = Math.round(scroll.scrollTop / DRUM_ITEM_H);
    return Math.max(0, Math.min(Math.round(DRUM_MAX / DRUM_STEP), index));
  }

  function openDrum(entryId, idx) {
    buildDrumList();
    rememberPageScroll();
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
    $('#drumDirectInput').value = ''; // プリフィルしない（前回開いたときの入力も消す）

    drumSelIndex = -1;
    var scroll = $('#drumScroll');
    requestAnimationFrame(function () {
      scroll.scrollTop = index * DRUM_ITEM_H;
      setDrumSel(index);
    });
  }

  function closeDrum(commit) {
    if (commit && drumTarget) {
      var v = drumSelIndex >= 0 ? Math.round(drumSelIndex * DRUM_STEP * 100) / 100 : 0;
      DB.updateSet(ui.date, drumTarget.entryId, drumTarget.idx, 'w', v);
      checkRecordToast(drumTarget.entryId);
    }
    $('#drumBackdrop').classList.remove('show');
    $('#drumSheet').classList.remove('show');
    $('#drumDirectInput').blur();
    drumTarget = null;
    if (commit) renderLog();
    restorePageScroll();
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

  /* ================== 回数ドラムロールピッカー（重量ドラムと同じ操作方式） ================== */
  var REPS_MAX = 50;        // 0〜50回
  var REPS_ITEM_H = 44;     // CSSと一致させること（.drum-item と共通）
  var repsTarget = null;    // { entryId, idx }
  var repsSelIndex = -1;
  var repsBuilt = false;

  function buildRepsList() {
    if (repsBuilt) return;
    var html = '';
    for (var i = 0; i <= REPS_MAX; i++) html += '<div class="drum-item num">' + i + '</div>';
    $('#repsList').innerHTML = html;
    repsBuilt = true;
  }

  function setRepsSel(index) {
    if (index === repsSelIndex) return;
    var kids = $('#repsList').children;
    if (repsSelIndex >= 0 && kids[repsSelIndex]) kids[repsSelIndex].classList.remove('sel');
    if (kids[index]) kids[index].classList.add('sel');
    repsSelIndex = index;
    // 直接入力欄には反映しない（重量ドラムと同じく手入力専用の空欄を保つ）
  }

  function repsIndexFromScroll() {
    var scroll = $('#repsScroll');
    var index = Math.round(scroll.scrollTop / REPS_ITEM_H);
    return Math.max(0, Math.min(REPS_MAX, index));
  }

  function openRepsDrum(entryId, idx) {
    buildRepsList();
    rememberPageScroll();
    repsTarget = { entryId: entryId, idx: idx };

    var s = DB.getSet(ui.date, entryId, idx);
    var cur = (s && s.r !== '' && s.r != null) ? +s.r : 0;
    cur = Math.max(0, Math.min(REPS_MAX, Math.round(cur)));

    var w = DB.getWorkout(ui.date);
    var ent = ((w && w.entries) || []).filter(function (x) { return x.id === entryId; })[0];
    $('#repsTitle').textContent = (ent ? ent.name : '') + '　' + (idx + 1) + 'セット目';

    $('#repsBackdrop').classList.add('show');
    $('#repsSheet').classList.add('show');
    $('#repsDirectInput').value = ''; // プリフィルしない（前回開いたときの入力も消す）

    repsSelIndex = -1;
    var scroll = $('#repsScroll');
    requestAnimationFrame(function () {
      scroll.scrollTop = cur * REPS_ITEM_H;
      setRepsSel(cur);
    });
  }

  function closeRepsDrum(commit) {
    if (commit && repsTarget) {
      var v = repsSelIndex >= 0 ? repsSelIndex : 0;
      DB.updateSet(ui.date, repsTarget.entryId, repsTarget.idx, 'r', v);
      checkRecordToast(repsTarget.entryId);
    }
    $('#repsBackdrop').classList.remove('show');
    $('#repsSheet').classList.remove('show');
    $('#repsDirectInput').blur();
    repsTarget = null;
    if (commit) renderLog();
    restorePageScroll();
  }

  function bindRepsDrum() {
    var scroll = $('#repsScroll');
    var ticking = false;
    scroll.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; setRepsSel(repsIndexFromScroll()); });
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
      var index = repsIndexFromScroll();
      scroll.scrollTop = index * REPS_ITEM_H; // 最寄りにスナップ
      setRepsSel(index);
    };
    scroll.addEventListener('pointerup', endDrag);
    scroll.addEventListener('pointercancel', endDrag);

    $('#repsDone').onclick = function () { closeRepsDrum(true); };
    $('#repsCancel').onclick = function () { closeRepsDrum(false); };
    $('#repsBackdrop').onclick = function () { closeRepsDrum(false); };

    // 数字の直接入力 → ホイールをその値へスクロールして同期させる
    $('#repsDirectInput').addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10);
      if (isNaN(v)) return;
      v = Math.max(0, Math.min(REPS_MAX, v));
      scroll.scrollTop = v * REPS_ITEM_H;
      setRepsSel(v);
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
    rememberPageScroll();
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
    ['#ctimeHInput', '#ctimeMInput', '#ctimeSInput'].forEach(function (id) { $(id).blur(); });
    ctimeTarget = null;
    if (commit) renderLog();
    restorePageScroll();
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

  /* 数値欄をタップしたときのカーソル位置は、その欄が「どう編集されるか」で分ける。
     ・continue（追記編集）… 有酸素の距離・時間・心拍。桁数が多く、消したいときは✕ボタンがある → 末尾に置く
     ・replace（全置換）  … 生成シートの分・秒・本数。1〜2桁で必ず丸ごと打ち直す → 中身を全選択して上書きできるようにする
     ここを「数値欄だから」と一括で末尾寄せにすると、全置換の欄が「打ち直せない欄」になる（v0.10.1で実際に踏んだ）。
     なお focus だけでは効かない：iOS Safari は focus のあとに「タップした位置」へカーソルを置き直すため、
     pointerup 後にもう一度寄せ直す */
  function caretToEnd(input) {
    if (input.selectionStart !== input.selectionEnd) return;  /* ドラッグで範囲選択中は動かさない */
    var n = input.value.length;
    try { input.setSelectionRange(n, n); } catch (err) { /* type次第で失敗するが実害なし */ }
  }
  function caretSelectAll(input) {
    try { input.setSelectionRange(0, input.value.length); } catch (err) { /* 同上 */ }
  }
  /* rootSel の中の inputSel に place のふるまいを付ける（記録カードと生成シートで共用） */
  function bindCaretPlacement(rootSel, inputSel, place) {
    var root = $(rootSel);
    if (!root) return;
    root.addEventListener('focusin', function (e) {
      var input = e.target.closest(inputSel);
      if (input) place(input);
    });
    root.addEventListener('pointerup', function (e) {
      var input = e.target.closest(inputSel);
      if (!input) return;
      setTimeout(function () {
        /* ドラッグで範囲を選んだ直後は邪魔しない */
        if (document.activeElement === input && input.selectionStart === input.selectionEnd) place(input);
      }, 0);
    });
  }

  /* ================== インターバル一括生成 ================== */
  var GEN_CFG_KEY = 'kintore_interval_cfg';
  var GEN_LIMIT = { work: [5, 1800], rest: [0, 1800], reps: [1, 60] };
  var genTarget = null;
  var genCfg = { work: 30, rest: 90, reps: 8 };

  /* 最後に使った構成を端末に覚えておく＝次に開いたときの初期値。設定画面に項目を増やさずに済む */
  function loadGenCfg() {
    var raw = null;
    try { raw = localStorage.getItem(GEN_CFG_KEY); } catch (e) { return; }
    if (!raw) return;
    try {
      var o = JSON.parse(raw);
      ['work', 'rest', 'reps'].forEach(function (k) {
        if (typeof o[k] === 'number' && isFinite(o[k])) genCfg[k] = clampGen(k, o[k]);
      });
    } catch (e) { /* 壊れていれば既定値のまま使う */ }
  }
  function saveGenCfg() {
    try { localStorage.setItem(GEN_CFG_KEY, JSON.stringify(genCfg)); } catch (e) { /* noop */ }
  }
  function clampGen(k, v) {
    var r = GEN_LIMIT[k];
    return Math.max(r[0], Math.min(r[1], Math.round(v)));
  }

  /* WORK/RESTの長さは内部では「合計秒」で持ち、画面には分・秒の2欄に割って出す。
     こうしておくと保存形式（秒）も doGen も変えずに済み、±ボタンも合計秒に足すだけでよい */
  var GEN_TIME_FIELD = { work: ['#genWorkM', '#genWorkS'], rest: ['#genRestM', '#genRestS'] };
  var GEN_ALL_INPUT = ['#genWorkM', '#genWorkS', '#genRestM', '#genRestS', '#genReps'];

  function showGen(k) {
    if (k === 'reps') { $('#genReps').value = String(genCfg.reps); return; }
    var f = GEN_TIME_FIELD[k];
    $(f[0]).value = String(Math.floor(genCfg[k] / 60));
    $(f[1]).value = ('0' + (genCfg[k] % 60)).slice(-2);
  }
  /* 秒欄に90と打たれても弾かず、いったん合計秒として受け取る（確定時に1分30秒へ整えられる） */
  function readGenTime(k) {
    var f = GEN_TIME_FIELD[k];
    var m = parseInt($(f[0]).value, 10);
    var s = parseInt($(f[1]).value, 10);
    return (isNaN(m) ? 0 : m) * 60 + (isNaN(s) ? 0 : s);
  }

  function openGen(entryId) {
    genTarget = entryId;
    rememberPageScroll();
    showGen('work');
    showGen('rest');
    showGen('reps');
    renderGenPreview();
    $('#genBackdrop').classList.add('show');
    $('#genSheet').classList.add('show');
  }

  function closeGen() {
    $('#genBackdrop').classList.remove('show');
    $('#genSheet').classList.remove('show');
    GEN_ALL_INPUT.forEach(function (id) { $(id).blur(); });
    genTarget = null;
    restorePageScroll();
  }

  /* 生成対象のセッションが「まだ何も入力されていない空セッションだけ」かどうか。
     空だけなら置き換え、1つでも入力済みがあれば末尾に足す＝入力を消さない */
  function genWouldReplace(entryId) {
    var w = DB.getWorkout(ui.date);
    var e = ((w && w.entries) || []).filter(function (x) { return x.id === entryId; })[0];
    if (!e) return true;
    return !e.sets.some(function (s) {
      return CARDIO_KEYS_ALL.some(function (k) { return s[k] !== '' && s[k] != null; });
    });
  }

  function renderGenPreview() {
    var total = (genCfg.work + genCfg.rest) * genCfg.reps;
    var count = genCfg.reps * (genCfg.rest > 0 ? 2 : 1);
    $('#genTotal').textContent = fmtSeconds(total);
    $('#genCount').textContent = String(count);
    $('#genMode').textContent = genTarget && genWouldReplace(genTarget)
      ? '空のセッションを置き換えます'
      : '入力済みの記録は残し、末尾に追加します';
  }

  function setGen(k, v) {
    genCfg[k] = clampGen(k, v);
    showGen(k);
    renderGenPreview();
  }

  function doGen() {
    if (!genTarget) return;
    var list = [];
    for (var i = 0; i < genCfg.reps; i++) {
      list.push({ t: Math.floor(genCfg.work / 60), ts: genCfg.work % 60, z: 'hi' });
      // REST 0秒はインターバルでなく単純な反復なので、REST行そのものを作らない
      if (genCfg.rest > 0) list.push({ t: Math.floor(genCfg.rest / 60), ts: genCfg.rest % 60, z: 'rec' });
    }
    var replace = genWouldReplace(genTarget);
    DB.addCardioSets(ui.date, genTarget, list, replace);
    saveGenCfg();
    // 一気に増えた行が全部開いていると読めないので、生成後は全部閉じた状態にする
    Object.keys(ui.lapOpen).forEach(function (key) {
      if (key.indexOf(genTarget + '/') === 0) delete ui.lapOpen[key];
    });
    toast(list.length + 'セッションを' + (replace ? '作成' : '追加') + 'しました');
    closeGen();
    renderLog();
  }

  function bindGen() {
    loadGenCfg();
    $('#genDo').onclick = doGen;
    $('#genCancel').onclick = closeGen;
    $('#genBackdrop').onclick = closeGen;

    $('#genSheet').addEventListener('click', function (e) {
      var b = e.target.closest('[data-step]');
      if (!b) return;
      var p = b.dataset.step.split(',');
      setGen(p[0], genCfg[p[0]] + (+p[1]));
    });
    // 入力中は値を直さない（「3」を打つ途中で勝手に丸めない・分を消している最中に0を書き戻さない）。
    // 確定（blur）したときに初めて範囲へ収め、分と秒に割り直して表示する
    ['work', 'rest'].forEach(function (k) {
      GEN_TIME_FIELD[k].forEach(function (id) {
        $(id).addEventListener('input', function () {
          genCfg[k] = clampGen(k, readGenTime(k));
          renderGenPreview();
        });
        $(id).addEventListener('change', function () { setGen(k, genCfg[k]); });
      });
    });
    $('#genReps').addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10);
      if (isNaN(v)) return;
      genCfg.reps = clampGen('reps', v);
      renderGenPreview();
    });
    $('#genReps').addEventListener('change', function () { setGen('reps', genCfg.reps); });

    bindCaretPlacement('#genSheet', 'input.num', caretSelectAll);
  }

  /* ================== 記録タブ ================== */
  function statTile(label, value, unit) {
    return '<div class="stat"><span class="stat-label">' + label + '</span>' +
      '<span class="stat-value num">' + value + (unit ? '<small>' + unit + '</small>' : '') + '</span></div>';
  }

  /* サマリータイル（内容がある種類だけ表示。筋トレ=レップ/負荷量、有酸素=時間/距離）。
     全再描画せずに数値だけ更新したいときにも呼べるよう renderLog から切り出してある */
  function renderDayStats(w) {
    var st = dayStats(w);
    var tiles = statTile('合計種目数', st.ex) + statTile('合計セット数', st.sets);
    if (st.hasStr) tiles += statTile('合計レップ数', st.reps) + statTile('合計負荷量', fmtNum(st.vol), 'kg');
    if (st.hasCardio) tiles += statTile('合計時間', fmtNum(st.time), '分') + statTile('合計距離', fmtNum(st.dist), 'km');
    if (!st.hasStr && !st.hasCardio) tiles += statTile('合計レップ数', 0) + statTile('合計負荷量', 0, 'kg');
    $('#dayStats').innerHTML = tiles;
  }

  function renderLog(animate) {
    var d = parseDate(ui.date);
    var pad2 = function (n) { return ('0' + n).slice(-2); };
    // セット入力などその場での再描画は #entries を丸ごと作り直すため、
    // 何もしないとスクロール位置が失われて別のカードへ飛んでしまう。
    // 日付・タブ切り替え時（animate=true）は先頭表示でよいので復元しない。
    var keepScrollY = animate ? null : window.scrollY;
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

    renderDayStats(w);

    // 種目カード
    var entries = (w && w.entries) || [];
    if (!entries.length) {
      var emptyHtml =
        '<div class="empty"><div class="ph-icon">' + dumbbellSvg() + '</div><p>まだ記録がありません。<br>「＋ 種目を追加」からはじめましょう。</p></div>';
      // 端末に記録が1件もない＝機種変更やSafari/アプリの開き分けで別の保存場所を見ている可能性が
      // あるため、クラウドバックアップからの復元導線を出す。
      // ただしクラウド同期を使っている端末（解除済みまたはURL設定済み）に限る：
      // 一般公開後の新規ユーザーには意味が分からないボタンのため見せない
      if (!DB.datesWithData().length && (syncUnlocked() || getGasUrl())) {
        emptyHtml += '<div class="empty-restore"><button class="btn ghost small" id="cloudRestoreEmptyBtn" type="button">クラウドバックアップから復元</button></div>';
      }
      $('#entries').innerHTML = emptyHtml;
      var rBtn = $('#cloudRestoreEmptyBtn');
      if (rBtn) rBtn.onclick = promptCloudRestore;
    } else {
      $('#entries').innerHTML = entries.map(entryHtml).join('');
    }

    // 再描画で失われたスクロール位置を、ペイント前に同期的に復元する
    if (keepScrollY !== null) window.scrollTo(0, keepScrollY);
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
      body = cardioPrevBody(prev.sets);
    } else {
      body = prev.sets.map(function (s) { return esc(s.w || 0) + '×' + esc(s.r || 0); }).join(' / ');
    }
    return '<p class="prev"><span>前回 ' + (pd.getMonth() + 1) + '/' + pd.getDate() + '</span>' + body + '</p>';
  }

  /* 前回の有酸素記録の1行表示。
     インターバルはセッションが16個などになるため1件ずつ並べると読めなくなるので、
     「WORK30秒/REST90秒 ×8本 計16分 9.35km」の形に要約する */
  function cardioPrevBody(sets) {
    var hi = [], rec = [];
    sets.forEach(function (s) {
      var z = zoneOf(s);
      if (z === 'hi') hi.push(s);
      else if (z === 'rec') rec.push(s);
    });

    if (!hi.length && !rec.length) {
      return sets.map(function (s) {
        var parts = [];
        var tv = fmtCardioTime(s);
        if (tv) parts.push(tv);
        if (+s.d) parts.push(esc(s.d) + 'km');
        if (+s.cal) parts.push(esc(s.cal) + 'kcal');
        return parts.join(' ') || '—';
      }).join(' / ');
    }

    // 全セッションが同じ長さなら秒数まで書き、まちまちなら本数だけにする（嘘の代表値を出さない）
    var uniform = function (list) {
      if (!list.length) return '';
      var first = setSeconds(list[0]);
      var same = list.every(function (s) { return setSeconds(s) === first; });
      return (same && first > 0) ? fmtShortSec(first) : '';
    };
    var head = [];
    if (hi.length) head.push(ZONES.hi.label + uniform(hi));
    if (rec.length) head.push(ZONES.rec.label + uniform(rec));

    var totSec = 0, totD = 0;
    sets.forEach(function (s) { totSec += setSeconds(s); totD += (+s.d || 0); });
    var tail = [];
    if (totSec) tail.push('計' + fmtShortSec(totSec));
    if (totD) tail.push(fmtNum(totD) + 'km');

    return esc(head.join('/') + ' ×' + Math.max(hi.length, rec.length) + '本 ' + tail.join(' '));
  }

  /* 要約用。「30秒」「1分30秒」「16分」「1時間」。ちょうどの分・時間は末尾の00秒を書かない */
  function fmtShortSec(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec % 60) return fmtSeconds(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return (h ? h + '時間' : '') + ((m || !h) ? m + '分' : '');
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
          '<button class="w-display num' + (s.r === '' ? ' empty' : '') + '" data-action="r-drum" aria-label="回数を選択">' +
            (s.r === '' ? '回' : esc(s.r)) + '</button>' +
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

  /* 有酸素の入力セル（時間ボタン＋数値5項目）。数値欄は値が入っているときだけクリアボタンを出す */
  function cardioCells(s) {
    var timeVal = fmtCardioTime(s);
    var timeCell = '<label class="cf">' +
      '<span class="cf-label">時間</span>' +
      '<span class="cf-inputwrap">' +
        '<button class="cf-time-btn num' + (timeVal ? '' : ' empty') + '" data-action="ctime-open" type="button">' + (timeVal || '分') + '</button>' +
      '</span>' +
    '</label>';
    return timeCell + CARDIO_FIELDS.map(function (f) {
      var isInt = f.step.indexOf('.') < 0;
      var mode = isInt ? 'numeric' : 'decimal';
      var patternAttr = isInt ? ' pattern="[0-9]*"' : '';
      var filled = !(s[f.k] === '' || s[f.k] == null);
      return '<label class="cf">' +
        '<span class="cf-label">' + f.label + '</span>' +
        '<span class="cf-inputwrap">' +
          '<input type="text" inputmode="' + mode + '"' + patternAttr + ' data-field="' + f.k + '" value="' + esc(s[f.k]) + '" placeholder="0">' +
          '<button type="button" class="cf-clear' + (filled ? ' on' : '') + '" data-action="cf-clear" tabindex="-1" aria-label="' + f.label + 'を消す">✕</button>' +
          '<span class="cf-unit">' + f.unit + '</span>' +
        '</span>' +
      '</label>';
    }).join('');
  }

  /* 強度チップ。タップするたび WORK → REST → タグなし と巡回する */
  function zoneChip(z) {
    var meta = ZONES[z];
    return '<button type="button" class="zchip num ' + (meta ? meta.cls : 'z-none') + '" data-action="z-cycle" ' +
      'aria-label="強度を切り替え（現在' + (meta ? meta.label : 'タグなし') + '）">' + (meta ? meta.label : '—') + '</button>';
  }

  /* コンパクト行の右側に出す補足。入力済みのものだけを最大3つまで */
  function lapSub(s) {
    var p = [];
    if (+s.sp) p.push(fmtNum(s.sp) + ' km/h');
    if (+s.d) p.push(fmtNum(s.d) + ' km');
    if (+s.hr) p.push(esc(s.hr) + ' bpm');
    if (+s.inc) p.push(esc(s.inc) + ' %');
    if (+s.cal) p.push(esc(s.cal) + ' kcal');
    return p.slice(0, 3).join(' · ');
  }

  /* 強度タグ付きセッション＝1行のコンパクト表示。タップしたものだけ全項目を開く */
  function lapHtml(e, s, idx) {
    var open = !!ui.lapOpen[e.id + '/' + idx];
    var timeVal = fmtCardioTime(s);
    var row = '<div class="lap' + (open ? ' open' : '') + '" data-idx="' + idx + '" data-action="lap-toggle">' +
      '<span class="lap-n num">' + (idx + 1) + '</span>' +
      zoneChip(zoneOf(s)) +
      '<span class="lap-t num' + (timeVal ? '' : ' empty') + '">' + (timeVal || '—') + '</span>' +
      '<span class="lap-sub">' + lapSub(s) + '</span>' +
      '<span class="lap-caret">' + (open ? '▲' : '▼') + '</span>' +
    '</div>';
    if (!open) return row;
    return row + '<div class="lap-body" data-idx="' + idx + '">' +
      '<div class="cardio-grid">' + cardioCells(s) + '</div>' +
      '<button class="link danger lap-del" type="button" data-action="del-set">このセッションを削除</button>' +
    '</div>';
  }

  /* 強度タグなしのセッション＝従来どおり全項目を並べたカード */
  function cardioSetHtml(e, s, idx) {
    return '<div class="cardio-set" data-idx="' + idx + '">' +
      '<div class="cardio-set-head">' +
        '<span class="set-no num">' + (idx + 1) + '</span>' +
        zoneChip(zoneOf(s)) +
        '<span class="cardio-set-label">セッション ' + (idx + 1) + '</span>' +
        '<button class="set-del" data-action="del-set" aria-label="セッション削除">✕</button>' +
      '</div>' +
      '<div class="cardio-grid">' + cardioCells(s) + '</div>' +
    '</div>';
  }

  /* カード下部に出す合計。強度別の内訳もここで作る */
  function cardioTotals(e) {
    var t = { sec: 0, dist: 0, hi: { n: 0, sec: 0 }, rec: { n: 0, sec: 0 } };
    e.sets.forEach(function (s) {
      var sec = setSeconds(s);
      t.sec += sec;
      t.dist += (+s.d || 0);
      var z = zoneOf(s);
      if (z === 'hi') { t.hi.n++; t.hi.sec += sec; }
      else if (z === 'rec') { t.rec.n++; t.rec.sec += sec; }
    });
    return t;
  }
  function cardioTotalHtml(t) {
    return '計 <b class="num">' + fmtNum(t.sec / 60) + '</b>分 · <b class="num">' + fmtNum(t.dist) + '</b>km';
  }
  function zoneSumHtml(t) {
    if (!t.hi.n && !t.rec.n) return '';
    var one = function (z, d) {
      if (!d.n) return '';
      return '<span class="' + ZONES[z].cls + '"><i>' + ZONES[z].label + '</i> ' + d.n + '本 ' + fmtSeconds(d.sec) + '</span>';
    };
    return '<div class="zsum">' + one('hi', t.hi) + one('rec', t.rec) + '</div>';
  }

  /* 有酸素種目：時間・距離・速度・傾斜・カロリー・心拍。強度タグ付きは1行に畳む */
  function cardioEntryHtml(e, i) {
    var rows = e.sets.map(function (s, idx) {
      return zoneOf(s) ? lapHtml(e, s, idx) : cardioSetHtml(e, s, idx);
    }).join('');
    var t = cardioTotals(e);

    return '<article class="entry" data-entry="' + e.id + '" style="animation-delay:' + Math.min(i * 50, 300) + 'ms">' +
      entryHead(e) +
      prevLine(e) +
      '<div class="sets cardio-sets">' + rows + '</div>' +
      '<div class="entry-foot">' +
        '<button class="btn ghost small" data-action="add-set">＋ セッション追加</button>' +
        '<button class="btn-interval" data-action="gen-open" type="button">⚡ インターバル</button>' +
        '<span class="vol">' + cardioTotalHtml(t) + '</span>' +
      '</div>' +
      zoneSumHtml(t) +
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
      } else if (a === 'r-drum') {
        openRepsDrum(id, idx);
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
        // 削除で以降の番号が1つずつ繰り上がるため、開いていた行の記憶は捨てる（別の行が開くのを防ぐ）
        Object.keys(ui.lapOpen).forEach(function (key) {
          if (key.indexOf(id + '/') === 0) delete ui.lapOpen[key];
        });
        renderLog();
      } else if (a === 'z-cycle') {
        var cur = ZONE_ORDER.indexOf(zoneOf(DB.getSet(ui.date, id, idx) || {}));
        var next = ZONE_ORDER[(cur + 1) % ZONE_ORDER.length];
        DB.updateSet(ui.date, id, idx, 'z', next);
        // タグを外すと1行表示から通常カードに戻るので、開いた状態は持ち越さない
        if (!next) delete ui.lapOpen[id + '/' + idx];
        renderLog();
      } else if (a === 'lap-toggle') {
        var key = id + '/' + idx;
        if (ui.lapOpen[key]) delete ui.lapOpen[key];
        else ui.lapOpen[key] = true;
        renderLog();
      } else if (a === 'gen-open') {
        openGen(id);
      } else if (a === 'cf-clear') {
        // 実処理は pointerdown 側（フォーカスを外さないため）。ここでは何もしない
        return;
      } else if (a === 'w-' || a === 'w+' || a === 'r-' || a === 'r+') {
        var field = (a.charAt(0) === 'w') ? 'w' : 'r';
        var delta = (a.charAt(1) === '+' ? 1 : -1) * (field === 'w' ? weightStepSettings.step : 1);
        var s = DB.getSet(ui.date, id, idx);
        var val = Math.max(0, ((s && +s[field]) || 0) + delta);
        val = Math.round(val * 100) / 100;
        DB.updateSet(ui.date, id, idx, field, val);
        checkRecordToast(id);
        renderLog();
      }
    });

    bindCaretPlacement('#entries', 'input[data-field]', caretToEnd);

    /* ✕（クリア）は pointerdown で処理する。
       click まで待つと先に input が blur → change → renderLog が走り、
       押した対象のDOMごと作り替わってしまうため */
    $('#entries').addEventListener('pointerdown', function (e) {
      var btn = e.target.closest('[data-action="cf-clear"]');
      if (!btn) return;
      e.preventDefault();          // フォーカスを移動させない＝キーボードを閉じない
      var input = btn.parentNode.querySelector('input[data-field]');
      var entryEl = btn.closest('.entry');
      var rowEl = btn.closest('[data-idx]');
      if (!input || !entryEl || !rowEl) return;
      input.value = '';
      btn.classList.remove('on');
      DB.updateSet(ui.date, entryEl.dataset.entry, +rowEl.dataset.idx, input.dataset.field, '');
      refreshCardio(entryEl, +rowEl.dataset.idx);
      if (document.activeElement !== input) input.focus();
    });

    /* 直接入力（blur時に保存）。
       ここで renderLog() を呼んではいけない：#entries が丸ごと作り替わるため、
       「速度を入れて、そのまま心拍の欄をタップする」と、指が触れた瞬間に前の欄のblur→再描画が走り、
       タップ先の要素が消えて入力が1つ丸ごと失われる（有酸素だけがテキスト入力なので有酸素だけで起きる）。
       必要な箇所（値の正規化・クリアボタン・合計・行の要約・サマリータイル）だけを書き換える */
    $('#entries').addEventListener('change', function (e) {
      var input = e.target.closest('input[data-field]');
      if (!input) return;
      var entryEl = e.target.closest('.entry');
      var rowEl = e.target.closest('[data-idx]');
      if (!entryEl || !rowEl) return;
      var v = (input.value === '') ? '' : Math.max(0, parseFloat(input.value) || 0);
      DB.updateSet(ui.date, entryEl.dataset.entry, +rowEl.dataset.idx, input.dataset.field, v);
      checkRecordToast(entryEl.dataset.entry);
      // 「5.30」→「5.3」、「-3」→「0」のように、保存された値を表示にも反映する（従来は再描画が担っていた）
      input.value = (v === '') ? '' : String(v);
      var clearBtn = input.parentNode.querySelector('.cf-clear');
      if (clearBtn) clearBtn.classList.toggle('on', v !== '');
      refreshCardio(entryEl, +rowEl.dataset.idx);
    });
  }

  /* 入力中に全再描画せず、値に連動する表示だけをその場で書き換える */
  function refreshCardio(entryEl, idx) {
    var w = DB.getWorkout(ui.date);
    renderDayStats(w);
    var e = ((w && w.entries) || []).filter(function (x) { return x.id === entryEl.dataset.entry; })[0];
    if (!e || !isCardio(e)) return;
    var t = cardioTotals(e);

    var vol = entryEl.querySelector('.entry-foot .vol');
    if (vol) vol.innerHTML = cardioTotalHtml(t);

    var zs = entryEl.querySelector('.zsum');
    var zsHtml = zoneSumHtml(t);
    if (zs && zsHtml) zs.outerHTML = zsHtml;
    else if (zs) zs.parentNode.removeChild(zs);
    else if (zsHtml) entryEl.insertAdjacentHTML('beforeend', zsHtml);

    var s = e.sets[idx];
    var lap = entryEl.querySelector('.lap[data-idx="' + idx + '"]');
    if (s && lap) {
      var tv = fmtCardioTime(s);
      var tEl = lap.querySelector('.lap-t');
      if (tEl) { tEl.textContent = tv || '—'; tEl.classList.toggle('empty', !tv); }
      var subEl = lap.querySelector('.lap-sub');
      if (subEl) subEl.innerHTML = lapSub(s);
    }
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
  /* ---- ワークアウトデイ（カレンダー） ----
     v0.11.0でグラフタブから移設した。ここで選んだ「日」と「部位」が、
     そのまま下の履歴一覧の絞り込みも兼ねる（カレンダーは見るだけのものではなくなった） */
  var HIST_CAL_OPEN_KEY = 'kintore_hist_cal_open';
  var histCal ={ part: 'ALL', year: null, month: null, date: null, open: true };
  (function initHistCal() {
    var t = parseDate(DB.todayStr());
    histCal.year = t.getFullYear();
    histCal.month = t.getMonth();
    /* 開閉だけは端末に残す。選んだ日はアプリを開いている間だけの状態にする（次に開いたら全件から始めたいため） */
    try { histCal.open = localStorage.getItem(HIST_CAL_OPEN_KEY) !== '0'; } catch (err) { /* 参照できなくても既定の「開」でよい */ }
  })();

  /* 部位ごとに「記録がある日（has）」と「実際に数値が入っている日（trained）」を集める。
     has = 一覧に出す日 かつ カレンダーで押せる日、trained = 色で塗る日。
     2つを分けているのは、種目を足しただけで数値が未入力の日も履歴には出るため。
     塗られた日だけ押せる作りにすると、一覧に並んでいるのに選べない日ができて理由が分からなくなる */
  function histDayInfo(part) {
    var has = {}, trained = {}, dates = [];
    DB.datesWithData().forEach(function (date) {
      var w = DB.getWorkout(date);
      var entries = (w.entries || []).filter(function (e) { return part === 'ALL' || e.part === part; });
      /* ALLのときはメモやコンディションだけの日も落とさない（従来の履歴に出ていたため） */
      if (!entries.length && !(part === 'ALL' && (w.memo || w.condition))) return;
      has[date] = true;
      dates.push(date);
      if (entries.some(function (e) { return filledSets(e).length > 0; })) trained[date] = true;
    });
    return { has: has, trained: trained, dates: dates };
  }

  function renderHistCalPartChips() {
    var byPart = {};
    DB.getExercises().forEach(function (x) { (byPart[x.part] = byPart[x.part] || []).push(x); });
    var chips = ['ALL'].concat(DB.PARTS.filter(function (p) { return byPart[p] && byPart[p].length; }));
    if (chips.indexOf(histCal.part) < 0) histCal.part = 'ALL';  /* 絞り込み中の部位の種目が全部消えたとき */
    $('#calPartChips').innerHTML = chips.map(function (p) {
      return '<button class="cal-pchip' + (p === histCal.part ? ' active' : '') +
        '" data-cal-part="' + esc(p) + '" type="button">' + esc(p) + '</button>';
    }).join('');
  }

  function renderHistCalendar() {
    var y = histCal.year, m = histCal.month;
    var startDow = new Date(y, m, 1).getDay();
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var prevDays = new Date(y, m, 0).getDate();
    var info = histDayInfo(histCal.part);
    /* 塗りの色はテーマで変わるのでCSS変数から読む。ALLは既定のボルトイエロー、部位選択中はその部位の色 */
    var volt = DB.cssVar('--volt', '#d7ff3e');
    var color = histCal.part === 'ALL' ? volt : (DB.PART_COLOR[histCal.part] || volt);
    /* ライトテーマの部位カラーは濃い色なので、塗った日の数字は白に反転させないと読めない */
    var onColor = DB.textOn(color);
    var today = DB.todayStr();

    var cells = '';
    for (var i = 0; i < startDow; i++) {
      cells += '<span class="cal-day other-month">' + (prevDays - startDow + 1 + i) + '</span>';
    }
    for (var d = 1; d <= daysInMonth; d++) {
      var ds = y + '-' + ('0' + (m + 1)).slice(-2) + '-' + ('0' + d).slice(-2);
      var cls = 'cal-day', style = '';
      if (info.trained[ds]) { cls += ' trained'; style = ' style="background:' + color + ';border-color:' + color + ';color:' + onColor + '"'; }
      else if (info.has[ds]) { cls += ' has-rec'; style = ' style="--dot-color:' + color + '"'; }
      if (ds === today) cls += ' today';
      if (ds === histCal.date) cls += ' sel';
      /* 記録のある日だけ button にする。記録のない日・未来日は span のままで押せない */
      cells += info.has[ds]
        ? '<button type="button" class="' + cls + '" data-cal-date="' + ds + '"' + style +
            ' aria-pressed="' + (ds === histCal.date ? 'true' : 'false') + '">' + d + '</button>'
        : '<span class="' + cls + '">' + d + '</span>';
    }
    var trailing = (7 - ((startDow + daysInMonth) % 7)) % 7;
    for (var j = 1; j <= trailing; j++) cells += '<span class="cal-day other-month">' + j + '</span>';

    $('#calGrid').innerHTML = cells;
    $('#calMonthLabel').textContent = y + '年' + (m + 1) + '月';
  }

  /* 絞り込み中だけ「すべて表示」を出す。
     v0.11.0では「2026/8/9(日) の記録」と日付も並べていたが、選択中の日はカレンダーで光っていて
     下のカードにも日付が出ているため、同じことを三度言っていた。しかも日付の真横に「すべて表示」が
     並ぶせいで“その日の全部を表示するボタン”と読めてしまう。文言を消してボタンだけ中央に置く */
  function renderHistFilterBar() {
    var filtering = histCal.date || histCal.part !== 'ALL';
    $('#histFilterBar').innerHTML = filtering
      ? '<div class="hist-filter-bar">' +
          '<button class="link" data-action="hist-clear" type="button">すべて表示</button></div>'
      : '';
  }

  function applyHistCalOpen() {
    $('#calCard').classList.toggle('collapsed', !histCal.open);
    $('#calToggle').classList.toggle('closed', !histCal.open);
    $('#calToggle').setAttribute('aria-expanded', histCal.open ? 'true' : 'false');
  }

  function renderHistory() {
    applyHistCalOpen();
    renderHistCalPartChips();
    renderHistCalendar();
    renderHistFilterBar();
    renderHistoryList();
  }

  function renderHistoryList() {
    var info = histDayInfo(histCal.part);
    var dates = info.dates.slice().reverse();
    if (histCal.date) dates = dates.filter(function (x) { return x === histCal.date; });
    if (!dates.length) {
      var filtering = histCal.date || histCal.part !== 'ALL';
      $('#historyList').innerHTML = '<div class="placeholder"><div class="ph-icon">📓</div><p>' +
        (filtering ? '該当する記録がありません' : 'まだ記録がありません') + '</p></div>';
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
      // 有酸素は記録カードの前回行と同じ要約（cardioPrevBody）を使う。
      // インターバルだと16セッションが並んで読めなくなるうえ、分(t)だけ見ると30秒が0分と出てしまうため
      var setsHtml = isCardio(e)
        ? (cardioPrevBody(e.sets) || '—')
        : esc(e.sets.map(function (s) { return (s.w || 0) + '×' + (s.r || 0); }).join(' / ') || '—');
      return '<div class="h-entry">' + partChip(e.part) + '<b>' + esc(e.name) + '</b>' + equipTag(e.equip) +
        '<span class="h-sets">' + setsHtml + '</span></div>';
    }).join('');
    return '<div class="h-body">' + rows +
      (w.memo ? '<p class="h-memo">' + esc(w.memo) + '</p>' : '') +
      '<div class="h-actions">' +
        '<button class="link" data-action="open-day">この日を開く</button>' +
        '<button class="link danger" data-action="del-day">この日の記録を削除</button>' +
      '</div>' +
    '</div>';
  }

  function shiftHistMonth(delta) {
    var d = new Date(histCal.year, histCal.month + delta, 1);
    histCal.year = d.getFullYear();
    histCal.month = d.getMonth();
    renderHistCalendar();   /* 月を動かしても選択日と一覧はそのまま（上のバーに何で絞っているか出ている） */
  }

  /* 選んだ日だけを一覧に出す。同じ日をもう一度押したら解除 */
  function selectHistDate(date) {
    histCal.date = (histCal.date === date) ? null : date;
    if (histCal.date) ui.expanded[histCal.date] = true;   /* 選んだ日は中身まで開いて見せる */
    renderHistory();
  }

  function bindHistory() {
    $('#calToggle').addEventListener('click', function () {
      histCal.open = !histCal.open;
      applyHistCalOpen();
      try { localStorage.setItem(HIST_CAL_OPEN_KEY, histCal.open ? '1' : '0'); } catch (err) { /* 保存できなくても表示には支障がない */ }
    });
    $('#calPrev').addEventListener('click', function () { shiftHistMonth(-1); });
    $('#calNext').addEventListener('click', function () { shiftHistMonth(1); });
    $('#calGrid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cal-date]');
      if (b) selectHistDate(b.dataset.calDate);
    });
    $('#calPartChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cal-part]');
      if (!b) return;
      histCal.part = b.dataset.calPart;
      /* 部位を変えた結果その日が対象外になったら選択を外す。
         残したままだと「空の一覧」だけが出て、なぜ0件なのか分からなくなる */
      if (histCal.date && !histDayInfo(histCal.part).has[histCal.date]) histCal.date = null;
      renderHistory();
    });
    $('#histFilterBar').addEventListener('click', function (e) {
      if (!e.target.closest('[data-action="hist-clear"]')) return;
      histCal.date = null;
      histCal.part = 'ALL';
      renderHistory();
    });

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
            if (histCal.date === date) histCal.date = null;  /* 消した日を選んだままだと0件表示になる */
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
    $('#storageInfo').textContent = (isNativeApp() ? 'この端末に保存中 · 約 ' : 'ブラウザ内に保存中 · 約 ') + DB.sizeKB() + ' KB';
    $('#restoreBackupRow').style.display = hasPreimportBackup() ? '' : 'none';
    renderStorageSection();
    renderSyncSection();
    renderWeightStepSettings();
    renderThemeSettings();
  }

  /* ================== 記録：重量±ボタンの刻み幅設定 ================== */
  function renderWeightStepSettings() {
    var box = $('#weightStepList');
    if (!box) return;
    box.innerHTML = WEIGHT_STEP_OPTIONS.map(function (v) {
      return '<button class="sound-row' + (v === weightStepSettings.step ? ' selected' : '') + '" data-wstep="' + v + '" type="button">' +
        '<span class="sound-name">' + drumFmt(v) + ' kg ずつ</span>' +
        '<span class="sound-check">✓</span>' +
      '</button>';
    }).join('');
  }

  /* @sync:start
     ここから @sync:end までは iOS ビルド（build-ios.js）で「何もしないスタブ」に
     差し替えられ、App Store 版にはクラウド同期が一切入らない（ガイドライン2.3.1対策）。
     呼び出し側（renderLog の空状態・renderSettings・bindSettings・起動時/visibilitychange）は
     一切書き換えないため、PWA 版の挙動はこのマーカーを足す前とまったく同じ。
     ブロック外から呼ばれるのは syncUnlocked / getGasUrl / setGasUrl / checkGasUrl /
     onVersionTap / renderSyncSection / runSync / autoSync / restoreFromCloud /
     promptCloudRestore の10個で、build-ios.js のスタブはこの10個を空実装で用意する。
     ここに関数を足して外から呼ぶ場合は、build-ios.js の STUB にも同名を追加すること。 */
  /* ================== クラウド同期（スプレッドシート・Phase 4） ==================
     一般公開時に非エンジニアのユーザーを混乱させないよう、設定画面には常時表示しない。
     設定画面末尾のバージョン表示を7回連続タップすると解除され、以後はこの端末で常に表示される。 */
  var SYNC_UNLOCK_KEY = 'kintore_sync_unlocked';
  var GAS_URL_KEY = 'kintore_gas_url';
  var LAST_SYNC_KEY = 'kintore_last_sync';

  function syncUnlocked() { try { return localStorage.getItem(SYNC_UNLOCK_KEY) === '1'; } catch (e) { return false; } }
  function getGasUrl() { try { return localStorage.getItem(GAS_URL_KEY) || ''; } catch (e) { return ''; } }
  function setGasUrl(url) { try { localStorage.setItem(GAS_URL_KEY, url); } catch (e) { /* noop */ } }
  function getLastSync() { try { return localStorage.getItem(LAST_SYNC_KEY) || ''; } catch (e) { return ''; } }
  function setLastSync(iso) { try { localStorage.setItem(LAST_SYNC_KEY, iso); } catch (e) { /* noop */ } }

  /* GAS Web AppのURLかどうかを判定する唯一の窓口。
     スプレッドシートの閲覧URL（docs.google.com/…）を貼る取り違えが繰り返し起きたため、
     入力箇所ごとに判定を書かず必ずここを通し、不正なURLはそもそも保存させない。
     戻り値: { ok: true, url } または { ok: false, error: 表示メッセージ } */
  function checkGasUrl(input) {
    var v = String(input || '').trim();
    if (!v) return { ok: false, error: 'URLが入力されていません。' };
    if (v.indexOf('docs.google.com') >= 0) {
      return { ok: false, error: 'それはスプレッドシートを開くためのURLです。\n\n必要なのは Apps Script を「ウェブアプリとしてデプロイ」したときに発行される、\nhttps://script.google.com/macros/s/…/exec\nという形式のURLです。' };
    }
    if (v.indexOf('https://script.google.com/') !== 0) {
      return { ok: false, error: 'バックアップ用のURLは https://script.google.com/ で始まります。\n入力されたURLは形式が違うようです。' };
    }
    if (v.slice(-5) !== '/exec') {
      return { ok: false, error: 'URLの末尾が /exec になっているか確認してください。\n（/dev で終わるURLは開発用のため使えません）' };
    }
    return { ok: true, url: v };
  }

  var versionTapCount = 0;
  var versionTapTimer = null;
  function onVersionTap() {
    clearTimeout(versionTapTimer);
    versionTapCount++;
    versionTapTimer = setTimeout(function () { versionTapCount = 0; }, 1500);
    if (versionTapCount < 7) return;
    versionTapCount = 0;
    if (!syncUnlocked()) {
      try { localStorage.setItem(SYNC_UNLOCK_KEY, '1'); } catch (e) { /* noop */ }
      toast('クラウド同期を表示しました');
      renderSyncSection();
    }
  }

  function renderSyncSection() {
    var box = $('#syncSectionContainer');
    if (!box) return;
    if (!syncUnlocked()) { box.innerHTML = ''; return; }
    var pending = DB.dirtyDates().length;
    var last = getLastSync();
    var lastText = last ? new Date(last).toLocaleString('ja-JP') : '未同期';
    var pendingParts = [];
    if (pending) pendingParts.push(pending + '件');
    if (DB.exercisesDirty()) pendingParts.push('種目リスト');
    if (pendingParts.length) lastText += '（未送信 ' + pendingParts.join('・') + '）';
    box.innerHTML =
      '<div class="s-section">' +
        '<h4 class="s-title">クラウド同期</h4>' +
        '<div class="panel-list">' +
          '<div class="s-row">' +
            '<div class="s-main"><b>GAS Web AppのURL</b><small>スプレッドシート連携用に発行したURLを貼り付け</small></div>' +
          '</div>' +
          '<div class="s-row">' +
            '<input id="gasUrlInput" class="sync-url-input" type="text" placeholder="https://script.google.com/macros/s/.../exec" value="' + esc(getGasUrl()) + '">' +
          '</div>' +
          '<div class="s-row">' +
            '<div class="s-main"><b>最終同期</b><small id="syncStatusText">' + esc(lastText) + '・変更は起動時と画面切替時に自動送信</small></div>' +
            '<button class="link" id="syncNowBtn" type="button">今すぐバックアップ</button>' +
          '</div>' +
          '<div class="s-row">' +
            '<div class="s-main"><b>復元</b><small>スプレッドシートの記録と種目をこの端末へ取り込む</small></div>' +
            '<button class="link" id="restoreCloudBtn" type="button">スプレッドシートから復元</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* バックアップに毎回同梱する全種目リスト（「種目」シートにマージ保存される） */
  function collectExerciseRows() {
    return DB.getExercises().map(function (x) {
      return [x.part, x.name, x.equip || '', x.video || '', x.note || ''];
    });
  }

  /* 削除した種目（「種目」シートからも消すために送る）。
     シートへの保存はマージ方式のため、削除は明示的に伝えないと反映されない */
  function collectDeletedExerciseRows() {
    return DB.deletedExercises().map(function (d) {
      return [d.part, d.name, d.equip || ''];
    });
  }

  var syncInFlight = false; // 起動時の自動送信・画面切替時・手動ボタンの二重送信を防ぐ

  function runSync(opts) {
    opts = opts || {};
    var url = getGasUrl();
    if (!url) { if (!opts.auto) toast('GAS Web AppのURLを入力してください'); return; }
    var dates = DB.dirtyDates();
    var exOnly = false;
    if (!dates.length) {
      if (DB.exercisesDirty()) {
        // 種目マスタだけが変更されている：記録行なしで種目リストのみ送る
        exOnly = true;
      } else if (opts.auto) {
        return;
      } else {
        // 手動時：未送信の変更が無くても全記録の送り直しを提案する。
        // 過去に誤ったURL宛の送信を成功扱いにしてしまった等で「送信済み扱いなのに
        // スプレッドシートに届いていない」状態から回復するための手段
        var all = DB.datesWithData();
        if (!all.length) { toast('送信する記録がありません'); return; }
        if (!confirm('✅ すべてバックアップ済みです（未送信の変更はありません）。\n念のため全記録（' + all.length + '日分）を送り直す場合はOKを押してください。')) return;
        dates = all;
      }
    }
    if (syncInFlight) return;
    syncInFlight = true;
    var payload = {
      dates: dates,
      rows: [],
      exercises: collectExerciseRows(),
      deletedExercises: collectDeletedExerciseRows()
    };
    dates.forEach(function (date) {
      rowsForDate(date).forEach(function (row) { payload.rows.push(row); });
    });
    var btn = $('#syncNowBtn');
    if (btn && !opts.auto) { btn.disabled = true; btn.textContent = '送信中…'; }
    fetch(url, {
      method: 'POST',
      // GASのWeb Appはプリフライト(OPTIONS)に応答しないため、text/plainで送りCORSプリフライトを回避する
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      // 画面切替時の自動送信はページが隠れた後も送信を続行させる（keepaliveはボディ64KB制限
      // があるため常用せず、差分が小さいこのケースに限って付ける）
      keepalive: !!opts.keepalive
    })
      // JSONを返さない応答（誤ったURL宛など）を成功扱いにしない。
      // 以前は json() 失敗時に {ok:true} へフォールバックしていたため、届いていないのに
      // 「送信済み」となり以後の再送が行われなくなる不具合があった
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        if (json && json.ok === false) throw new Error(json.error || 'sync failed');
        DB.clearDirty(dates);
        DB.clearExercisesDirty();
        DB.clearDeletedExercises(); // 削除がシートへ反映できたので控えを消す（失敗時は残り次回再送）
        setLastSync(new Date().toISOString());
        if (!opts.auto) toast(exOnly ? '種目リストをバックアップしました' : 'バックアップが完了しました（' + dates.length + '日分）');
      })
      .catch(function () {
        // 失敗時はdirtyが残るため、次の起動時・画面切替時・手動バックアップで自動的に再送される
        if (!opts.auto) toast('バックアップに失敗しました。URLや通信環境を確認してください');
      })
      .then(function () {
        syncInFlight = false;
        if (btn && !opts.auto) { btn.disabled = false; btn.textContent = '今すぐバックアップ'; }
        renderSyncSection();
      });
  }

  /* 未送信の変更（記録または種目リスト）があれば静かにバックアップする（URL未設定・失敗時は何もしない） */
  function autoSync(opts) {
    if (!getGasUrl()) return;
    if (!DB.dirtyDates().length && !DB.exercisesDirty()) return;
    runSync({ auto: true, keepalive: !!(opts && opts.keepalive) });
  }

  /* スプレッドシートから全記録＋種目リストを取り込む */
  function restoreFromCloud() {
    var url = getGasUrl();
    if (!url) { toast('GAS Web AppのURLを入力してください'); return; }
    var btn = $('#restoreCloudBtn');
    if (btn) { btn.disabled = true; btn.textContent = '読み込み中…'; }
    var done = function () {
      if (btn) { btn.disabled = false; btn.textContent = 'スプレッドシートから復元'; }
    };
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'restore' })
    })
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (!json || json.ok === false) throw new Error((json && json.error) || 'restore failed');
        var rows = json.rows || [];
        if (!rows.length) { toast('スプレッドシートに記録がありません'); done(); return; }
        // 記録行はCSVインポートと同じ17列形式なので、ヘッダー行を先頭に足して取り込み処理を流用する
        var data = buildImportData([ROW_HEAD].concat(rows));
        if (data.error) { toast(data.error); done(); return; }
        if (!data.dateOrder.length) { toast('取り込めるデータが見つかりませんでした'); done(); return; }
        var ok = confirm('クラウドバックアップから ' + data.dateOrder.length + '日分・' + data.rowCount + '件を復元します。\n対象の日の記録は置き換わります。よろしいですか？');
        if (!ok) { done(); return; }
        var backupJSON = DB.exportStateJSON();
        try {
          DB.applyImport(data.dateOrder, data.byDate);
          DB.importExercises((json.exercises || []).map(function (r) {
            return { part: String(r[0] || ''), name: String(r[1] || ''), equip: String(r[2] || ''), video: String(r[3] || ''), note: String(r[4] || '') };
          }));
        } catch (e) {
          if (backupJSON) DB.restoreStateJSON(backupJSON);
          toast('復元に失敗したため元に戻しました');
          done();
          return;
        }
        if (backupJSON) {
          try { localStorage.setItem(PREIMPORT_BACKUP_KEY, backupJSON); } catch (e) { /* noop */ }
        }
        DB.clearDirty(data.dateOrder); // スプシ由来のデータはスプシと一致しているため再送不要
        setLastSync(new Date().toISOString());
        renderLog();
        renderSettings();
        toast(data.dateOrder.length + '日分の記録を復元しました');
        done();
      })
      .catch(function () {
        toast('復元に失敗しました。URLや通信環境を確認してください');
        done();
      });
  }
  /* @sync:end */

  /* ================== ネイティブ連携（Capacitor / App Store版でのみ動く） ==================
     PWA（ブラウザ）には window.Capacitor が無いため、この節の関数はすべて何もしないで返る。
     PWA版とApp Store版でソースを分岐させないための共通実装（build-ios.js の除去対象ではない）。 */

  function isNativeApp() {
    try {
      return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    } catch (e) { return false; }
  }
  /* Capacitor.Plugins は registerPlugin() を呼んだ時点で初めて中身が入る（capacitor.js の実装）。
     参照するだけでは undefined なので、未登録なら自分で登録してから使う。
     ネイティブ側にそのプラグインが組み込まれていない場合はプロキシが返り、
     実際に呼んだときに reject するため、呼び出し側はすべて catch している。 */
  var nativePluginCache = {};
  function nativePlugin(name) {
    if (Object.prototype.hasOwnProperty.call(nativePluginCache, name)) return nativePluginCache[name];
    var p = null;
    try {
      var C = window.Capacitor;
      if (C && typeof C.registerPlugin === 'function') {
        p = (C.Plugins && C.Plugins[name]) || C.registerPlugin(name);
      }
    } catch (e) { p = null; }
    nativePluginCache[name] = p;
    return p;
  }

  /* ---- 端末内バックアップ（iOSの端末バックアップ／iCloudに載せる） ----
     WKWebViewのlocalStorageがiOSのバックアップに含まれるかは実装依存で確証が無いため、
     「ユーザーが作成したデータの置き場」としてバックアップ対象が明示されている Documents/ にも
     まるごと書き出しておく。機種変更・再インストール後の初回起動で記録が空なら自動で読み戻す。 */
  var NATIVE_BACKUP_FILE = 'kintore-backup.json';
  var NATIVE_BACKUP_AT_KEY = 'kintore_native_backup_at';
  /* 復元の読み込み中は書き出しを止める。
     機種変更直後は記録が空の状態で起動するため、読み終わる前に書いてしまうと
     「空のデータ」でバックアップを上書きし、復元元を自分で消すことになる */
  var nativeRestorePending = false;

  function getNativeBackupAt() {
    try { return localStorage.getItem(NATIVE_BACKUP_AT_KEY) || ''; } catch (e) { return ''; }
  }

  function writeNativeBackup() {
    var fsPlugin = nativePlugin('Filesystem');
    if (!isNativeApp() || !fsPlugin) return Promise.resolve(false);
    if (nativeRestorePending) return Promise.resolve(false);
    var json = DB.exportStateJSON();
    if (!json) return Promise.resolve(false);
    return fsPlugin.writeFile({
      path: NATIVE_BACKUP_FILE,
      data: json,
      directory: 'DOCUMENTS',
      encoding: 'utf8',
      recursive: true
    }).then(function () {
      try { localStorage.setItem(NATIVE_BACKUP_AT_KEY, new Date().toISOString()); } catch (e) { /* noop */ }
      renderStorageInfo();
      return true;
    }).catch(function () {
      // 失敗しても記録はlocalStorageに残っている。次の起動・画面切替で再試行される
      return false;
    });
  }

  /* 起動時：記録が1件も無いときだけ、端末内バックアップから読み戻す。
     記録がある端末では絶対に触らない（古いバックアップで現在のデータを潰さないため） */
  function restoreNativeBackupIfEmpty() {
    var fsPlugin = nativePlugin('Filesystem');
    if (!isNativeApp() || !fsPlugin) return;
    if (DB.datesWithData().length) return;
    nativeRestorePending = true;
    fsPlugin.readFile({ path: NATIVE_BACKUP_FILE, directory: 'DOCUMENTS', encoding: 'utf8' })
      .then(function (res) {
        nativeRestorePending = false;
        var data = res && res.data;
        if (!data) return;
        if (DB.datesWithData().length) return; // 読み込み待ちの間に記録が入った場合は上書きしない
        if (!DB.restoreStateJSON(data)) return;
        renderLog();
        renderSettings();
        toast('バックアップから記録を復元しました');
      })
      .catch(function () {
        nativeRestorePending = false; // ファイルが無いのは初回起動として正常
      });
  }

  /* ---- 消音モード（サイレントスイッチ）の扱い ----
     WKWebViewの音は既定でサイレントスイッチに従うため、消音のままトレーニングしていると
     アプリを開いていてもアラームが鳴らない。ネイティブ側の AVAudioSession を
     .playback にすると消音でも鳴るようになる（AlarmAudioプラグイン＝AppDelegate.swift）。
     プラグインが無い／古いビルドでは reject されるが、AppDelegate 側が起動時に
     .playback を張っているので「鳴る」状態が既定になる（設定が効かないだけで無音にはならない）。 */
  function applySilentModeSetting() {
    if (!isNativeApp()) { soundDiag.session = '—（ブラウザ版）'; return Promise.resolve(false); }
    var pl = nativePlugin('AlarmAudio');
    if (!pl) { soundDiag.session = 'NG: プラグイン未登録'; return Promise.resolve(false); }
    return pl.setIgnoreSilentMode({ value: !!timerSettings.ignoreSilent })
      .then(function (r) {
        soundDiag.session = (r && r.category ? r.category : (timerSettings.ignoreSilent ? 'playback' : 'ambient'));
        return true;
      })
      .catch(function () { soundDiag.session = 'NG: 呼び出し失敗'; return false; });
  }

  /* ---- 通知音として使うWAVを Library/Sounds/ へ置く ----
     UNNotificationSound はファイル名しか受け取れず、探しに行く先は
     アプリ本体のbundle直下か Library/Sounds/ の2箇所だけ。
     Capacitorのweb資産は bundle の public/ 配下に入るので通知からは参照できない。
     そこで初回起動時に sounds/*.wav を Library/Sounds/ へコピーしておく。
     音源を作り直したら ALARM_ASSET_VERSION を上げてコピーし直させること。 */
  var ALARM_ASSET_VERSION = '2';
  var ALARM_ASSET_KEY = 'kintore_notif_sound_ver';
  /* ネイティブ呼び出しを待つ上限。返ってこない場合に備えた保険で、
     通常はどれも一瞬で返る */
  var NATIVE_WAIT_MS = 4000;
  var notifSoundsReady = false;
  var notifSoundsPromise = null;

  /* コピーは起動時に1回走らせるが、通知を予約する側もこれを待つ。
     コピー前に予約してしまうと、その回だけ音の無い通知になるため。 */
  function ensureNotificationSounds() {
    if (!notifSoundsPromise) {
      // 一度でも reject させると、キャッシュした Promise が以後ずっと失敗を返し続ける。
      // 失敗は「音が付かない」だけの話なので、必ず false に畳んで解決させる。
      // Promise.resolve().then() を挟むのは、中で同期例外が出たときに
      // .catch() まで届かずここから外へ投げ出されるのを防ぐため
      notifSoundsPromise = Promise.resolve().then(installNotificationSounds).catch(function (e) {
        soundDiag.notif = 'NG: ' + errText(e);
        noteAppError('通知音の準備', e);
        return false;
      });
    }
    return notifSoundsPromise;
  }

  /* Library/Sounds に実際に何があるかをネイティブ側に聞く。
     localStorage の「コピー済み」フラグは“やったつもり”しか表さないので、
     本当にファイルがあるかはこちらで確かめる。 */
  function soundKeys() { return SOUND_PATTERNS.map(function (p) { return p.key; }); }

  function readSoundFiles() {
    var alarm = nativePlugin('AlarmAudio');
    if (!isNativeApp() || !alarm) return Promise.resolve(null);
    // ネイティブ側が返してこない場合に備えて必ず打ち切る。
    // 呼び出し自体が同期例外を投げても Promise に畳む
    return withTimeout(
      Promise.resolve()
        .then(function () { return alarm.soundFiles({ names: soundKeys() }); })
        .then(function (r) { return r || null; })
        // 握りつぶすと実機で何が起きたのか分からなくなるので、内容だけは残す
        .catch(function (e) { noteAppError('通知音の確認', e); return null; }),
      NATIVE_WAIT_MS, null
    );
  }

  /* 通知音がどこに在るかを1行にまとめる。
     アプリ本体に同梱されていれば、Library/Sounds が空でも通知音は鳴る。 */
  function describeSoundFiles(r) {
    var bundled = (r && r.bundled) || [];
    var files = (r && r.files) || [];
    if (!r) return '確認できず';
    var head = bundled.length ? 'アプリ本体に' + bundled.length + '本' : 'アプリ本体になし';
    var tail = files.length ? 'Library: ' + files.join(' / ') : 'Library: 0件';
    if (!bundled.length && !files.length) return '0件（通知音のファイルが無い＝無音になる）';
    return head + ' ／ ' + tail;
  }

  function installedAssetVersion() {
    try { return localStorage.getItem(ALARM_ASSET_KEY); } catch (e) { return null; }
  }

  function installNotificationSounds() {
    if (!isNativeApp()) { soundDiag.notif = '—（ブラウザ版）'; return Promise.resolve(false); }
    // 途中で止まったときに「未実行」と区別が付くようにしておく
    soundDiag.notif = '準備中…';
    var filesToken = claimDiag('files');
    return readSoundFiles().then(function (r) {
      var files = (r && r.files) || [];
      var bundled = (r && r.bundled) || [];
      writeDiag('files', filesToken, describeSoundFiles(r));

      // アプリ本体に同梱されていれば、UNNotificationSound はそのまま見つけられる。
      // コピーという失敗しうる手順を踏まずに済むので、これを本命にする
      if (bundled.length >= SOUND_PATTERNS.length) {
        notifSoundsReady = true;
        soundDiag.notif = 'OK (アプリ本体に同梱)';
        return true;
      }
      // 同梱が無い古いビルド向け。中身もあり音源の版も一致しているなら再コピーは不要。
      // 版を見ないと、音源を差し替えても古いファイルが残り続けて直らない
      var haveAll = installedAssetVersion() === ALARM_ASSET_VERSION && SOUND_PATTERNS.every(function (p) {
        return files.some(function (f) { return f.indexOf(alarmFileName(p.key) + ' ') === 0 && f.indexOf(' 0B') < 0; });
      });
      if (haveAll) {
        notifSoundsReady = true;
        soundDiag.notif = 'OK (' + files.length + '本コピー済み)';
        return true;
      }
      return copyViaNative().then(function (ok) { return ok ? true : copyViaFilesystem(); });
    });
  }

  /* 本命の経路：同梱WAVを bundle から Library/Sounds へネイティブがコピーする。
     JS の fetch → base64 → Filesystem という長い経路は失敗箇所が多く、
     どこでこけても「通知は出るが無音」という同じ症状になって切り分けられなかった。 */
  function copyViaNative() {
    var alarm = nativePlugin('AlarmAudio');
    if (!alarm) { soundDiag.notif = 'NG: AlarmAudio未登録'; return Promise.resolve(false); }
    var names = SOUND_PATTERNS.map(function (p) { return p.key; });
    // 返ってこないと通知の予約まで道連れになるので、ここも必ず打ち切る
    return withTimeout(
      Promise.resolve().then(function () { return alarm.installSounds({ names: names }); }),
      NATIVE_WAIT_MS, 'timeout'
    )
      .then(function (r) {
        if (r === 'timeout') { soundDiag.notif = 'NG: コピーの応答なし（時間切れ）'; return false; }
        if (r && r.ok) {
          notifSoundsReady = true;
          try { localStorage.setItem(ALARM_ASSET_KEY, ALARM_ASSET_VERSION); } catch (e) { /* noop */ }
          soundDiag.notif = 'OK (ネイティブでコピー)';
          var filesToken = claimDiag('files');
          return readSoundFiles().then(function (f) {
            writeDiag('files', filesToken, describeSoundFiles(f));
            return true;
          });
        }
        soundDiag.notif = 'NG: ' + ((r && (r.reason || (r.failed || []).join(','))) || '理由不明');
        return false;
      })
      .catch(function (e) {
        soundDiag.notif = 'NG: ' + errText(e);
        noteAppError('通知音のコピー', e);
        return false;
      });
  }

  /* 予備の経路：ネイティブ側が古いビルドで installSounds を持っていない場合に使う */
  function copyViaFilesystem() {
    var fsPlugin = nativePlugin('Filesystem');
    if (!fsPlugin) { soundDiag.notif = 'NG: Filesystem未登録'; return Promise.resolve(false); }
    // 5本まとめてbase64にするとメモリを食うので1本ずつ順番に書く
    var chain = Promise.resolve();
    SOUND_PATTERNS.forEach(function (p) {
      chain = chain.then(function () { return copySoundToLibrary(fsPlugin, p.key); });
    });
    return chain.then(function () {
      notifSoundsReady = true;
      try { localStorage.setItem(ALARM_ASSET_KEY, ALARM_ASSET_VERSION); } catch (e) { /* noop */ }
      soundDiag.notif = 'OK (Filesystemでコピー)';
      var filesToken = claimDiag('files');
      return readSoundFiles().then(function (f) {
        writeDiag('files', filesToken, describeSoundFiles(f));
        return true;
      });
    }).catch(function (e) {
      soundDiag.notif = 'NG: コピー失敗 ' + errText(e);
      return false;
    });
  }

  function copySoundToLibrary(fsPlugin, key) {
    return fetch(alarmSrc(key))
      .then(function (r) {
        if (!r.ok) throw new Error('sound not found');
        return r.arrayBuffer();
      })
      .then(function (buf) {
        var bytes = new Uint8Array(buf), bin = '', CHUNK = 0x8000;
        // apply の引数上限に当たるため分割して文字列化する
        for (var i = 0; i < bytes.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return fsPlugin.writeFile({
          path: 'Sounds/' + alarmFileName(key),
          data: btoa(bin),
          directory: 'LIBRARY',
          recursive: true
        });
      });
  }

  /* ---- タイマーのローカル通知 ----
     PWAは画面ロック中・バックグラウンドではJSが止まるため、終了時に鳴らそうとしても鳴らない。
     ネイティブ版では「終了時刻に通知する」ようOSへ予約しておき、アプリが動いていなくても知らせる。
     予約は開始・時間延長・再開のたびに取り直し、停止・終了時に取り消す。 */
  var TIMER_NOTIF_ID = 1;
  var TEST_NOTIF_ID = 2;
  /* 確認ダイアログを今出しているところか。返事が来たら必ず戻す。
     アプリが前面に戻ったときにも戻す（ダイアログを出したまま他アプリへ行かれた場合の受け皿） */
  var notifPermissionAsking = false;
  /* 許可のダイアログはユーザーが答えるまで返らないので長めに待つ。
     ただし待つのは「予約を出したあと」なので、待っている間に何が起きても予約は残る */
  var PERM_WAIT_MS = 20000;

  function errText(e) {
    if (!e) return '理由不明';
    return String(e.message || e.errorMessage || e).slice(0, 90);
  }

  /* 返ってこないネイティブ呼び出しで処理全体が止まらないようにする。
     時間切れでも reject せず fallback を返す（呼び出し側は分岐せずに済む）。
     これが無かったために、音の準備が返ってこないと通知の予約まで
     道連れで止まり、実機では「何も起きない」状態になっていた。 */
  function withTimeout(promise, ms, fallback) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () {
        if (done) return;
        done = true;
        resolve(fallback);
      }, ms);
      Promise.resolve(promise).then(function (v) {
        if (done) return;
        done = true; clearTimeout(t); resolve(v);
      }, function () {
        if (done) return;
        done = true; clearTimeout(t); resolve(fallback);
      });
    });
  }
  function hhmmss(d) {
    function p(n) { return ('0' + n).slice(-2); }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* iOS側の通知設定を読む。
     通知を「許可」していても、iPhoneの設定でサウンドだけオフにされていると
     バナーは出るのに無音になる。checkPermissions() では区別できないため自前で見る。 */
  function refreshIosNotifDiag() {
    var alarm = nativePlugin('AlarmAudio');
    if (!isNativeApp() || !alarm) return Promise.resolve('—（ブラウザ版）');
    return alarm.notificationSettings()
      .then(function (r) {
        if (!r) return '取得できず';
        return '音' + r.sound + ' / バナー' + r.alert + ' / ロック画面' + r.lockScreen +
          ' / 表示' + r.alertStyle + ' / 要約' + (r.summary || '不明') + '（' + r.status + '）';
      })
      .catch(function (e) { return 'NG: ' + errText(e); });
  }

  /* 通知が出せない状態のとき、タイマー画面の一番上に理由を出す。
     これまでは許可が無くても画面上は何も変わらず、ただ静かに何も起きなかった。
     鳴らない理由が設定画面の診断欄にしか無いのは、気付けないのと同じ。
     押すと iPhone の「設定 > 筋トレLog」を開く。 */
  function describeNotifBlock(perm, ios) {
    if (!isNativeApp()) return null;
    if (!timerSettings.notifyOn) return null;   // 自分でオフにしている場合は警告しない
    if (!nativePlugin('LocalNotifications')) {
      return { title: '通知の仕組みを読み込めていません', body: 'アプリを一度終了して開き直してください。直らない場合は再インストールが必要です' };
    }
    if (perm === 'denied') {
      return { title: '通知が許可されていません', body: 'このままだとアプリを閉じている間タイマーのお知らせが届きません。タップして「通知を許可」をオンにしてください' };
    }
    if (perm && perm !== 'granted') {
      return { title: '通知の許可がまだ済んでいません', body: 'タイマーを開始すると確認が出ます。「許可」を選ぶまでアプリを閉じないでください' };
    }
    if (!ios) return null;
    if (ios.status && ios.status.indexOf('仮承認') === 0) {
      return { title: '通知が「静かに配信」になっています', body: 'バナーも音も出ずに通知センターにだけ溜まります。タップして通知スタイルを変更してください' };
    }
    if (ios.alert === 'オフ') {
      return { title: 'バナー表示がオフです', body: '通知は届きますが画面には出ません。タップして「バナー」「ロック画面」をオンにしてください' };
    }
    if (timerSettings.soundOn && ios.sound === 'オフ') {
      return { title: 'iPhone側で通知音がオフです', body: 'アプリを閉じている間の通知が無音になります。タップして「サウンド」をオンにしてください' };
    }
    if (ios.summary === 'オン') {
      return { title: '「通知の要約」に入っています', body: 'タイマーの終了時刻ではなく、まとめ配信の時間まで通知が保留されます。タップして要約から外してください' };
    }
    return null;
  }

  function renderNotifWarning(info) {
    var el = $('#trNotifWarn');
    if (!el) return;
    if (!info) { el.hidden = true; el.innerHTML = ''; return; }
    el.innerHTML = '';
    var b = document.createElement('b');
    b.textContent = '⚠ ' + info.title;
    var span = document.createElement('span');
    span.textContent = info.body;
    el.appendChild(b);
    el.appendChild(span);
    el.hidden = false;
  }

  /* 許可とiOS設定を読み直して警告を出し直す */
  function refreshNotifWarning() {
    if (!isNativeApp()) return Promise.resolve();
    /* ここも許可を聞き直すので、診断欄の「許可」を書く資格を取ってから始める。
       取れなかったときに前の値を書き戻すのは、
       ①元々「取れなければ前の値を残す」仕様だったのを変えないため
       ②追い越した以上ここが書かないと欄が「確認中…」のまま固まるため。 */
    var permToken = claimDiag('perm');
    var ln = nativePlugin('LocalNotifications');
    var alarm = nativePlugin('AlarmAudio');
    var permP = ln ? Promise.resolve().then(function () { return ln.checkPermissions(); })
      .then(function (r) { return (r && r.display) || null; }, function () { return null; })
      : Promise.resolve(null);
    var iosP = alarm ? Promise.resolve().then(function () { return alarm.notificationSettings(); })
      .then(function (r) { return r || null; }, function () { return null; })
      : Promise.resolve(null);
    return Promise.all([permP, iosP]).then(function (v) {
      writeDiag('perm', permToken, v[0] || soundDiag.perm);
      renderNotifWarning(describeNotifBlock(v[0], v[1]));
    }, function () { /* noop */ });
  }

  function describePending(list) {
    if (!list.length) return '0件（OSに予約なし）';
    return list.length + '件: ' + list.map(function (n) {
      var at = n && n.schedule && n.schedule.at ? new Date(n.schedule.at) : null;
      var when = (at && !isNaN(at.getTime())) ? hhmmss(at) : '時刻不明';
      return '#' + n.id + ' ' + when;
    }).join(' / ');
  }

  /* OSが実際に予約を受け取ったかを確認する。
     schedule() が成功しても、日時の受け渡しがおかしければここで空になるので、
     「予約したつもり」と「本当に予約できた」を分けて見られるようにする。
     判定にも使うので、取得できたかどうか（ok）と中身を呼び出し側へ返す。
     問い合わせ自体が失敗した場合を 0件 と同じ扱いにすると、
     「OSが予約を捨てた」と「OSに聞けなかった」を取り違えるため必ず区別する。
     ここでは soundDiag に直接書かず、表示用の文言（text）も一緒に返すだけにする。
     どの問い合わせが最新かを判断できるのは呼び出し側なので、書き込みはそちらに任せる。 */
  function readPending() {
    var ln = nativePlugin('LocalNotifications');
    if (!isNativeApp() || !ln) {
      return Promise.resolve({ ok: false, list: [], why: 'ブラウザ版', text: '—（ブラウザ版）' });
    }
    return Promise.resolve()
      .then(function () { return ln.getPending(); })
      .then(function (r) {
        var list = (r && r.notifications) || [];
        return { ok: true, list: list, text: describePending(list) };
      })
      .catch(function (e) {
        var why = errText(e);
        return { ok: false, list: [], why: why, text: 'NG: ' + why };
      });
  }
  function refreshPendingDiag() {
    return readPending().then(function (res) { return res.text; });
  }

  /* 「OSが通知を配信したのか、そもそも配信していないのか」を分けるための欄。
     予約はOKなのに何も出ない場合、
       ・ここが 0件 → OSまで届いていない（許可・予約時刻の問題）
       ・ここに件数がある → 配信はされたが画面に出ていない（要約・集中モード・設定の問題）
     と原因が二分できる。通知センターに残っているものを数えるので、
     通知を手で消したあとだと 0件 に戻る点だけ注意。 */
  function refreshDeliveredDiag() {
    var ln = nativePlugin('LocalNotifications');
    if (!isNativeApp() || !ln || !ln.getDeliveredNotifications) {
      return Promise.resolve('—（ブラウザ版）');
    }
    return Promise.resolve()
      .then(function () { return ln.getDeliveredNotifications(); })
      .then(function (r) {
        var list = (r && r.notifications) || [];
        if (!list.length) return '0件（通知センターに無し）';
        return list.length + '件: ' + list.map(function (n) {
          return '#' + n.id;
        }).join(' / ');
      })
      .catch(function (e) { return 'NG: ' + errText(e); });
  }

  function ensureNotifPermission() {
    var ln = nativePlugin('LocalNotifications');
    if (!ln) return Promise.resolve(false);
    return Promise.resolve()
      .then(function () { return ln.checkPermissions(); })
      .then(function (r) {
        if (r && r.display === 'granted') return true;
        if (r && r.display === 'denied') return false;
        /* 起動直後ではなく「タイマーを初めて使うとき」に許可を求める（拒否されにくくするため）。
           フラグは「今まさに確認ダイアログを出している最中か」だけを表す。
           ここを「一度でも聞いたか」にすると、ダイアログを出した直後にホーム画面へ戻られた場合
           （＝返事が返らずJSも止まる）に、以後そのアプリ起動中は二度と許可を求められなくなる。
           iOS はシステムのダイアログをインストールごとに一度しか出さず、
           答え済みなら即座に結果だけ返すので、聞き直しても画面がうるさくなることはない。 */
        if (notifPermissionAsking) return false;
        notifPermissionAsking = true;
        return ln.requestPermissions().then(function (r2) {
          notifPermissionAsking = false;
          return !!(r2 && r2.display === 'granted');
        }, function () {
          notifPermissionAsking = false;
          return false;
        });
      })
      .catch(function () { return false; });
  }

  /* 通知の予約データを組み立てる。タイマー用とテスト用で中身を揃えるため共通化する。 */
  function buildNotif(id, body, at) {
    var notif = {
      id: id,
      title: '筋トレLog',
      body: body,
      schedule: { at: at, allowWhileIdle: true }
    };
    /* sound を渡さないと content.sound が nil のまま＝音の出ない通知になる。
       「アプリを閉じていると鳴らない」のはこれが原因だった。
       コピーに失敗していてもファイル名は渡す（見つからない場合iOSは既定の通知音を鳴らすため、
       何も指定せず確実に無音になるより良い）。 */
    if (timerSettings.soundOn) notif.sound = alarmFileName(timerSettings.sound);
    return notif;
  }

  /* ---- 「予約できた」はOSに聞くまで分からない ----
     Capacitor の schedule() は UNUserNotificationCenter.add() の完了を待たずに resolve する。
     node_modules/@capacitor/local-notifications/.../LocalNotificationsPlugin.swift の schedule は

         center.add(request) { error in if let e = error { call.reject(...) } }   // 非同期
         ids.append(...)
         call.resolve(["notifications": ret])                                     // ← 先に返る

     という並びで、add のコールバックの外で resolve している。
     しかも add が失敗したときの call.reject は「resolve 済みの呼び出し」への空振りなので、
     OSが予約を突き返してもJS側は成功したようにしか見えない。
     つまり resolve は「注文票を渡した」までで、「OSが受理した」ではない。
     直後に getPending() を読むのも add 完了前を引く可能性がある。
     そこで resolve は「受付」とだけ書き、getPending() にそのidが現れるまで
     少し待って聞き直し、確認が取れてはじめて OK と書く。 */
  var PENDING_CONFIRM_TRIES = 6;
  var PENDING_CONFIRM_WAIT_MS = 400;
  /* 予約は常に同じidで置き換える作りなので、idの一致だけでは
     「今回の時刻に置き換わった」ことを確かめられない。前回の予約が残っているだけでも
     一致してしまい、＋30秒・一時停止からの再開・通知音の変更・通知テストの連打のように
     同じidを出し直す操作では、置き換えが失敗していても OK と表示されてしまう。
     そこで時刻も突き合わせる。getPending が返す時刻は
     LocalNotificationsHandler.makePendingNotificationRequestJSObject が
     ISO8601DateFormatter で文字列にしたもので、ミリ秒が落ちて秒単位に丸まる。
     丸めの分だけずれるので、1秒までの差は同じ予約とみなす。 */
  var PENDING_AT_TOLERANCE_MS = 1000;

  function laterMs(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /* OSが返した予約の時刻をミリ秒にする。読み取れなければ null。 */
  function pendingAtMs(n) {
    var raw = n && n.schedule ? n.schedule.at : null;
    if (raw === null || raw === undefined || raw === '') return null;
    var t = (raw instanceof Date) ? raw.getTime() : new Date(raw).getTime();
    return isNaN(t) ? null : t;
  }

  /* 指定idが「今回の時刻で」OSの予約一覧に現れるまで聞き直す。
     found=今回の時刻で入っている / stale=同じidの古い予約が残ったまま
     / missing=そもそも入っていない / fired=もう時刻を過ぎた（消えていて当然）
     / error=OSに聞けなかった、の5つを区別して返す。
     pendToken は「OS予約」欄を書く資格。追い越されたら書かずに調べるだけにする。 */
  function confirmScheduled(id, atMs, tries, pendToken) {
    return readPending().then(function (res) {
      writeDiag('pending', pendToken, res.text);
      if (!res.ok) return { state: 'error', why: res.why };
      var stale = null;
      for (var i = 0; i < res.list.length; i++) {
        var n = res.list[i];
        if (!n || String(n.id) !== String(id)) continue;
        var t = pendingAtMs(n);
        /* 時刻が読み取れない場合まで「違う」と決めつけると、
           予約は正しく置き換わっているのに NG と出す診断になってしまう。
           判定できないものは、これまでどおり id の一致で足りたことにする。 */
        if (t === null) return { state: 'found', notif: n };
        if (Math.abs(t - atMs) <= PENDING_AT_TOLERANCE_MS) return { state: 'found', notif: n };
        stale = { at: t, notif: n };   // idは合うが時刻が違う＝置き換え待ち
      }
      /* 確認している間に予定時刻を過ぎたなら、消えているのが正しい姿。
         ただし古い予約が居座っているなら「消えて当然」では説明できないので、
         そちらを優先して最後まで置き換わるか見る。 */
      if (!stale && atMs <= Date.now()) return { state: 'fired' };
      if (tries <= 1) {
        return stale ? { state: 'stale', at: stale.at, notif: stale.notif } : { state: 'missing' };
      }
      return laterMs(PENDING_CONFIRM_WAIT_MS).then(function () {
        return confirmScheduled(id, atMs, tries - 1, pendToken);
      });
    });
  }

  /* 診断欄をまるごと描き直すとOSへの問い合わせが連鎖するので、
     予約の進み具合だけを書き換えたいときはこちらを使う。
     予約の確認で一緒に分かる「OS予約」欄は writeDiag が書くので、ここでは触らない。 */
  function renderSchedDiag() {
    try {
      var el = $('#diagSched');
      if (el) el.textContent = soundDiag.sched;
    } catch (e) { /* 表示できないだけなので握りつぶす */ }
  }

  /* ---- 予約欄は「いちばん新しい書き手」だけが書ける ----
     予約は「まず出す→許可が取れたら出し直す」の2段構えで、さらに各段が
     OSへの確認を数百ミリ秒かけて行う。素朴に書くと、先に始まった確認が
     あとから返ってきて、より新しく確定した結果（例：「通知が許可されていない」）を
     上書きしてしまう。番号を配って、追い越された書き手は黙るようにする。 */
  var schedSeq = 0;
  function claimSched() { return ++schedSeq; }
  /* 書けたかどうかを返す。追い越された確認は内部エラーの記録もやめさせる
     （＋30秒などで予約を出し直すと、古い確認は必ず「置き換わっていない」と見えるため、
       そのままだと実害の無い失敗が内部エラー欄に溜まってしまう）。 */
  function writeSched(token, text) {
    if (token !== schedSeq) return false;   // もっと新しい書き手がいるので何もしない
    soundDiag.sched = text;
    renderSchedDiag();
    return true;
  }

  /* 実際にOSへ予約を投げる。ここは何も待たずに呼べること自体が要件なので、
     同期例外も含めて必ず soundDiag.sched に残し、外へは投げない。 */
  function pushNotif(ln, id, body, atMs) {
    var at = new Date(atMs);
    var notif = buildNotif(id, body, at);
    var label = hhmmss(at) + ' / ' + (notif.sound || '音なし');
    var token = claimSched();
    // 確認の途中経過で「OS予約」欄も書き換わるので、その資格もここで取る
    var pendToken = claimDiag('pending');
    writeSched(token, '予約中… ' + hhmmss(at));
    try {
      Promise.resolve()
        .then(function () { return ln.schedule({ notifications: [notif] }); })
        .then(function () {
          // ここではまだ「渡した」だけ。OSが受け取ったかは次で確かめる
          writeSched(token, '受付 ' + label + '（OSに確認中…）');
          return confirmScheduled(id, atMs, PENDING_CONFIRM_TRIES, pendToken);
        })
        .then(function (res) {
          if (res.state === 'found') {
            writeSched(token, 'OK ' + label + '（OS確認済み）');
          } else if (res.state === 'fired') {
            writeSched(token, '受付 ' + label + '（予定時刻を過ぎたため確認できず）');
          } else if (res.state === 'error') {
            if (writeSched(token, '受付 ' + label + '（確認できず: ' + res.why + '）')) {
              noteAppError('通知の予約確認', res.why);
            }
          } else if (res.state === 'stale') {
            var old = (res.at === null || res.at === undefined) ? '時刻不明' : hhmmss(new Date(res.at));
            if (writeSched(token, 'NG: 同じIDの古い予約が残っている（OS ' + old + ' → 今回 ' + hhmmss(at) + '）')) {
              noteAppError('通知の予約', '同じidの予約が今回の時刻に置き換わらない（OS: ' + old + ' / 今回: ' + hhmmss(at) + '）');
            }
          } else {
            if (writeSched(token, 'NG: OSに予約が入っていない ' + label)) {
              noteAppError('通知の予約', 'schedule後もOSの予約一覧に現れない（OSが受理しなかった）');
            }
          }
        })
        .catch(function (e) {
          if (writeSched(token, 'NG: ' + errText(e))) noteAppError('通知の予約', e);
        });
    } catch (e) {
      if (writeSched(token, 'NG: ' + errText(e))) noteAppError('通知の予約', e);
    }
  }

  /* ---- 通知の予約は「まず出す、あとで直す」 ----
     iOSのWebViewは、アプリが後ろに回った時点でJSの実行を止める。
     そのため「許可の確認」や「通知音の準備」の完了を待ってから予約する作りにすると、
     待っている最中にアプリを閉じられた回は ln.schedule() に到達せず、予約そのものが消える。
     タイマーを開始してすぐ他のアプリに切り替えるのはいちばん普通の使い方なので、
     この待ち合わせは「通知が来ないことがある」と同義だった。

     同じ id で schedule するとOS側の予約は置き換わるので、
     先に出しておいて後から出し直しても二重に鳴ることはない。
     予約前に cancel していたのもやめた（cancel の完了を待っていなかったため、
     順序が入れ替わると予約したばかりの通知を自分で消す可能性があった）。 */
  function scheduleTimerNotification(endAtMs) {
    if (!isNativeApp()) { writeSched(claimSched(), '—（ブラウザ版）'); return; }
    var ln = nativePlugin('LocalNotifications');
    if (!ln) { writeSched(claimSched(), 'NG: 通知プラグインが読み込まれていない'); return; }
    if (!timerSettings.notifyOn) { writeSched(claimSched(), '—（システム通知がOFF）'); return; }
    if (endAtMs <= Date.now()) { writeSched(claimSched(), 'NG: 終了時刻が過去'); return; }

    // ① 何も待たずに予約する。この1行がアプリを閉じられても残る
    pushNotif(ln, TIMER_NOTIF_ID, '休憩終了！ 次のセットへ', endAtMs);

    // ② 許可はそのあとで確認する。初回は許可を求めるダイアログが出るが、
    //    その間はアプリが前面なのでJSは止まらない。取れたら同じidで出し直す
    withTimeout(ensureNotifPermission(), PERM_WAIT_MS, null)
      .then(function (granted) {
        /* 許可が無いと分かった時点で、進行中の予約確認より新しい確定情報になる。
           番号を取り直して、あとから返る確認結果に上書きされないようにする。 */
        if (granted === false) { writeSched(claimSched(), 'NG: 通知が許可されていない'); return; }
        // 待っている間にタイマーが止まった・時間が変わったなら、その回の予約はもう関係ない
        if (!timer.running || timer.paused || timer.finished || timer.endAt !== endAtMs) return;
        // 終了直前だと出し直しが「過去の時刻」として弾かれ、成功済みの表示を上書きしてしまう
        if (endAtMs - Date.now() < 1500) return;
        pushNotif(ln, TIMER_NOTIF_ID, '休憩終了！ 次のセットへ', endAtMs);
      })
      .catch(function (e) { noteAppError('通知の許可確認', e); });

    // ③ 音の準備は予約と切り離して進める（間に合った回から音が付く）。
    //    通知音は本体に同梱してあるので、そもそも準備を待つ必要はない
    ensureNotificationSounds();
  }

  /* 設定画面の「通知テスト」。タイマーを5分回さなくても10秒で試せるようにする。 */
  function runNotifTest() {
    var out = $('#testNotifResult');
    function say(t) { if (out) out.textContent = t; }
    if (!isNativeApp()) { say('ブラウザ版では試せません（アプリ版のみ）'); return; }
    var ln = nativePlugin('LocalNotifications');
    if (!ln) { say('NG: 通知プラグインが読み込まれていません'); return; }

    // タイマー本体と同じく、待たずにまず予約する
    var atMs = Date.now() + 10000;
    pushNotif(ln, TEST_NOTIF_ID, 'テスト通知です（10秒後）', atMs);
    say('予約しました。' + hhmmss(new Date(atMs)) + ' に鳴ります。今すぐホーム画面に戻るか画面を消して待ってください');

    withTimeout(ensureNotifPermission(), PERM_WAIT_MS, null)
      .then(function (granted) {
        if (granted === false) {
          say('NG: 通知が許可されていません。iPhoneの「設定 > 通知 > 筋トレLog」を開いて「通知を許可」をONにしてください');
        }
        // 予約一覧は renderSoundDiag が取り直す。ここで先に聞くと同じ問い合わせが二重になる
      })
      .then(renderSoundDiag)
      .catch(function (e) { noteAppError('通知テスト', e); });
    ensureNotificationSounds();
  }

  /* cancel が消すのは「まだ配信されていない予約」だけ。配信済みの通知には効かない。 */
  function cancelTimerNotification() {
    var ln = nativePlugin('LocalNotifications');
    if (!ln) return;
    try {
      ln.cancel({ notifications: [{ id: TIMER_NOTIF_ID }] }).catch(function () { /* noop */ });
    } catch (e) { /* noop */ }
  }

  /* 配信済みの通知を通知センターから消す。
     終了時に予約を取り消さなくなったぶん、前回のお知らせが残り続けるので、
     次にタイマーを始めるとき・リセットするときに片づける。 */
  function clearDeliveredTimerNotification() {
    var ln = nativePlugin('LocalNotifications');
    if (!ln || !ln.removeDeliveredNotifications) return;
    try {
      var r = ln.removeDeliveredNotifications({ notifications: [{ id: TIMER_NOTIF_ID }] });
      if (r && r.catch) r.catch(function () { /* noop */ });
    } catch (e) { /* noop */ }
  }

  /* ---- 設定画面「データの保存」 ----
     App Store版にはクラウド同期が無いぶん、記録がどこにあり何で守られるのかを設定画面で示す。
     PWA版ではクラウド同期セクションがその役目を果たすため、ここは空のまま。 */
  function renderStorageSection() {
    var box = $('#storageSectionContainer');
    if (!box) return;
    if (!isNativeApp()) { box.innerHTML = ''; return; }
    box.innerHTML =
      '<div class="s-section">' +
        '<h4 class="s-title">データの保存</h4>' +
        '<div class="panel-list">' +
          '<div class="s-row"><div class="s-main">' +
            '<b>記録はこのiPhoneの中に保存されます</b>' +
            '<small>インターネットには送信されません。</small>' +
          '</div></div>' +
          '<div class="s-row"><div class="s-main">' +
            '<b>iPhoneのバックアップに自動で含まれます</b>' +
            '<small>機種変更や紛失のときは、iPhoneのバックアップ（iCloudバックアップ、または' +
            'パソコンでのバックアップ）から復元すれば、記録もそのまま戻ります。設定は必要ありません。</small>' +
          '</div></div>' +
          '<div class="s-row"><div class="s-main">' +
            '<small>最終保存：<span id="nativeBackupAt">' + esc(nativeBackupAtText()) + '</span></small>' +
          '</div></div>' +
        '</div>' +
      '</div>';
  }

  function nativeBackupAtText() {
    var at = getNativeBackupAt();
    return at ? new Date(at).toLocaleString('ja-JP') : 'まだ作成されていません';
  }

  /* 書き出し直後に日時表示だけ差し替える（設定画面を開いていなければ何もしない） */
  function renderStorageInfo() {
    var el = $('#nativeBackupAt');
    if (el) el.textContent = nativeBackupAtText();
  }

  /* ================== ご意見・ご要望（一般公開向けサポート窓口） ==================
     受付専用GAS（gas/feedback.gs）に送信する。バックアップ用GASとは別物で、
     このURLは公開前提の受付窓口のためコードに直接埋め込む（書き込み専用・記録データとは無関係）。
     空文字の間はサポートセクション自体を表示しない */
  var FEEDBACK_GAS_URL = 'https://script.google.com/macros/s/AKfycbzIuw4o_FtZbpoR3iRoFbqwNJPKU9V41hNXxw6u98Pfavmt3B7atETA2Fcju9jUjlnL2Q/exec';
  var FB_LIMIT_PER_DAY = 5;

  function appVersion() {
    var el = $('.version');
    var m = el && el.textContent.match(/v[\d.]+/);
    return m ? m[0] : '';
  }

  function bindFeedback() {
    var section = $('#supportSection');
    if (!section) return;
    if (!FEEDBACK_GAS_URL) { section.style.display = 'none'; return; }

    $('#fbSendBtn').onclick = function () {
      var text = $('#fbText').value.trim();
      if (!text) { toast('内容を入力してください'); return; }
      var countKey = 'kintore_fb_' + DB.todayStr();
      var count = 0;
      try { count = parseInt(localStorage.getItem(countKey), 10) || 0; } catch (e) { /* noop */ }
      if (count >= FB_LIMIT_PER_DAY) { toast('本日の送信回数の上限に達しました。また明日お願いします'); return; }
      var btn = $('#fbSendBtn');
      btn.disabled = true;
      btn.textContent = '送信中…';
      fetch(FEEDBACK_GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          text: text.slice(0, 1000),
          email: $('#fbEmail').value.trim().slice(0, 200),
          version: appVersion()
        })
      })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (json) {
          if (json && json.ok === false) throw new Error(json.error || 'failed');
          try { localStorage.setItem(countKey, String(count + 1)); } catch (e) { /* noop */ }
          $('#fbText').value = '';
          $('#fbEmail').value = '';
          toast('ご意見ありがとうございました！今後の改善の参考にさせていただきます。');
        })
        .catch(function () {
          toast('送信に失敗しました。通信環境をご確認のうえ、時間をおいてお試しください');
        })
        .then(function () {
          btn.disabled = false;
          btn.textContent = '送信する';
        });
    };
  }

  /* @sync:start */
  /* 記録が空の端末からの復元導線（記録タブの空状態から。隠し機能の解除状態と独立して使える） */
  function promptCloudRestore() {
    if (!getGasUrl()) {
      var url = prompt('バックアップ用 GAS Web AppのURLを入力してください\n（https://script.google.com/macros/s/…/exec）\n※スプレッドシートを開くURLではありません');
      if (url === null) return;
      var chk = checkGasUrl(url);
      if (!chk.ok) { alert(chk.error); return; }
      setGasUrl(chk.url);
      renderSyncSection();
    }
    restoreFromCloud();
  }
  /* @sync:end */

  function bindSettings() {
    var versionEl = $('.version');
    if (versionEl) versionEl.addEventListener('click', onVersionTap);

    /* @sync:start
       同期セクション（#syncSectionContainer）のイベント登録。中身を描画するのは renderSyncSection で、
       iOS版ではそれがスタブになり常に空のため、この登録も丸ごと不要になる。
       ここを残すと動かないコードだけが残り、ガイドライン2.3.1（休眠機能）の指摘対象になり得る。 */
    $('#syncSectionContainer').addEventListener('change', function (e) {
      if (e.target.id === 'gasUrlInput') {
        var v = e.target.value.trim();
        // 空欄はクラウド同期の解除として扱う
        if (!v) { setGasUrl(''); toast('バックアップ先URLを消去しました'); return; }
        // 貼り間違いは保存させない（以前は警告を出しつつ保存していたため、
        // 誤ったURL宛に送り続けてバックアップできない状態に気づけなかった）
        var chk = checkGasUrl(v);
        if (!chk.ok) {
          alert(chk.error);
          e.target.value = getGasUrl();  // 保存済みの正しいURLを保つ
          return;
        }
        setGasUrl(chk.url);
        toast('バックアップ先URLを保存しました');
      }
    });
    $('#syncSectionContainer').addEventListener('click', function (e) {
      if (e.target.id === 'syncNowBtn') runSync();
      if (e.target.id === 'restoreCloudBtn') restoreFromCloud();
    });
    /* @sync:end */

    $('#weightStepList').addEventListener('click', function (e) {
      var row = e.target.closest('[data-wstep]');
      if (!row) return;
      weightStepSettings.step = parseFloat(row.dataset.wstep);
      saveWeightStepSettings();
      renderWeightStepSettings();
    });

    $('#themeSeg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-theme-opt]');
      if (!b) return;
      setThemePref(b.dataset.themeOpt);
    });

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

    $('#importCsvBtn').onclick = function () {
      var input = $('#importCsvFile');
      input.value = ''; // 同じファイルを連続で選んでもchangeが発火するように
      input.click();
    };
    $('#importCsvFile').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) importCSVFile(file);
    });
    $('#restoreBackupBtn').onclick = function () {
      if (!confirm('直前のCSV取り込み前の状態に戻します。よろしいですか？')) return;
      var json = null;
      try { json = localStorage.getItem(PREIMPORT_BACKUP_KEY); } catch (e) { /* noop */ }
      if (!json || !DB.restoreStateJSON(json)) { toast('バックアップが見つかりませんでした'); return; }
      try { localStorage.removeItem(PREIMPORT_BACKUP_KEY); } catch (e) { /* noop */ }
      renderLog();
      renderSettings();
      toast('元に戻しました');
    };

    $('#wipeBtn').onclick = function () {
      if (!confirm('すべての記録・種目データを削除します。よろしいですか？')) return;
      if (!confirm('本当に削除しますか？ この操作は取り消せません。')) return;
      DB.wipe();
      ui.expanded = {};
      ui.exExpanded = {};
      renderLog();
      renderSettings();
      // 端末内バックアップも即座に空にする。ここで書き換えずにアプリを終了されると、
      // 次の起動時に「記録が0件」と判定されて消したはずの記録が復元されてしまう
      writeNativeBackup();
      toast('データを初期化しました');
    };
  }

  /* ================== CSVエクスポート・スプレッドシート同期 共通の行データ ================== */
  /* 強度(v0.10.0で追加)は末尾に足す。途中に挿すとスプレッドシートに既に書かれた行と列がずれるため */
  var ROW_HEAD = ['日付', '曜日', '部位', '種目', '器具', 'セット',
    '重量kg', '回数', 'ボリュームkg',
    '時間min', '時間秒', '距離km', '速度kmh', '傾斜%', 'カロリーkcal', '心拍bpm', 'メモ', '強度'];
  /* 指定日の記録を18列の行配列（ROW_HEADと同じ並び）に変換する。記録が無ければ空配列 */
  function rowsForDate(date) {
    var w = DB.getWorkout(date);
    if (!w) return [];
    var d = parseDate(date);
    var val = function (x) { return (x === '' || x == null) ? '' : x; };
    var rows = [];
    (w.entries || []).forEach(function (e) {
      var cardio = isCardio(e);
      e.sets.forEach(function (s, i) {
        rows.push([
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
          w.memo || '',
          cardio ? zoneCsv(zoneOf(s)) : ''
        ]);
      });
    });
    return rows;
  }

  function exportCSV() {
    var dates = DB.datesWithData();
    if (!dates.length) { toast('書き出す記録がありません'); return; }
    var csv = function (v) {
      v = String(v == null ? '' : v);
      return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var lines = [ROW_HEAD.join(',')];
    dates.forEach(function (date) {
      rowsForDate(date).forEach(function (row) { lines.push(row.map(csv).join(',')); });
    });
    var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv' }); // BOM付きでExcel文字化け防止
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '筋トレLog_' + DB.todayStr() + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('CSVを書き出しました');
  }

  /* ================== CSVインポート ================== */
  /* ROW_HEADの見出し文字列 → 内部キー。列の並びが変わっていてもヘッダー名で判定する */
  var IMPORT_KEYS = ['date', 'wd', 'part', 'name', 'equip', 'setNo',
    'w', 'r', 'vol', 't', 'ts', 'd', 'sp', 'inc', 'cal', 'hr', 'memo', 'z'];
  var IMPORT_HEADER_KEY = ROW_HEAD.reduce(function (m, h, i) { m[h] = IMPORT_KEYS[i]; return m; }, {});
  var PREIMPORT_BACKUP_KEY = 'kintore_v1_preimport_backup';

  /* CSVテキストを2次元配列にパースする（引用符内のカンマ・改行・""エスケープに対応） */
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    var rows = [], row = [], field = '', inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else { field += c; }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\r') {
        /* 改行はこの次の\nで処理する */
      } else if (c === '\n') {
        row.push(field); field = ''; rows.push(row); row = [];
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return !(r.length === 1 && r[0] === ''); });
  }

  function numOrEmpty(v) {
    if (v === '' || v == null) return '';
    var n = parseFloat(v);
    return isNaN(n) ? '' : n;
  }

  /* パース済み行 → 日付ごと・種目ごとにグルーピングする。DB.applyImportにそのまま渡せる形にする */
  function buildImportData(rows) {
    if (!rows || rows.length < 2) return { dateOrder: [], byDate: {}, rowCount: 0, error: 'CSVにデータ行がありません' };
    var keys = rows[0].map(function (h) { return IMPORT_HEADER_KEY[String(h).trim()] || null; });
    if (keys.indexOf('date') < 0 || keys.indexOf('part') < 0 || keys.indexOf('name') < 0) {
      return { dateOrder: [], byDate: {}, rowCount: 0, error: 'CSVの形式が正しくありません（日付・部位・種目の列が見つかりません）' };
    }
    var byDate = {}, dateOrder = [], rowCount = 0;
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r.length) continue;
      var rec = {};
      keys.forEach(function (k, idx) { if (k) rec[k] = (r[idx] !== undefined) ? r[idx] : ''; });
      if (!rec.date || !rec.part || !rec.name) continue;
      rowCount++;
      if (!byDate[rec.date]) { byDate[rec.date] = { entries: {}, order: [], memo: '' }; dateOrder.push(rec.date); }
      var dayObj = byDate[rec.date];
      if (rec.memo) dayObj.memo = rec.memo;
      var entryKey = rec.part + '||' + rec.name + '||' + (rec.equip || '');
      if (!dayObj.entries[entryKey]) {
        dayObj.entries[entryKey] = { part: rec.part, name: rec.name, equip: rec.equip || '', sets: [] };
        dayObj.order.push(entryKey);
      }
      var entryObj = dayObj.entries[entryKey];
      var setNo = parseInt(rec.setNo, 10);
      if (!setNo || setNo < 1) setNo = entryObj.sets.length + 1;
      var setObj = (rec.part === CARDIO_PART)
        ? { t: numOrEmpty(rec.t), ts: numOrEmpty(rec.ts), d: numOrEmpty(rec.d), sp: numOrEmpty(rec.sp), inc: numOrEmpty(rec.inc), cal: numOrEmpty(rec.cal), hr: numOrEmpty(rec.hr), z: zoneFromCsv(rec.z) }
        : { w: numOrEmpty(rec.w), r: numOrEmpty(rec.r) };
      entryObj.sets[setNo - 1] = setObj;
    }
    return { dateOrder: dateOrder, byDate: byDate, rowCount: rowCount };
  }

  function hasPreimportBackup() {
    try { return !!localStorage.getItem(PREIMPORT_BACKUP_KEY); } catch (e) { return false; }
  }

  function importCSVFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = buildImportData(parseCSV(reader.result));
      } catch (e) {
        toast('CSVの読み込みに失敗しました');
        return;
      }
      if (data.error) { toast(data.error); return; }
      if (!data.dateOrder.length) { toast('取り込めるデータが見つかりませんでした'); return; }
      var ok = confirm(data.dateOrder.length + '日分・' + data.rowCount + '件のデータを読み込みます。\n対象の日の記録は置き換わります。よろしいですか？');
      if (!ok) return;

      var backupJSON = DB.exportStateJSON();
      try {
        DB.applyImport(data.dateOrder, data.byDate);
      } catch (e) {
        if (backupJSON) DB.restoreStateJSON(backupJSON);
        toast('取り込みに失敗したため元に戻しました');
        return;
      }
      if (backupJSON) {
        try { localStorage.setItem(PREIMPORT_BACKUP_KEY, backupJSON); } catch (e) { /* noop */ }
      }
      renderLog();
      renderSettings();
      toast(data.dateOrder.length + '日分のデータを取り込みました');
    };
    reader.onerror = function () { toast('ファイルの読み込みに失敗しました'); };
    reader.readAsText(file, 'UTF-8');
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
    audioElUnlocked: false, previewStop: null, vibrateTimer: null,
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
  /* ignoreSilent: 本体側面のサイレントスイッチ（消音モード）を無視して鳴らすか。
     既定ON＝トレーニング中は消音のままの人が多く、鳴らないと目的を果たさないため。
     OFFにすると通常の動画アプリと同じ挙動（消音スイッチに従う）に戻る。ネイティブ版のみ有効。 */
  var timerSettings = { sound: 'beep', soundOn: true, vibrateOn: true, notifyOn: true, ignoreSilent: true };

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
      var sl = localStorage.getItem('kintore_timer_ignore_silent');
      if (sl !== null) timerSettings.ignoreSilent = sl === '1';
    } catch (e) { /* noop */ }
  }
  function saveTimerSettings() {
    try {
      localStorage.setItem('kintore_timer_sound', timerSettings.sound);
      localStorage.setItem('kintore_timer_sound_on', timerSettings.soundOn ? '1' : '0');
      localStorage.setItem('kintore_timer_vibrate_on', timerSettings.vibrateOn ? '1' : '0');
      localStorage.setItem('kintore_timer_notify_on', timerSettings.notifyOn ? '1' : '0');
      localStorage.setItem('kintore_timer_ignore_silent', timerSettings.ignoreSilent ? '1' : '0');
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

  /* ---- 音（同梱WAVファイルを<audio>要素で再生する方式） ----
     以前はオシレーターの合成音をOfflineAudioContextでレンダリング→Blob URL化して
     再生していたが、この経路は「レンダリング成功」「Blob URLの再生可否」という
     iOS WKWebView 依存の不確実な段を2つ挟むため、鳴らないときに原因を切り分けられない。
     いまは sounds/*.wav（tools/gen_alarm_wav.py が生成する実ファイル）を直接指すだけにして、
     再生経路を「ファイルを指す→play()」の1段に減らしている。
     同じファイルをローカル通知の音にも使うので、アプリが閉じていても開いていても
     同じ音が鳴る（通知用は Library/Sounds/ へコピーする。installNotificationSounds 参照）。

     タップ時（unlockAudio）に、無音の短いWAVをユーザー操作の同期コールスタック内で
     一度再生→即停止してアンロックしておく。iOSはユーザー操作から非同期処理を挟んだ
     後のplay()を許可しないことが多いため、実ファイルの読み込み完了を待たずに
     即座にアンロックしてから、実ファイルを裏で読み込ませる。 ---- */
  function alarmFileName(key) { return key + '.wav'; }
  function alarmSrc(key) { return 'sounds/' + alarmFileName(key); }

  /* 「音が鳴らない」と言われたときに設定画面で状態を見せるための記録（診断表示用）。
     sched / pending は「アプリを閉じているときの通知」が出なかったときに、
     予約そのものが失敗したのか・OSまで届いているのかを切り分けるためのもの。 */
  var soundDiag = {
    play: '未実行', notif: '未実行', session: '未実行',
    sched: '未実行', pending: '未確認', delivered: '未確認',
    files: '未確認', ios: '未確認', perm: '未確認', foreground: '未確認'
  };

  /* ---- OSに聞いて埋める欄は「いちばん新しい問い合わせ」だけが書ける ----
     許可・予約一覧・iOS設定などは、画面を開く／タイマーを開始する／前面に戻る、の
     どれでも問い合わせが走るため、同じ欄に複数の問い合わせが同時に飛ぶ。
     素朴に書くと、先に始まって遅れて返ってきた古い問い合わせ（や、その4秒の時間切れ）が
     あとから確定した新しい結果を上書きして、画面に古い状態を出してしまう。
     欄ごとに通し番号を配り、追い越された問い合わせは成功・失敗・時間切れのどれでも黙る。
     書き込みと画面反映をここに集約してあるので、soundDiag と表示がずれることもない。 */
  var DIAG_TARGET = {
    perm: '#diagPerm', pending: '#diagPending', delivered: '#diagDelivered',
    ios: '#diagIos', files: '#diagFiles'
  };
  var diagSeq = {};
  function claimDiag(key) {
    diagSeq[key] = (diagSeq[key] || 0) + 1;
    return diagSeq[key];
  }
  /* 書けたかどうかを返す。書けなかった＝追い越された、なので
     呼び出し側もエラー記録などの後始末をやめる目印に使える。 */
  function writeDiag(key, token, text) {
    if (token !== diagSeq[key]) return false;
    soundDiag[key] = text;
    var sel = DIAG_TARGET[key];
    if (sel) {
      try {
        var el = $(sel);
        if (el) el.textContent = text;
      } catch (e) { /* 表示できないだけなので握りつぶす */ }
    }
    return true;
  }

  /* ---- 前面にいるときの通知の出方 ----
     capacitor.config.json の LocalNotifications.presentationOptions と対になる写し。
     この設定値はJSからは読めないので、ここに同じ内容を置いて診断に出す。
     配列を明示すると、そこに書いていないものは Capacitor 側で明示的に抑止される
     （既定は badge/sound/banner/list の4つ）。
     "sound" をあえて外しているのは、アプリが前面にいるときはアプリ内アラームが鳴っており、
     通知音と重なって二重に聞こえるのを避けるため。意図した無音であって不具合ではない。
     ただし診断画面がぜんぶ正常なのに前面で音がしないと故障に見えるので、こうして明記する。
     ★片方だけ書き換えると診断が嘘になる。変えるときは capacitor.config.json と必ず両方直すこと。 */
  var FOREGROUND_PRESENTATION = ['banner', 'list', 'badge'];
  function describeForegroundPresentation() {
    if (!isNativeApp()) return '—（ブラウザ版）';
    var names = { banner: 'バナー', list: '通知センター', badge: 'バッジ', sound: '音' };
    var shown = FOREGROUND_PRESENTATION.map(function (k) { return names[k] || k; }).join('・');
    var hasSound = FOREGROUND_PRESENTATION.indexOf('sound') >= 0;
    return (shown || '何も出さない') + ' / 通知音' +
      (hasSound ? 'オン' : 'オフ（アプリ内アラームと二重に鳴らないようアプリ側で切っています）');
  }
  var SILENT_WAV_URL = (function () {
    // 1chモノラル・8kHz・16bit・約0.05秒(400サンプル)の無音WAV。ArrayBufferは既定でゼロ埋めなのでそのまま無音になる
    var sampleRate = 8000, samples = 400, dataSize = samples * 2;
    var ab = new ArrayBuffer(44 + dataSize);
    var view = new DataView(ab);
    function writeStr(off, s) { for (var i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }
    writeStr(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeStr(8, 'WAVE');
    writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    writeStr(36, 'data'); view.setUint32(40, dataSize, true);
    var bytes = new Uint8Array(ab), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return 'data:audio/wav;base64,' + btoa(bin);
  })();
  function unlockAudio() {
    try {
      if (!timer.audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) timer.audioCtx = new AC();
      }
      if (timer.audioCtx && timer.audioCtx.state === 'suspended') timer.audioCtx.resume();
    } catch (e) { /* noop */ }
    if (!timer.audioElUnlocked) {
      try {
        var el = $('#timerAlarmAudio');
        if (el) {
          el.src = SILENT_WAV_URL;
          var finish = function () {
            /* 解錠の再生が終わるまでの間に本命の再生が始まっていたら何もしない。
               設定画面で音色をタップした直後（解錠と試聴が同時に走る）に
               ここで pause してしまうと、試聴が一瞬で止まってしまう。 */
            if (el.getAttribute('data-sound')) return;
            try { el.pause(); el.currentTime = 0; } catch (e2) { /* noop */ }
            setAlarmSource(timerSettings.sound); // 無音での解錠が済んでから本命を読み込ませる
          };
          var p = el.play();
          if (p && p.then) p.then(finish).catch(finish); else finish();
          timer.audioElUnlocked = true;
        }
      } catch (e) { /* noop */ }
    } else {
      setAlarmSource(timerSettings.sound);
    }
    applySilentModeSetting();
  }

  /* <audio>要素の src を選択中の音色に合わせる（同じなら何もしない＝読み込み直しを避ける） */
  function setAlarmSource(key) {
    var el = $('#timerAlarmAudio');
    if (!el) return null;
    if (el.getAttribute('data-sound') !== key) {
      el.setAttribute('data-sound', key);
      el.src = alarmSrc(key);
      try { el.load(); } catch (e) { /* noop */ }
    }
    return el;
  }

  /* 同梱WAVを再生する。stopAfterSec>0 なら途中で止める（設定画面の試聴用）。
     再生できなかったときだけ、旧方式のオシレーター合成にフォールバックする。 */
  function playAlarmFile(key, stopAfterSec) {
    var el = setAlarmSource(key);
    var full = !stopAfterSec;
    if (!el) { soundDiag.play = 'NG: <audio>要素が無い'; playViaAudioContextFallback(key, full); return; }
    var fallback = function (why) {
      soundDiag.play = 'NG: ' + why;
      playViaAudioContextFallback(key, full);
    };
    try {
      el.muted = false;
      el.loop = false;
      if (el.currentTime) el.currentTime = 0;
      var p = el.play();
      if (p && p.then) {
        p.then(function () { soundDiag.play = 'OK (' + alarmFileName(key) + ')'; })
         .catch(function (err) { fallback((err && err.name) || 'play()拒否'); });
      } else {
        soundDiag.play = 'OK (' + alarmFileName(key) + ')';
      }
    } catch (e) { fallback('play()例外'); return; }
    if (stopAfterSec > 0) {
      clearPreviewStop();
      timer.previewStop = setTimeout(function () { timer.previewStop = null; stopBeep(); }, stopAfterSec * 1000);
    }
  }
  function clearPreviewStop() {
    if (timer.previewStop) { clearTimeout(timer.previewStop); timer.previewStop = null; }
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
  /* Web Audio API(AudioContext)直接再生へのフォールバック（同梱WAVが再生できない場合のみ） */
  function playViaAudioContextFallback(key, full) {
    try {
      var ctx = timer.audioCtx;
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      schedulePattern(ctx, key, full);
    } catch (e) { /* noop */ }
  }
  /* タイマー終了時のアラーム音（設定でオフなら鳴らさない） */
  function playAlarmSound() {
    if (!timerSettings.soundOn) return;
    stopBeep();
    playAlarmFile(timerSettings.sound, 0);
  }
  /* 設定画面での試聴（頭の1.6秒だけ鳴らす。鳴る音そのものは終了時とまったく同じファイル） */
  function previewSound(key) {
    unlockAudio();
    stopBeep();
    playAlarmFile(key, 1.6);
  }
  function stopBeep() {
    clearPreviewStop();
    (timer.beepNodes || []).forEach(function (o) { try { o.stop(); o.disconnect(); } catch (e) { /* noop */ } });
    timer.beepNodes = [];
    try {
      var el = $('#timerAlarmAudio');
      if (el) { el.pause(); if (el.currentTime) el.currentTime = 0; }
    } catch (e) { /* noop */ }
  }
  /* バイブ（設定でオフなら振動しない）。
     navigator.vibrate は iOS の WKWebView に存在せず、これまでiPhoneでは一度も振動していなかった。
     ネイティブ版は Capacitor の Haptics（CoreHaptics）で鳴らす。
     Haptics はアプリが前面にあるときだけ効くので、閉じているときの振動は通知側が担当する。 */
  var VIBRATE_PULSE_MS = 500;   // 1回の振動の長さ（Hapticsを使う場合）
  var VIBRATE_GAP_MS = 800;     // 次の振動までの間隔
  var VIBRATE_REPEAT = 7;       // 合計 約5.6秒
  function vibrateAlarm() {
    if (!timerSettings.vibrateOn) return;
    stopVibrate();
    if (isNativeApp()) {
      // 自前プラグインの振動を先に試す。Haptics の CoreHaptics は
      // エンジンの寿命が呼び出しスコープに縛られていて途切れることがあるため、
      // 確実に動く AudioServices 側を本命にし、Haptics は控えに回す
      var aa = nativePlugin('AlarmAudio');
      var hp = nativePlugin('Haptics');
      /* Capacitor の registerPlugin はプロキシを返すので、ネイティブ側の登録が漏れていても
         JSからは vibrate が関数に見える（呼んで初めて reject でわかる）。
         したがって「あるかどうか」ではなく「呼んで失敗したか」で控えに切り替える。 */
      var fallback = false;
      function haptics() {
        if (!hp) return;
        try { hp.vibrate({ duration: VIBRATE_PULSE_MS }).catch(function () { /* noop */ }); }
        catch (e) { /* noop */ }
      }
      if (aa || hp) {
        var left = VIBRATE_REPEAT;
        var pulse = function () {
          if (left-- <= 0) { stopVibrate(); return; }
          if (fallback || !aa) { haptics(); return; }
          try {
            var r = aa.vibrate();
            if (r && r.catch) {
              r.catch(function () { fallback = true; haptics(); });
            }
          } catch (e) { fallback = true; haptics(); }
        };
        pulse();
        timer.vibrateTimer = setInterval(pulse, VIBRATE_GAP_MS);
        return;
      }
    }
    // Android Chrome など navigator.vibrate があるブラウザ向け（iOS Safariには無い）
    try {
      if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400, 200, 400, 200, 400, 200, 400, 200, 400, 200, 400, 200, 400]);
    } catch (e) { /* noop */ }
  }
  function stopVibrate() {
    if (timer.vibrateTimer) { clearInterval(timer.vibrateTimer); timer.vibrateTimer = null; }
    try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) { /* noop */ }
  }

  /* ---- OS通知（許可時のみ）・バッジ ---- */
  function askNotify() {
    try {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    } catch (e) { /* noop */ }
  }
  /* ブラウザ版専用。iOSのWKWebViewには Notification が無いので、
     アプリ版でここを通ってもただの死にコードになる（アプリ版はOSに予約した通知が出る） */
  function showTimerNotification() {
    if (!timerSettings.notifyOn || isNativeApp()) return;
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      var opts = { body: '休憩終了！ 次のセットへ', tag: 'kintore-timer', renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) { reg.showNotification('筋トレLog', opts); }).catch(function () {});
      } else {
        new Notification('筋トレLog', opts);
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
  /* 表示更新は200ms間隔のintervalだが、バックグラウンドではintervalが止まりうるため、
     終了判定そのものは独立したsetTimeoutで行う（バックグラウンドでも発火しやすくするため）。 */
  function startTick() { stopTick(); timer.tick = setInterval(tickTimer, 200); scheduleFinishTimeout(); }
  function stopTick() { if (timer.tick) { clearInterval(timer.tick); timer.tick = null; } clearFinishTimeout(); }
  function scheduleFinishTimeout() {
    clearFinishTimeout();
    var ms = timer.endAt - Date.now();
    timer.finishTimeout = setTimeout(function () {
      timer.finishTimeout = null;
      if (timer.running && !timer.paused) finishTimer();
    }, Math.max(0, ms));
  }
  function clearFinishTimeout() { if (timer.finishTimeout) { clearTimeout(timer.finishTimeout); timer.finishTimeout = null; } }
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
    clearDeliveredTimerNotification(); // 前回のお知らせを通知センターから片づける
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
    scheduleTimerNotification(timer.endAt);
    setTimerView('running');
    renderTimer();
    /* 予約を出したあとで状態を見に行く。許可ダイアログの結果が反映されるよう少し置く */
    refreshNotifWarning();
    setTimeout(refreshNotifWarning, 3000);
  }
  function finishTimer() {
    if (timer.finished) return;
    stopTick();
    timer.running = false;
    timer.paused = false;
    timer.finished = true;
    timer.remaining = 0;
    releaseWakeLock();
    /* 時間どおりに終わったときは、OSに預けた予約を取り消してはいけない。
       cancel が消すのは「まだ配信されていない予約」なので、
       OSがまさに今出そうとしているバナーを、こちらから叩き落とすことになる。
       （アプリを開いたまま待っているとバナーが出ないのはこれが原因だった）
       「−30秒」などで終了時刻より手前に終わらせた場合だけ取り消す。 */
    if (timer.endAt - Date.now() > 1500) cancelTimerNotification();
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
      scheduleTimerNotification(timer.endAt);
    } else {
      timer.remaining = (timer.endAt - Date.now()) / 1000;
      timer.paused = true;
      stopTick();
      releaseWakeLock();
      cancelTimerNotification(); // 一時停止中に終了時刻が来ても鳴らさない
    }
    renderTimer();
  }
  function addTime(sec) {
    if (timer.finished) return;
    timer.total += sec;
    if (timer.paused) timer.remaining += sec;
    else {
      timer.endAt += sec * 1000;
      timer.remaining = (timer.endAt - Date.now()) / 1000;
      scheduleFinishTimeout();
      scheduleTimerNotification(timer.endAt); // 終了時刻が動いたので通知も取り直す
    }
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
    cancelTimerNotification();
    clearDeliveredTimerNotification();
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

    /* 警告バーを押したら iPhone の設定を開く。
       通知を一度「許可しない」にすると、アプリからは二度と確認ダイアログを出せないので、
       設定アプリへ送るのが唯一の直し方になる */
    var warn = $('#trNotifWarn');
    if (warn) {
      warn.addEventListener('click', function () {
        var alarm = nativePlugin('AlarmAudio');
        if (!alarm || !alarm.openSettings) return;
        try {
          var r = alarm.openSettings();
          if (r && r.catch) r.catch(function (e) { noteAppError('設定を開く', e); });
        } catch (e) { noteAppError('設定を開く', e); }
      });
    }

    // バックグラウンド復帰時：経過を反映し、必要ならWake Lockを取り直す
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      /* ダイアログを出したまま他アプリへ行かれていた場合、返事は永遠に来ない。
         戻ってきた時点で 「確認中」 を解いておかないと、以後許可を求め直せなくなる */
      notifPermissionAsking = false;
      // 設定アプリで通知を切り替えて戻ってきた場合に、その場で警告を消す／出す
      refreshNotifWarning();
      // タイマーがTIME UP画面のまま残っていても、アプリを開いた時点でバッジは消す
      clearBadge();
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
    /* タイマー画面を開いた時点で、通知が出せない状態なら先に知らせる。
       「開始して5分待ったが鳴らなかった」より前に気付けるようにする */
    refreshNotifWarning();
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
    $('#toggleIgnoreSilent').checked = timerSettings.ignoreSilent;
    // 消音モードの制御と診断表示はネイティブ版だけの話なので、ブラウザ版では出さない
    $('#rowIgnoreSilent').hidden = !isNativeApp();
    $('#soundDiagSection').hidden = !isNativeApp();
    renderSoundDiag();
  }
  /* OSへの問い合わせが返ってこないと、欄が「確認中…」のまま固まって
     何が起きているのか実機から読み取れない。時間切れをはっきり書き出す。 */
  var DIAG_WAIT_MS = 4000;
  /* key は soundDiag のどの欄を担当するか。work は表示する文言を返す。
     失敗や時間切れのときに前回の値を残すと、たとえば許可が取れなくなった回でも
     古い「granted」がそのまま出て、診断そのものが嘘をつく。
     ここで必ず失敗として上書きしてから表示する。
     ただし上書きしてよいのは、この問い合わせが今もその欄の最新である場合だけ。
     欄ごとに番号を取り、成功・失敗・時間切れのどの道でも writeDiag を通す。
     work の中で soundDiag を直接書かせないのも同じ理由で、
     そうしないと追い越された問い合わせが表示だけ古い値に戻してしまう。 */
  function fillDiag(sel, key, work) {
    var el = $(sel);
    if (!el) return Promise.resolve();
    var token = claimDiag(key);
    el.textContent = '確認中…';
    var settled = false;
    var p = Promise.resolve()
      .then(work)
      .then(function (text) {
        settled = true;
        writeDiag(key, token, (text === null || text === undefined) ? '取得できず' : String(text));
      })
      .catch(function (e) {
        settled = true;
        if (writeDiag(key, token, 'NG: ' + errText(e))) noteAppError('診断', e);
      });
    return withTimeout(p, DIAG_WAIT_MS, null).then(function () {
      if (settled) return;
      /* 時間切れを出したあとにこの問い合わせが遅れて返ってきても、
         「返ってこなかった」という事実の方を残す。番号を進めて資格を失わせる。 */
      if (writeDiag(key, token, '確認が返ってきません（時間切れ）')) claimDiag(key);
    });
  }

  /* 「鳴らない」ときにどこで止まっているかを見せる */
  function renderSoundDiag() {
    if (!isNativeApp()) return;
    // ここで例外が出ると全欄が初期表示のまま残り、実機では「何も出ていない」ようにしか見えない
    try {
      $('#diagPlay').textContent = soundDiag.play;
      $('#diagNotif').textContent = soundDiag.notif;
      $('#diagSession').textContent = soundDiag.session;
      $('#diagSched').textContent = soundDiag.sched;
      // OSに聞く必要がない（アプリ側の設定で決まる）ので、その場で組み立てて出す
      soundDiag.foreground = describeForegroundPresentation();
      $('#diagForeground').textContent = soundDiag.foreground;
      $('#diagErr').textContent = lastAppError || 'なし';
    } catch (e) { noteAppError('診断表示', e); }

    var ln = nativePlugin('LocalNotifications');
    if (ln) {
      fillDiag('#diagPerm', 'perm', function () {
        return ln.checkPermissions().then(function (r) { return (r && r.display) || '不明'; });
      });
    } else {
      writeDiag('perm', claimDiag('perm'), 'NG: プラグイン未登録');
    }
    // OSに聞かないと分からないものは、画面を開くたびに取り直す
    fillDiag('#diagPending', 'pending', refreshPendingDiag);
    fillDiag('#diagDelivered', 'delivered', refreshDeliveredDiag);
    fillDiag('#diagIos', 'ios', refreshIosNotifDiag);
    fillDiag('#diagFiles', 'files', function () {
      return readSoundFiles().then(describeSoundFiles);
    });
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
      // 試聴の結果（成功/失敗）を診断欄に反映させる
      setTimeout(renderSoundDiag, 400);
      // 計測中に音色を変えたら、予約済みの通知も新しい音で取り直す
      if (timer.running && !timer.paused && !timer.finished) scheduleTimerNotification(timer.endAt);
    });
    $('#toggleSoundOn').addEventListener('change', function (e) {
      timerSettings.soundOn = e.target.checked;
      saveTimerSettings();
      if (timer.running && !timer.paused && !timer.finished) scheduleTimerNotification(timer.endAt);
    });
    $('#toggleVibrateOn').addEventListener('change', function (e) {
      timerSettings.vibrateOn = e.target.checked;
      saveTimerSettings();
      // ONにしたらその場で1回振動させて、効いていることを確かめられるようにする
      if (timerSettings.vibrateOn) {
        var hp = nativePlugin('Haptics');
        if (isNativeApp() && hp) { try { hp.vibrate({ duration: VIBRATE_PULSE_MS }).catch(function () { /* noop */ }); } catch (e2) { /* noop */ } }
      }
    });
    $('#toggleIgnoreSilent').addEventListener('change', function (e) {
      timerSettings.ignoreSilent = e.target.checked;
      saveTimerSettings();
      applySilentModeSetting().then(renderSoundDiag);
    });
    $('#toggleNotifyOn').addEventListener('change', function (e) {
      timerSettings.notifyOn = e.target.checked;
      saveTimerSettings();
      if (timerSettings.notifyOn) {
        askNotify();
        // 計測中に通知をONにしたら、その回の終了時刻からちゃんと鳴るようにする
        if (timer.running && !timer.paused && !timer.finished) scheduleTimerNotification(timer.endAt);
      } else {
        cancelTimerNotification(); // OFFにした以上、OSに預けた予約も取り消す
      }
      setTimeout(renderSoundDiag, 400);
      setTimeout(refreshNotifWarning, 600);
    });
    var testBtn = $('#testNotifBtn');
    if (testBtn) testBtn.addEventListener('click', runNotifTest);
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
  bindFeedback();
  bindExInfo();
  bindDrum();
  bindCtime();
  bindGen();
  bindRepsDrum();
  loadTimerSettings();
  bindTimerSettingsOnce();
  loadWeightStepSettings();
  initTheme();
  renderLog(true);

  // 機種変更・再インストール後の初回起動なら、端末内バックアップから記録を読み戻す
  // （記録が1件でもある端末では何もしない）
  restoreNativeBackupIfEmpty();

  // 消音モードの扱いを設定どおりにしておく（起動直後のタップでも正しい状態で鳴らすため）
  applySilentModeSetting();
  // 通知音のコピーは起動を妨げないよう少し遅らせる（初回だけ約1.2MB書き出す）
  setTimeout(function () { ensureNotificationSounds(); }, 1500);

  // 自動バックアップ：起動直後（描画を妨げないよう少し遅らせる）と、
  // アプリを閉じる・他アプリへ切り替えるとき（hidden）に未送信の変更を送る
  setTimeout(function () { autoSync(); writeNativeBackup(); }, 2000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden') return;
    autoSync({ keepalive: true });
    writeNativeBackup();
    /* ここから先はJSが止まる。動作中のタイマーがあれば予約を出し直しておく。
       開始時の予約が何らかの理由でOSに届いていなくても、この一手で拾える
       （同じidなので二重にはならない）。 */
    if (timer.running && !timer.paused && !timer.finished) scheduleTimerNotification(timer.endAt);
  });
})();
