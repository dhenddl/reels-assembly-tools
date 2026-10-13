# tts-words.py — edge-tts(설치된 7.2.8 라이브러리)로 음성과 **어절 경계**를 한 번에 받는다.
#   CLI 의 --write-subtitles 는 문장 경계만 준다(이 대본은 쉼표로 이은 한 문장이라 큐가 1개).
#   라이브러리의 boundary="WordBoundary" 는 어절마다 offset/duration 을 준다 — 같은 합성 호출에서 받으니 음성과 어긋나지 않는다.
#   python tts-words.py <대본.txt> <out.mp3> <out.words.json> [voice] [rate]
import asyncio, json, sys
import edge_tts
from edge_tts import communicate as _comm, constants as _const

# ✏️ 2026-10-13 (릴스 세션 · 사용자 「B 시도해」): 2026-10-10 부터 옛 합성 주소(speech.platform.bing.com)가 403 을 준다
#   (rany2/edge-tts #490 · 이 PC 도 10-13 재현). 고치는 PR #491(jonata · 8a5844c · 미병합)은 합성 주소만
#   Edge 155 가 쓰는 api.msedgeservices.com 으로 바꾼다 — 같은 공개 토큰을 Ocp-Apim-Subscription-Key 로 준다.
#   ▶ 외부 코드를 설치하지 않고 **그 한 줄만** 여기서 갈아 끼운다(diff 17줄 검토: 새 의존성·설치 훅·다른 외부 주소 없음).
#   PR 의 두 번째 수정(Date 헤더 locale)은 이 PC 가 C locale 이라 안 걸린다 — 안 옮겼다.
#   ⚠️ 정식판이 고쳐지면(WSS_URL 이 더는 옛 주소가 아니면) 아래 조건이 거짓이라 아무것도 안 한다.
_NEW_WSS = ("wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1"
            f"?Ocp-Apim-Subscription-Key={_const.TRUSTED_CLIENT_TOKEN}")
if str(getattr(_comm, 'WSS_URL', '')).startswith('wss://speech.platform.bing.com'):
    _comm.WSS_URL = _NEW_WSS

async def once(text, mp3, voice, rate):
    com = edge_tts.Communicate(text, voice, rate=rate, boundary='WordBoundary')
    words = []
    with open(mp3, 'wb') as f:
        async for ch in com.stream():
            if ch['type'] == 'audio':
                f.write(ch['data'])
            elif ch['type'] == 'WordBoundary':
                words.append({'text': ch['text'], 't0': ch['offset'] / 1e7, 't1': (ch['offset'] + ch['duration']) / 1e7})
    return words

async def main(src, mp3, js, voice, rate):
    text = open(src, encoding='utf-8').read().strip()
    # ✏️ 2026-10-13: 새 주소는 연달아 부르면 429(요청 과다)를 준다 — 🔬 탐침 직후 두 번째 요청이 429, 45초 뒤 1회에 성공.
    #   render-full 이 본 말·CTA 말을 이어서 받으니 429 에만 기다렸다 다시 한다(45·90·135초). 다른 오류는 그대로 낸다.
    import aiohttp
    for k in range(4):
        try:
            words = await once(text, mp3, voice, rate); break
        except aiohttp.WSServerHandshakeError as e:
            if e.status != 429 or k == 3: raise
            wait = 45 * (k + 1)
            print(f'429 (요청 과다) — {wait}초 뒤 다시 ({k + 1}/3)', file=sys.stderr, flush=True)
            await asyncio.sleep(wait)
    json.dump({'voice': voice, 'rate': rate, 'text': text, 'words': words}, open(js, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'{len(words)} words · last ends {words[-1]["t1"]:.3f}s' if words else 'no words')

src, mp3, js = sys.argv[1:4]
voice = sys.argv[4] if len(sys.argv) > 4 else 'ko-KR-HyunsuMultilingualNeural'
rate = sys.argv[5] if len(sys.argv) > 5 else '+50%'
asyncio.run(main(src, mp3, js, voice, rate))
