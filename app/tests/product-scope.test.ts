import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { productClarification } from '../src/lib/productScope.ts'
for (const q of ['요가매트 세탁해도 되나요?', '이거 빨아도 돼요?', '건조기에 넣어도 돼요?']) {
  test(`제품명 확인: ${q}`, () => assert.match(productClarification(q) ?? '', /제품명과 궁금한 관리 방법/))
}
for (const q of ['트래블매트 세탁해도 되나요?', 'TPE 매트도 세탁기에 넣어도 되나요?', '배송비가 얼마인가요?', '요가매트 가격 알려줘']) {
  test(`일반 검색 유지: ${q}`, () => assert.equal(productClarification(q), null))
}
