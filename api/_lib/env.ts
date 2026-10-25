/** 서버 전용 환경변수. VITE_ 접두사가 없으므로 Vite가 브라우저 번들에 절대 포함하지 않는다. */
import { resolveCareAiConfiguration } from './careAiConfig.js'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`환경변수 ${name}가 설정되지 않았습니다.`)
  return value
}

export const env = {
  get supabaseUrl() {
    return required('SUPABASE_URL')
  },
  get supabaseServiceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY')
  },
  get jwtSecret() {
    return required('CARE_PILOT_JWT_SECRET')
  },
  get adminPasswordHash() {
    return required('CARE_PILOT_ADMIN_PASSWORD_HASH')
  },
  get geminiApiKey() {
    return required('GEMINI_API_KEY')
  },
  get careAiConfiguration() {
    return resolveCareAiConfiguration(process.env)
  },
  // auto는 기존의 프로젝트+서비스계정 존재 여부로 경로를 고른다.
  // LOCATION은 선택 사항이며 명시 선택된 provider의 실패를 다른 경로로 대체하지 않는다.
  get vertexProjectId() {
    return process.env.GOOGLE_VERTEX_PROJECT_ID || null
  },
  get vertexLocation() {
    return process.env.GOOGLE_VERTEX_LOCATION || 'us-central1'
  },
  /** 서비스 계정 JSON 키 전체를 한 줄 문자열로 담은 값(Vercel 환경변수). 파일로
   * 올리지 않는다 — 서버리스 환경에 파일시스템 영속성이 없다. */
  get vertexServiceAccountJson() {
    return process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON || null
  },
  get isProduction() {
    return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
  },
}
