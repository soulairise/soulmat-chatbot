// EmbeddingGemma 프리픽스 규약 — 빌드(Node)와 런타임(브라우저)이 반드시 공유해야 하는 파일.
// 문서와 질의에 서로 다른 프리픽스를 붙이지 않으면 같은 모델이라도 벡터 공간이 어긋난다.
export const EMBED_MODEL = 'embeddinggemma:300m'
export const EMBED_DIM = 768

export const docPrompt = (c) => `title: ${c.section || 'none'} | text: ${c.text}`
export const queryPrompt = (q) => `task: search result | query: ${q}`
