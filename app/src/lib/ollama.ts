import { EMBED_MODEL, queryPrompt } from './embedPrompt.mjs'

export const OLLAMA_URL = 'http://localhost:11434'
export const CHAT_MODEL = 'qwen3.5:2b'
export { EMBED_MODEL }

export type OllamaStatus =
  | { state: 'checking' }
  | { state: 'ready'; models: string[] }
  | { state: 'no-model'; models: string[]; missing: string[] }
  | { state: 'offline'; error: string }

export async function checkOllama(): Promise<OllamaStatus> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = await r.json()
    const models: string[] = (j.models || []).map((m: { name: string }) => m.name)
    const has = (want: string) => models.some((m) => m === want || m.startsWith(want.split(':')[0] + ':'))
    const missing = [CHAT_MODEL, EMBED_MODEL].filter((m) => !has(m))
    if (missing.length) return { state: 'no-model', models, missing }
    return { state: 'ready', models }
  } catch (e) {
    return { state: 'offline', error: e instanceof Error ? e.message : String(e) }
  }
}

/** 질의 임베딩 — 문서 벡터와 같은 모델·같은 프리픽스 규약을 쓴다. */
export async function embedQuery(q: string): Promise<number[]> {
  const r = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: queryPrompt(q) }),
  })
  if (!r.ok) throw new Error(`임베딩 실패 (${r.status}): ${await r.text()}`)
  const j = await r.json()
  return j.embeddings[0]
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

/** 스트리밍 생성. onToken 으로 조각을 흘려보내고, 최종 전체 문자열을 반환한다. */
export async function streamChat(
  messages: ChatMessage[],
  onToken: (t: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      stream: true,
      think: false,
      options: { temperature: 0, num_ctx: 4096 },
    }),
  })
  if (!r.ok) throw new Error(`생성 실패 (${r.status}): ${await r.text()}`)
  if (!r.body) throw new Error('스트림 본문이 없습니다')

  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      let j: { message?: { content?: string }; error?: string }
      try {
        j = JSON.parse(line)
      } catch {
        continue
      }
      if (j.error) throw new Error(j.error)
      const t = j.message?.content
      if (t) {
        full += t
        onToken(t)
      }
    }
  }
  return full
}

/** 구조화 출력이 필요한 단발 호출 (판정용). */
export async function chatJson<T>(
  messages: ChatMessage[],
  schema: object,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      stream: false,
      think: false,
      format: schema,
      options: { temperature: 0, num_ctx: 4096 },
    }),
  })
  if (!r.ok) throw new Error(`판정 실패 (${r.status}): ${await r.text()}`)
  const j = await r.json()
  return JSON.parse(j.message.content) as T
}
