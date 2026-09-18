/**
 * 소울매트 챗봇 — OpenAI 프록시
 *
 * 브라우저는 OpenAI 를 직접 부르지 않는다. 이 워커를 부르고, 워커가 키를 붙여 대신 부른다.
 * 키는 Cloudflare 시크릿에만 있고 저장소와 빌드 산출물 어디에도 없다.
 *
 * 하는 일은 셋뿐이다 — 접속코드 확인, 모델 고정, OpenAI 로 중계.
 * 프롬프트와 판정은 프런트엔드에 그대로 둔다. 여기서 답을 만들지 않는다.
 */

export interface Env {
  OPENAI_API_KEY: string
  /** 기본은 OpenAI 본사. 교육기관 게이트웨이처럼 다른 주소를 쓰면 여기만 바꾼다. */
  OPENAI_BASE_URL?: string
  ACCESS_CODE: string
  ALLOWED_ORIGINS: string
  CHAT_MODEL: string
  EMBED_MODEL: string
}

const DEFAULT_BASE = 'https://api.openai.com/v1'
const base = (env: Env) => (env.OPENAI_BASE_URL || DEFAULT_BASE).replace(/\/$/, '')

/** 허용 목록에 있는 출처에만 CORS 를 열어 준다. 목록에 없으면 헤더를 주지 않는다. */
function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  if (!allowed.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Access-Code',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

/**
 * 길이가 달라도 같은 시간이 걸리게 비교한다.
 * 짧은 접속코드라 실익은 크지 않지만, 비교 시간으로 코드를 좁혀 가는 일은 막아 둔다.
 */
function codeMatches(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diff === 0
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const h = cors(req, env)

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h })
    if (!h['Access-Control-Allow-Origin']) {
      return json({ error: '허용되지 않은 출처입니다.' }, 403, {})
    }
    if (req.method !== 'POST') return json({ error: 'POST 만 받습니다.' }, 405, h)

    if (!codeMatches(req.headers.get('X-Access-Code') ?? '', env.ACCESS_CODE)) {
      return json({ error: '접속코드가 필요합니다.' }, 401, h)
    }

    const path = new URL(req.url).pathname

    if (path === '/embed') {
      const { input } = (await req.json()) as { input: string | string[] }
      const r = await fetch(`${base(env)}/embeddings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: env.EMBED_MODEL, input }),
      })
      if (!r.ok) return json({ error: `임베딩 실패 (${r.status})` }, 502, h)
      const j = (await r.json()) as { data: { embedding: number[] }[] }
      return json({ embeddings: j.data.map((d) => d.embedding) }, 200, h)
    }

    if (path === '/chat') {
      // 모델·온도는 서버가 정한다. 클라이언트가 바꿔 비용을 키우지 못하게 한다.
      const { messages, response_format } = (await req.json()) as {
        messages: { role: string; content: string }[]
        response_format?: unknown
      }
      const stream = !response_format // 구조화 출력(판정)은 스트리밍하지 않는다
      const r = await fetch(`${base(env)}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        // temperature 를 보내지 않는다. gpt-5.6 계열은 0 을 거부한다 —
        //   "Unsupported value: 'temperature' does not support 0 with this model."
        // 기본값(1)만 받으므로 아예 빼고 모델 기본을 쓴다.
        body: JSON.stringify({
          model: env.CHAT_MODEL,
          messages,
          stream,
          ...(response_format ? { response_format } : {}),
        }),
      })
      if (!r.ok) return json({ error: `생성 실패 (${r.status})` }, 502, h)
      if (!stream) return json(await r.json(), 200, h)
      // SSE 를 그대로 흘려보낸다. 프런트엔드가 파싱한다.
      return new Response(r.body, {
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', ...h },
      })
    }

    return json({ error: '없는 경로입니다.' }, 404, h)
  },
}
