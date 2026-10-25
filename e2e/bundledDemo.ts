import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Page } from '@playwright/test'
// Optional isolated built-app verification; no live server/API is represented by this fixture.
export async function bundledDemo(page: Page) {
 if (process.env.PW_BUNDLED !== '1') return
 if (new URL(process.env.PW_BASE_URL!).hostname !== 'localhost') throw new Error('PW_BUNDLED requires http://localhost for a trustworthy crypto.randomUUID context')
 await page.route('**/*', async route => {
  const u = new URL(route.request().url()), path = u.pathname
  const name = path.startsWith('/assets/') ? 'assets/' + basename(path) : path === '/center' || path === '/' ? 'index.html' : null
  if (!name || u.origin !== new URL(process.env.PW_BASE_URL!).origin) { await route.abort(); return }
  const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.png') ? 'image/png' : 'text/html'
  await route.fulfill({ status: 200, contentType: type, body: await readFile(new URL('../dist/' + name, import.meta.url)) })
 })
}
