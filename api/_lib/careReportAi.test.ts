import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ configuration: {} as Record<string, string | undefined>, vertex: vi.fn() }))
vi.mock('./env.js', async () => {
  const { resolveCareAiConfiguration } = await import('./careAiConfig.js')
  return { env: {
    get careAiConfiguration() { return resolveCareAiConfiguration(state.configuration) },
    get geminiApiKey() { return state.configuration.GEMINI_API_KEY },
    get vertexProjectId() { return state.configuration.GOOGLE_VERTEX_PROJECT_ID },
    get vertexLocation() { return state.configuration.GOOGLE_VERTEX_LOCATION || 'us-central1' },
  } }
})
vi.mock('./vertexAuth.js', () => ({ getVertexAccessToken: state.vertex }))
import { runCareReportTurn } from './careReportAi.js'

const original = '어르신이 오늘 점심을 평소처럼 드셨어요.'
const report = { change: '점심을 평소처럼 드심', action: '확인되지 않음', result: '확인되지 않음', escalation: '추가 관찰', caregiverNote: '' }
function mockFetch(result: unknown = { needFollowup: false, question: null, missingField: null, report }) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
beforeEach(() => {
  state.configuration = { GEMINI_API_KEY: 'test-only-key' }
  state.vertex.mockReset().mockResolvedValue('test-only-token')
})
afterEach(() => { vi.unstubAllGlobals() })

describe('돌봄 AI provider 전환과 기존 반문 계약 (모든 네트워크 mock)', () => {
  it('기본 요청은 기존 Gemini 모델과 보고 응답을 유지한다', async () => {
    const request = mockFetch()
    expect(await runCareReportTurn(original, [])).toMatchObject({ needFollowup: false, usedFallback: false, report })
    expect(request.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=test-only-key')
  })
  it('gemini를 명시하면 Vertex 잔존 설정·토큰을 사용하지 않는다', async () => {
    state.configuration = { ...state.configuration, CARE_AI_PROVIDER: 'gemini', GOOGLE_VERTEX_PROJECT_ID: 'leftover-project', GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON: 'leftover-json' }
    const request = mockFetch()
    await runCareReportTurn(original, [])
    expect(request.mock.calls[0][0]).toContain('generativelanguage.googleapis.com')
    expect(state.vertex).not.toHaveBeenCalled()
  })
  it('Vertex는 선택 모델·위치와 Bearer 인증만 사용한다', async () => {
    state.configuration = { CARE_AI_PROVIDER: 'vertex', CARE_AI_MODEL: 'test-model', GOOGLE_VERTEX_PROJECT_ID: 'test-project', GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON: 'test-json', GOOGLE_VERTEX_LOCATION: 'test-region' }
    const request = mockFetch()
    await runCareReportTurn(original, [])
    expect(request.mock.calls[0][0]).toBe('https://test-region-aiplatform.googleapis.com/v1/projects/test-project/locations/test-region/publishers/google/models/test-model:generateContent')
    expect(request.mock.calls[0][1]?.headers).toMatchObject({ authorization: 'Bearer test-only-token' })
  })
  it('provider 설정 오류는 요청 전에 명확한 503을 반환한다', async () => {
    const request = mockFetch()
    for (const configuration of [
      { CARE_AI_PROVIDER: 'vertex', GEMINI_API_KEY: 'test-key', GOOGLE_VERTEX_PROJECT_ID: 'partial' },
      { CARE_AI_PROVIDER: 'wrong', GEMINI_API_KEY: 'test-key' },
      { CARE_AI_MODEL: '../invalid', GEMINI_API_KEY: 'test-key' },
    ]) {
      state.configuration = configuration
      await expect(runCareReportTurn(original, [])).rejects.toMatchObject({ statusCode: 503 })
    }
    expect(request).not.toHaveBeenCalled(); expect(state.vertex).not.toHaveBeenCalled()
  })
  it('Vertex 인증 실패 후 다른 과금·인증 경로로 자동 재시도하지 않는다', async () => {
    state.configuration = { CARE_AI_PROVIDER: 'vertex', GOOGLE_VERTEX_PROJECT_ID: 'test-project', GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON: 'test-json', GEMINI_API_KEY: 'test-key' }
    state.vertex.mockRejectedValue(new Error('test authentication failure'))
    const request = mockFetch()
    await expect(runCareReportTurn(original, [])).rejects.toMatchObject({ statusCode: 502 })
    expect(request).not.toHaveBeenCalled()
  })
  it('모델 선택만 바꿔도 반문·보고 요청 본문은 바뀌지 않는다', async () => {
    const request = mockFetch()
    await runCareReportTurn(original, [])
    state.configuration.CARE_AI_MODEL = 'test-different-model'
    await runCareReportTurn(original, [])
    expect(request.mock.calls[0][1]?.body).toBe(request.mock.calls[1][1]?.body)
  })
  it('최대 3회 반문 이후에는 모델이 또 질문해도 최종 정리한다', async () => {
    mockFetch({ needFollowup: true, question: '또 질문', missingField: 'other', report: null })
    const history = [1, 2, 3].map(i => ({ question: `가상 질문 ${i}`, missingField: 'action_taken', answer: '확인되지 않음' }))
    expect(await runCareReportTurn(original, history)).toMatchObject({ needFollowup: false, question: null, usedFallback: true })
  })
})
