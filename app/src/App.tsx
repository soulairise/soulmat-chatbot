import { useEffect, useMemo, useRef, useState } from 'react'
import { BM25, TOP_K, WEAK_EVIDENCE_THRESHOLD, retrieve } from './lib/rag'
import { CHAT_MODEL, EMBED_MODEL, checkOllama, embedQuery, streamChat } from './lib/ollama'
import type { OllamaStatus } from './lib/ollama'
import { buildSystemPrompt, buildUserPrompt } from './lib/prompt'
import { judge } from './lib/judge'
import type { DocStore, Hit, Judgement, Retrieval } from './lib/types'
import './styles.css'

type Stage = 'idle' | 'embedding' | 'retrieving' | 'generating' | 'judging' | 'done' | 'error'

type Turn = {
  id: number
  question: string
  answer: string
  retrieval?: Retrieval
  judgement?: Judgement
  stage: Stage
  error?: string
  feedback?: 'up' | 'down'
}

const EXAMPLES = [
  '배송비가 얼마인가요?',
  '트래블매트 색상은 뭐가 있나요?',
  '요가매트 세탁해도 되나요?',
  '반품은 며칠 안에 해야 하나요?',
  '리포머 매트 가격 알려주세요',
  '허리디스크에 도움이 되나요?',
]

const STAGE_LABEL: Record<Stage, string> = {
  idle: '',
  embedding: '질문을 임베딩하는 중',
  retrieving: '근거 청크를 검색하는 중',
  generating: '답변을 생성하는 중',
  judging: '답변을 판정하는 중',
  done: '',
  error: '',
}

export default function App() {
  const [store, setStore] = useState<DocStore | null>(null)
  const [storeError, setStoreError] = useState<string>()
  const [status, setStatus] = useState<OllamaStatus>({ state: 'checking' })
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState<{ turn: Turn } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}soulmat-docs.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setStore)
      .catch((e) => setStoreError(String(e)))
  }, [])

  useEffect(() => {
    checkOllama().then(setStatus)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  const bm25 = useMemo(() => (store ? new BM25(store.chunks) : null), [store])

  const patch = (id: number, p: Partial<Turn>) =>
    setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)))

  async function ask(question: string) {
    if (!store || !bm25 || busy) return
    const q = question.trim()
    if (!q) return

    const id = Date.now()
    setTurns((ts) => [...ts, { id, question: q, answer: '', stage: 'embedding' }])
    setInput('')
    setBusy(true)

    const ac = new AbortController()
    abortRef.current = ac

    try {
      const qv = await embedQuery(q)

      patch(id, { stage: 'retrieving' })
      const r = retrieve(store, bm25, q, qv, TOP_K)
      patch(id, { retrieval: r, stage: 'generating' })

      let acc = ''
      const answer = await streamChat(
        [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: buildUserPrompt(q, r) },
        ],
        (t) => {
          acc += t
          patch(id, { answer: acc })
        },
        ac.signal,
      )

      patch(id, { answer, stage: 'judging' })
      try {
        const j = await judge(q, answer, r, ac.signal)
        patch(id, { judgement: j, stage: 'done' })
      } catch {
        // 판정 실패는 답변 자체를 무효로 만들지 않는다. 판정 없음으로 남긴다.
        patch(id, { stage: 'done' })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('abort')) patch(id, { stage: 'done', error: '사용자가 취소했습니다.' })
      else patch(id, { stage: 'error', error: msg })
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  const cancel = () => abortRef.current?.abort()

  return (
    <div className="page">
      <Intro store={store} storeError={storeError} />
      <StatusBar status={status} onRecheck={() => { setStatus({ state: 'checking' }); checkOllama().then(setStatus) }} />

      <section className="chat" aria-label="챗봇 대화">
        {turns.length === 0 && (
          <div className="examples">
            <p className="examples-title">이렇게 물어보세요. 마지막 질문은 일부러 자료 밖 질문입니다.</p>
            <div className="chips">
              {EXAMPLES.map((e) => (
                <button key={e} className="chip" onClick={() => ask(e)} disabled={busy || !store}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t) => (
          <TurnView key={t.id} turn={t} onOpen={() => setModal({ turn: t })} onFeedback={(f) => patch(t.id, { feedback: f })} />
        ))}
        <div ref={bottomRef} />
      </section>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          ask(input)
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              ask(input)
            }
          }}
          placeholder={store ? '소울매트 제품·배송·교환에 대해 물어보세요' : '자료를 불러오는 중…'}
          disabled={!store || busy}
          aria-label="질문 입력"
        />
        {busy ? (
          <button type="button" className="btn-cancel" onClick={cancel}>
            취소
          </button>
        ) : (
          <button type="submit" disabled={!store || !input.trim()}>
            질문
          </button>
        )}
      </form>

      {modal && <EvidenceModal turn={modal.turn} onClose={() => setModal(null)} />}
      <Footer store={store} />
    </div>
  )
}

