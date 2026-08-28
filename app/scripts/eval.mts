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
import { embedQuery, streamChat } from '../src/lib/ollama'
import type { DocStore } from '../src/lib/types'

const name = process.argv[2] || 'baseline'

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

const rows: string[] = []
let pass = 0
const t0 = Date.now()

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

  const ok = j.verdict === 'pass' ? 'PASS' : j.verdict.toUpperCase()
  console.log(`${ok.padEnd(5)} [${kind}] ${q}  (cos ${r.maxCosine.toFixed(3)})`)

  rows.push(
    `| ${kind} | ${q} | ${r.maxCosine.toFixed(3)} | ${r.weakEvidence ? '약함' : '충분'} | ${r.hits[0].chunk.id} | ${j.cited ? 'O' : 'X'} | ${j.refusal ? 'O' : 'X'} | ${j.grounded ? 'O' : 'X'} | ${j.relevance} | **${j.verdict}** | ${answer.replace(/\n/g, ' ').replace(/\|/g, '/').slice(0, 110)}… |`,
  )
}

const secs = ((Date.now() - t0) / 1000).toFixed(0)
const md = [
  `# 실험 ${name}`,
  '',
  `- 고정 질문 ${QUESTIONS.length}문항 (직답 5 / 연결 3 / 자료밖 4 / 채널 4 / 실제 고객문의 7)`,
  `- 임베딩 ${store.model} ${store.dim}차원 · 청크 ${store.chunks.length}개`,
  `- pass ${pass}/${QUESTIONS.length} · 총 ${secs}초`,
  '',
  '| 유형 | 질문 | 최고코사인 | 근거 | 1위청크 | cited | refusal | grounded | relevance | verdict | 답변(발췌) |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows,
].join('\n')

mkdirSync(new URL('../results/', import.meta.url), { recursive: true })
writeFileSync(new URL(`../results/${name}.md`, import.meta.url), md)
console.log(`\npass ${pass}/${QUESTIONS.length} · ${secs}초 → results/${name}.md`)
