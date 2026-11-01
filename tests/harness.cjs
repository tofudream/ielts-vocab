const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname,'../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const actualWords = JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'fixtures/legacy-words.json'), 'utf8'));
const DAILY = 'ielts-vocab-daily-v1', PROGRESS = 'ielts-vocab-progress-v1';
class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.dataset = {}; this.value = ''; this.textContent = ''; this.disabled = false; this.style = {}; this.open = false;
    const classes = new Set();
    this.classList = { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle: (c, state) => { const value = state === undefined ? !classes.has(c) : state; value ? classes.add(c) : classes.delete(c); return value; } };
  }
  append(...els) { this.children.push(...els); }
  get textContent() { return (this._text || '') + this.children.map(el=>typeof el==='string'?el:el.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children=[]; }
  replaceChildren(...els) { this._text=''; this.children = [...els]; }
  click() { if (!this.disabled) this.onclick?.(); }
}
async function boot({storage = new Map(), data = actualWords, date = '2026-11-02T10:00:00+08:00', blocked = false, ok = true} = {}) {
  let now = new Date(date).getTime();
  const NativeDate = Date;
  class Clock extends NativeDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => ['#' + match[1], new Element()]));
  elements.get('#filter').value = 'all';
  const nav = [...html.matchAll(/data-tab="([^"]+)"/g)].map(match => { const el = new Element('button'); el.dataset.tab = match[1]; return el; });
  const sections = ['learn','history','library','quiz','review'].map(id => { const el = elements.get('#' + id); el.id = id; return el; });
  const events = {};
  const context = vm.createContext({
    Date: Clock, console: {error() {}}, Blob, URL, SpeechSynthesisUtterance: class {},
    localStorage: { getItem: key => { if (blocked) throw Error('blocked'); return storage.get(key) || null; }, setItem: (key, value) => { if (blocked) throw Error('blocked'); storage.set(key, value); } },
    document: { querySelector: key => { if (!elements.has(key)) throw Error('Missing selector ' + key); return elements.get(key); }, querySelectorAll: key => key === '[data-tab]' ? nav : sections, createElement: tag => new Element(tag), addEventListener: (name, handler) => { events[name] = handler; }, hidden: false },
    window: { addEventListener: (name, handler) => { events[name] = handler; } },
    fetch: async () => ({ok, status: ok ? 200 : 404, json: async () => data}),
    setInterval: () => {}, setTimeout: () => {},
  });
  vm.runInContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  return {storage, elements, nav, events, get: key => elements.get('#'+key), eval: code => vm.runInContext(code, context), advance: date => { now = new NativeDate(date).getTime(); }, journal: () => JSON.parse(storage.get(DAILY))};
}
function study(app, remember = true) { app.get('reveal').click(); app.get(remember ? 'remember' : 'again').click(); }
module.exports = { boot, study, actualWords, DAILY, PROGRESS };