/* ---------------- 소개 ---------------- */

function Intro({ store, storeError }: { store: DocStore | null; storeError?: string }) {
  return (
    <header className="intro">
      <p className="eyebrow">soulmat.kr 공개 자료 기반</p>
      <h1>소울매트 구매 안내 챗봇</h1>
      <p className="lede">
        요가매트 전문 브랜드 <strong>소울매트</strong>의 제품·배송·교환 안내를 자사몰 공개 자료에
        근거해서만 답합니다. 답변마다 <strong>어느 자료를 근거로 삼았는지</strong>와{' '}
        <strong>그 답을 어떻게 판정했는지</strong>를 함께 보여줍니다.
      </p>
      <ul className="scope">
        <li>
          <span>답할 수 있는 것</span>
          제품 종류·가격·색상·소재, 세탁과 사용법, 배송비와 배송기간, 교환·반품·환불 조건,
          구매 채널과 문의 방법
        </li>
        <li>
          <span>답하지 않는 것</span>
          의학적 효과, 통증·질환 상담, 타사 제품 비교, 요가 자세 지도, 자사몰 자료에 없는 재고·프로모션
        </li>
      </ul>
      {storeError && <p className="err">자료를 불러오지 못했습니다: {storeError}</p>}
      {store && (
        <p className="meta">
          자료 {store.chunks.length}개 청크 · 임베딩 {store.model} {store.dim}차원 · 수집{' '}
          {new Date(store.builtAt).toLocaleDateString('ko-KR')}
        </p>
      )}
    </header>
  )
}

/* ---------------- 상태 ---------------- */

function StatusBar({ status, onRecheck }: { status: OllamaStatus; onRecheck: () => void }) {
  if (status.state === 'checking') return <div className="status checking">Ollama 연결을 확인하는 중…</div>

  if (status.state === 'ready')
    return (
      <div className="status ok">
        Ollama 연결됨 · 생성 <code>{CHAT_MODEL}</code> · 임베딩 <code>{EMBED_MODEL}</code>
      </div>
    )

  if (status.state === 'no-model')
    return (
      <div className="status warn">
        <p>Ollama는 실행 중이지만 필요한 모델이 없습니다: {status.missing.join(', ')}</p>
        <pre>{status.missing.map((m) => `ollama pull ${m}`).join('\n')}</pre>
        <button onClick={onRecheck}>다시 확인</button>
      </div>
    )

  return (
    <div className="status err">
      <p>
        <strong>Ollama에 연결하지 못했습니다.</strong> 이 페이지는 서버에서 답을 만들지 않고,
        보고 계신 컴퓨터의 Ollama가 답변을 생성합니다. 아래 3가지를 확인해 주세요.
      </p>
      <ol>
        <li>
          Ollama 설치 후 실행 — <a href="https://ollama.com/download" target="_blank" rel="noreferrer">ollama.com/download</a>
        </li>
        <li>
          모델 준비
          <pre>{`ollama pull ${CHAT_MODEL}\nollama pull ${EMBED_MODEL}`}</pre>
        </li>
        <li>
          이 페이지 주소에서의 호출 허용 (CORS)
          <pre>{`# macOS / Linux\nlaunchctl setenv OLLAMA_ORIGINS "${location.origin}"   # macOS\nexport OLLAMA_ORIGINS="${location.origin}"             # Linux\n# 설정 후 Ollama 재시작`}</pre>
        </li>
      </ol>
      <p className="dim">오류: {status.error}</p>
      <button onClick={onRecheck}>다시 확인</button>
    </div>
  )
}

/* ---------------- 한 턴 ---------------- */

