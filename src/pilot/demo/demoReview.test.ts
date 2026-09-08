import { beforeEach, describe, expect, it } from 'vitest'

/** localStorage 최소 폴리필(Node/vitest 환경). demoStore.ts는 getItem/setItem만
 * 쓰고, BroadcastChannel은 `typeof BroadcastChannel === 'undefined'`일 때 이미
 * 안전하게 건너뛰도록 돼 있어 별도 폴리필이 필요 없다. */
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string) {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }
  setItem(key: string, value: string) {
    this.store.set(key, value)
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
  clear() {
    this.store.clear()
  }
}

beforeEach(() => {
  ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage()
})

/** 관리자 검토(승인/반려)의 "충돌 처리 계약"(조건부 갱신, 중복요청 무시)을
 * 데모(localStorage) 저장소를 통해 모의 검증한다. 주의: localStorage의
 * 읽고→비교→쓰기는 진짜 원자적 CAS가 아니다(탭 간 락 없음) — 여기서 확인하는
 * 것은 "계약대로 동작하는가"이지, 실제 동시 쓰기 안전성이 아니다. 실DB 동시성은
 * 검증하지 않는다(연결된 실DB가 없음). */
describe('demoAdminRepo.reviewReport — 충돌 처리 계약 (모의)', () => {
  it('예상값 불일치 시 거부하고, 일치하면 성공하며, 같은 요청 식별자 재전송은 중복 이력을 남기지 않는다', async () => {
    const { demoCareRepo } = await import('./demoCareRepo')
    const { demoAdminRepo } = await import('./demoAdminRepo')
    const { ReviewConflictError } = await import('../shared/adminRepo')

    await demoCareRepo.login('C01', '1234')
    const created = await demoCareRepo.createReport({ recipientCode: 'A01', reportType: 'daily', inputMethod: 'text' })
    const reportId = created.report.id
    const draftUpdatedAt = created.report.updated_at

    const submitted = await demoCareRepo.patchReport({
      id: reportId,
      caregiverFinalReport: { change: '식사량 감소', action: '관찰', result: '안정적', escalation: '경과 관찰', caregiverNote: '' },
      submit: true,
    })
    expect(submitted.status).toBe('submitted')

    // 1) 정상 승인 — expectedUpdatedAt이 최신값과 일치.
    const firstReview = await demoAdminRepo.reviewReport({
      id: reportId,
      reviewStatus: 'approved',
      adminFinalReport: { change: '식사량 감소(관리자 확인)', action: '관찰', result: '안정적', escalation: '경과 관찰', caregiverNote: '' },
      expectedUpdatedAt: submitted.updated_at,
      requestId: 'req-1',
    })
    expect(firstReview.review_status).toBe('approved')
    expect(firstReview.admin_final_report?.change).toBe('식사량 감소(관리자 확인)')
    expect(firstReview.review_history).toEqual([]) // 최초 검토라 이전 이력이 없다.

    // 2) 같은 요청 식별자로 재전송 — 중복 이력 없이 직전 결과를 그대로 반환.
    const duplicate = await demoAdminRepo.reviewReport({
      id: reportId,
      reviewStatus: 'approved',
      adminFinalReport: { change: '다른 내용으로 바꿔도', action: '무시됨', result: '무시됨', escalation: '무시됨', caregiverNote: '' },
      expectedUpdatedAt: firstReview.updated_at,
      requestId: 'req-1',
    })
    expect(duplicate.admin_final_report?.change).toBe('식사량 감소(관리자 확인)') // 중복요청의 새 내용이 반영되지 않았다.
    expect(duplicate.review_history).toEqual([])

    // 3) 오래된 expectedUpdatedAt(승인 이전 값)으로 다른 요청을 보내면 충돌.
    await expect(
      demoAdminRepo.reviewReport({
        id: reportId,
        reviewStatus: 'rejected',
        reviewNote: '재작업 필요',
        adminFinalReport: { change: 'x', action: 'x', result: 'x', escalation: 'x', caregiverNote: '' },
        expectedUpdatedAt: draftUpdatedAt, // 이미 지난 값
        requestId: 'req-2',
      }),
    ).rejects.toBeInstanceOf(ReviewConflictError)

    // 4) 최신 updated_at으로 다시 시도하면 성공하고, 직전(승인) 상태가 이력에 남는다.
    const secondReview = await demoAdminRepo.reviewReport({
      id: reportId,
      reviewStatus: 'rejected',
      reviewNote: '재작업 필요',
      adminFinalReport: { change: 'x', action: 'x', result: 'x', escalation: 'x', caregiverNote: '' },
      expectedUpdatedAt: firstReview.updated_at,
      requestId: 'req-3',
    })
    expect(secondReview.review_status).toBe('rejected')
    expect(secondReview.review_history.length).toBe(1)
    expect(secondReview.review_history[0].review_status).toBe('approved')
  })

  it('반려 시 사유가 없으면 거부한다', async () => {
    const { demoCareRepo } = await import('./demoCareRepo')
    const { demoAdminRepo } = await import('./demoAdminRepo')

    await demoCareRepo.login('C02', '1234')
    const created = await demoCareRepo.createReport({ recipientCode: 'A03', reportType: 'daily', inputMethod: 'text' })
    const submitted = await demoCareRepo.patchReport({
      id: created.report.id,
      caregiverFinalReport: { change: 'a', action: 'b', result: 'c', escalation: 'd', caregiverNote: '' },
      submit: true,
    })

    await expect(
      demoAdminRepo.reviewReport({
        id: created.report.id,
        reviewStatus: 'rejected',
        adminFinalReport: { change: 'a', action: 'b', result: 'c', escalation: 'd', caregiverNote: '' },
        expectedUpdatedAt: submitted.updated_at,
        requestId: 'req-x',
      }),
    ).rejects.toThrow('반려 사유')
  })
})
