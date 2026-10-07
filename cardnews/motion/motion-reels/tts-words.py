# tts-words.py — edge-tts(설치된 7.2.8 라이브러리)로 음성과 **어절 경계**를 한 번에 받는다.
#   CLI 의 --write-subtitles 는 문장 경계만 준다(이 대본은 쉼표로 이은 한 문장이라 큐가 1개).
#   라이브러리의 boundary="WordBoundary" 는 어절마다 offset/duration 을 준다 — 같은 합성 호출에서 받으니 음성과 어긋나지 않는다.
#   python tts-words.py <대본.txt> <out.mp3> <out.words.json> [voice] [rate]
import asyncio, json, sys
import edge_tts

async def main(src, mp3, js, voice, rate):
    text = open(src, encoding='utf-8').read().strip()
    com = edge_tts.Communicate(text, voice, rate=rate, boundary='WordBoundary')
    words = []
    with open(mp3, 'wb') as f:
        async for ch in com.stream():
            if ch['type'] == 'audio':
                f.write(ch['data'])
            elif ch['type'] == 'WordBoundary':
                words.append({'text': ch['text'], 't0': ch['offset'] / 1e7, 't1': (ch['offset'] + ch['duration']) / 1e7})
    json.dump({'voice': voice, 'rate': rate, 'text': text, 'words': words}, open(js, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'{len(words)} words · last ends {words[-1]["t1"]:.3f}s' if words else 'no words')

src, mp3, js = sys.argv[1:4]
voice = sys.argv[4] if len(sys.argv) > 4 else 'ko-KR-HyunsuMultilingualNeural'
rate = sys.argv[5] if len(sys.argv) > 5 else '+50%'
asyncio.run(main(src, mp3, js, voice, rate))
