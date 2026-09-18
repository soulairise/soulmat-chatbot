/**
 * 모델 호출 한 곳.
 *
 * 브라우저는 **프록시**를 부른다(`worker/`). 키가 없어야 하기 때문이다.
 * Node(평가 스크립트)는 OpenAI 를 **직접** 부른다. 그쪽은 키가 환경변수에 있고
 * 프록시를 거칠 이유가 없다.
 *
 * 이전에는 각자 컴퓨터의 Ollama(qwen3.5:2b)가 답을 만들었다. 링크만 주면 팀원이
 * 바로 쓰게 하려고 바꿨다 — Ollama 방식은 보는 사람마다 설치·모델 2.5GB·CORS 설정이
 * 필요했다. `ollama.ts` 는 지우지 않고 남겨 두었다. 로컬에서 비용 없이 돌려 볼 때 쓴다.
 */

/**
 * Node 환경변수를 브라우저 빌드에서도 안전하게 읽는다.
 * 브라우저에는 `process` 가 없으므로 타입을 직접 좁혀 둔다 (@types/node 를 끌어오면
 * 브라우저 코드에 Node 전역이 다 딸려 들어온다).
 */
const nodeEnv = (k: string): string => {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return p?.env?.[k] ?? ''
}

/** Node 직접 호출의 기준 주소. 게이트웨이를 쓰면 OPENAI_BASE_URL 로 덮어쓴다. */
const DIRECT = (nodeEnv('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/$/, '')

/** 브라우저 빌드에 박히는 값. 키가 아니라 프록시 **주소**다. 공개되어도 무방하다. */
const PROXY_URL: string = (import.meta.env?.VITE_PROXY_URL as string) ?? ''

/** Node 에서만 값이 있다. 브라우저 번들에는 들어가지 않는다. */
const NODE_KEY: string = nodeEnv('OPENAI_API_KEY')

// 임베딩 모델·차원은 `embedPrompt.mjs` 하나에서만 정한다.
// 빌드(embed.mjs)와 런타임(여기)이 다른 값을 쓰면 벡터 공간이 조용히 어긋난다.
export { EMBED_DIM } from './embedPrompt.mjs'
import { EMBED_MODEL, queryPrompt } from './embedPrompt.mjs'
export { EMBED_MODEL }

/**
 * gpt-5.6 계열은 `temperature: 0` 을 거부한다 (기본값 1 만 허용).
 * 그래서 이 파일은 temperature 를 **아예 보내지 않는다.**
 *
 * 대가가 있다. Ollama 시절에는 temperature=0 이라 같은 질문에 같은 답이 나왔고,
 * 그래서 23문항 평가가 회차마다 완전히 재현됐다(폭 0.0%p). 이제는 재현되지 않는다.
 * **설정을 비교할 때는 반드시 `--repeat 3` 이상으로 재고 폭부터 볼 것.**
 */
export const CHAT_MODEL = 'gpt-5.6-terra'

const CODE_KEY = 'soulmat-chatbot-access-code'

export const getAccessCode = (): string => {
  try {
    return localStorage.getItem(CODE_KEY) ?? ''
  } catch {
    return ''
  }
}

export const setAccessCode = (code: string): void => {
  try {
    localStorage.setItem(CODE_KEY, code.trim())
  } catch {
    /* 사생활 보호 모드 등에서 저장이 막힐 수 있다. 그 세션 동안만 못 쓸 뿐이라 넘어간다. */
  }
}

const useDirect = () => Boolean(NODE_KEY)

function endpoint(kind: 'chat' | 'embed'): string {
  if (useDirect()) return kind === 'chat' ? `${DIRECT}/chat/completions` : `${DIRECT}/embeddings`
  return `${PROXY_URL.replace(/\/$/, '')}/${kind}`
}

function headers(): Record<string, string> {
  if (useDirect()) {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${NODE_KEY}` }
  }
  return { 'Content-Type': 'application/json', 'X-Access-Code': getAccessCode() }
}

/* ---------- 상태 ---------- */

export type BackendStatus =
  | { state: 'checking' }
  | { state: 'ready' }
  | { state: 'need-code' }
  | { state: 'no-proxy' }
  | { state: 'offline'; error: string }

/**
 * 접속코드가 맞는지 **가장 싼 호출**로 확인한다.
 * 짧은 문자열 임베딩 한 번이면 401 인지 200 인지 갈린다. 생성 호출로 확인하면 돈이 더 든다.
 */
export async function checkBackend(): Promise<BackendStatus> {
  if (useDirect()) return { state: 'ready' }
  if (!PROXY_URL) return { state: 'no-proxy' }
  if (!getAccessCode()) return { state: 'need-code' }
  try {
    const r = await fetch(endpoint('embed'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ input: 'ping' }),
    })
    if (r.status === 401) return { state: 'need-code' }
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return { state: 'ready' }
  } catch (e) {
    return { state: 'offline', error: e instanceof Error ? e.message : String(e) }
  }
}

/* ---------- 임베딩 ---------- */

/** 문서와 질의가 같은 공간에 있어야 한다. 양쪽 다 이 함수를 쓴다. */
export async function embed(input: string | string[]): Promise<number[][]> {
  const r = await fetch(endpoint('embed'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(useDirect() ? { model: EMBED_MODEL, input } : { input }),
  })
  if (!r.ok) throw new Error(`임베딩 실패 (${r.status}): ${await r.text()}`)
  const j = await r.json()
  // 직접 호출은 OpenAI 형식, 프록시는 {embeddings} 로 줄여서 준다.
  return useDirect() ? j.data.map((d: { embedding: number[] }) => d.embedding) : j.embeddings
}

export const embedQuery = async (q: string): Promise<number[]> => (await embed(queryPrompt(q)))[0]

/* ---------- 생성 ---------- */

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

/** 스트리밍 생성. onToken 으로 조각을 흘려보내고 최종 전체 문자열을 반환한다. */
export async function streamChat(
  messages: ChatMessage[],
  onToken: (t: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const r = await fetch(endpoint('chat'), {
    method: 'POST',
    headers: headers(),
    signal,
    body: JSON.stringify(
      useDirect()
        ? { model: CHAT_MODEL, messages, stream: true }   // temperature 는 보내지 않는다 (아래 주석)
        : { messages },
    ),
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
      const s = line.trim()
      if (!s.startsWith('data:')) continue
      const payload = s.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const t = JSON.parse(payload).choices?.[0]?.delta?.content
        if (t) {
          full += t
          onToken(t)
        }
      } catch {
        /* SSE 조각이 줄 경계에서 잘릴 수 있다. 다음 덩어리와 합쳐지므로 넘어간다. */
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
  const response_format = {
    type: 'json_schema',
    json_schema: { name: 'judgement', strict: true, schema },
  }
  const r = await fetch(endpoint('chat'), {
    method: 'POST',
    headers: headers(),
    signal,
    body: JSON.stringify(
      useDirect()
        ? { model: CHAT_MODEL, messages, response_format }
        : { messages, response_format },
    ),
  })
  if (!r.ok) throw new Error(`판정 실패 (${r.status}): ${await r.text()}`)
  const j = await r.json()
  return JSON.parse(j.choices[0].message.content) as T
}
