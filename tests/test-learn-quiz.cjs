const assert = require('node:assert/strict');
const { boot, DAILY, PROGRESS } = require('./harness.cjs');
const data = Array.from({ length: 200 }, (_, i) => ({
  word: 'word' + i, definition: '定義' + i, phonetic: '/w/', part_of_speech: 'noun',
  example_sentence: `This is a sample sentence using word${i} here.`, example_translation: '這是例句。'
}));
const entry = i => ({ word: 'word' + i, phonetic: '/w/', part_of_speech: 'noun', definition: '定義' + i, example_sentence: `This is a sample sentence using word${i} here.`, example_translation: '這是例句。', status: 'learned', firstStudiedAt: '2026-11-01T00:00:00Z' });
const studied = (from, to) => Object.fromEntries(Array.from({ length: to - from }, (_, k) => ['word' + (from + k), entry(from + k)]));

(async () => {
  // Learning: a single "已學習" action, and the two-way filter.
  const app = await boot({ data, date: '2026-11-04T10:00:00+08:00' });
  assert.equal(app.get('again'), undefined, 'the old "not familiar" button is gone');
  app.get('reveal').click(); app.get('remember').click();
  const day = app.journal().days['2026-11-04'];
  assert.equal(Object.keys(day.studied).length, 1);
  assert.equal(Object.values(day.studied)[0].status, 'learned');
  assert.equal(app.eval('sequence.length'), 29, 'filter "未學習" hides the learned word');
  app.get('filter').value = 'done'; app.get('filter').onchange();
  assert.equal(app.eval('sequence.length'), 1, 'filter "已學習" shows only learned words');
  assert.equal(app.get('known').textContent, '1');
  assert.equal(app.get('due').textContent, '199', 'unlearned = total - learned');

  // Quiz: 20 learned today + 5 learned-but-untested + 5 tested-but-wrong (+10 fill).
  const today = studied(0, 25);                       // 25 learned today
  const earlier = studied(25, 45);                    // 20 learned earlier, never quizzed
  const quizResults = Object.fromEntries(Array.from({ length: 12 }, (_, k) => ['word' + (100 + k), { wrongCount: 1, correctCount: 0, lastCorrect: false, lastAttemptAt: '2026-10-30T00:00:00Z' }]));
  const progress = Object.fromEntries(Array.from({ length: 57 }, (_, k) => [k < 45 ? 'word' + k : 'word' + (100 + k - 45), { level: 1, due: '2026-11-01', updated: '2026-11-01T00:00:00Z' }]));
  const ids = n => Array.from({ length: n }, (_, k) => 'word' + k);
  const store = new Map([
    [DAILY, JSON.stringify({ version: 1, days: { '2026-11-04': { ids: ids(30), studied: today }, '2026-11-02': { ids: ids(30).map((_, k) => 'word' + (25 + k)), studied: earlier } } })],
    ['ielts-vocab-quiz-v1', JSON.stringify(quizResults)], [PROGRESS, JSON.stringify(progress)]
  ]);
  const quiz = await boot({ data, storage: store, date: '2026-11-04T10:00:00+08:00' });
  quiz.get('startexam').click();
  const alloc = quiz.eval('currentExam().allocation');
  assert.deepEqual({ today: alloc.today, previous: alloc.previous, wrong: alloc.wrong }, { today: 20, previous: 5, wrong: 5 });
  assert.equal(quiz.eval('currentExam().questions.length'), 40);
  const sources = quiz.eval("currentExam().questions.filter(q=>q.type==='choice').map(q=>q.source+':'+q.word.word)");
  const untested = sources.filter(s => s.startsWith('previous')).map(s => Number(s.split('word')[1]));
  assert.ok(untested.every(n => n >= 25 && n < 45), 'untested picks are learned words that were never quizzed');
  const wrong = sources.filter(s => s.startsWith('wrong')).map(s => Number(s.split('word')[1]));
  assert.ok(wrong.every(n => n >= 100 && n < 112), 'wrong picks come from words answered incorrectly');
  assert.equal(new Set(sources.map(s => s.split(':')[1])).size, 30, 'no word is asked twice');
  console.log('PASS: single learned action, two-way filter, quiz 20 + 5 + 5 (+10 fill)');
})().catch(e => { console.error(e); process.exit(1); });
