import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'

/** Local preview uses the same server handlers as Vercel; never return SPA HTML for an API request. */
function centerApi(): Plugin {
  return {
    name: 'center-local-api',
    apply: 'serve',
    configResolved(config) {
      const local = loadEnv(config.mode, config.envDir, '')
      for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CENTER_SESSION_SECRET',
        'CENTER_MASTER_ID', 'CENTER_MASTER_PASSWORD_HASH', 'CENTER_MASTER_ORGANIZATION_CODE',
        'CENTER_LEGACY_ORGANIZATION_CODE', 'CENTER_PERSON_IMPORT_AI_ENABLED', 'CARE_AI_PROVIDER', 'CARE_AI_MODEL',
        'GEMINI_API_KEY', 'GOOGLE_VERTEX_PROJECT_ID', 'GOOGLE_VERTEX_LOCATION', 'GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON']) {
        if (!process.env[name] && local[name]) process.env[name] = local[name]
      }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost')
        const match = /^\/api\/center\/([a-z-]+)$/.exec(url.pathname)
        if (!match) return next()
        url.searchParams.set('centerAction', match[1])
        req.url = `${url.pathname}?${url.searchParams}`
        try {
          const router = await server.ssrLoadModule('/api/_lib/centerRouter.ts')
          await router.handleCenterRequest(req, res)
        } catch {
          if (!res.headersSent) {
            res.statusCode = 503
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.setHeader('cache-control', 'no-store')
            res.end(JSON.stringify({ error: '센터 API 실행 설정을 확인해 주세요.' }))
          } else if (!res.writableEnded) res.end()
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), centerApi()],
})
