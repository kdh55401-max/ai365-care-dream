import { describe, expect, it } from 'vitest'
import { resolveCareAiConfiguration } from './careAiConfig.js'

const gemini = { GEMINI_API_KEY: 'test-only-key' }
const vertex = { GOOGLE_VERTEX_PROJECT_ID: 'test-only-project', GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON: 'test-only-json' }

describe('돌봄 AI 서버 provider/model 설정 (실제 자격증명 없음)', () => {
  it('미설정/auto는 기존 경로와 기존 기본 모델을 유지한다', () => {
    expect(resolveCareAiConfiguration(gemini)).toEqual({ provider: 'gemini', model: 'gemini-3.6-flash' })
    expect(resolveCareAiConfiguration({ ...vertex, CARE_AI_PROVIDER: 'auto' })).toEqual({ provider: 'vertex', model: 'gemini-3.6-flash' })
    expect(resolveCareAiConfiguration({ ...gemini, GOOGLE_VERTEX_PROJECT_ID: 'partial-project' }).provider).toBe('gemini')
  })
  it('명시 gemini는 남은 Vertex 설정이 있어도 Gemini API를 선택한다', () => {
    expect(resolveCareAiConfiguration({ ...gemini, ...vertex, CARE_AI_PROVIDER: 'gemini' }).provider).toBe('gemini')
  })
  it('명시 vertex 설정 불완전 시 Gemini 키로 우회하지 않는다', () => {
    expect(() => resolveCareAiConfiguration({ ...gemini, CARE_AI_PROVIDER: 'vertex', GOOGLE_VERTEX_PROJECT_ID: 'partial-project' })).toThrow('다른 경로로 전환하지 않았습니다')
  })
  it('명시 gemini에 API 키가 없으면 Vertex 설정으로 우회하지 않는다', () => {
    expect(() => resolveCareAiConfiguration({ ...vertex, CARE_AI_PROVIDER: 'gemini' })).toThrow('GEMINI_API_KEY')
  })
  it('provider 오타·모델 경로·질의문자·지나치게 긴 식별자를 거부한다', () => {
    expect(() => resolveCareAiConfiguration({ ...gemini, CARE_AI_PROVIDER: 'other' })).toThrow('CARE_AI_PROVIDER')
    for (const model of ['models/test', '../test', 'test?key=x', 'x'.repeat(101)]) {
      expect(() => resolveCareAiConfiguration({ ...gemini, CARE_AI_MODEL: model })).toThrow('CARE_AI_MODEL')
    }
  })
  it('문법상 유효한 모델명은 선택만 하며 실제 사용 가능성을 주장하지 않는다', () => {
    expect(resolveCareAiConfiguration({ ...gemini, CARE_AI_MODEL: 'test-model-not-a-real-model' }).model).toBe('test-model-not-a-real-model')
  })
})
