/* ============================================================
   db.js — データ層（localStorage抽象化）
   キー: kintore_v1
   将来IndexedDBやスプレッドシート同期に差し替えられるよう、
   アプリ側は必ずこのDBオブジェクト経由でデータを操作する。
   ============================================================ */
'use strict';

var DB = (function () {
  var KEY = 'kintore_v1';
  var PARTS = ['胸', '背中', '脚', '肩', '腕', '腹', '有酸素', 'その他'];
  /* 記録画面の部位チップ（.p-xxx）と同じ配色。グラフの線色とカレンダーの塗りで共用する。
     app.js と charts.js の両方が使うため、部位の情報を持つここに置く（2か所にコピーすると
     色を変えたとき片方だけ直す事故になる）。有酸素はキーを持たず、使う側でボルトイエローに落ちる */
  var PART_COLOR = {
    '胸': '#ff8484', '背中': '#74b6ff', '脚': '#ffbc57', '肩': '#c9a4ff',
    '腕': '#62e3cb', '腹': '#ff9ec4', 'その他': '#9ba0a8'
  };
  var EQUIPS = ['バーベル', 'ダンベル', 'マシン', 'ケーブル', '自重'];
  var CARDIO_PART = '有酸素';
  /* 有酸素セットのフィールド：時間(t/分)・秒(ts/0-59)・距離(d/km)・速度(sp/km/h)・傾斜(inc/%)・カロリー(cal/kcal)・心拍(hr/bpm)
     z はインターバルの強度ラベル（'hi'=WORK / 'rec'=REST / ''=タグなし）。他と違い数値ではなく文字列で、
     実施セットの判定には使わない（強度だけ付いていて中身が空のセッションを「実施した」と数えないため） */
  var CARDIO_KEYS = ['t', 'ts', 'd', 'sp', 'inc', 'cal', 'hr', 'z'];
  var DEFAULTS = [
    ['ベンチプレス', '胸', 'バーベル'], ['ダンベルプレス', '胸', 'ダンベル'], ['インクラインベンチプレス', '胸', 'バーベル'], ['ダンベルフライ', '胸', 'ダンベル'], ['チェストプレス', '胸', 'マシン'],
    ['デッドリフト', '背中', 'バーベル'], ['ラットプルダウン', '背中', 'マシン'], ['ベントオーバーロー', '背中', 'バーベル'], ['シーテッドロー', '背中', 'ケーブル'], ['懸垂', '背中', '自重'],
    ['スクワット', '脚', 'バーベル'], ['レッグプレス', '脚', 'マシン'], ['レッグエクステンション', '脚', 'マシン'], ['レッグカール', '脚', 'マシン'], ['カーフレイズ', '脚', 'マシン'],
    ['ショルダープレス', '肩', 'ダンベル'], ['サイドレイズ', '肩', 'ダンベル'], ['リアレイズ', '肩', 'ダンベル'], ['フロントレイズ', '肩', 'ダンベル'],
    ['バーベルカール', '腕', 'バーベル'], ['ダンベルカール', '腕', 'ダンベル'], ['トライセプスプッシュダウン', '腕', 'ケーブル'], ['ナローベンチプレス', '腕', 'バーベル'],
    ['アブローラー', '腹', '自重'], ['クランチ', '腹', '自重'], ['レッグレイズ', '腹', '自重'], ['プランク', '腹', '自重'],
    ['トレッドミル', '有酸素', 'マシン'], ['エアロバイク', '有酸素', 'マシン'], ['ランニング', '有酸素', '自重'], ['ウォーキング', '有酸素', '自重']
  ];

  var state = null;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isCardioPart(part) { return part === CARDIO_PART; }
  function cp(v) { return v == null ? '' : v; }
  /* 部位に応じた空セット（有酸素は7項目、それ以外は重量×回数）
     筋トレの重量は新規セット時に50kgをデフォルトにする。回数は常に0スタート（前回の回数を引き継がない） */
  function emptySet(part) {
    if (isCardioPart(part)) {
      var s = {};
      CARDIO_KEYS.forEach(function (k) { s[k] = ''; });
      return s;
    }
    return { w: 50, r: 0 };
  }
  /* 前回値の引き継ぎ・セット追加時に既存セットを複製する（部位で形が異なる）
     筋トレは重量のみ引き継ぎ、回数は毎回0から（前回の回数を誤って使い回さないため） */
  function copySet(part, s) {
    if (isCardioPart(part)) {
      var out = {};
      CARDIO_KEYS.forEach(function (k) { out[k] = cp(s[k]); });
      return out;
    }
    return { w: cp(s.w), r: 0 };
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error('保存に失敗しました', e);
    }
  }

  function datesWithData() {
    return Object.keys(state.workouts).filter(function (d) {
      var w = state.workouts[d];
      return (w.entries && w.entries.length) || w.memo || w.condition;
    }).sort();
  }

  /* スプレッドシート同期用：前回同期以降に変更された日付を記憶する（クラウド連携機能で使用） */
  function markDirty(date) { state.dirtyDates[date] = true; }
  /* 種目マスタの変更（追加・名称変更・情報更新・削除・並べ替え）も未送信変更として記憶する */
  function markExercisesDirty() { state.dirtyExercises = true; }

  /* 種目の突合キー。スプレッドシート側の「種目」シートには種目IDの列が無く、IDは端末ごとに
     採番されるため、部位+種目名+器具の3点で同一性を判定する（findExerciseと同じ基準） */
  function exKeyOf(part, name, equip) {
    // 区切り文字が種目名に混ざる心配が無いよう、JSON配列の文字列をキーにする
    return JSON.stringify([
      String(part == null ? '' : part),
      String(name == null ? '' : name),
      String(equip == null ? '' : equip)
    ]);
  }
  /* 削除した種目の記録（tombstone）。バックアップはマージ方式（アプリに無い種目はシートに残す）
     のため、「アプリから消えた＝削除された」とはGAS側で判定できない。削除を明示的に送るための控え */
  function markExerciseDeleted(part, name, equip) {
    if (!state.deletedExercises) state.deletedExercises = [];
    var key = exKeyOf(part, name, equip);
    var dup = state.deletedExercises.some(function (d) {
      return exKeyOf(d.part, d.name, d.equip) === key;
    });
    if (!dup) state.deletedExercises.push({ part: part, name: name, equip: equip || '' });
    markExercisesDirty();
  }
  /* 同じ種目が再登録・復元されたら削除の控えを取り消す（登録したのに次の同期で消される事故を防ぐ） */
  function unmarkExerciseDeleted(part, name, equip) {
    if (!state.deletedExercises || !state.deletedExercises.length) return;
    var key = exKeyOf(part, name, equip);
    state.deletedExercises = state.deletedExercises.filter(function (d) {
      return exKeyOf(d.part, d.name, d.equip) !== key;
    });
  }

  /* 既存データを新しいデータ構造に引き上げる */
  function migrate() {
    if (state.version >= 2) return;
    // v2: 種目に器具(equip)フィールド追加・有酸素部位の初期種目追加
    var equipMap = {};
    DEFAULTS.forEach(function (d) { equipMap[d[1] + ':' + d[0]] = d[2]; });
    state.exercises.forEach(function (ex) {
      if (ex.equip === undefined) ex.equip = equipMap[ex.part + ':' + ex.name] || '';
    });
    var hasCardio = state.exercises.some(function (x) { return x.part === '有酸素'; });
    if (!hasCardio) {
      DEFAULTS.forEach(function (d) {
        if (d[1] === '有酸素') state.exercises.push({ id: uid(), name: d[0], part: d[1], equip: d[2] });
      });
    }
    state.version = 2;
    save();
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.exercises && s.workouts) {
          state = s;
          migrate();
          if (!state.dirtyDates) {
            // 同期機能を導入する前からのデータ：初回同期で全履歴を送れるよう既存の記録日をすべてdirty扱いにする
            state.dirtyDates = {};
            datesWithData().forEach(function (d) { state.dirtyDates[d] = true; });
            save();
          }
          if (state.dirtyExercises === undefined) {
            // 種目dirty追跡の導入前からのデータ：初回同期で種目リストを確実に送れるようdirty扱いにする
            state.dirtyExercises = true;
            save();
          }
          if (!state.deletedExercises) {
            // 削除同期（v0.9.3）導入前からのデータ：控えが無いだけなので空で始める
            state.deletedExercises = [];
            save();
          }
          return;
        }
      }
    } catch (e) { /* 壊れていたら初期化 */ }
    state = {
      version: 2,
      exercises: DEFAULTS.map(function (d, i) { return { id: 'd' + i, name: d[0], part: d[1], equip: d[2] }; }),
      workouts: {},
      dirtyDates: {},
      dirtyExercises: true,
      deletedExercises: []
    };
    save();
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function getWorkout(date) { return state.workouts[date] || null; }

  function ensure(date) {
    if (!state.workouts[date]) {
      state.workouts[date] = { date: date, memo: '', entries: [] };
    }
    return state.workouts[date];
  }

  function findEntry(date, entryId) {
    var w = getWorkout(date);
    if (!w) return null;
    for (var i = 0; i < w.entries.length; i++) {
      if (w.entries[i].id === entryId) return w.entries[i];
    }
    return null;
  }

  function getExercise(id) {
    for (var i = 0; i < state.exercises.length; i++) {
      if (state.exercises[i].id === id) return state.exercises[i];
    }
    return null;
  }

  /* 部位・種目名・器具がすべて一致する種目を探す（完全重複チェック用） */
  function findExercise(name, part, equip) {
    var eq = equip || '';
    for (var i = 0; i < state.exercises.length; i++) {
      var x = state.exercises[i];
      if (x.part === part && x.name === name && (x.equip || '') === eq) return x;
    }
    return null;
  }

  /* CSVインポート用：一致する種目が無ければ種目マスタに新規登録する（保存はしない。呼び出し側でまとめてsave） */
  function resolveExercise(name, part, equip) {
    var ex = findExercise(name, part, equip || '');
    if (ex) return ex;
    ex = { id: uid(), name: name, part: part, equip: equip || '' };
    state.exercises.push(ex);
    unmarkExerciseDeleted(part, name, equip || '');
    markExercisesDirty();
    return ex;
  }

  /* 指定日より前の、同じ種目の直近の記録を返す。
     種目を削除→再登録するとIDが変わり過去記録と切れてしまうため、
     IDで一致しない記録は記録時スナップショット（名前+部位+器具）でも同一種目とみなす */
  function prevRecord(exId, beforeDate) {
    var ex = getExercise(exId);
    var dates = Object.keys(state.workouts).filter(function (d) { return d < beforeDate; }).sort().reverse();
    for (var i = 0; i < dates.length; i++) {
      var w = state.workouts[dates[i]];
      var entries = w.entries || [];
      for (var j = 0; j < entries.length; j++) {
        var e = entries[j];
        if (!e.sets || !e.sets.length) continue;
        var same = e.exId === exId ||
          (ex && e.name === ex.name && e.part === ex.part && (e.equip || '') === (ex.equip || ''));
        if (same) return { date: dates[i], sets: e.sets };
      }
    }
    return null;
  }

  /* 種目ごとに「日付→その日の合計ボリューム(重量×回数の総和)」を集計する（有酸素は対象外） */
  function volumeByDateForExercise(exId) {
    var byDate = {};
    Object.keys(state.workouts).forEach(function (date) {
      var w = state.workouts[date];
      (w.entries || []).forEach(function (e) {
        if (e.exId !== exId || isCardioPart(e.part)) return;
        var vol = (e.sets || []).reduce(function (sum, s) {
          return sum + ((+s.w || 0) * (+s.r || 0));
        }, 0);
        if (vol > 0) byDate[date] = (byDate[date] || 0) + vol;
      });
    });
    return byDate;
  }
  function rankedRecords(exId) {
    var byDate = volumeByDateForExercise(exId);
    var list = Object.keys(byDate).map(function (d) { return { date: d, vol: byDate[d] }; });
    list.sort(function (a, b) { return b.vol - a.vol || (a.date < b.date ? -1 : 1); });
    return list;
  }
  /* 種目の合計ボリューム上位N件（日付ごと）を返す */
  function bestRecords(exId, topN) {
    return rankedRecords(exId).slice(0, topN || 3);
  }
  /* 指定日のその種目の順位（1位=1）を返す。TOP3圏外またはその日に記録が無ければnull */
  function rankOnDate(exId, date) {
    var list = rankedRecords(exId);
    for (var i = 0; i < list.length && i < 3; i++) {
      if (list[i].date === date) return i + 1;
    }
    return null;
  }

  load();

  return {
    PARTS: PARTS,
    PART_COLOR: PART_COLOR,
    EQUIPS: EQUIPS,
    todayStr: todayStr,

    /* ---- 種目マスタ ---- */
    getExercises: function () { return state.exercises.slice(); },
    getExercise: getExercise,
    findExercise: findExercise,
    addExercise: function (name, part, equip) {
      var ex = { id: uid(), name: name, part: part, equip: equip || '' };
      state.exercises.push(ex);
      // 以前に削除した種目と同じなら、削除の控えを取り消す（登録直後に消される事故を防ぐ）
      unmarkExerciseDeleted(part, name, equip || '');
      markExercisesDirty();
      save();
      return ex;
    },
    renameExercise: function (id, name) {
      var ex = getExercise(id);
      if (!ex) return;
      var oldName = ex.name;
      ex.name = name;
      // 各日の記録は登録時点の種目名をスナップショットとして持っているため、
      // 名称変更時はそれらも合わせて書き換える（削除時は履歴保護のためあえて残す仕様と非対称）
      Object.keys(state.workouts).forEach(function (date) {
        var w = state.workouts[date];
        var changed = false;
        (w.entries || []).forEach(function (e) {
          if (e.exId === id && e.name !== name) { e.name = name; changed = true; }
        });
        if (changed) markDirty(date);
      });
      // スプレッドシート側は部位+種目名+器具で突合するため、改名は「旧名の削除＋新名の追加」になる。
      // 旧名を削除として送らないとシートに旧名が残り、復元で重複して戻ってくる
      if (oldName !== name) {
        markExerciseDeleted(ex.part, oldName, ex.equip);
        unmarkExerciseDeleted(ex.part, name, ex.equip);
      }
      markExercisesDirty();
      save();
    },
    updateExercise: function (id, fields) {
      var ex = getExercise(id);
      if (!ex) return;
      Object.keys(fields).forEach(function (k) { ex[k] = fields[k]; });
      markExercisesDirty();
      save();
    },
    /* 指定部位の種目を orderedIds の順に並べ替える（他部位の位置は保持） */
    reorderWithinPart: function (part, orderedIds) {
      var orderMap = {};
      orderedIds.forEach(function (id, i) { orderMap[id] = i; });
      var partItems = state.exercises.filter(function (x) { return x.part === part; });
      partItems.sort(function (a, b) {
        var ai = (orderMap[a.id] == null) ? 9999 : orderMap[a.id];
        var bi = (orderMap[b.id] == null) ? 9999 : orderMap[b.id];
        return ai - bi;
      });
      var k = 0;
      state.exercises = state.exercises.map(function (x) {
        return x.part === part ? partItems[k++] : x;
      });
      markExercisesDirty();
      save();
    },
    deleteExercise: function (id) {
      var ex = getExercise(id);
      state.exercises = state.exercises.filter(function (x) { return x.id !== id; });
      // 削除をスプレッドシート側にも伝える控えを残す（残さないとシートに残り続け、復元で復活する）
      if (ex) markExerciseDeleted(ex.part, ex.name, ex.equip);
      markExercisesDirty();
      save();
    },

    /* ---- ワークアウト ---- */
    getWorkout: getWorkout,
    deleteWorkout: function (date) { delete state.workouts[date]; markDirty(date); save(); },
    addEntry: function (date, exId) {
      var ex = getExercise(exId);
      if (!ex) return null;
      var w = ensure(date);
      // 種目名・部位・器具は記録時点の値を保持（種目マスタから削除しても履歴が壊れない）
      var entry = { id: uid(), exId: exId, name: ex.name, part: ex.part, equip: ex.equip || '', sets: [] };
      // 前回の記録があれば引き継ぐ。無ければ既定の行数を用意する
      // 筋トレは前回何セットやっていても上から3セット分だけ引き継ぐ（4セット目以降は「＋セット追加」で）。
      // 有酸素は前回の全セッションを引き継ぐ（インターバル構成を保つため）
      var minRows = isCardioPart(ex.part) ? 1 : 3;
      var prev = prevRecord(exId, date);
      if (prev) {
        var carry = isCardioPart(ex.part) ? prev.sets : prev.sets.slice(0, minRows);
        carry.forEach(function (s) { entry.sets.push(copySet(ex.part, s)); });
      }
      while (entry.sets.length < minRows) {
        var pad = entry.sets.length ? entry.sets[entry.sets.length - 1] : null;
        entry.sets.push(pad ? copySet(ex.part, pad) : emptySet(ex.part));
      }
      w.entries.push(entry);
      markDirty(date);
      save();
      return entry;
    },
    removeEntry: function (date, entryId) {
      var w = getWorkout(date);
      if (!w) return;
      w.entries = w.entries.filter(function (e) { return e.id !== entryId; });
      markDirty(date);
      save();
    },
    addSet: function (date, entryId) {
      var e = findEntry(date, entryId);
      if (!e) return;
      var last = e.sets[e.sets.length - 1];
      if (!last) {
        var prev = prevRecord(e.exId, date);
        last = prev ? prev.sets[prev.sets.length - 1] : null;
      }
      e.sets.push(last ? copySet(e.part, last) : emptySet(e.part));
      markDirty(date);
      save();
    },
    getSet: function (date, entryId, idx) {
      var e = findEntry(date, entryId);
      return e ? (e.sets[idx] || null) : null;
    },
    updateSet: function (date, entryId, idx, field, val) {
      var e = findEntry(date, entryId);
      if (e && e.sets[idx]) { e.sets[idx][field] = val; markDirty(date); save(); }
    },
    removeSet: function (date, entryId, idx) {
      var e = findEntry(date, entryId);
      if (e) { e.sets.splice(idx, 1); markDirty(date); save(); }
    },
    /* インターバルの一括生成。listは {t,ts,z,…} の配列で、指定が無いフィールドは空のまま。
       replaceAll=true なら既存セットを置き換え、falseなら末尾に足す（入力済みの記録を消さないため）。
       セットを1つずつaddSet+updateSetで作ると保存が本数分走るので、まとめて1回で書き込む */
    addCardioSets: function (date, entryId, list, replaceAll) {
      var e = findEntry(date, entryId);
      if (!e || !list || !list.length) return;
      var made = list.map(function (src) {
        var s = emptySet(e.part);
        Object.keys(src).forEach(function (k) {
          if (Object.prototype.hasOwnProperty.call(s, k)) s[k] = cp(src[k]);
        });
        return s;
      });
      e.sets = replaceAll ? made : e.sets.concat(made);
      markDirty(date);
      save();
    },
    setMemo: function (date, text) { ensure(date).memo = text; markDirty(date); save(); },
    prevRecord: prevRecord,
    bestRecords: bestRecords,
    rankOnDate: rankOnDate,

    /* ---- 集計・ユーティリティ ---- */
    datesWithData: datesWithData,
    sizeKB: function () {
      try { return (JSON.stringify(state).length / 1024).toFixed(1); } catch (e) { return '?'; }
    },
    wipe: function () {
      try { localStorage.removeItem(KEY); } catch (e) { /* noop */ }
      load();
    },

    /* ---- クラウド同期（スプレッドシート） ---- */
    dirtyDates: function () { return Object.keys(state.dirtyDates || {}).sort(); },
    clearDirty: function (dates) {
      (dates || []).forEach(function (d) { delete state.dirtyDates[d]; });
      save();
    },
    exercisesDirty: function () {
      return !!state.dirtyExercises || !!(state.deletedExercises && state.deletedExercises.length);
    },
    clearExercisesDirty: function () { state.dirtyExercises = false; save(); },
    /* 未送信の削除（tombstone）。バックアップ時に同梱し、成功したらクリアする */
    deletedExercises: function () { return (state.deletedExercises || []).slice(); },
    clearDeletedExercises: function () { state.deletedExercises = []; save(); },

    /* ---- CSVインポート（app.js側でCSVをパース・日付ごとにグルーピングした結果を受け取り反映する） ---- */
    /* dateOrder: 対象日付の配列。byDate: { date: { order:[entryKey...], entries:{entryKey:{part,name,equip,sets}}, memo } }
       日付ごとにその日の記録を丸ごと置き換える（CSVに含まれない日付は無変更）。種目マスタに無い種目は自動登録する。 */
    applyImport: function (dateOrder, byDate) {
      dateOrder.forEach(function (date) {
        var dayData = byDate[date];
        if (!dayData) return;
        var w = ensure(date);
        w.entries = dayData.order.map(function (key) {
          var d = dayData.entries[key];
          var ex = resolveExercise(d.name, d.part, d.equip);
          var sets = d.sets.filter(function (s) { return !!s; }); // 歯抜け（セット番号の飛び）を除去
          if (!sets.length) sets = [emptySet(d.part)];
          return { id: uid(), exId: ex.id, name: d.name, part: d.part, equip: d.equip || '', sets: sets };
        });
        w.memo = dayData.memo || '';
        markDirty(date);
      });
      save();
    },
    /* クラウド復元用：種目リストを取り込む。名前+部位+器具が一致する既存種目はそのまま使い、
       無いものだけ追加する。video/noteはローカルが空の場合のみ設定（ローカルの編集を上書きしない） */
    importExercises: function (list) {
      (list || []).forEach(function (d) {
        if (!d || !d.name || !d.part) return;
        var ex = findExercise(d.name, d.part, d.equip || '');
        if (!ex) {
          ex = { id: uid(), name: d.name, part: d.part, equip: d.equip || '' };
          state.exercises.push(ex);
        }
        // 復元はスプレッドシートを正として取り込む操作なので、未送信の削除の控えは取り消す
        unmarkExerciseDeleted(d.part, d.name, d.equip || '');
        if (d.video && !ex.video) ex.video = d.video;
        if (d.note && !ex.note) ex.note = d.note;
      });
      save();
    },

    /* ---- 取り込み前の自動バックアップ・復元 ---- */
    exportStateJSON: function () {
      try { return JSON.stringify(state); } catch (e) { return null; }
    },
    restoreStateJSON: function (json) {
      try {
        var s = JSON.parse(json);
        if (!s || !s.exercises || !s.workouts) return false;
        if (!s.dirtyDates) s.dirtyDates = {};
        if (!s.deletedExercises) s.deletedExercises = [];
        state = s;
        save();
        return true;
      } catch (e) { return false; }
    }
  };
})();
