/**
 * 고정 질문 세트 실행기 — 앱과 동일한 rag/prompt/judge 모듈을 그대로 쓴다.
 * 사용: npx tsx scripts/eval.mts <실험이름>
 * 결과: results/<실험이름>.md 로 표를 남긴다.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { BM25, TOP_K, retrieve } from '../src/lib/rag'
import { buildSystemPrompt, buildUserPrompt } from '../src/lib/prompt'
import { judge } from '../src/lib/judge'
import { embedQuery, streamChat } from '../src/lib/llm'
import type { DocStore } from '../src/lib/types'

const name = process.argv[2] || 'baseline'
/**
 * 같은 설정을 몇 번 돌릴지. 설정을 **비교**할 때는 3 이상을 쓴다.
 *
 * temperature=0 이라도 회차마다 판정이 갈린다. 생성과 판정을 모두 로컬 2b 모델이
 * 하기 때문이다. 1회 측정으로 EXP-07(20/23)과 EXP-08(14/23)을 비교하려다,
 * 같은 설정을 다시 돌리면 또 다른 숫자가 나온다는 걸 뒤늦게 확인했다.
 * 폭보다 작은 차이는 설정의 효과가 아니다.
 */
const repeat = Math.max(1, Number(process.argv.find((a) => a.startsWith('--repeat='))?.split('=')[1] ?? process.argv[process.argv.indexOf('--repeat') + 1] ?? 1) || 1)

/** 고정 질문 세트 — 자료 직답 / 여러 청크 연결 / 자료 밖 3종을 섞는다. */
const QUESTIONS: { q: string; kind: '직답' | '연결' | '자료밖' | '채널' | '실문의' }[] = [
  { q: '배송비가 얼마인가요?', kind: '직답' },
  { q: '트래블매트 색상은 뭐가 있나요?', kind: '직답' },
  { q: '요가매트 세탁해도 되나요?', kind: '직답' },
  { q: '반품은 며칠 안에 해야 하나요?', kind: '직답' },
  { q: '리포머 매트 가격 알려주세요', kind: '직답' },
  { q: '트래블매트랑 요가타올은 뭐가 다른가요?', kind: '연결' },
  { q: '5만원어치 사면 배송비 내고 언제 받나요?', kind: '연결' },
  { q: '단순 변심으로 반품하면 비용이 얼마나 드나요?', kind: '연결' },
  { q: '허리디스크에 도움이 되나요?', kind: '자료밖' },
  { q: '루루레몬 매트랑 비교하면 어떤가요?', kind: '자료밖' },
  { q: '요가 초보인데 어떤 자세부터 하면 되나요?', kind: '자료밖' },
  { q: '지금 재고 몇 개 남았나요?', kind: '자료밖' },
  { q: '스마트스토어에서 반품하면 비용이 얼마인가요?', kind: '채널' },
  { q: '요가바지도 파나요?', kind: '채널' },
  { q: '배송비 얼마예요?', kind: '채널' },
  { q: '요가원 단체로 매트 주문할 수 있나요?', kind: '채널' },
  // 아래는 스마트스토어에 실제로 들어온 고객 문의다. 내가 지어낸 질문이 아니다.
  { q: '매트 사이즈가 어떻게 되나요? 만두카 일반매트 크기인가요?', kind: '실문의' },
  { q: '해변 모래나 잔디밭에서 써도 쿠션감이 있나요?', kind: '실문의' },
  { q: '옴그레이랑 그레이랑 같은 색인가요?', kind: '실문의' },
  { q: '베이지색 후면은 무슨 색인가요?', kind: '실문의' },
  { q: '세탁할 때 물 온도는 몇 도까지 되나요? 세탁망에 넣어야 하나요?', kind: '실문의' },
  { q: '블루레이크 언제 재입고되나요?', kind: '실문의' },
  { q: '카톡 리뷰 인증 남겼는데 접수됐나요?', kind: '실문의' },
]

const store: DocStore = JSON.parse(
  readFileSync(new URL('../public/soulmat-docs.json', import.meta.url), 'utf8'),
)
const bm25 = new BM25(store.chunks)

/** 문항별 회차 기록. 한 번 돌린 숫자로는 설정을 비교할 수 없어 회차를 다 남긴다. */
type Trial = { verdict: string; cited: boolean; grounded: boolean; relevance: number; answer: string }
const trials = new Map<string, Trial[]>()
const meta = new Map<string, { kind: string; maxCosine: number; weak: boolean; top: string }>()
const perRun: number[] = []
const t0 = Date.now()

