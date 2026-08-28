export type Chunk = {
  id: string
  text: string
  url: string
  section: string
  vector: number[]
}

export type DocStore = {
  model: string
  dim: number
  builtAt: string
  source: string
  chunks: Chunk[]
}

export type Hit = {
  chunk: Chunk
  cosine: number
  bm25: number
  score: number
}

export type Retrieval = {
  hits: Hit[]
  maxCosine: number
  weakEvidence: boolean
}

/** LLM-as-a-Judge 판정 6필드 */
export type Judgement = {
  grounded: boolean
  cited: boolean
  refusal: boolean
  relevance: 0 | 1 | 2
  verdict: 'pass' | 'warn' | 'fail'
  reason: string
}
