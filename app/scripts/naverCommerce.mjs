/**
 * 네이버 커머스 API 클라이언트 (빌드 타임 전용 · Node 에서만 동작)
 *
 * 브라우저 앱에서 절대 import 하지 말 것. client_secret 이 노출된다.
 * 이 모듈은 자료 수집 단계에서만 쓰이고, 결과 JSON만 앱으로 넘어간다.
 *
 * 공식 스펙: https://apicenter.commerce.naver.com/ko/basic/commerce-api
 * 전자서명 구현은 공식 문서의 예시값과 일치함을 확인했다.
 */
import bcrypt from 'bcryptjs'

const BASE = 'https://api.commerce.naver.com/external'

/**
 * 전자서명 생성.
 * client_secret 은 bcrypt 의 '솔트'로 쓰인다 ($2a$10$... 형식).
 * timestamp 는 밀리초이며 5분간만 유효하므로 매 발급 시 새로 만든다.
 */
export function makeSignature(clientId, clientSecret, timestamp) {
  const hashed = bcrypt.hashSync(`${clientId}_${timestamp}`, clientSecret)
  return Buffer.from(hashed, 'utf-8').toString('base64')
}

/** 토큰은 3시간 유효하다. 프로세스 안에서 재사용해 불필요한 발급을 줄인다. */
let cached = null

export async function getAccessToken({ clientId, clientSecret, accountId } = {}) {
  clientId ||= process.env.NAVER_CLIENT_ID
  clientSecret ||= process.env.NAVER_CLIENT_SECRET
  accountId ||= process.env.NAVER_ACCOUNT_ID

  if (!clientId || !clientSecret) {
    throw new Error(
      'NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 이 없습니다.\n' +
        'app/.env 를 만들고 값을 채운 뒤 `npm run naver:fetch` 로 실행하세요. (.env.example 참고)',
    )
  }

  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached.token

  const timestamp = Date.now()
  const params = new URLSearchParams({
    client_id: clientId,
    timestamp: String(timestamp),
    client_secret_sign: makeSignature(clientId, clientSecret, timestamp),
    grant_type: 'client_credentials',
    type: accountId ? 'SELLER' : 'SELF',
  })
  if (accountId) params.set('account_id', accountId)

  const r = await fetch(`${BASE}/v1/oauth2/token?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })

  const body = await r.text()
  if (!r.ok) {
    // 시크릿은 절대 로그에 남기지 않는다.
    throw new Error(`토큰 발급 실패 (${r.status}): ${body}\n${hintFor(r.status, body)}`)
  }

  const j = JSON.parse(body)
  cached = { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 10800) * 1000 }
  return cached.token
}

function hintFor(status, body) {
  if (status === 400 && body.includes('client_secret_sign'))
    return '→ 전자서명 오류입니다. client_secret 을 그대로($2a$10$... 전체) 넣었는지 확인하세요.'
  if (status === 400) return '→ 값이 잘못되었거나 timestamp 가 5분을 넘겼습니다. 시스템 시각을 확인하세요.'
  if (status === 403)
    return '→ 권한/약관 문제입니다. 커머스API센터에서 애플리케이션에 "상품" 권한 그룹이 부여됐는지, 약관에 동의했는지 확인하세요.'
  if (status === 404) return '→ account_id(판매자 ID)가 잘못되었을 수 있습니다.'
  return ''
}

/** 인증 헤더를 붙여 호출한다. */
export async function api(path, { method = 'GET', body, query } = {}) {
  const token = await getAccessToken()
  const url = new URL(BASE + path)
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v)

  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path} 실패 (${r.status}): ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : null
}

/* ---------- 우리가 쓰는 조회들 ---------- */

/** 판매 중인 상품 목록. 페이지를 끝까지 넘긴다. */
export async function listProducts({ size = 100, statuses = ['SALE', 'OUTOFSTOCK'] } = {}) {
  const all = []
  for (let page = 1; ; page++) {
    const res = await api('/v1/products/search', {
      method: 'POST',
      body: { productStatusTypes: statuses, page, size, orderType: 'NO', periodType: 'PROD_REG_DAY' },
    })
    const items = res?.contents ?? []
    all.push(...items)
    if (items.length < size || page >= (res?.totalPages ?? 1)) break
  }
  return all
}

/** 채널 상품 상세 — 배송비, 반품/교환비, 옵션이 여기 들어 있다. */
export const getChannelProduct = (channelProductNo) =>
  api(`/v1/products/channel-products/${channelProductNo}`)

/** 묶음배송 그룹 — 배송비 정책의 원본. */
export const getBundleGroups = () => api('/v1/product-delivery-info/bundle-groups')
