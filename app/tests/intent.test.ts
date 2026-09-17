import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { classify, type Intent } from '../src/lib/intent.ts'

/**
 * 평가셋 23문항 전부에 정답 의도를 달아 둔다.
 * 규칙을 고칠 때마다 이 표가 먼저 깨지므로, 한 곳을 넓히다 다른 곳을 망가뜨리는 걸 잡는다.
 */
const EVAL_SET: [string, Intent][] = [
  ['배송비가 얼마인가요?', '배송_비용_질문'],
  ['트래블매트 색상은 뭐가 있나요?', '상품_색상_질문'],
  ['요가매트 세탁해도 되나요?', '관리_세탁_질문'],
  ['반품은 며칠 안에 해야 하나요?', '반품_기한_질문'],
  ['리포머 매트 가격 알려주세요', '상품_가격_질문'],
  ['트래블매트랑 요가타올은 뭐가 다른가요?', '상품_비교_질문'],
  ['5만원어치 사면 배송비 내고 언제 받나요?', '배송_비용_질문'],
  ['단순 변심으로 반품하면 비용이 얼마나 드나요?', '반품_비용_질문'],
  ['허리디스크에 도움이 되나요?', '효능_건강_질문'],
  ['루루레몬 매트랑 비교하면 어떤가요?', '타사_비교_질문'],
  ['지금 재고 몇 개 남았나요?', '재고_수량_질문'],
  ['스마트스토어에서 반품하면 비용이 얼마인가요?', '반품_비용_질문'],
  ['요가바지도 파나요?', '채널_취급_질문'],
  ['배송비 얼마예요?', '배송_비용_질문'],
  ['요가원 단체로 매트 주문할 수 있나요?', '단체_견적_질문'],
  // 만두카가 들어간 순간 타사 비교가 된다. EXP-08 에서 이 문항이 없는 비교를 지어냈다.
  ['매트 사이즈가 어떻게 되나요? 만두카 일반매트 크기인가요?', '타사_비교_질문'],
  ['해변 모래나 잔디밭에서 써도 쿠션감이 있나요?', '사용_환경_질문'],
  ['옴그레이랑 그레이랑 같은 색인가요?', '상품_색상_질문'],
  ['베이지색 후면은 무슨 색인가요?', '상품_색상_질문'],
  ['세탁할 때 물 온도는 몇 도까지 되나요? 세탁망에 넣어야 하나요?', '관리_세탁_질문'],
  ['블루레이크 언제 재입고되나요?', '재입고_일정_질문'],
  ['카톡 리뷰 인증 남겼는데 접수됐나요?', '주문_상태_질문'],
]

for (const [q, want] of EVAL_SET) {
  test(`분류: ${q}`, () => {
    const c = classify(q)
    assert.equal(c.intent, want, `"${q}" → ${c.intent} (걸린 말: ${c.matched})`)
  })
}

/** '기타'로 떨어져야 하는 것 — 억지로 의도를 붙이면 안 된다. */
for (const q of ['요가 초보인데 어떤 자세부터 하면 되나요?', '안녕하세요', '고마워요']) {
  test(`기타: ${q}`, () => assert.equal(classify(q).intent, '기타'))
}

/** 정책이 실제로 붙는지 — 이름만 맞고 정책이 비면 의미가 없다. */
test('채널 민감 의도에는 채널 정책이 붙는다', () => {
  assert.equal(classify('배송비가 얼마인가요?').policy.channelSensitive, true)
  assert.equal(classify('반품은 며칠 안에 해야 하나요?').policy.channelSensitive, true)
})

test('제품별 의도에는 제품 정책이 붙는다', () => {
  assert.equal(classify('요가매트 세탁해도 되나요?').policy.productSpecific, true)
  assert.equal(classify('해변에서 써도 쿠션감이 있나요?').policy.productSpecific, true)
})

test('조회가 필요한 의도는 needsLookup 이다', () => {
  assert.equal(classify('지금 재고 몇 개 남았나요?').policy.needsLookup, true)
  assert.equal(classify('블루레이크 언제 재입고되나요?').policy.needsLookup, true)
  assert.equal(classify('카톡 리뷰 인증 남겼는데 접수됐나요?').policy.needsLookup, true)
  // 자료로 답할 수 있는 것에 needsLookup 이 붙으면 멀쩡한 질문을 창구로 떠넘긴다
  assert.equal(classify('배송비가 얼마인가요?').policy.needsLookup, false)
})
