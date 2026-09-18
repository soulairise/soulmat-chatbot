import { chatJson } from './llm'
import { type FactCheck, factCheck } from './factcheck'
import { REFUSAL_LINE } from './prompt'
import type { Judgement, Retrieval } from './types'

/**
 * 판정 설계 원칙 — LLM에는 '원자적 사실'만 묻고, 최종 verdict는 코드가 조합한다.
 *
 * 처음에는 6필드 전부를 qwen3.5:2b에게 한 번에 맡겼는데, 2B 모델은
 * "정당한 거절도 pass" 같은 분기 규칙을 지키지 못하고 정상 거절을 fail로 찍었다.
 * cited 역시 [1][2]가 있는 답변을 false로 오판정했다. (실험 EXP-02)
 *
 * 그래서 결정적으로 확인 가능한 것(cited)은 정규식으로,
 * 규칙 조합(verdict, grounded, relevance)은 코드로 옮기고,
 * 모델에게는 서로 독립적인 판단 3개만 남겼다.
 */
const CITATION_RE = /\[\s*\d+\s*\]/

type Atoms = {
  /** 답변에 자료로 확인되지 않는 사실 주장이 있는가 */
  hallucinated: boolean
  /** 답변이 "자료에 없다"며 답변을 거절했는가 */
  refusal: boolean
  /** 주어진 자료만으로 질문에 답할 수 있는가 (답변과 무관하게 자료만 보고) */
  answerable: boolean
  /** 답변이 질문을 얼마나 충족했는가 */
  covered: 0 | 1 | 2
  reason: string
}

const SCHEMA = {
  type: 'object',
  properties: {
    hallucinated: { type: 'boolean' },
    refusal: { type: 'boolean' },
    answerable: { type: 'boolean' },
    covered: { type: 'integer', enum: [0, 1, 2] },
    reason: { type: 'string' },
  },
  required: ['hallucinated', 'refusal', 'answerable', 'covered', 'reason'],
}

const JUDGE_SYSTEM = [
  '당신은 RAG 답변을 검사하는 심사자입니다. 문체나 친절함은 보지 않습니다.',
  '아래 4가지를 서로 독립적으로 판단하세요. 종합 평가는 하지 마세요.',
  '',
  // 여기에 제품범위 규칙을 한 줄 더 넣었다가 19/23 → 11/23 이 되었다.
  // 더 정교하게 여섯 줄로 늘렸더니 8/23 이 되었다. 지시문을 늘릴수록 2b 판정기는
  // "제품 이름이 둘 이상이면 일단 true" 쪽으로 무너진다. (EXP-09, EXP-11)
  // 그래서 제품범위·수치 검사는 모델에서 빼고 아래 코드로 내렸다.
  'hallucinated — [답변]에 [자료]로 확인되지 않는 사실 주장(수치, 조건, 효과 등)이 하나라도 있으면 true.',
  '               "자료에 없다"고 말한 것은 사실 주장이 아니므로 hallucinated가 아닙니다.',
  '',
  'refusal — [답변]이 "자료에서 확인되지 않는다 / 답할 수 없다"는 취지로 답변을 미뤘으면 true.',
  '',
  'answerable — [답변]은 보지 말고 [자료]와 [질문]만 보세요.',
  '             자료만으로 질문에 답할 수 있으면 true, 자료에 답이 없으면 false.',
  '',
  'covered — [답변]이 [질문]에 답한 정도. 충분히 답했으면 2, 일부만이면 1, 답하지 않았으면 0.',
  '          거절한 답변은 0입니다.',
  '',
  'reason — 위 판단의 근거를 한 문장으로.',
].join('\n')

/** 원자 판단을 규칙으로 조합한다. 이 조합은 모델이 아니라 코드가 책임진다. */
function compose(a: Atoms, cited: boolean, fc: FactCheck): Judgement {
  // 모델의 판단과 코드의 검사 중 **하나라도** 걸리면 근거 없음이다.
  // 코드 쪽은 세어 본 결과라 모델보다 신뢰도가 높다.
  const grounded = !a.hallucinated && fc.ok
  const justifiedRefusal = a.refusal && !a.answerable
  const missedRefusal = a.refusal && a.answerable

  const relevance: 0 | 1 | 2 = a.refusal ? (justifiedRefusal ? 2 : 0) : a.covered

  let verdict: Judgement['verdict']
  if (!grounded) verdict = 'fail'
  else if (justifiedRefusal) verdict = 'pass'
  else if (missedRefusal) verdict = 'fail'
  else if (a.covered === 2) verdict = cited ? 'pass' : 'warn'
  else if (a.covered === 1) verdict = 'warn'
  else verdict = 'fail'

  const factNote = [
    fc.numbers.length ? `자료에 없는 숫자: ${fc.numbers.join(', ')}` : '',
    fc.brands.length ? `자료에 없는 브랜드를 단정: ${fc.brands.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' / ')

  const note = justifiedRefusal
    ? '자료 범위 밖 질문에 대한 정당한 거절.'
    : missedRefusal
      ? '자료에 답이 있는데도 거절했다.'
      : factNote
        ? factNote
        : a.hallucinated
          ? '자료로 확인되지 않는 주장이 포함되었다.'
          : ''

  return {
    grounded,
    cited,
    refusal: a.refusal,
    relevance,
    verdict,
    reason: note ? `${note} ${a.reason}` : a.reason,
  }
}

export async function judge(
  question: string,
  answer: string,
  r: Retrieval,
  signal?: AbortSignal,
): Promise<Judgement> {
  const context = r.hits.map((h, i) => `[${i + 1}] ${h.chunk.text}`).join('\n')
  const user = [
    `[질문]\n${question}`,
    '',
    `[자료]\n${context}`,
    '',
    `[답변]\n${answer}`,
    '',
    'JSON으로만 판정하세요.',
  ].join('\n')

  const atoms = await chatJson<Atoms>(
    [
      { role: 'system', content: JUDGE_SYSTEM },
      { role: 'user', content: user },
    ],
    SCHEMA,
    signal,
  )

  // 거절 문구의 고객센터 번호는 우리 템플릿에서 온 값이지 모델이 지어낸 것이 아니다.
  // 자료에만 없다고 잡으면 정당한 거절이 전부 fail 이 된다. EXP-12 에서 실제로 그랬고,
  // 오탐 8건이 전부 이 번호 하나 때문이었다.
  const sources = [...r.hits.map((h) => h.chunk.text), REFUSAL_LINE]

  return compose(atoms, CITATION_RE.test(answer), factCheck(answer, sources))
}
