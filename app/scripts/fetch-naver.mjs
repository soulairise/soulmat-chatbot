#!/usr/bin/env node
/**
 * 네이버 커머스 API로 스마트스토어 자료를 수집한다.
 * 실행: npm run naver:fetch      (app/.env 에 키가 있어야 함)
 *
 * 결과는 src/data/sources/ 에 원본 그대로 저장한다.
 * 청크로 옮기는 일은 사람이 확인한 뒤 별도로 한다 —
 * API 응답을 자동으로 청크화하면 잘못된 값이 검증 없이 챗봇에 실린다.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { getBundleGroups, getChannelProduct, listProducts } from './naverCommerce.mjs'

process.on('uncaughtException', fail)
process.on('unhandledRejection', fail)

function fail(e) {
  console.error('\n실패했습니다.\n')
  console.error(String(e?.message ?? e).split('\n').map((l) => '  ' + l).join('\n'))
  console.error('')
  process.exit(1)
}

const OUT = new URL('../src/data/sources/', import.meta.url)
mkdirSync(OUT, { recursive: true })
const save = (name, data) => {
  writeFileSync(new URL(name, OUT), JSON.stringify(data, null, 2))
  console.log(`  저장: src/data/sources/${name}`)
}

console.log('네이버 커머스 API 수집 시작\n')

console.log('[1/3] 묶음배송 그룹 (배송비 정책)')
const bundles = await getBundleGroups()
save('naver-bundle-groups.json', bundles)
for (const g of bundles?.deliveryBundleGroups ?? bundles ?? []) {
  console.log(`  · ${g.groupName ?? g.deliveryBundleGroupName ?? '(이름없음)'}`)
}

console.log('\n[2/3] 판매 중 상품 목록')
const products = await listProducts()
save('naver-products.json', products)
console.log(`  상품 ${products.length}개`)

console.log('\n[3/3] 채널 상품 상세 (배송비·반품비 원본)')
const details = []
for (const p of products) {
  const no = p.channelProducts?.[0]?.channelProductNo ?? p.channelProductNo
  if (!no) continue
  try {
    details.push(await getChannelProduct(no))
    process.stdout.write(`\r  ${details.length}/${products.length}`)
  } catch (e) {
    console.warn(`\n  건너뜀 ${no}: ${e.message.slice(0, 80)}`)
  }
}
console.log()
save('naver-channel-products.json', details)

/* 사람이 바로 확인할 수 있게 핵심 값만 요약해 보여준다. */
console.log('\n=== 요약: 챗봇 청크로 옮길 후보 ===')
const seen = new Set()
for (const d of details) {
  const op = d.originProduct ?? d
  const dl = op.deliveryInfo ?? {}
  const rt = op.returnInfo ?? op.claimDeliveryInfo ?? {}
  const key = JSON.stringify([dl.deliveryFee?.baseFee, dl.deliveryFee?.freeConditionalAmount, rt.returnDeliveryFee, rt.exchangeDeliveryFee])
  if (seen.has(key)) continue
  seen.add(key)
  console.log(`
  상품: ${op.name ?? '(이름없음)'}
    배송비           ${dl.deliveryFee?.baseFee ?? '-'}원 (유형 ${dl.deliveryFee?.deliveryFeeType ?? '-'})
    무료배송 기준     ${dl.deliveryFee?.freeConditionalAmount ?? '-'}원
    묶음배송          ${dl.deliveryBundleGroupUsable ?? '-'}
    반품 배송비       ${rt.returnDeliveryFee ?? '-'}원
    교환 배송비       ${rt.exchangeDeliveryFee ?? '-'}원`)
}

console.log(`

다음 단계
  1. src/data/sources/*.json 을 확인한다
  2. 자사몰 값과 다른 항목이 있으면 채널을 명시해 청크를 만든다
  3. node scripts/embed.mjs        (벡터 재생성)
  4. npx tsx scripts/eval.mts <이름>  (12문항 회귀 확인)`)
