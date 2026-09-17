/**
 * 질문 의도 분류.
 *
 * 명명규칙은 AI Hub 「소상공인 고객 주문 질의-응답 텍스트」(NIA, 2020)를 따랐다.
 * 그 데이터의 인텐트는 `배송_비용_질문` 처럼 `<대상>_<속성>_<행위>` 세 토막이다.
 * 데이터 자체는 신청·승인이 필요해 받지 않았고, **체계만** 빌려 소울매트 자료
 * (SM 자사몰 52청크 / NS 스마트스토어 14 / CS 고객문의 15)에 맞춰 18종으로 다시 짰다.
 *
 * ── 왜 LLM 분류가 아니라 규칙인가
 * 분류를 모델에 맡기면 질문 한 건마다 로컬 2b 모델 호출이 하나 더 붙는다.
 * 지금도 23문항 평가에 4분이 걸린다. 게다가 분류가 틀리면 그 원인을 되짚을 수가 없다.
 * 규칙은 즉시 끝나고, 틀리면 어느 정규식이 잡았는지가 바로 보이며, Ollama 없이 테스트된다.
 *
 * ── 이 분류로 무엇을 하나
 * 경로를 가로채지 **않는다**. 어제 고객응대 에이전트에서 분류 단계가 건강 문의를
 * 통째로 삼켜 "저희 소관이 아닙니다"가 나갔다. 같은 실수를 반복하지 않으려고,
 * 여기서는 분류 결과를 프롬프트에 **정보로만** 얹는다. 답은 여전히 자료가 만든다.
 */

export type Intent =
  // 자료로 답할 수 있는 것
  | '배송_비용_질문'
  | '배송_기간_질문'
  | '반품_기한_질문'
  | '반품_비용_질문'
  | '교환_방법_질문'
  | '상품_가격_질문'
  | '상품_색상_질문'
  | '상품_치수_질문'
  | '상품_재질_질문'
  | '상품_비교_질문'
  | '관리_세탁_질문'
  | '사용_환경_질문'
  | '채널_취급_질문'
  | '단체_견적_질문'
  | '문의_연락처_질문'
  // 자료에 없는 것
  | '효능_건강_질문'
  | '타사_비교_질문'
  // 실시간 조회가 필요한 것
  | '재고_수량_질문'
  | '재입고_일정_질문'
  | '주문_상태_질문'
  | '기타'

export type IntentPolicy = {
  /** 채널(자사몰/스마트스토어)마다 값이 달라 반드시 채널을 밝혀야 하는 의도 */
  channelSensitive: boolean
  /** 제품마다 값이 달라 제품명을 특정해야 하는 의도 */
  productSpecific: boolean
  /** 공개 자료로는 원리상 답할 수 없는 의도. 자료를 뒤지는 대신 다음 창구를 안내한다. */
  needsLookup: boolean
  /** 프롬프트에 덧붙일 의도별 지시. 없으면 기본 규칙만 적용된다. */
  note?: string
}

/**
 * 의도별 응대 정책.
 *
 * `needsLookup` 은 "자료에 없다"와 다르다. 재고 수량은 자료에 **없는** 게 아니라
 * 공개 페이지로는 **알 수 없는** 것이다. 고객에게는 "확인되지 않습니다"보다
 * "어디서 확인하시면 됩니다"가 맞는 답이다.
 */
