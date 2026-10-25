import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, it, vi } from 'vitest'
import { mutateCenterOperation } from './centerOperationStore.js'
const id = '00000000-0000-4000-8000-000000000001'
const mutation = { action: 'upsertVisit' as const, requestId: id, expectedVersion: 0, visit: { id, date: '2026-10-22', time: '09:00', minutes: 60, service: '요양', workerId: id, patientId: id } }
it.each([{ data: null, error: { code: 'PGRST202' } }, { data: 0, error: null }])('제공자 검증 마이그레이션 미준비는 실제 저장을 호출하지 않는다', async readiness => {
  const rpc = vi.fn().mockResolvedValue(readiness)
  await expect(mutateCenterOperation({ rpc } as unknown as SupabaseClient, 'TEST', 'fake-admin', mutation)).rejects.toMatchObject({ statusCode: 503 })
  expect(rpc).toHaveBeenCalledExactlyOnceWith('center_visit_provider_support')
})
it('마이그레이션 확인 뒤에만 기관 범위 저장을 호출한다', async () => {
  const result = { visit: { ...mutation.visit, version: 1, archived: false } }
  const rpc = vi.fn().mockResolvedValueOnce({ data: 1, error: null }).mockResolvedValueOnce({ data: result, error: null })
  expect(await mutateCenterOperation({ rpc } as unknown as SupabaseClient, 'TEST', 'fake-admin', mutation)).toEqual(result)
  expect(rpc).toHaveBeenNthCalledWith(2, 'mutate_center_operation', { p_organization_code: 'TEST', p_actor_id: 'fake-admin', p_mutation: mutation })
})
