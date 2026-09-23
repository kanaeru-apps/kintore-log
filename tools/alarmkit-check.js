'use strict';
// Native calls are mocked here; SDK compilation and real-device sound checks remain separate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const routing = source.slice(source.indexOf('  var restAlarmState ='), source.indexOf('  function scheduleLegacyTimerNotification'));
const lifecycle = source.slice(source.indexOf('  function startTimer(seconds)'), source.indexOf('  function setTimerView(state)'));
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const calls = { schedules: [], cancels: 0, legacy: [], legacyCancels: 0, sounds: 0 };
  const plugin = {
    status: async () => ({ supported: true, authorized: true }),
    schedule: args => new Promise((resolve, reject) => calls.schedules.push({ args, resolve, reject })),
    cancel: async () => { calls.cancels++; }
  };
  const context = {
    Date, Promise, setTimeout: () => 0,
    isNativeApp: () => true, nativePlugin: () => plugin,
    timerSettings: { notifyOn: true, soundOn: true, ignoreSilent: true, sound: 'beep' },
    timer: { running: false, paused: false, finished: false, endAt: 0, total: 60 },
    scheduleLegacyTimerNotification: at => calls.legacy.push(at),
    cancelLegacyTimerNotification: () => calls.legacyCancels++,
    renderNotifWarning: info => { calls.warning = info; }, noteAppError() {},
    stopBeep() {}, stopVibrate() {}, unlockAudio() {}, askNotify() {}, clearBadge() {},
    clearDeliveredTimerNotification() {}, requestWakeLock() {}, releaseWakeLock() {},
    startTick() {}, stopTick() {}, renderTimer() {}, setTimerView() {}, refreshNotifWarning() {},
    scheduleFinishTimeout() {}, scrollTwToCustom() {}, vibrateAlarm() {}, showTimerNotification() {}, setBadge() {},
    playAlarmSound: () => calls.sounds++
  };
  vm.createContext(context);
  vm.runInContext(routing + lifecycle + '\nfunction cancelTimerNotification() { cancelRestAlarm(); cancelLegacyTimerNotification(); }', context);
  context.restAlarmState.supported = true;
  return { c: context, calls };
}
async function main() {
  {
    const { c, calls } = setup();
    c.startTimer(60);
    assert.equal(calls.schedules.length, 1);
    assert.equal(calls.legacy.length, 0);
    calls.schedules[0].resolve({ ok: true }); await flush();
    c.scheduleTimerNotification(c.timer.endAt); // visibilitychange must not reschedule
    assert.equal(calls.schedules.length, 1);
    c.timer.endAt = Date.now(); c.restAlarmState.endAt = c.timer.endAt;
    c.finishTimer();
    assert.equal(calls.sounds, 0, 'No app audio on top of OS alarm');
    c.resetTimer();
    assert.equal(calls.cancels, 1);
  }
  {
    const { c, calls } = setup();
    c.startTimer(60); c.pauseResumeTimer();
    calls.schedules[0].resolve({ ok: false, reason: 'denied' }); await flush();
    assert.equal(calls.legacy.length, 0, 'Late permission reply must not revive paused timer');
    assert.equal(c.restAlarmState.endAt, 0);
    c.pauseResumeTimer();
    assert.equal(calls.schedules.length, 2);
    c.addTime(30);
    assert.equal(calls.schedules.length, 3);
    calls.schedules[2].resolve({ ok: true }); await flush();
    calls.schedules[1].resolve({ ok: true }); await flush();
    assert.equal(c.restAlarmState.endAt, calls.schedules[2].args.endAt, 'Old reply cannot overwrite extended timer');
  }
  for (const reason of ['denied', 'failure']) {
    const { c, calls } = setup(); c.startTimer(60);
    if (reason === 'failure') calls.schedules[0].reject(new Error('native failure'));
    else calls.schedules[0].resolve({ ok: false, reason });
    await flush();
    assert.equal(calls.legacy.length, 1);
    assert.ok(calls.warning);
  }
  for (const flag of ['soundOn', 'ignoreSilent', 'notifyOn']) {
    const { c, calls } = setup(); c.startTimer(60);
    c.timerSettings[flag] = false;
    c.scheduleTimerNotification(c.timer.endAt);
    calls.schedules[0].resolve({ ok: true }); await flush();
    assert.equal(calls.cancels, 1, 'Disabling setting cancels AlarmKit');
    assert.equal(c.restAlarmState.endAt, 0);
  }
  {
    const { c, calls } = setup(); c.restAlarmState.supported = false;
    c.startTimer(60);
    assert.equal(calls.schedules.length, 0);
    assert.equal(calls.legacy.length, 1);
  }
  {
    const { c, calls } = setup(); c.startTimer(10); c.addTime(-30);
    assert.equal(calls.cancels, 1);
    assert.equal(c.timer.finished, true);
    assert.equal(calls.sounds, 1);
  }
  console.log('AlarmKit routing check passed: start / pause / resume / extend / reset / stale replies / permission and error fallback / settings / old iOS / no duplicate audio');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
