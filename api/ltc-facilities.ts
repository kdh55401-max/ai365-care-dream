import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * 국민건강보험공단 장기요양기관 검색 Open API 연동을 위한 서버리스 엔드포인트 골격.
 *
 * 아직 공식 활용가이드(요청 파라미터명, 응답 필드명)와 실제 인증키를 받지 못했으므로
 * 업스트림 호출은 구현하지 않았다. DATA_GO_KR_SERVICE_KEY는 이 서버리스 함수
 * 안에서만 사용하고, 절대 프론트엔드 번들에 포함되거나 클라이언트로 응답되지 않는다.
 * (Vite는 VITE_ 접두사가 붙은 환경변수만 브라우저 번들에 포함시키므로, 이 이름은
 * 그 자체로 프론트엔드에 노출되지 않는다.)
 *
 * 공식 활용가이드가 준비되면 아래 순서로 채운다.
 *   1. UPSTREAM_ENDPOINT에 공식 API 요청 URL을 지정한다.
 *   2. buildUpstreamUrl()에서 sido/sigungu/visitCareOnly를 활용가이드의 공식
 *      요청 파라미터명으로 매핑한다. (파라미터명을 추측해서 미리 넣지 않는다)
 *   3. 업스트림 응답을 파싱해 활용가이드의 공식 응답 필드명으로 매핑한다.
 *   4. 기관기호 기준 중복 제거, 방문요양 급여 제공기관 필터링, 운영 중인 기관 수
 *      집계, 조회 기준일(asOf) 채우기를 구현한다.
 *   5. 정상 응답에는 `cache-control: public, s-maxage=86400, stale-while-revalidate=3600`
 *      헤더를 붙여 24시간 캐싱한다 (아래 no-store 대신 적용).
 */

const UPSTREAM_ENDPOINT = '' // TODO: 공식 활용가이드의 API 요청 URL

export interface LtcFacilityQuery {
  sido?: string
  sigungu?: string
  visitCareOnly: boolean
}

export interface LtcFacilitySearchResult {
  status: 'ok' | 'not_configured' | 'upstream_error'
  message: string
  /** 조회 기준일 (아직 미연동이라 항상 null) */
  asOf: string | null
  count: number
  items: unknown[]
}

function parseQuery(req: IncomingMessage): LtcFacilityQuery {
  const url = new URL(req.url ?? '', 'http://localhost')
  return {
    sido: url.searchParams.get('sido') ?? undefined,
    sigungu: url.searchParams.get('sigungu') ?? undefined,
    visitCareOnly: url.searchParams.get('visitCareOnly') === 'true',
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: LtcFacilitySearchResult) {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  // 아직 실제 데이터가 없으므로 캐시하지 않는다. 업스트림 연동 후에는 성공
  // 응답에만 24시간 캐시 헤더를 붙인다 (파일 상단 TODO 5번 참고).
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    sendJson(res, 405, {
      status: 'upstream_error',
      message: 'GET 요청만 지원합니다.',
      asOf: null,
      count: 0,
      items: [],
    })
    return
  }

  const query = parseQuery(req)
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY

  if (!serviceKey || !UPSTREAM_ENDPOINT) {
    sendJson(res, 200, {
      status: 'not_configured',
      message:
        '장기요양기관 검색 API 연동이 아직 준비되지 않았습니다. ' +
        'DATA_GO_KR_SERVICE_KEY 환경변수 등록과 공식 활용가이드 반영이 필요합니다.',
      asOf: null,
      count: 0,
      items: [],
    })
    return
  }

  // TODO: 활용가이드 확보 후 실제 업스트림 호출로 교체.
  //   const upstreamUrl = buildUpstreamUrl(UPSTREAM_ENDPOINT, serviceKey, query)
  //   const upstreamRes = await fetch(upstreamUrl)
  //   if (!upstreamRes.ok) { ... 'upstream_error' 응답 ... }
  //   const data = await upstreamRes.json()
  //   ... 기관기호 중복 제거 / 방문요양 필터링 / 운영 중 기관 수 집계 ...
  void query

  sendJson(res, 200, {
    status: 'not_configured',
    message: '업스트림 연동 로직이 아직 구현되지 않았습니다.',
    asOf: null,
    count: 0,
    items: [],
  })
}