export const POLICY: Record<Intent, IntentPolicy> = {
  배송_비용_질문: { channelSensitive: true, productSpecific: false, needsLookup: false },
  배송_기간_질문: { channelSensitive: true, productSpecific: false, needsLookup: false },
  반품_기한_질문: { channelSensitive: true, productSpecific: false, needsLookup: false },
  반품_비용_질문: { channelSensitive: true, productSpecific: false, needsLookup: false },
  교환_방법_질문: { channelSensitive: true, productSpecific: false, needsLookup: false },
  상품_가격_질문: { channelSensitive: true, productSpecific: true, needsLookup: false },
  채널_취급_질문: {
    channelSensitive: true,
    productSpecific: false,
    needsLookup: false,
    note: '어느 채널에서 취급하고 어느 채널에서 취급하지 않는지를 각각 밝히세요. 한쪽 채널만 보고 "판매하지 않습니다"라고 답하지 마세요.',
  },
  상품_색상_질문: { channelSensitive: false, productSpecific: true, needsLookup: false },
  상품_치수_질문: { channelSensitive: false, productSpecific: true, needsLookup: false },
  상품_재질_질문: { channelSensitive: false, productSpecific: true, needsLookup: false },
  관리_세탁_질문: { channelSensitive: false, productSpecific: true, needsLookup: false },
  사용_환경_질문: { channelSensitive: false, productSpecific: true, needsLookup: false },
  상품_비교_질문: {
    channelSensitive: false,
    productSpecific: true,
    needsLookup: false,
    note: '비교 대상 제품 각각의 자료를 인용해 항목별로 답하세요. 한쪽 제품의 자료만으로 둘을 비교하지 마세요.',
  },
  단체_견적_질문: {
    channelSensitive: false,
    productSpecific: false,
    needsLookup: false,
    note: '수량·사양에 따라 견적이 달라지는 건이므로, 자료로 확인되는 범위를 밝힌 뒤 견적 문의 창구로 안내하세요.',
  },
  문의_연락처_질문: { channelSensitive: false, productSpecific: false, needsLookup: false },

  효능_건강_질문: {
    channelSensitive: false,
    productSpecific: false,
    needsLookup: false,
    note: '의학적 효과·개인 신체 상태 판단은 자료 범위 밖입니다. 규칙 4의 안내 문구를 쓰고, 제품 사양만 사실대로 덧붙이세요. 효과가 있다/없다를 단정하지 마세요.',
  },
  타사_비교_질문: {
    channelSensitive: false,
    productSpecific: false,
    needsLookup: false,
    note: '타사 제품 정보는 자료에 없습니다. 소울매트 제품의 사양만 사실대로 밝히고, 우열을 말하지 마세요.',
  },

  재고_수량_질문: {
    channelSensitive: true,
    productSpecific: true,
    needsLookup: true,
    note: '실시간 재고는 공개 자료로 알 수 없습니다. "자료에 없다"가 아니라 "재고는 각 판매 페이지에서 실시간으로 확인하실 수 있습니다"로 안내하세요.',
  },
  재입고_일정_질문: {
    channelSensitive: false,
    productSpecific: true,
    needsLookup: true,
    note: '재입고 일정은 공개 자료에 없습니다. 해당 제품이 자료에 있으면 그 사실만 밝히고, 일정은 고객센터·톡톡으로 안내하세요.',
  },
  주문_상태_질문: {
    channelSensitive: false,
    productSpecific: false,
    needsLookup: true,
    note: '개별 주문·접수 내역은 조회할 수 없습니다. 자료를 뒤지지 말고 곧바로 고객센터·네이버 톡톡 확인을 안내하세요.',
  },

  기타: { channelSensitive: false, productSpecific: false, needsLookup: false },
}

/**
 * 규칙 목록. **위에서부터 먼저 맞는 것이 이긴다.**
 *
 * 순서가 곧 우선순위다. "지금 재고 몇 개 남았나요"는 재고 규칙과 수량 규칙에 다 걸리므로
 * 좁은 쪽(재고_수량)을 위에 둔다. 새 규칙은 아무 데나 넣지 말고, 기존 규칙보다
 * 좁으면 위에, 넓으면 아래에 넣어야 한다.
 */
