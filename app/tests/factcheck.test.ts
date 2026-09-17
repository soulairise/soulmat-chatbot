import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { factCheck, looksLikeRefusal, unsupportedBrandClaim, unsupportedNumbers } from '../src/lib/factcheck.ts'

/**
 * EXP-09/EXP-11 에서 판정기가 잡아야 했던 것과, 잘못 깎았던 것을 그대로 옮겨 놓았다.
 * 답변 문장은 실제 실험 결과에서 가져온 것이지 지어낸 것이 아니다.
 */

const 반품자료 = [
  '자사몰 반품·교환: 상품을 공급받은 날로부터 7일 이내에 신청할 수 있습니다.',
  '네이버 스마트스토어 반품비 3,000원 / 교환비 6,000원 (요가매트류 기준)',
]
const 치수자료 = [
  '트래블 요가매트 1mm: 가로 183cm, 세로 61cm. 일반 요가매트보다 가로가 2cm 작습니다.',
]
const 색상자료 = [
  '트래블 요가매트 1mm 색상: 민무늬 4종(블루레이크, 옴그레이, 물란다라 핑크, 아즈나 네이비)과 패턴 11종.',
]

/* ── 잡아야 하는 것 ─────────────────────────────────── */

test('자료에 없는 숫자를 지어내면 잡는다 — "3 영업일"', () => {
  const a = '자사몰 기준 공급받은 날로부터 7일 이내에 신청해야 하며, 스마트스토어 기준은 3 영업일 이내로 처리해야 합니다. [1]'
  assert.ok(unsupportedNumbers(a, 반품자료).length > 0)
})

test('자료에 없는 타사 브랜드를 두고 단정하면 잡는다 — 만두카', () => {
  const a = '트래블 요가매트는 가로 183cm, 세로 61cm입니다. 이는 만두카 일반매트와 동일한 크기가 아닙니다. [1]'
  assert.deepEqual(unsupportedBrandClaim(a, 치수자료), ['만두카'])
})

/* ── 깎으면 안 되는 것 (EXP-09 에서 판정기가 잘못 깎았던 5건) ─── */

test('브랜드를 말해도 "자료에 없다"고 밝히면 통과', () => {
  const a = '소울매트 공개 자료에서 루루레몬 매트와 비교한 내용은 없습니다. 고객센터로 문의해 주세요.'
  assert.deepEqual(unsupportedBrandClaim(a, 치수자료), [])
})

test('요가바지 — 목록에 없다고 정확히 답한 것은 통과', () => {
  const a = '자사몰과 스마트스토어 모두에서 요가담요를 판매하고 있습니다. 다만 요가바지는 제품 목록에 명시되지 않았습니다. [1]'
  assert.equal(factCheck(a, 반품자료).ok, true)
})

test('블루레이크 재입고 — 일정이 자료에 없다고 답한 것은 통과', () => {
  const a = '블루레이크는 트래블 요가매트 1mm 제품군의 민무늬 색상이며, 재입고 일정은 공개 자료에 없습니다. [2]'
  assert.equal(factCheck(a, 색상자료).ok, true)
})

test('채널별로 나눠 각각 자료대로 말한 답변은 통과', () => {
  const a = '자사몰 기준은 7일 이내 신청이며, 스마트스토어 기준은 반품비 3,000원 교환비 6,000원입니다. [1][2]'
  assert.equal(factCheck(a, 반품자료).ok, true)
})

test('비교 질문에 두 제품을 각각 자료대로 설명한 답변은 통과', () => {
  const 비교자료 = [
    '트래블매트는 바닥이 천연고무로 밀착되어 들뜨지 않습니다. 두께 1mm.',
    '요가타올은 윗면이 마이크로화이바로 땀 흡수가 좋습니다.',
  ]
  const a = '트래블매트는 바닥이 천연고무로 밀착되어 들뜨지 않고, 요가타올은 윗면이 마이크로화이바로 땀 흡수가 좋습니다. [1][2]'
  assert.equal(factCheck(a, 비교자료).ok, true)
})

/* ── 검사 자체가 헛돌지 않는지 ───────────────────────── */

test('인용 표시 [1][2] 는 숫자로 세지 않는다', () => {
  assert.deepEqual(unsupportedNumbers('7일 이내입니다. [1][2][3]', 반품자료), [])
})

test('오늘 날짜는 숫자로 세지 않는다', () => {
  const now = new Date()
  const a = `오늘 ${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 기준 재고는 확인할 수 없습니다.`
  assert.deepEqual(unsupportedNumbers(a, 반품자료), [])
})

/* ── 거절 표지 (EXP-19: 판정기가 멀쩡한 답을 refusal=true 로 찍었다) ── */

test('또박또박 답한 답변은 거절이 아니다', () => {
  const a = '소울매트 공개 자료에 따르면 필라테스 리포머 매트는 베이지색을 옵션으로 구매할 수 있으며, 그 제품의 후면은 천연고무로 되어 있고 색상이 검정색입니다 [1].'
  assert.equal(looksLikeRefusal(a), false)
})

test('"공개 자료에 따르면"이 들어갔다고 거절이 아니다', () => {
  assert.equal(looksLikeRefusal('소울매트 공개 자료에 따르면 배송비는 3,000원입니다 [1].'), false)
})

for (const a of [
  '소울매트 공개 자료에서 확인되지 않는 내용입니다. 정확한 안내가 필요하시면 소울매트 고객센터(0507-1316-1623) 또는 네이버 톡톡으로 문의해 주세요.',
  '소울매트 공개 자료에서 루루레몬 매트와 비교한 내용은 없습니다.',
  '재입고 일정은 공개된 안내 자료에 나와 있지 않습니다.',
  '실시간 재고는 공개 자료로는 알 수 없습니다.',
]) {
  test(`거절은 거절로 본다: ${a.slice(0, 26)}…`, () => assert.equal(looksLikeRefusal(a), true))
}
