/* Keep ordinary text fields above both native iOS and browser keyboards.
   Numeric editors, exercise details and programs retain their dedicated editors. */
'use strict';
(function () {
  var height = 0, frame = 0, timer = 0, active = null;
  var sheet = document.getElementById('sheet');
  var bar = document.createElement('div');
  bar.id = 'textInputBar'; bar.hidden = true;
  var done = document.createElement('button');
  done.type = 'button'; done.className = 'drum-done'; done.textContent = '完了';
  bar.appendChild(done); document.body.appendChild(bar);
  function eligible(input) {
    return input && input.matches('textarea, input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], input[type="tel"]') &&
      !input.readOnly && !input.disabled && !input.matches('[inputmode="numeric"], [inputmode="decimal"]') &&
      !input.closest('#exModal, #setMenuDialog');
  }
  function clear() {
    bar.hidden = true;
    sheet.classList.remove('text-input-active');
    document.body.classList.remove('text-input-active');
    document.documentElement.style.removeProperty('--text-input-space');
  }
  function update() {
    frame = 0;
    var input = document.activeElement;
    if (!eligible(input)) { active = null; clear(); return; }
    active = input;
    var v = window.visualViewport;
    var top = v ? v.offsetTop : 0;
    var bottom = Math.min(v ? top + v.height : window.innerHeight, window.innerHeight - height);
    var toolbarTop = Math.max(top, bottom - 56);
    bar.hidden = false; bar.style.top = toolbarTop + 'px';
    var inSheet = sheet.contains(input);
    sheet.classList.toggle('text-input-active', inSheet);
    document.body.classList.toggle('text-input-active', !inSheet);
    document.documentElement.style.setProperty('--text-input-space', (Math.max(0, window.innerHeight - toolbarTop) + 24) + 'px');
    if (inSheet) {
      sheet.style.setProperty('--text-sheet-top', top + 'px');
      sheet.style.setProperty('--text-sheet-height', Math.max(0, toolbarTop - top) + 'px');
    }
    var rect = input.getBoundingClientRect();
    var upper = top + 16, lower = toolbarTop - 16;
    if (rect.top < upper || rect.bottom > lower) {
      var delta = rect.top - (upper + Math.max(0, (lower - upper - rect.height) / 2));
      if (inSheet) sheet.scrollTop += delta;
      else window.scrollBy(0, delta);
    }
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  document.addEventListener('focusin', function () {
    schedule(); clearTimeout(timer); timer = setTimeout(schedule, 350);
  });
  document.addEventListener('focusout', schedule);
  document.addEventListener('input', schedule);
  document.addEventListener('keydown', function (e) {
    if (eligible(e.target) && e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !e.isComposing) {
      e.preventDefault(); e.target.blur();
    }
  });
  done.addEventListener('pointerdown', function (e) { e.preventDefault(); });
  done.addEventListener('click', function () { if (active) active.blur(); clear(); });
  window.addEventListener('resize', schedule);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', schedule);
    window.visualViewport.addEventListener('scroll', schedule);
  }
  var keyboard = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard;
  if (keyboard) {
    ['keyboardWillShow', 'keyboardDidShow'].forEach(function (name) {
      keyboard.addListener(name, function (info) { height = Math.max(0, Number(info.keyboardHeight) || 0); schedule(); });
    });
    ['keyboardWillHide', 'keyboardDidHide'].forEach(function (name) {
      keyboard.addListener(name, function () { height = 0; schedule(); });
    });
  }
})();