for (let run = 1; run <= repeat; run++) {
  let pass = 0
  if (repeat > 1) console.log(`\n── ${run}회차 ──────────────`)
  for (const { q, kind } of QUESTIONS) {
    const qv = await embedQuery(q)
    const r = retrieve(store, bm25, q, qv, TOP_K)
    const answer = await streamChat(
      [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(q, r) },
      ],
      () => {},
    )
    const j = await judge(q, answer, r)
    if (j.verdict === 'pass') pass++

    if (!trials.has(q)) trials.set(q, [])
    trials.get(q)!.push({ verdict: j.verdict, cited: j.cited, grounded: j.grounded, relevance: j.relevance, answer })
    // 검색은 질문에 대해 결정적이므로 첫 회차 값만 남긴다.
    if (!meta.has(q)) meta.set(q, { kind, maxCosine: r.maxCosine, weak: r.weakEvidence, top: r.hits[0].chunk.id })

    const ok = j.verdict === 'pass' ? 'PASS' : j.verdict.toUpperCase()
    console.log(`${ok.padEnd(5)} [${kind}] ${q}  (cos ${r.maxCosine.toFixed(3)})`)
  }
  perRun.push(pass)
  if (repeat > 1) console.log(`  ${run}회차 pass ${pass}/${QUESTIONS.length}`)
}

const secs = ((Date.now() - t0) / 1000).toFixed(0)
const n = QUESTIONS.length
const mean = perRun.reduce((a, b) => a + b, 0) / perRun.length
const lo = Math.min(...perRun)
const hi = Math.max(...perRun)
const spreadPp = (((hi - lo) / n) * 100).toFixed(1)

/** 회차마다 판정이 갈린 문항. 여기 있는 것은 그 문항 자체가 불안정하다는 뜻이다. */
const unstable = [...trials.entries()].filter(([, ts]) => new Set(ts.map((t) => t.verdict)).size > 1)

const rows = QUESTIONS.map(({ q }) => {
  const ts = trials.get(q)!
  const m = meta.get(q)!
  const passN = ts.filter((t) => t.verdict === 'pass').length
  const seq = ts.map((t) => ({ pass: 'P', warn: 'W', fail: 'F' })[t.verdict] ?? '?').join('')
  const last = ts[ts.length - 1]
  const rate = repeat > 1 ? `${passN}/${repeat} \`${seq}\`` : `**${last.verdict}**`
  return `| ${m.kind} | ${q} | ${m.maxCosine.toFixed(3)} | ${m.weak ? '약함' : '충분'} | ${m.top} | ${last.cited ? 'O' : 'X'} | ${last.grounded ? 'O' : 'X'} | ${last.relevance} | ${rate} | ${last.answer.replace(/\n/g, ' ').replace(/\|/g, '/').slice(0, 110)}… |`
})

const md = [
  `# 실험 ${name}`,
  '',
  `- 고정 질문 ${n}문항 (직답 5 / 연결 3 / 자료밖 4 / 채널 4 / 실제 고객문의 7) · **${repeat}회 반복**`,
  `- 임베딩 ${store.model} ${store.dim}차원 · 청크 ${store.chunks.length}개 · 생성/판정 qwen3.5:2b temperature=0`,
  `- pass 평균 **${mean.toFixed(1)}/${n}** (${(((mean / n) * 100)).toFixed(1)}%) · 회차별 ${perRun.join(' · ')} · 폭 ${spreadPp}%p · 총 ${secs}초`,
  '',
  repeat > 1
    ? `> **폭이 ${spreadPp}%p 다.** 이보다 작은 차이는 설정을 바꿔 얻은 것이 아니라 흔들림이다.\n> 회차마다 판정이 갈린 문항 ${unstable.length}개: ${unstable.map(([q]) => q).join(' / ') || '없음'}`
    : '> **1회 측정이다. 이 숫자로 다른 설정과 비교하지 말 것.** `--repeat 3` 이상으로 다시 재라.',
  '',
  `| 유형 | 질문 | 최고코사인 | 근거 | 1위청크 | cited | grounded | relevance | ${repeat > 1 ? 'pass율' : 'verdict'} | 답변(발췌) |`,
  '|---|---|---|---|---|---|---|---|---|---|',
  ...rows,
].join('\n')

mkdirSync(new URL('../results/', import.meta.url), { recursive: true })
writeFileSync(new URL(`../results/${name}.md`, import.meta.url), md)
console.log(
  `\npass 평균 ${mean.toFixed(1)}/${n} · 회차별 ${perRun.join(' · ')} · 폭 ${spreadPp}%p · ${secs}초 → results/${name}.md`,
)
if (repeat > 1 && unstable.length) {
  console.log(`판정이 갈린 문항 ${unstable.length}개:`)
  for (const [q, ts] of unstable) console.log(`  ${ts.map((t) => t.verdict).join(' → ')}  ${q}`)
}
