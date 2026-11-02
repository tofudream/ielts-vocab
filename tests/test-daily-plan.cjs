const assert = require('node:assert/strict');
const { boot, study, DAILY } = require('./harness.cjs');
const data = Array.from({ length: 200 }, (_, i) => ({ word: 'word' + i, definition: 'def ' + i }));

(async () => {
  // Day 1: no review pool, so the whole 30-word list is new words.
  const app = await boot({ data, date: '2026-11-02T10:00:00+08:00' });
  const day1 = app.journal().days['2026-11-02'];
  assert.equal(day1.ids.length, 30, 'first day fills the review quotas with new words');
  assert.equal(day1.groups.new.length, 30);
  assert.equal(day1.groups.priority.length + day1.groups.random.length, 0);
  assert.equal(new Set(day1.ids).size, 30);

  // Same day: list is fixed after reload, before and after studying.
  const reload1 = await boot({ data, storage: app.storage, date: '2026-11-02T18:00:00+08:00' });
  assert.deepEqual(reload1.journal().days['2026-11-02'].ids, day1.ids);
  study(reload1);
  const reload2 = await boot({ data, storage: app.storage, date: '2026-11-02T22:00:00+08:00' });
  assert.deepEqual(reload2.journal().days['2026-11-02'].ids, day1.ids);

  // Unstarted plan with an older ruleVersion must NOT be regenerated.
  const store = new Map([[DAILY, JSON.stringify({ version: 1, days: { '2026-11-02': { ruleVersion: 1, ids: day1.ids, studied: {} } } })]]);
  const legacy = await boot({ data, storage: store, date: '2026-11-02T10:00:00+08:00' });
  assert.deepEqual(legacy.journal().days['2026-11-02'].ids, day1.ids);

  // Skipped day: nothing studied yet, so the next list is still a first-time (30 new) list.
  const skipStore = new Map();
  await boot({ data, storage: skipStore, date: '2026-11-02T10:00:00+08:00' });
  const skipped = await boot({ data, storage: skipStore, date: '2026-11-05T10:00:00+08:00' });
  assert.equal(skipped.journal().days['2026-11-05'].ids.length, 30);
  assert.ok(skipped.journal().days['2026-11-05'].firstDay);

  // Day 2: normal rules (20 new + up to 5 priority + 5 random) using words studied on day 1.
  const next = await boot({ data, storage: reload2.storage, date: '2026-11-03T09:00:00+08:00' });
  const day2 = next.journal().days['2026-11-03'];
  assert.equal(day2.groups.new.length, 20);
  assert.ok(day2.groups.priority.length + day2.groups.random.length <= 10);
  assert.ok(!day2.firstDay);
  console.log('PASS: first-time fill, same-day fixed list, legacy unstarted plan kept, day-2 normal rules.');
})().catch(e => { console.error(e); process.exit(1); });
