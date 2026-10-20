import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import handler from '../admin/session.js'
function response() { const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() }; return res as unknown as ServerResponse & typeof res }
function request(action: string, method = 'GET') { return { method, url: '/api/admin/session?centerAction=' + action, headers: {} } as IncomingMessage }
describe('센터 회원 경로와 기존 관리자 경로 분리', () => {
 it('센터 세션 조회는 비로그인 상태를 반환한다', async () => { const res=response(); await handler(request('session'),res); expect(res.statusCode).toBe(200); expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({authenticated:false}) })
 it('승인 API를 직접 호출해도 마스터 세션 없이는 거부한다', async () => { const res=response(); await handler(request('members','PATCH'),res); expect(res.statusCode).toBe(403) })
 it('지원하지 않는 동작과 잘못된 메서드는 거부한다', async () => { const res=response(); await handler(request('invalid'),res); expect(res.statusCode).toBe(404); const second=response(); await handler(request('signup'),second); expect(second.statusCode).toBe(405) })
 it('기존 관리자 세션 조회도 계속 동작한다', async () => { const res=response(); await handler({method:'GET',url:'/api/admin/session',headers:{}} as IncomingMessage,res); expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({authenticated:false,organization:null}) })
})