const RULES: [Intent, RegExp][] = [
  // ── 조회가 필요한 것 (가장 좁다. 먼저 걸러야 아래 상품 규칙에 먹히지 않는다)
  ['주문_상태_질문', /주문\s?(번호|내역|상태|확인)|배송\s?조회|송장|운송장|접수\s?(됐|되었|됬|했)|접수됐나|리뷰\s?인증|적립\s?(됐|되었)|입금\s?확인/],
  ['재입고_일정_질문', /재입고|입고\s?(언제|일정|예정|되나|되면)|품절.*(언제|다시)|다시\s?(들어|나오)/],
  ['재고_수량_질문', /재고|몇\s?개\s?(남|있)|남았나|수량\s?(확인|있)|품절인가|살\s?수\s?있나요.*재고/],

  // ── 자료 밖
  ['효능_건강_질문', /디스크|허리\s?(아|통증)|무릎\s?(아|통증)|어깨\s?(아|통증)|통증\s?(완화|개선|도움)|치료|재활|교정|임신|임산부|수술|질환|자세\s?교정.*되나|살\s?빠|다이어트\s?효과|효과\s?(있|없)/],
  ['타사_비교_질문', /루루레몬|lululemon|만두카|manduka|얼라인|alignment|젤리코어|다른\s?브랜드|타사|경쟁\s?(사|제품)/i],

  // ── 채널·단체
  ['단체_견적_질문', /단체|대량|도매|요가원.*(주문|납품|견적)|렌탈|렌털|견적|b2b/i],
  // '있나요?'로 끝난다고 취급 문의가 아니다. "쿠션감이 있나요?", "색상은 뭐가 있나요?"까지
  // 삼켜서 엉뚱한 의도가 붙었다. 취급 여부를 묻는 말만 남긴다.
  ['채널_취급_질문', /파나요|파시나요|판매\s?(하|되|중|처)|취급|입점|들어\s?왔|도\s?있나요/],

  // ── 배송·반품·교환
  ['배송_비용_질문', /배송비|배송\s?(료|비용)|무료\s?배송|택배비|얼마\s?이상.*무료/],
  ['배송_기간_질문', /언제\s?(받|오|도착|배송)|며칠\s?(걸|안에\s?받)|배송\s?(기간|소요|얼마나)|얼마나\s?걸/],
  ['반품_기한_질문', /반품.*(며칠|기한|기간|언제까지|몇\s?일)|환불.*(며칠|기한|기간|언제까지)|청약\s?철회/],
  ['반품_비용_질문', /반품.*(비용|얼마|배송비|부담)|환불.*(비용|얼마|수수료)|단순\s?변심|반송비/],
  ['교환_방법_질문', /교환/],

  // ── 제품 속성 (관리·환경을 가격·색상보다 위에 둔다. "세탁"이 더 좁다)
  ['관리_세탁_질문', /세탁|세척|빨아|빨래|건조|세제|유연제|탈수|관리\s?(법|방법)|보관\s?(법|방법)|손질/],
  ['사용_환경_질문', /야외|실외|해변|모래|잔디|바닥|마룻|카펫|맨바닥|미끄|땀|습기|여행|캠핑|쿠션감/],
  ['상품_치수_질문', /사이즈|크기|치수|가로|세로|길이|너비|폭|두께|mm|cm|무게|몇\s?kg|얼마나\s?(큰|커|두꺼)/i],
  ['상품_색상_질문', /색상|색깔|무슨\s?색|컬러|색이|민무늬|패턴|옴그레이|블루레이크|베이지/],
  ['상품_재질_질문', /재질|소재|성분|천연고무|tpe|pvc|코르크|황마|스웨이드|마이크로화이바|후면|뒷면|앞면/i],
  ['상품_비교_질문', /차이|다른\s?점|뭐가\s?(다른|달라|나은)|다른가요|비교|vs|보다\s?(나은|좋|낫)|어떤\s?걸|어느\s?쪽|둘\s?중/i],
  ['상품_가격_질문', /가격|얼마|값|원인가요|비싼|저렴|할인|세일|쿠폰/],

  ['문의_연락처_질문', /고객센터|연락처|전화\s?번호|톡톡|문의\s?(방법|처|하려)|상담/],
]

export type Classification = {
  intent: Intent
  policy: IntentPolicy
  /** 어느 규칙이 잡았는지. 분류가 틀렸을 때 되짚기 위한 것이다. */
  matched: string | null
}

export function classify(question: string): Classification {
  for (const [intent, re] of RULES) {
    const m = re.exec(question)
    if (m) return { intent, policy: POLICY[intent], matched: m[0] }
  }
  return { intent: '기타', policy: POLICY['기타'], matched: null }
}

/**
 * 분류 결과를 프롬프트에 얹을 문장으로 바꾼다.
 * 경로를 바꾸지 않고 지시만 더한다 — 답은 여전히 자료가 만든다.
 */
export function intentDirective(c: Classification): string[] {
  if (c.intent === '기타') return []

  const lines = [`[의도] ${c.intent}`]
  if (c.policy.needsLookup) {
    lines.push(
      '이 의도는 공개 자료로는 원리상 확인할 수 없는 내용입니다. 자료에서 비슷한 내용을 찾아 끼워 맞추지 말고, 확인할 수 있는 곳을 안내하세요.',
    )
  }
  if (c.policy.channelSensitive) {
    lines.push(
      '이 의도는 자사몰(soulmat.kr)과 네이버 스마트스토어의 값이 다릅니다. 질문에 채널이 없으면 두 채널을 모두 밝히고, 각각 어느 자료에서 나온 값인지 번호를 다세요.',
    )
  }
  if (c.policy.productSpecific) {
    lines.push(
      '이 의도는 제품마다 값이 다릅니다. 자료에 적힌 정확한 제품명을 쓰고, 한 제품의 값을 다른 제품이나 전체로 넓히지 마세요.',
    )
  }
  if (c.policy.note) lines.push(c.policy.note)
  return lines
}
