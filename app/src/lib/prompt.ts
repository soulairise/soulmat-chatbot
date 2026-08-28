import type { Hit, Retrieval } from './types'

export const REFUSAL_LINE =
  '소울매트 공개 자료에서 확인되지 않는 내용입니다. 정확한 안내가 필요하시면 소울매트 고객센터(0507-1316-1623) 또는 네이버 톡톡으로 문의해 주세요.'

const fmtContext = (hits: Hit[]) =>
  hits
    .map(
      (h, i) =>
        `[${i + 1}] id=${h.chunk.id} | 섹션=${h.chunk.section} | 출처=${h.chunk.url}\n${h.chunk.text}`,
    )
    .join('\n\n')

/** 시간 맥락 — 자료가 가격·재고처럼 변할 수 있음을 모델에 알린다. */
const timeContext = () => {
  const now = new Date()
  const d = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`
  return `오늘은 ${d}입니다. 아래 자료는 soulmat.kr에서 수집한 시점의 내용이며, 가격·색상·재고는 이후 바뀌었을 수 있습니다.`
}

export function buildSystemPrompt(): string {
  return [
    '당신은 요가매트 전문 브랜드 "소울매트"의 구매 안내 도우미입니다.',
    '',
    '규칙:',
    '1. 아래 [자료]에 있는 내용만 근거로 답합니다. 자료에 없는 사실을 추측하거나 일반 상식으로 보충하지 않습니다.',
    '2. 답변에 사용한 자료는 문장 끝에 [1] [2] 형태로 번호를 표시합니다.',
    '3. 답하기 전에 [자료]를 끝까지 읽습니다. 자료에 답이 있으면 반드시 그 내용으로 답합니다.',
    '4. 자료에 정말로 답이 없을 때만 거절합니다. 이때는 자료를 요약해 보여주지 말고,',
    `   다음 문장을 그대로 답변에 포함합니다: "${REFUSAL_LINE}"`,
    '5. 가격·색상·재고는 변경될 수 있으므로 단정하지 말고 "자료 기준"임을 밝힙니다.',
    '6. 의학적 효과, 타사 제품 비교, 개인 신체 상태에 대한 조언은 자료 범위 밖입니다. 규칙 4를 따릅니다.',
    '7. 소울매트는 자사몰(soulmat.kr)과 네이버 스마트스토어 두 채널에서 판매하며,',
    '   배송비와 반품·교환 비용이 채널마다 다릅니다. 비용을 답할 때는 반드시',
    '   어느 채널 기준인지 밝히고, 질문에 채널이 없으면 두 채널을 모두 안내합니다.',
    '8. 한국어로, 3~5문장 이내로 간결하게 답합니다.',
  ].join('\n')
}

export function buildUserPrompt(question: string, r: Retrieval): string {
  const parts = [timeContext(), '', '[자료]', fmtContext(r.hits)]

  if (r.weakEvidence) {
    parts.push(
      '',
      `[주의] 위 자료와 질문의 최고 유사도가 ${r.maxCosine.toFixed(3)}으로 낮습니다(기준 0.55).`,
      '자료가 질문에 직접 답하지 못할 가능성이 큽니다. 억지로 연결하지 말고,',
      '자료로 확인되는 범위만 말하거나 규칙 3의 안내 문구를 사용하세요.',
    )
  }

  parts.push('', `[질문] ${question}`)
  return parts.join('\n')
}
