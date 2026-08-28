// 고정 질문 세트로 검색 품질만 먼저 검증한다 (생성 전 단계).
import { readFileSync } from 'node:fs'
import { EMBED_MODEL, queryPrompt } from '../src/lib/embedPrompt.mjs'

const store = JSON.parse(readFileSync(new URL('../public/soulmat-docs.json', import.meta.url)))
const OLLAMA = 'http://localhost:11434'

const cos = (a, b) => {
  let d = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return d / (Math.sqrt(na) * Math.sqrt(nb))
}

const QUESTIONS = [
  ['배송비가 얼마인가요?', 'SM-071'],
  ['얼마 이상 사면 무료배송인가요?', 'SM-071'],
  ['트래블매트 색상 뭐뭐 있어요?', 'SM-011'],
  ['요가매트 세탁해도 되나요?', 'SM-016'],
  ['반품하려면 며칠 안에 해야 하나요?', 'SM-080'],
  ['교환할 때 택배비는 누가 내나요?', 'SM-083'],
  ['환불은 언제 되나요?', 'SM-085'],
  ['리포머 매트 가격이 어떻게 되나요?', 'SM-030'],
  ['미니매트는 어디에 쓰는 건가요?', 'SM-022'],
  ['요가양말 사이즈 종류 알려주세요', 'SM-051'],
  ['매트가 미끄러지지 않나요?', 'SM-014'],
  ['스마트스토어에서도 파나요?', 'SM-100'],
  ['강사인데 대량으로 살 수 있나요?', 'SM-103'],
  // 자료 밖 질문 — 낮은 유사도가 나와야 정상
  ['허리디스크에 이 매트가 도움이 되나요?', null],
  ['루루레몬 매트랑 비교하면 어때요?', null],
  ['요가 초보인데 어떤 자세부터 해야 하나요?', null],
]

const embed = async (t) => {
  const r = await fetch(`${OLLAMA}/api/embed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: queryPrompt(t) }),
  })
  return (await r.json()).embeddings[0]
}

let hit1 = 0, hit3 = 0, inDomain = 0
console.log(`모델 ${store.model} · ${store.dim}차원 · 청크 ${store.chunks.length}\n`)
for (const [q, want] of QUESTIONS) {
  const qv = await embed(q)
  const ranked = store.chunks
    .map((c) => ({ id: c.id, s: cos(qv, c.vector), t: c.text }))
    .sort((a, b) => b.s - a.s)
  const top = ranked.slice(0, 3)
  const max = top[0].s
  const weak = max < 0.55
  if (want) {
    inDomain++
    if (top[0].id === want) hit1++
    if (top.some((x) => x.id === want)) hit3++
    const mark = top[0].id === want ? 'OK ' : top.some((x) => x.id === want) ? '~3 ' : 'X  '
    console.log(`${mark} ${max.toFixed(3)}${weak ? ' [약함]' : '      '} ${q}`)
    console.log(`     기대 ${want} / 1위 ${top[0].id} · ${top.map((x) => `${x.id}:${x.s.toFixed(2)}`).join(' ')}`)
  } else {
    console.log(`${weak ? 'OK ' : 'X  '} ${max.toFixed(3)}${weak ? ' [약함]' : '      '} (자료밖) ${q}`)
    console.log(`     1위 ${top[0].id} — ${top[0].t.slice(0, 45)}...`)
  }
}
console.log(`\n도메인 내 ${inDomain}문항: top-1 ${hit1}/${inDomain}, top-3 ${hit3}/${inDomain}`)
