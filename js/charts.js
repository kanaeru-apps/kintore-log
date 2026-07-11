/* ============================================================
   charts.js — グラフ・レポート（種目別グラフ・推定1RM・部位別ボリューム）
   外部ライブラリ不使用。SVGを直接組み立てて描画する（人体図SVGと同じ方式）。
   ============================================================ */
'use strict';

var Charts = (function () {
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  var VOLT = '#d7ff3e';
  /* 記録画面の部位チップ（.p-xxx）と同じ配色。有酸素は重量ボリューム対象外のため含めない */
  var PART_COLOR = {
    '胸': '#ff8484', '背中': '#74b6ff', '脚': '#ffbc57', '肩': '#c9a4ff',
    '腕': '#62e3cb', '腹': '#ff9ec4', 'その他': '#9ba0a8'
  };

  var state = { cardTab: 'exercise', part: null, exId: null, bound: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt1(n) { return (Math.round((n || 0) * 10) / 10).toLocaleString('ja-JP'); }
  function parseDate(str) {
    var p = str.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function toStr(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function rmCoef(n) { return 1 + 0.0244 * (n - 1); } // RM計算機タブと同じ式（表記のブレをなくす）

  /* ================== 種目別：データ収集 ================== */
  function collectExerciseSessions(exId) {
    var rows = [];
    DB.datesWithData().forEach(function (date) {
      var w = DB.getWorkout(date);
      var matched = (w.entries || []).filter(function (e) { return e.exId === exId; });
      if (!matched.length) return;
      var cardio = matched[0].part === '有酸素';
      if (cardio) {
        var t = 0, d = 0;
        matched.forEach(function (e) {
          e.sets.forEach(function (s) { t += (+s.t || 0); d += (+s.d || 0); });
        });
        rows.push({ date: date, cardio: true, t: t, d: d });
      } else {
        var vol = 0, best1rm = 0;
        matched.forEach(function (e) {
          e.sets.forEach(function (s) {
            var w2 = +s.w || 0, r = +s.r || 0;
            if (w2 > 0 && r > 0) {
              vol += w2 * r;
              var est = w2 * rmCoef(r);
              if (est > best1rm) best1rm = est;
            }
          });
        });
        rows.push({ date: date, cardio: false, vol: vol, rm: best1rm });
      }
    });
    return rows.filter(function (r) { return r.cardio ? (r.t > 0 || r.d > 0) : (r.vol > 0 || r.rm > 0); });
  }

  /* ================== 部位別ボリューム：期間バケット ================== */
  function dayBuckets(count) {
    var today = parseDate(DB.todayStr());
    var buckets = [];
    for (var i = count - 1; i >= 0; i--) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      buckets.push({ label: (d.getMonth() + 1) + '/' + d.getDate(), dateStr: toStr(d) });
    }
    return buckets;
  }
  function mondayOf(d) {
    var day = d.getDay();
    var diff = (day === 0 ? -6 : 1 - day);
    var m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
    return m;
  }
  function weekBuckets(count) {
    var thisMonday = mondayOf(parseDate(DB.todayStr()));
    var buckets = [];
    for (var i = count - 1; i >= 0; i--) {
      var start = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - i * 7);
      var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      buckets.push({ label: (start.getMonth() + 1) + '/' + start.getDate(), start: start, end: end });
    }
    return buckets;
  }
  function monthBuckets(count) {
    var today = parseDate(DB.todayStr());
    var buckets = [];
    for (var i = count - 1; i >= 0; i--) {
      var d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      buckets.push({ label: (d.getMonth() + 1) + '月', year: d.getFullYear(), month: d.getMonth() });
    }
    return buckets;
  }

  function volumeByPartBuckets(range) {
    var buckets = range === 'month' ? monthBuckets(6) : range === 'day' ? dayBuckets(8) : weekBuckets(8);
    var sums = buckets.map(function () { return {}; });

    DB.datesWithData().forEach(function (date) {
      var d = parseDate(date);
      var idx = -1;
      if (range === 'month') {
        idx = buckets.findIndex(function (b) { return b.year === d.getFullYear() && b.month === d.getMonth(); });
      } else if (range === 'day') {
        idx = buckets.findIndex(function (b) { return b.dateStr === date; });
      } else {
        idx = buckets.findIndex(function (b) { return d >= b.start && d <= b.end; });
      }
      if (idx < 0) return;
      var w = DB.getWorkout(date);
      (w.entries || []).forEach(function (e) {
        if (e.part === '有酸素') return;
        var vol = 0;
        e.sets.forEach(function (s) { vol += (+s.w || 0) * (+s.r || 0); });
        if (vol <= 0) return;
        sums[idx][e.part] = (sums[idx][e.part] || 0) + vol;
      });
    });

    // 表示する部位は、期間内に1回でも記録がある部位のみ（凡例が煩雑にならないように）
    var partsUsed = {};
    sums.forEach(function (s) { Object.keys(s).forEach(function (p) { partsUsed[p] = true; }); });
    var partOrder = DB.PARTS.filter(function (p) { return p !== '有酸素' && partsUsed[p]; });

    var maxTotal = 0;
    var bucketData = buckets.map(function (b, i) {
      var segs = partOrder.map(function (p) {
        return { part: p, value: sums[i][p] || 0, color: PART_COLOR[p] || '#9ba0a8' };
      });
      var total = segs.reduce(function (a, s) { return a + s.value; }, 0);
      if (total > maxTotal) maxTotal = total;
      return { label: b.label, segments: segs, total: total };
    });

    return { buckets: bucketData, parts: partOrder, maxTotal: maxTotal };
  }

  /* ================== SVG描画ヘルパー ================== */
  var CW = 320, CH = 150, PL = 34, PR = 8, PT = 26, PB = 20;
  var IW = CW - PL - PR, IH = CH - PT - PB;

  function gridAndAxis(maxV) {
    var lines = [0, 0.5, 1].map(function (t) {
      var y = PT + IH * (1 - t);
      return '<line class="chart-gridline" x1="' + PL + '" x2="' + (CW - PR) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>' +
        '<text class="chart-axis-label" x="0" y="' + (y + 3).toFixed(1) + '">' + fmt1(maxV * t) + '</text>';
    }).join('');
    return lines +
      '<line class="chart-axis-line" x1="' + PL + '" x2="' + PL + '" y1="' + PT + '" y2="' + (PT + IH) + '"/>' +
      '<line class="chart-axis-line" x1="' + PL + '" x2="' + (CW - PR) + '" y1="' + (PT + IH) + '" y2="' + (PT + IH) + '"/>';
  }

  /* 折れ線グラフ（points: [{label, value}]） */
  function lineChartSvg(points) {
    var n = points.length;
    var maxV = Math.max.apply(null, points.map(function (p) { return p.value; }).concat([0])) || 1;
    var stepX = n > 1 ? IW / (n - 1) : 0;
    var xAt = function (i) { return PL + (n > 1 ? i * stepX : IW / 2); };
    var yAt = function (v) { return PT + IH - (v / maxV) * IH; };

    var path = points.map(function (p, i) {
      return (i === 0 ? 'M' : 'L') + xAt(i).toFixed(1) + ' ' + yAt(p.value).toFixed(1);
    }).join(' ');
    var dots = points.map(function (p, i) {
      return '<circle class="chart-line-dot" cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(p.value).toFixed(1) + '" r="3"/>';
    }).join('');
    var valueLabels = points.map(function (p, i) {
      var y = Math.max(10, yAt(p.value) - 8);
      return '<text class="chart-value-label" text-anchor="middle" x="' + xAt(i).toFixed(1) + '" y="' + y.toFixed(1) + '">' + fmt1(p.value) + '</text>';
    }).join('');
    var labelEvery = Math.max(1, Math.ceil(n / 6));
    var xLabels = points.map(function (p, i) {
      if (i % labelEvery !== 0 && i !== n - 1) return '';
      return '<text class="chart-axis-label" text-anchor="middle" x="' + xAt(i).toFixed(1) + '" y="' + (CH - 4) + '">' + esc(p.label) + '</text>';
    }).join('');

    return '<svg class="chart-svg" viewBox="0 0 ' + CW + ' ' + CH + '" preserveAspectRatio="xMidYMid meet">' +
      gridAndAxis(maxV) + '<path class="chart-line-path" d="' + path + '"/>' + dots + valueLabels + xLabels +
    '</svg>';
  }

  /* 単色の棒グラフ（points: [{label, value}]） */
  function barChartSvg(points) {
    var n = points.length;
    var maxV = Math.max.apply(null, points.map(function (p) { return p.value; }).concat([0])) || 1;
    var slot = IW / n;
    var barW = Math.min(28, slot * 0.6);

    var bars = points.map(function (p, i) {
      var h = (p.value / maxV) * IH;
      var x = PL + slot * i + (slot - barW) / 2;
      var y = PT + IH - h;
      var label = p.value > 0 ? '<text class="chart-value-label" text-anchor="middle" x="' + (x + barW / 2).toFixed(1) + '" y="' + Math.max(10, y - 6).toFixed(1) + '">' + fmt1(p.value) + '</text>' : '';
      return '<rect class="chart-bar-seg" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="3" fill="' + VOLT + '"/>' + label;
    }).join('');
    var xLabels = points.map(function (p, i) {
      var x = PL + slot * i + slot / 2;
      return '<text class="chart-axis-label" text-anchor="middle" x="' + x.toFixed(1) + '" y="' + (CH - 4) + '">' + esc(p.label) + '</text>';
    }).join('');

    return '<svg class="chart-svg" viewBox="0 0 ' + CW + ' ' + CH + '" preserveAspectRatio="xMidYMid meet">' +
      gridAndAxis(maxV) + bars + xLabels +
    '</svg>';
  }

  /* 積み上げ棒グラフ（buckets: [{label, segments:[{part,value,color}], total}]） */
  function stackedBarChartSvg(buckets, maxTotal) {
    var n = buckets.length;
    var maxV = maxTotal || 1;
    var slot = IW / n;
    var barW = Math.min(26, slot * 0.62);

    var bars = buckets.map(function (b, i) {
      var x = PL + slot * i + (slot - barW) / 2;
      var yCursor = PT + IH;
      var segHtml = b.segments.map(function (seg) {
        if (seg.value <= 0) return '';
        var h = (seg.value / maxV) * IH;
        yCursor -= h;
        return '<rect class="chart-bar-seg" x="' + x.toFixed(1) + '" y="' + yCursor.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + seg.color + '"/>';
      }).join('');
      var totalLabel = b.total > 0 ? '<text class="chart-value-label" text-anchor="middle" x="' + (x + barW / 2).toFixed(1) + '" y="' + Math.max(10, yCursor - 6).toFixed(1) + '">' + fmt1(b.total) + '</text>' : '';
      return segHtml + totalLabel;
    }).join('');
    var xLabels = buckets.map(function (b, i) {
      var x = PL + slot * i + slot / 2;
      return '<text class="chart-axis-label" text-anchor="middle" x="' + x.toFixed(1) + '" y="' + (CH - 4) + '">' + esc(b.label) + '</text>';
    }).join('');

    return '<svg class="chart-svg" viewBox="0 0 ' + CW + ' ' + CH + '" preserveAspectRatio="xMidYMid meet">' +
      gridAndAxis(maxV) + bars + xLabels +
    '</svg>';
  }

  /* ================== 描画・バインド ================== */
  function chartCard(title, inner) {
    return '<div class="chart-card"><div class="chart-card-title">' + esc(title) + '</div>' + inner + '</div>';
  }
  function emptyMsg(msg) {
    return '<div class="empty"><p>' + esc(msg) + '</p></div>';
  }

  function renderExercisePane() {
    if (!state.exId) { $('#chartExBody').innerHTML = emptyMsg('種目を選択してください'); return; }
    var rows = collectExerciseSessions(state.exId);
    if (!rows.length) { $('#chartExBody').innerHTML = emptyMsg('この種目の記録がまだありません'); return; }

    var recent = rows.slice(-12); // 直近12回分
    var labelOf = function (r) { var d = parseDate(r.date); return (d.getMonth() + 1) + '/' + d.getDate(); };

    var html = '';
    if (recent[0].cardio) {
      html += chartCard('時間の推移（分）', lineChartSvg(recent.map(function (r) { return { label: labelOf(r), value: r.t }; })));
      html += chartCard('距離の推移（km）', lineChartSvg(recent.map(function (r) { return { label: labelOf(r), value: r.d }; })));
    } else {
      html += chartCard('推定1RM推移（kg）', lineChartSvg(recent.map(function (r) { return { label: labelOf(r), value: Math.round(r.rm * 10) / 10 }; })));
      html += chartCard('セッション合計ボリューム（kg）', barChartSvg(recent.map(function (r) { return { label: labelOf(r), value: Math.round(r.vol) }; })));
    }
    $('#chartExBody').innerHTML = html;
  }

  /* 部位別ボリューム1件分（週次 or 月次）のカードHTMLを組み立てる。データが無ければ空メッセージ */
  function volumeCard(range, title) {
    var data = volumeByPartBuckets(range);
    if (!data.maxTotal) return chartCard(title, emptyMsg('まだ記録がありません'));
    var svg = stackedBarChartSvg(data.buckets, data.maxTotal);
    var legend = '<div class="chart-legend">' + data.parts.map(function (p) {
      return '<span class="chart-legend-item"><span class="chart-legend-dot" style="background:' + (PART_COLOR[p] || '#9ba0a8') + '"></span>' + esc(p) + '</span>';
    }).join('') + '</div>';
    return chartCard(title, svg + legend);
  }

  /* 日次グラフ・週次グラフ・月次グラフの順に並べて表示 */
  function renderVolumePane() {
    $('#chartVolBody').innerHTML =
      volumeCard('day', '部位別ボリューム（日次・直近8日間）') +
      volumeCard('week', '部位別ボリューム（週次・直近8週間）') +
      volumeCard('month', '部位別ボリューム（月次・直近6ヶ月）');
  }

  /* まず部位を選ぶチップを描画（種目が登録されている部位のみ） */
  function populatePartChips() {
    var byPart = {};
    DB.getExercises().forEach(function (x) { (byPart[x.part] = byPart[x.part] || []).push(x); });
    var parts = DB.PARTS.filter(function (p) { return byPart[p] && byPart[p].length; });
    if (!state.part || parts.indexOf(state.part) < 0) state.part = parts[0] || null;
    $('#chartPartChips').innerHTML = parts.map(function (p) {
      return '<button class="chart-pchip' + (p === state.part ? ' active' : '') + '" data-part="' + esc(p) + '" type="button">' + esc(p) + '</button>';
    }).join('');
  }
  /* 選んだ部位の種目だけを一覧表示（スクロールが長くならないように絞り込む） */
  function populateExList() {
    var list = state.part ? DB.getExercises().filter(function (x) { return x.part === state.part; }) : [];
    if (!state.exId || list.every(function (x) { return x.id !== state.exId; })) {
      state.exId = list.length ? list[0].id : null;
    }
    $('#chartExList').innerHTML = list.map(function (x) {
      return '<button class="chart-ex-item' + (x.id === state.exId ? ' active' : '') + '" data-ex="' + x.id + '" type="button">' +
        '<span>' + esc(x.name) + (x.equip ? '（' + esc(x.equip) + '）' : '') + '</span>' +
        '<span class="chart-ex-check">✓</span>' +
      '</button>';
    }).join('');
  }

  function switchCTab(tab) {
    state.cardTab = tab;
    $$('.chart-tab').forEach(function (b) { b.classList.toggle('active', b.dataset.ctab === tab); });
    $('#chartPaneExercise').classList.toggle('active', tab === 'exercise');
    $('#chartPaneVolume').classList.toggle('active', tab === 'volume');
    if (tab === 'exercise') renderExercisePane(); else renderVolumePane();
  }

  function bindOnce() {
    if (state.bound) return;
    state.bound = true;
    $$('.chart-tab').forEach(function (b) {
      b.addEventListener('click', function () { switchCTab(b.dataset.ctab); });
    });
    $('#chartPartChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-part]');
      if (!b) return;
      state.part = b.dataset.part;
      populatePartChips();
      populateExList();
      renderExercisePane();
    });
    $('#chartExList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-ex]');
      if (!b) return;
      state.exId = b.dataset.ex;
      populateExList();
      renderExercisePane();
    });
  }

  /* 全期間・全種目・全部位を合算した総合計ボリューム（有酸素は対象外） */
  function totalVolumeAllTime() {
    var total = 0;
    DB.datesWithData().forEach(function (date) {
      var w = DB.getWorkout(date);
      (w.entries || []).forEach(function (e) {
        if (e.part === '有酸素') return;
        e.sets.forEach(function (s) { total += (+s.w || 0) * (+s.r || 0); });
      });
    });
    return total;
  }
  function renderTotalVol() {
    var el = $('#totalVolValue');
    if (!el) return;
    el.innerHTML = fmt1(totalVolumeAllTime()) + '<small> kg</small>';
  }

  function init() {
    bindOnce();
    populatePartChips();
    populateExList();
    renderTotalVol();
    if (state.cardTab === 'exercise') renderExercisePane(); else renderVolumePane();
  }

  return { init: init };
})();
