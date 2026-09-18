#!/usr/bin/env node
// 문서 벡터 생성기 — OpenAI text-embedding-3-small (1536차원)
//
// 키는 저장소에 두지 않는다. 아래 순서로 찾는다.
//   1) 환경변수 OPENAI_API_KEY
//   2) macOS 키체인  (security find-generic-password -a "$USER" -s soulmat-openai -w)
// 둘 다 없으면 무엇을 해야 하는지 알려 주고 멈춘다.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { EMBED_MODEL, EMBED_DIM, docPrompt } from '../src/lib/embedPrompt.mjs'

function apiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim()
  try {
    return execFileSync(
      'security',
      ['find-generic-password', '-a', process.env.USER, '-s', 'soulmat-openai', '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    console.error(
      '키를 찾을 수 없습니다.\n' +
        '  export OPENAI_API_KEY=... 하거나\n' +
        '  security add-generic-password -a "$USER" -s soulmat-openai -U -w\n' +
        '  로 키체인에 넣어 주세요.',
    )
    process.exit(1)
  }
}

const KEY = apiKey()
// 발급처가 자체 게이트웨이를 쓰면 OPENAI_BASE_URL 로 지정한다.
const BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')

async function embed(inputs) {
  const r = await fetch(`${BASE_URL}/embeddings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
  })
  if (!r.ok) {
    const body = await r.text()
    // 키가 틀렸을 때 본문에 키 일부가 실려 온다. 화면·로그에 그대로 남기지 않는다.
    throw new Error(`OpenAI ${r.status}: ${body.replace(/sk-[A-Za-z0-9_-]{4,}/g, 'sk-***').slice(0, 200)}`)
  }
  const j = await r.json()
  // 순서 보장은 index 로 확인한다. 배치가 섞이면 청크와 벡터가 어긋난다.
  return j.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
}

const chunks = JSON.parse(readFileSync(new URL('../src/data/chunks.source.json', import.meta.url)))
console.log(`청크 ${chunks.length}개 · 모델 ${EMBED_MODEL} · 주소 ${BASE_URL}`)

const out = []
const BATCH = 32 // OpenAI 는 배열 입력을 받는다. Ollama 때(8)보다 크게 잡아도 된다
for (let i = 0; i < chunks.length; i += BATCH) {
  const slice = chunks.slice(i, i + BATCH)
  const vecs = await embed(slice.map(docPrompt))
  slice.forEach((c, k) => {
    const v = vecs[k]
    if (v.length !== EMBED_DIM) throw new Error(`${c.id}: 차원 ${v.length} (기대 ${EMBED_DIM})`)
    out.push({
      id: c.id,
      text: c.text,
      url: c.url,
      section: c.section,
      // 소수점 6자리로 자른다. 1536차원 × 82청크라 파일이 커진다 — 검색 품질에는 영향이 없다.
      vector: v.map((x) => +x.toFixed(6)),
    })
  })
  process.stdout.write(`\r  임베딩 ${Math.min(i + BATCH, chunks.length)}/${chunks.length}`)
}
console.log()

const payload = {
  model: EMBED_MODEL,
  dim: EMBED_DIM,
  builtAt: new Date().toISOString(),
  source: 'soulmat.kr 공개 페이지',
  chunks: out,
}
writeFileSync(new URL('../public/soulmat-docs.json', import.meta.url), JSON.stringify(payload))
const mb = (JSON.stringify(payload).length / 1e6).toFixed(1)
console.log(`완료: public/soulmat-docs.json (${out.length}개 · ${EMBED_DIM}차원 · ${mb}MB)`)
if (mb > 4) {
  console.log('⚠ 파일이 큽니다. 첫 방문에 이만큼 내려받습니다. 차원 축소(dimensions 파라미터)를 검토하세요.')
}
