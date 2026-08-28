#!/usr/bin/env node
// 문서 벡터 생성기 — Ollama embeddinggemma:300m (768차원)
// 교안 요구: 임베딩은 embeddinggemma-300m 768차원으로 통일
// 퍼실 조언: 브라우저 WASM 대신 Ollama 자체 임베딩 모델 사용
import { readFileSync, writeFileSync } from 'node:fs'
import { EMBED_MODEL, EMBED_DIM, docPrompt } from '../src/lib/embedPrompt.mjs'

const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434'

async function embed(inputs) {
  const r = await fetch(`${OLLAMA}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
  })
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`)
  const j = await r.json()
  return j.embeddings
}

const chunks = JSON.parse(readFileSync(new URL('../src/data/chunks.source.json', import.meta.url)))
console.log(`청크 ${chunks.length}개, 모델 ${EMBED_MODEL}`)

const out = []
const BATCH = 8
for (let i = 0; i < chunks.length; i += BATCH) {
  const slice = chunks.slice(i, i + BATCH)
  const vecs = await embed(slice.map(docPrompt))
  slice.forEach((c, k) => {
    const v = vecs[k]
    if (v.length !== EMBED_DIM) throw new Error(`${c.id}: 차원 ${v.length} (기대 ${EMBED_DIM})`)
    out.push({ id: c.id, text: c.text, url: c.url, section: c.section, vector: v.map((x) => +x.toFixed(6)) })
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
console.log(`완료: public/soulmat-docs.json (${out.length}개 · ${EMBED_DIM}차원)`)
