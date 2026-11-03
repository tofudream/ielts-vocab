#!/usr/bin/env python3
"""Generate pronunciation mp3 files with Microsoft Edge neural voices (edge-tts).

  python data-tools/generate_audio.py sample   # a few words in two voices -> audio-samples/
  python data-tools/generate_audio.py all      # every headword -> audio/<slug>.mp3
  python data-tools/generate_audio.py examples # every example sentence -> audio/ex/<hash>.mp3
"""
import asyncio, json, re, sys
from pathlib import Path
import edge_tts

ROOT = Path(__file__).resolve().parent.parent
VOICES = {'sonia': 'en-GB-SoniaNeural', 'ryan': 'en-GB-RyanNeural'}
DEFAULT_VOICE = 'sonia'
RATE = '-10%'
SAMPLE_WORDS = ['additionally', 'accomplish', 'analyze', 'approach', 'environment',
                'phd', 'age group', 'ageing', 'significantly', 'responsibility']

def slug(word):
    return re.sub(r'[^a-z0-9]+', '-', word.lower()).strip('-')

def text_hash(text):
    """cyrb53 over UTF-16 code units; index.html implements the identical function."""
    M = 0xFFFFFFFF
    imul = lambda a, b: (a * b) & M
    data = text.encode('utf-16-le')
    h1, h2 = 0xDEADBEEF, 0x41C6CE57
    for i in range(0, len(data), 2):
        ch = data[i] | (data[i + 1] << 8)
        h1 = imul(h1 ^ ch, 2654435761)
        h2 = imul(h2 ^ ch, 1597334677)
    h1 = imul(h1 ^ (h1 >> 16), 2246822507)
    h1 ^= imul(h2 ^ (h2 >> 13), 3266489909)
    h2 = imul(h2 ^ (h2 >> 16), 2246822507)
    h2 ^= imul(h1 ^ (h1 >> 13), 3266489909)
    return format(4294967296 * (2097151 & h2) + (h1 & M), 'x')

async def synth(text, voice, path, sem):
    async with sem:
        for attempt in range(3):
            try:
                await edge_tts.Communicate(text, voice, rate=RATE).save(str(path))
                return
            except Exception as error:  # network hiccup: retry
                if attempt == 2:
                    print('FAILED', text, error)
                await asyncio.sleep(1 + attempt)

async def main(mode):
    sem = asyncio.Semaphore(8)
    if mode == 'sample':
        out = ROOT / 'audio-samples'; out.mkdir(exist_ok=True)
        jobs = [synth(w, VOICES[v], out / f'{v}-{slug(w)}.mp3', sem) for v in VOICES for w in SAMPLE_WORDS]
        await asyncio.gather(*jobs)
        rows = ''.join(
            f'<tr><td>{w}</td>' + ''.join(f'<td><audio controls preload="none" src="{v}-{slug(w)}.mp3"></audio></td>' for v in VOICES) + '</tr>'
            for w in SAMPLE_WORDS)
        head = ''.join(f'<th>{VOICES[v]}</th>' for v in VOICES)
        (out / 'index.html').write_text(
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>發音試聽</title><style>body{font-family:sans-serif;padding:16px}td,th{padding:8px;text-align:left}audio{width:220px}</style>'
            f'<h2>發音試聽</h2><table><tr><th>單字</th>{head}</tr>{rows}</table>', encoding='utf-8')
    elif mode == 'examples':
        out = ROOT / 'audio' / 'ex'; out.mkdir(parents=True, exist_ok=True)
        words = json.loads((ROOT / 'words.json').read_text(encoding='utf-8'))
        todo = {}
        for item in words:
            for sense in item.get('senses') or [item]:
                for ex in [sense] + list(sense.get('additional_examples') or []):
                    text = (ex.get('example_sentence') or '').strip()
                    if text:
                        todo.setdefault(text_hash(text), text)
        jobs = [synth(text, VOICES[DEFAULT_VOICE], out / f'{key}.mp3', sem)
                for key, text in todo.items() if not (out / f'{key}.mp3').exists()]
        print(len(todo), 'sentences,', len(jobs), 'files to generate')
        await asyncio.gather(*jobs)
    else:
        out = ROOT / 'audio'; out.mkdir(exist_ok=True)
        words = json.loads((ROOT / 'words.json').read_text(encoding='utf-8'))
        todo = {}
        for item in words:
            todo.setdefault(slug(item['word']), item['word'])
        jobs = [synth(text, VOICES[DEFAULT_VOICE], out / f'{key}.mp3', sem)
                for key, text in todo.items() if not (out / f'{key}.mp3').exists()]
        print(len(jobs), 'files to generate')
        await asyncio.gather(*jobs)

if __name__ == '__main__':
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else 'sample'))
