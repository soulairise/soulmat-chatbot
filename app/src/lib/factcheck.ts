/**
 * 결정적으로 확인할 수 있는 것은 모델에게 묻지 않는다.
 *
 * 제품범위·수치 검사를 판정 프롬프트에 글로 적어 봤더니 지시문을 늘릴수록
 * 2b 판정기가 무너졌다 — 한 줄 추가에 19/23 → 11/23, 여섯 줄로 늘리니 8/23.
 * "제품 이름이 둘 이상이면 일단 true" 쪽으로 기울기 때문이다. (EXP-09, EXP-11)
 *
 * 답변의 숫자가 자료에 있는지, 자료에 없는 브랜드를 단정했는지는 **세어 보면 아는 것**이다.
 * 세어 보면 아는 것을 모델에게 묻지 않는다. 형제 프로젝트(고객응대 에이전트)의
 * `guardrail.allowed_numbers` 와 같은 생각이다.
 */

/** 숫자를 비교 가능한 형태로. "38,800" "38 800" → "38800" */
const normNum = (s: string) => s.replace(/[,\s]/g, '')

/** 인용 표시 [1] 과 오늘 날짜는 자료에서 온 값이 아니므로 검사 대상에서 뺀다. */
function strip(answer: string): string {
  const now = new Date()
  const today = new RegExp(
    `${now.getFullYear()}\\s*년?\\s*${now.getMonth() + 1}\\s*월?\\s*${now.getDate()}\\s*일?`,
    'g',
  )
  return answer.replace(/\[\s*\d+\s*\]/g, ' ').replace(today, ' ')
}

/** 숫자와, 바로 뒤에 붙은 한국어 단위(만·천·억)까지 함께 잡는다. */
const NUM_RE = /(\d[\d,\s]*\d|\d)\s*([만천억])?/g

/**
 * 숫자 하나가 가질 수 있는 표기들. "5만" 은 자료에 50000 으로 적혀 있을 수 있다.
 * 둘 중 하나라도 자료에 있으면 근거가 있는 것으로 본다.
 */
function forms(digits: string, unit?: string): string[] {
  const n = Number(digits)
  const out = [digits]
  if (!Number.isFinite(n)) return out
  const mul = unit === '만' ? 1e4 : unit === '천' ? 1e3 : unit === '억' ? 1e8 : 0
  if (mul) out.push(String(n * mul))
  return out
}

/**
 * 답변에 나오는데 자료 어디에도 없는 숫자.
 *
 * **부분일치가 아니라 정확일치**다. 처음에 "자료 문자열에 포함되는가"로 했더니
 * 답변의 "3 영업일"이 자료의 "3,000원" 안에 들어 있다는 이유로 통과했다.
 * 숫자는 토막으로 쪼개 비교하면 안 된다.
 */
export function unsupportedNumbers(answer: string, chunks: string[]): string[] {
  const pool = new Set<string>()
  for (const c of chunks) {
    for (const m of c.matchAll(NUM_RE)) {
      for (const f of forms(normNum(m[1]), m[2])) pool.add(f)
    }
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of strip(answer).matchAll(NUM_RE)) {
    const digits = normNum(m[1])
    if (!digits || seen.has(digits + (m[2] ?? ''))) continue
    seen.add(digits + (m[2] ?? ''))
    if (forms(digits, m[2]).some((f) => pool.has(f))) continue
    out.push(m[0].trim())
  }
  return out
}

/** 자료에 없는데 답변이 끌어다 쓰는 타사 브랜드 */
const BRANDS = /루루레몬|lululemon|만두카|manduka|얼라인|alignment|젤리코어|나이키|아디다스|데카트론/gi

/** 비교를 **단정**하는 말. "같다/다르다/더 크다" 따위. */
const COMPARE_CLAIM = /동일|같(은|다|습니다|아요)|다르(다|지|며|고)|차이가\s?(있|없)|더\s?(크|작|얇|두껍|저렴|비싸|좋|나)|보다\s?(크|작|얇|두껍|저렴|비싸|좋|나)/
/** 자료에 없다고 밝히는 말. 이게 있으면 단정이 아니다. */
const DISCLAIMER = /없습니다|없어요|없으(므로|며)|확인되지\s?않|명시되지\s?않|포함되지\s?않|제공되지\s?않|알\s?수\s?없|비교.*(어렵|불가)/

/**
 * 자료에 없는 타사 제품을 두고 우열·동일 여부를 단정했는가.
 *
 * "루루레몬 정보는 자료에 없습니다"는 통과해야 한다 — 브랜드를 말한 게 문제가 아니라
 * **없는 것을 아는 척하는 것**이 문제다. 그래서 단정하는 말이 있고 밝히는 말이 없을 때만 잡는다.
 */
export function unsupportedBrandClaim(answer: string, chunks: string[]): string[] {
  const pool = chunks.join(' ').toLowerCase()
  const body = strip(answer)
  const hits = new Set<string>()
  for (const b of body.match(BRANDS) ?? []) {
    if (pool.includes(b.toLowerCase())) continue // 자료에 있는 브랜드면 근거가 있다
    if (!COMPARE_CLAIM.test(body)) continue
    if (DISCLAIMER.test(body)) continue
    hits.add(b)
  }
  return [...hits]
}

/**
 * 답변에 **거절의 흔적이 하나라도 있는가.**
 *
 * 판정기가 "베이지색 후면은 무슨 색인가요?" 에 또박또박 답한 답변을 refusal=true 로
 * 찍었다. 그 답이 "소울매트 **공개 자료에 따르면**…" 으로 시작하는데, 2b 판정기가
 * 여기 든 "자료" 를 거절 신호로 본 것이다. 판정기의 reason 에는 답을 제대로 읽은
 * 내용이 적혀 있었다. 이해는 했는데 플래그만 틀린 것이다. (EXP-19)
 *
 * 이건 세어 보면 아는 것이다. 규칙 4 가 거절할 때 정해진 문장을 쓰도록 강제하고,
 * 모델이 바꿔 말하더라도 "확인되지 않는다" 류의 말은 반드시 들어간다.
 * 그런 말이 **하나도 없으면** 그 답변은 거절이 아니다.
 */
const REFUSAL_MARK =
  /확인되지\s?않|확인할\s?수\s?없|확인이\s?어렵|알\s?수\s?없|명시되(어|지)\s?있지\s?않|포함되(어|지)\s?있지\s?않|제공되지\s?않|나와\s?있지\s?않|정보가\s?없|내용은?\s?없|0507-1316-1623|고객센터.{0,10}문의|톡톡.{0,10}문의/

export const looksLikeRefusal = (answer: string): boolean => REFUSAL_MARK.test(answer)

export type FactCheck = { numbers: string[]; brands: string[]; ok: boolean }

export function factCheck(answer: string, chunks: string[]): FactCheck {
  const numbers = unsupportedNumbers(answer, chunks)
  const brands = unsupportedBrandClaim(answer, chunks)
  return { numbers, brands, ok: numbers.length === 0 && brands.length === 0 }
}
