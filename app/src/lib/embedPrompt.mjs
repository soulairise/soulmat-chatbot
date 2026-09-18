// 임베딩 규약 — 빌드(Node)와 런타임(브라우저)이 **반드시 공유해야 하는** 파일.
// 문서와 질의를 서로 다른 방식으로 임베딩하면 같은 모델이라도 벡터 공간이 어긋난다.
//
// 2026-09-18: embeddinggemma:300m(768) → OpenAI text-embedding-3-small(1536) 으로 옮겼다.
// 이유는 성능이 아니라 **배포**다. Ollama 방식은 링크를 받은 사람마다 설치 · 모델 2.5GB ·
// CORS 설정이 필요해서, 팀원에게 링크만 줘서는 열리지 않았다.
//
// EmbeddingGemma 는 문서와 질의에 서로 다른 프리픽스(`title:` / `task: search result`)를
// 요구했지만 OpenAI 임베딩은 그런 규약이 없다. 그래서 프리픽스를 뺐다.
// 다만 **섹션 제목은 남긴다** — 같은 문장이라도 어느 장에 속하는지가 검색에 도움이 된다.
export const EMBED_MODEL = 'text-embedding-3-small'
export const EMBED_DIM = 1536

export const docPrompt = (c) => `${c.section || ''} | ${c.text}`.trim()
export const queryPrompt = (q) => q
