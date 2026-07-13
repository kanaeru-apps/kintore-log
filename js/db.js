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
  var EQUIPS = ['バーベル', 'ダンベル', 'マシン', 'ケーブル', '自重'];
  var CARDIO_PART = '有酸素';
  /* 有酸素セットのフィールド：時間(t/分)・秒(ts/0-59)・距離(d/km)・速度(sp/km/h)・傾斜(inc/%)・カロリー(cal/kcal)・心拍(hr/bpm) */
  var CARDIO_KEYS = ['t', 'ts', 'd', 'sp', 'inc', 'cal', 'hr'];
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
          return;
        }
      }
    } catch (e) { /* 壊れていたら初期化 */ }
    state = {
      version: 2,
      exercises: DEFAULTS.map(function (d, i) { return { id: 'd' + i, name: d[0], part: d[1], equip: d[2] }; }),
      workouts: {},
      dirtyDates: {}
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

  /* 指定日より前の、同じ種目の直近の記録を返す */
  function prevRecord(exId, beforeDate) {
    var dates = Object.keys(state.workouts).filter(function (d) { return d < beforeDate; }).sort().reverse();
    for (var i = 0; i < dates.length; i++) {
      var w = state.workouts[dates[i]];
      var entries = w.entries || [];
      for (var j = 0; j < entries.length; j++) {
        if (entries[j].exId === exId && entries[j].sets.length) {
          return { date: dates[i], sets: entries[j].sets };
        }
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
    EQUIPS: EQUIPS,
    todayStr: todayStr,

    /* ---- 種目マスタ ---- */
    getExercises: function () { return state.exercises.slice(); },
    getExercise: getExercise,
    findExercise: findExercise,
    addExercise: function (name, part, equip) {
      var ex = { id: uid(), name: name, part: part, equip: equip || '' };
      state.exercises.push(ex);
      save();
      return ex;
    },
    renameExercise: function (id, name) {
      var ex = getExercise(id);
      if (ex) { ex.name = name; save(); }
    },
    updateExercise: function (id, fields) {
      var ex = getExercise(id);
      if (!ex) return;
      Object.keys(fields).forEach(function (k) { ex[k] = fields[k]; });
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
      save();
    },
    deleteExercise: function (id) {
      state.exercises = state.exercises.filter(function (x) { return x.id !== id; });
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
      // 前回の記録があれば全セットを引き継ぐ。無ければ既定の行数を用意する
      // （筋トレ=3セット、有酸素=1セッション。有酸素は「＋セッション追加」で増やせる）
      var minRows = isCardioPart(ex.part) ? 1 : 3;
      var prev = prevRecord(exId, date);
      if (prev) {
        prev.sets.forEach(function (s) { entry.sets.push(copySet(ex.part, s)); });
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
    }
  };
})();
