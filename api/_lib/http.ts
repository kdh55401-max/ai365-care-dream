import type { IncomingMessage, ServerResponse } from 'node:http'

/** 파일럿 API 공통 JSON 요청/응답 헬퍼. 원시 Node http 시그니처를 그대로 쓴다
 * (기존 api/ltc-facilities.ts와 동일한 방식 — Vercel Node 런타임, @vercel/node 미사용). */

export class ApiError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
    if (chunks.reduce((n, c) => n + c.length, 0) > 200_000) {
      throw new ApiError(413, '요청 본문이 너무 큽니다.')
    }
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    throw new Error('not an object')
  } catch {
    throw new ApiError(400, '요청 본문이 올바른 JSON이 아닙니다.')
  }
}

export function sendJson(res: ServerResponse, statusCode: number, body: unknown, headers?: Record<string, string>) {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  if (headers) {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  }
  res.end(JSON.stringify(body))
}

export function sendError(res: ServerResponse, err: unknown) {
  if (err instanceof ApiError) {
    sendJson(res, err.statusCode, { error: err.message })
    return
  }
  console.error(err)
  sendJson(res, 500, { error: '서버 오류가 발생했습니다.' })
}

export function requireMethod(req: IncomingMessage, ...methods: string[]) {
  if (!req.method || !methods.includes(req.method)) {
    throw new ApiError(405, `${methods.join(', ')} 요청만 지원합니다.`)
  }
}

export function getQuery(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url ?? '', 'http://localhost')
  return url.searchParams
}

export async function withHandler(res: ServerResponse, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (err) {
    sendError(res, err)
  }
}
