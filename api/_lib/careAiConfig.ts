/** Server-only provider routing; never accepts a school login or browser input. */
export interface CareAiConfiguration { provider: 'gemini' | 'vertex'; model: string }
export class CareAiConfigurationError extends Error {}

export function resolveCareAiConfiguration(configuration: Record<string, string | undefined>): CareAiConfiguration {
  const requested = configuration.CARE_AI_PROVIDER?.trim() || 'auto'
  if (!['auto', 'gemini', 'vertex'].includes(requested)) {
    throw new CareAiConfigurationError('CARE_AI_PROVIDER는 auto, gemini, vertex 중 하나여야 합니다.')
  }
  const model = configuration.CARE_AI_MODEL?.trim() || 'gemini-3.6-flash'
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(model)) {
    throw new CareAiConfigurationError('CARE_AI_MODEL은 경로가 아닌 모델 식별자로 설정하세요.')
  }
  const hasVertex = Boolean(configuration.GOOGLE_VERTEX_PROJECT_ID?.trim() && configuration.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON?.trim())
  const provider = requested === 'auto' ? hasVertex ? 'vertex' : 'gemini' : requested as 'gemini' | 'vertex'
  if (provider === 'vertex' && !hasVertex) {
    throw new CareAiConfigurationError('Vertex AI를 선택하면 GOOGLE_VERTEX_PROJECT_ID와 GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON 설정이 필요합니다. 다른 경로로 전환하지 않았습니다.')
  }
  if (provider === 'gemini' && !configuration.GEMINI_API_KEY?.trim()) {
    throw new CareAiConfigurationError('Gemini API를 선택하면 서버 GEMINI_API_KEY 설정이 필요합니다. Google 로그인 비밀번호는 API 키가 아닙니다.')
  }
  return { provider, model }
}
