const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {boot,actualWords:legacy,DAILY,PROGRESS} = require('./harness.cjs');
const words=JSON.parse(fs.readFileSync(path.join(__dirname,'../words.json'),'utf8'));
const report=JSON.parse(fs.readFileSync(path.join(__dirname,'../data-import-report.json'),'utf8'));
const fields=['word','phonetic','part_of_speech','definition','example_sentence','example_translation'];
(async()=>{
  assert.equal(report.input_rows,2657);
  assert.equal(report.unique_words,words.length);
  assert.deepEqual(report.missing_fields,[]);
  assert.equal(new Set(words.map(w=>w.word.toLowerCase())).size,words.length);
  assert.equal(words.reduce((n,w)=>n+w.senses.reduce((sum,s)=>sum+s.sources.length,0),0),2657+20+report.restored_headwords,'every input row is represented, including merged senses');
  for(const w of words){
    for(const f of fields)assert.equal(typeof w[f],'string',`${w.word}.${f}`);
    for(const s of w.senses){
      for(const f of fields.slice(1))assert.ok(s[f]?.trim(),`${w.word}.${f} is empty`);
      assert.ok(/[\u3400-\u9fff]/u.test(s.definition));
      assert.ok(!/[<>{}|#\u3400-\u9fff]/u.test(s.example_sentence),`${w.word} has English OCR debris`);
    }
  }
  for(const old of legacy){
    const entry=words.find(w=>w.word===old.word);
    for(const f of fields)assert.equal(entry[f],old[f],`legacy ${old.word}.${f} stays compatible`);
  }
  const act=words.find(w=>w.word==='act');
  assert.ok(act.senses.some(s=>s.part_of_speech==='noun'));
  assert.ok(act.senses.some(s=>s.part_of_speech==='verb'));
  const prior={version:1,days:{'2026-11-02':{ids:legacy.map(w=>w.word),studied:{accomplish:{...legacy[0],status:'remembered',firstStudiedAt:'2026-11-02T00:00:00Z'}}}}};
  const progress={accomplish:{level:3,due:'2026-11-01',updated:'2026-11-01T00:00:00Z'}};
  const store=new Map([[DAILY,JSON.stringify(prior)],[PROGRESS,JSON.stringify(progress)]]);
  const app=await boot({data:words,storage:store});
  assert.equal(app.eval('words.length'),words.length);
  assert.equal(app.get('known').textContent,'1');
  assert.deepEqual(app.journal().days['2026-11-02'].ids,prior.days['2026-11-02'].ids);
  assert.equal(app.journal().days['2026-11-02'].studied.accomplish.status,'remembered');
  assert.equal(app.get('wordlist').children.length,100,'large dictionary renders in bounded batches');
  app.get('loadmore').click();assert.equal(app.get('wordlist').children.length,200);
  app.get('search').value='履職';app.get('search').oninput();
  assert.ok(app.get('wordlist').children.some(el=>el.textContent.includes('act')),'search includes secondary senses');
  app.get('search').value='act';app.get('search').oninput();
  const item=app.get('wordlist').children.find(el=>el.textContent.startsWith('act'));
  item.open=true;item.ontoggle();assert.ok(item.textContent.includes('noun'));
  assert.ok(item.textContent.includes('verb'));
  app.eval("sequence=[words.find(w=>w.word==='act')];index=0;renderCard()");
  assert.ok(app.get('othersenses').textContent.includes('其他詞義'));
  assert.equal(app.eval('words.filter(w=>!gapFor(w)).length'),0,'every primary example can be used for a hint or gap');
  const otherMissing=app.eval('words.flatMap(w=>w.senses.filter(s=>!gapFor({...w,...s}))).length');
  assert.equal(otherMissing,0,'all preserved senses have a matching headword or explicit inflection');
  // Make three real-data cohorts and verify the imported vocabulary produces 40 questions.
  const ids=words.slice(0,60).map(w=>w.word.toLowerCase());
  const studied=(start,end)=>Object.fromEntries(words.slice(start,end).map(w=>[w.word.toLowerCase(),{...w,status:'remembered',firstStudiedAt:'2026-11-01T00:00:00Z'}]));
  const examStore=new Map([
    [DAILY,JSON.stringify({version:1,days:{'2026-11-02':{ids:ids.slice(0,20),studied:studied(0,20)},'2026-11-01':{ids:ids.slice(20,40),studied:studied(20,40)}}})],
    ['ielts-vocab-quiz-v1',JSON.stringify(Object.fromEntries(ids.slice(40,60).map(id=>[id,{wrongCount:1,lastCorrect:false}])))]
  ]);
  const quiz=await boot({data:words,storage:examStore});quiz.get('startexam').click();
  assert.equal(quiz.eval('currentExam().questions.length'),40);
  assert.equal(quiz.eval('examSummary(currentExam()).max'),100);
  assert.equal(quiz.eval("currentExam().questions.filter(q=>q.type==='choice').every(q=>q.options.length===4 && new Set(q.options.map(o=>o.label)).size===4)"),true);
  console.log(`PASS: ${words.length} words, ${report.preserved_senses} senses; complete row coverage, no missing fields, legacy progress, secondary-sense search/display, pagination, all example gaps, real-data 40-question exam.`);
})();
