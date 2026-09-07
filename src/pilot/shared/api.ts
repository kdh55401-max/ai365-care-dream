/** 파일럿(/care, /admin) 공통 fetch 래퍼. 항상 same-origin 쿠키를 포함해 세션을 유지한다. */
export class ApiClientError extends Error {
  status: number
  /** 서버가 에러와 함께 돌려준 응답 본문 전체(예: 409 충돌 시의 최신 report). */
  body?: unknown
  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  let data: unknown = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      // JSON이 아닌 응답(예: CSV)은 이 함수를 쓰지 않는다.
    }
  }

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `요청에 실패했습니다 (${res.status})`
    throw new ApiClientError(res.status, message, data)
  }

  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
}
