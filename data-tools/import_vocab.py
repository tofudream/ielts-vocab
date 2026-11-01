"""Build a word-keyed vocabulary without discarding senses or legacy progress IDs.

Usage: python import_vocab.py ELEMENTARY_JSON INTERMEDIATE_JSON LEGACY_WORDS_JSON
Writes words.json and data-import-report.json beside this script's parent directory.
Requires opencc-python-reimplemented. Corrections use zero-based source row numbers.
All replacement examples in examples-*.tsv are newly authored, not book quotations.
"""
import json
import re
import sys
import hashlib
from collections import defaultdict
from pathlib import Path
from opencc import OpenCC

ROOT = Path(__file__).resolve().parent
CC = OpenCC('s2twp')
FIELDS = ('word', 'phonetic', 'part_of_speech', 'definition', 'example_sentence', 'example_translation')

def read_tsv(name):
    for line in (ROOT / name).read_text().splitlines():
        if line and not line.startswith('#'):
            yield line.split('|')

def clean(value):
    return re.sub(r'\s+', ' ', str(value or '')).strip()

def build(paths):
    originals = [json.loads(Path(p).read_text()) for p in paths]
    rows, changes = [], []
    for label, data in zip(('elementary', 'intermediate', 'legacy'), originals):
        for i, item in enumerate(data):
            row = {key: clean(item.get(key)) for key in FIELDS}
            row['sources'] = [{'file': label, 'row': i}]
            row['example_origin'] = 'supplied'
            rows.append(row)
    slices = [rows[:len(originals[0])], rows[len(originals[0]):len(originals[0])+len(originals[1])]]
    for label, data in zip(('a', 'b'), slices):
        for index, word, pos, definition in read_tsv(f'repairs-{label}.tsv'):
            row = data[int(index)]
            for key, value in [('word',word),('part_of_speech',pos),('definition',definition)]:
                if value and row[key] != value:
                    changes.append({'source':row['sources'][0], 'field':key, 'before':row[key], 'after':value})
                    row[key] = value
                    if key == 'word':
                        # A neighbouring headword's IPA must never follow a corrected word.
                        row['phonetic'] = ''
        for indices, sentence, translation in read_tsv(f'examples-{label}.tsv'):
            for index in indices.split(','):
                row = data[int(index)]
                changes.append({'source':row['sources'][0], 'field':'example_pair', 'before':[row['example_sentence'],row['example_translation']], 'after':[sentence,translation]})
                row.update(example_sentence=sentence,example_translation=translation,example_origin='editorial')
    # Fill pronunciation from another occurrence of the same word and POS first.
    ipa = defaultdict(list)
    for row in rows:
        if row['phonetic']:
            ipa[row['word'].lower()].append((row['part_of_speech'],row['phonetic']))
    manual_ipa = dict(read_tsv('pronunciations.tsv'))
    for row in rows:
        if not row['phonetic']:
            choices = ipa.get(row['word'].lower(), [])
            row['phonetic'] = next((v for p,v in choices if p == row['part_of_speech']), choices[0][1] if choices else manual_ipa.get(row['word'].lower(), ''))
        row['phonetic'] = manual_ipa.get(row['word'].lower()+'#'+row['part_of_speech'],row['phonetic'])
        for key in ('definition','example_translation'):
            if row['sources'][0]['file'] != 'legacy':
                row[key] = CC.convert(row[key])
        row['example_sentence'] = clean(row['example_sentence'])
    restored = []
    for word,phonetic,pos,definition,sentence,translation in read_tsv('restored.tsv'):
        if any(r['word'].casefold()==word.casefold() for r in rows):
            continue
        restored.append({'word':word,'phonetic':phonetic,'part_of_speech':pos,'definition':definition,'example_sentence':sentence,'example_translation':translation,'sources':[{'file':'editorial-restoration','row':len(restored)}],'example_origin':'editorial'})
    merged = {}
    # Legacy entries remain primary, keeping today's saved questions and familiar cards compatible.
    for row in rows[-len(originals[2]):] + rows[:-len(originals[2])] + restored:
        key = row['word'].casefold()
        if key not in merged:
            merged[key] = {'word':row['word'], 'senses':[]}
        entry = merged[key]
        sense = {k:v for k,v in row.items() if k != 'word'}
        signature = (sense['part_of_speech'],re.sub(r'[\s，、；;。()（）]', '', sense['definition']))
        previous = next((s for s in entry['senses'] if (s['part_of_speech'],re.sub(r'[\s，、；;。()（）]', '', s['definition'])) == signature),None)
        if previous:
            previous['sources'].extend(sense['sources'])
            # Keep all supplied valid example pairs, even when their sense is identical.
            if (previous['example_sentence'],previous['example_translation']) != (sense['example_sentence'],sense['example_translation']):
                previous.setdefault('additional_examples', []).append({k:sense[k] for k in ('example_sentence','example_translation','example_origin')})
        else:
            entry['senses'].append(sense)
    words = []
    forms = json.loads((ROOT/'forms.json').read_text())
    for key, entry in merged.items():
        first = entry['senses'][0]
        for field in FIELDS[1:]:
            entry[field] = first[field]
        if key in forms:
            entry['forms'] = forms[key]
        words.append(entry)
    # Retain legacy ordering, then sort imported words for stable diffs.
    old_ids = [r['word'].casefold() for r in originals[2]]
    words.sort(key=lambda r: (0,old_ids.index(r['word'].casefold())) if r['word'].casefold() in old_ids else (1,r['word'].casefold()))
    missing = []
    for entry in words:
        for number,sense in enumerate(entry['senses']):
            for key in FIELDS[1:]:
                if not sense[key]:
                    missing.append([entry['word'],number,key,sense['sources']])
    report = {
        'schema_version':2, 'input_rows':sum(map(len,originals[:2])), 'legacy_rows':len(originals[2]),
        'source_files':[{'name':Path(p).name,'rows':len(a),'sha256':hashlib.sha256(Path(p).read_bytes()).hexdigest()} for p,a in zip(paths,originals)],
        'unique_words':len(words), 'preserved_senses':sum(len(w['senses']) for w in words),
        'merged_sense_rows':sum(map(len,originals))+len(restored)-sum(len(w['senses']) for w in words),
        'restored_headwords':len(restored),
        'repaired_fields':len(changes), 'editorial_example_rows':sum(r['example_origin']=='editorial' for r in rows),
        'editorial_restoration_examples':len(restored),
        'missing_fields':missing,
        'notes':['同字依大小寫與空白正規化合併，保留不同詞義與詞性。','補寫例句為新編例句，非原書逐字還原。','未對原書逐頁核對；現有例句不代表已完成逐句語言審校。','舊版20個單字保持原有識別字與主要詞義，學習紀錄不需遷移。'],
        'reference_urls':['https://www.collinsdictionary.com/dictionary/english/alike','https://dictionary.cambridge.org/dictionary/english/graduate','https://dictionary.cambridge.org/dictionary/english/lead'],
        'changes':changes
    }
    return words, report

if __name__ == '__main__':
    words, report = build(sys.argv[1:4])
    (ROOT.parent/'words.json').write_text(json.dumps(words,ensure_ascii=False,indent=2)+'\n')
    (ROOT.parent/'data-import-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('changes','source_files')},ensure_ascii=False,indent=2))