function TurnView({
  turn,
  onOpen,
  onFeedback,
}: {
  turn: Turn
  onOpen: () => void
  onFeedback: (f: 'up' | 'down') => void
}) {
  const r = turn.retrieval
  const working = turn.stage !== 'done' && turn.stage !== 'error' && turn.stage !== 'idle'

  return (
    <article className="turn">
      <div className="q">{turn.question}</div>

      {working && (
        <div className="stage">
          <span className="dot" />
          {STAGE_LABEL[turn.stage]}
        </div>
      )}

      {r && r.weakEvidence && (
        <div className="weak">
          약한 근거 — 질문과 자료의 최고 유사도가 {r.maxCosine.toFixed(3)}으로 기준(
          {WEAK_EVIDENCE_THRESHOLD}) 아래입니다. 아래 답변은 자료가 질문에 직접 답하지 못할 수
          있다는 전제로 읽어 주세요.
        </div>
      )}

      {turn.answer && <div className="a">{turn.answer}</div>}

      {turn.error && <div className="turn-err">{turn.error}</div>}

      {r && (
        <div className="sources">
          <span className="sources-label">근거</span>
          {r.hits.map((h, i) => (
            <a key={h.chunk.id} className="src" href={h.chunk.url} target="_blank" rel="noreferrer" title={h.chunk.text}>
              [{i + 1}] {h.chunk.id} · {h.chunk.section}
            </a>
          ))}
          <button className="link" onClick={onOpen}>
            검색 단계 보기
          </button>
        </div>
      )}

      {turn.judgement && <JudgeBadge j={turn.judgement} />}

      {turn.stage === 'done' && turn.answer && (
        <div className="feedback">
          <span>이 답변이 도움이 되었나요?</span>
          <button className={turn.feedback === 'up' ? 'on' : ''} onClick={() => onFeedback('up')}>
            도움됨
          </button>
          <button className={turn.feedback === 'down' ? 'on' : ''} onClick={() => onFeedback('down')}>
            아쉬움
          </button>
          {turn.feedback && turn.judgement && (
            <em>
              사람 판단 {turn.feedback === 'up' ? '도움됨' : '아쉬움'} / 자동 판정{' '}
              {turn.judgement.verdict}
              {(turn.feedback === 'up') !== (turn.judgement.verdict === 'pass') && ' — 두 판단이 엇갈립니다'}
            </em>
          )}
        </div>
      )}
    </article>
  )
}

/* ---------------- 판정 배지 (6필드) ---------------- */

function JudgeBadge({ j }: { j: Judgement }) {
  const F = ({ label, ok, value }: { label: string; ok: boolean; value: string }) => (
    <span className={`f ${ok ? 'y' : 'n'}`}>
      <b>{label}</b>
      {value}
    </span>
  )
  return (
    <div className={`judge ${j.verdict}`}>
      <div className="fields">
        <F label="verdict" ok={j.verdict === 'pass'} value={j.verdict} />
        <F label="grounded" ok={j.grounded} value={j.grounded ? '예' : '아니오'} />
        <F label="cited" ok={j.cited} value={j.cited ? '예' : '아니오'} />
        <F label="refusal" ok value={j.refusal ? '거절' : '응답'} />
        <F label="relevance" ok={j.relevance === 2} value={String(j.relevance)} />
      </div>
      <p className="reason">
        <b>reason</b> {j.reason}
      </p>
    </div>
  )
}

/* ---------------- 근거 모달 ---------------- */

function EvidenceModal({ turn, onClose }: { turn: Turn; onClose: () => void }) {
  const r = turn.retrieval
  if (!r) return null
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="검색 단계">
        <header>
          <h2>검색 단계</h2>
          <button onClick={onClose} aria-label="닫기">
            닫기
          </button>
        </header>
        <p className="modal-q">{turn.question}</p>
        <p className="modal-meta">
          최고 코사인 {r.maxCosine.toFixed(4)} · 기준 {WEAK_EVIDENCE_THRESHOLD} ·{' '}
          {r.weakEvidence ? '약한 근거' : '충분한 근거'} · 상위 {r.hits.length}개
        </p>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>id</th>
              <th>코사인</th>
              <th>BM25</th>
              <th>hybrid</th>
              <th>본문</th>
            </tr>
          </thead>
          <tbody>
            {r.hits.map((h: Hit, i) => (
              <tr key={h.chunk.id}>
                <td>{i + 1}</td>
                <td>
                  <a href={h.chunk.url} target="_blank" rel="noreferrer">
                    {h.chunk.id}
                  </a>
                </td>
                <td>{h.cosine.toFixed(3)}</td>
                <td>{h.bm25.toFixed(2)}</td>
                <td>{h.score.toFixed(3)}</td>
                <td className="tx">{h.chunk.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Footer({ store }: { store: DocStore | null }) {
  return (
    <footer className="foot">
      <p>
        이 챗봇은 서버에서 답을 만들지 않습니다. 페이지를 연 컴퓨터의 Ollama가 답변을 생성하고,
        질문 임베딩도 같은 Ollama가 처리합니다. 대화 내용은 어디에도 저장되지 않습니다.
      </p>
      {store && <p className="dim">자료 출처: {store.source} · 이 챗봇은 소울매트 공식 상담 창구가 아닙니다.</p>}
    </footer>
  )
}
