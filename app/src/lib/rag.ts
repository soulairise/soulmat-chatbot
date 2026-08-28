import type { Chunk, DocStore, Hit, Retrieval } from './types'

/** 최고 코사인 유사도가 이 값 미만이면 '약한 근거'로 표시한다 (교안 기준). */
export const WEAK_EVIDENCE_THRESHOLD = 0.55
export const TOP_K = 5
/** 하이브리드 가중치: 의미(코사인) 우선, 정확한 표기(BM25) 보완 */
export const COSINE_WEIGHT = 0.7
export const BM25_WEIGHT = 0.3

/* ---------- 벡터 검색 ---------- */

const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0))

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  const d = norm(a) * norm(b)
  return d === 0 ? 0 : dot / d
}

/* ---------- BM25 (한국어 대응 토크나이저) ---------- */

/**
 * 한국어는 조사가 붙어 어절 단위 완전일치가 잘 안 된다.
 * 어절 토큰 + 한글 2-gram을 함께 넣어 '배송비는' / '배송비' 를 잇는다.
 */
export function tokenize(s: string): string[] {
  const words = (s.toLowerCase().match(/[가-힣]+|[a-z]+|\d+/g) || [])
  const out: string[] = []
  for (const w of words) {
    out.push(w)
    if (/[가-힣]/.test(w) && w.length > 1) {
      for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2))
    }
  }
  return out
}

const K1 = 1.2
const B = 0.75

export class BM25 {
  private df = new Map<string, number>()
  private docs: string[][] = []
  private avgdl = 0
  private N = 0

  constructor(chunks: Chunk[]) {
    this.docs = chunks.map((c) => tokenize(`${c.section} ${c.text}`))
    this.N = this.docs.length
    this.avgdl = this.docs.reduce((s, d) => s + d.length, 0) / Math.max(1, this.N)
    for (const d of this.docs) {
      for (const t of new Set(d)) this.df.set(t, (this.df.get(t) || 0) + 1)
    }
  }

  private idf(t: string) {
    const n = this.df.get(t) || 0
    return Math.log(1 + (this.N - n + 0.5) / (n + 0.5))
  }

  scoreAll(query: string): number[] {
    const q = tokenize(query)
    return this.docs.map((doc) => {
      const dl = doc.length
      const tf = new Map<string, number>()
      for (const t of doc) tf.set(t, (tf.get(t) || 0) + 1)
      let s = 0
      for (const t of new Set(q)) {
        const f = tf.get(t) || 0
        if (!f) continue
        s += this.idf(t) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * dl) / this.avgdl)))
      }
      return s
    })
  }
}

/* ---------- 하이브리드 검색 ---------- */

const minmax = (xs: number[]) => {
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  return xs.map((x) => (hi - lo < 1e-9 ? 0 : (x - lo) / (hi - lo)))
}

export function retrieve(
  store: DocStore,
  bm25: BM25,
  query: string,
  queryVector: number[],
  topK = TOP_K,
): Retrieval {
  const cos = store.chunks.map((c) => cosine(queryVector, c.vector))
  const lex = bm25.scoreAll(query)
  const cosN = minmax(cos)
  const lexN = minmax(lex)

  const hits: Hit[] = store.chunks.map((chunk, i) => ({
    chunk,
    cosine: cos[i],
    bm25: lex[i],
    score: COSINE_WEIGHT * cosN[i] + BM25_WEIGHT * lexN[i],
  }))

  hits.sort((a, b) => b.score - a.score)
  const top = hits.slice(0, topK)
  // 약한 근거 판정은 정규화 전 '원본' 코사인 값으로 한다.
  // 정규화 값은 항상 1이 나오므로 임계값의 의미가 사라진다.
  const maxCosine = Math.max(...cos)

  return { hits: top, maxCosine, weakEvidence: maxCosine < WEAK_EVIDENCE_THRESHOLD }
}
