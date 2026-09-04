/** 서버 전용 환경변수. VITE_ 접두사가 없으므로 Vite가 브라우저 번들에 절대 포함하지 않는다. */

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
  get isProduction() {
    return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
  },
}
