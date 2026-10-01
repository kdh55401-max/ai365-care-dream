import { describe, expect, it } from 'vitest'
import {
  CONTENT_MAX,
  addDays,
  buildTemplateDraft,
  changeFactSentence,
  checkAiDraft,
  dueOf,
  kstDateOf,
  pendingCount,
  sortStaffNotes,
  validateDraftInput,
  validateStaffNote,
  type StaffNoteDraftInput,
  type StaffNoteItem,
  type StaffNoteRecord,
} from './staffChangeNote.js'

const note = (over: Partial<StaffNoteRecord> = {}): StaffNoteRecord => ({
  changedOn: '2026-10-01',
  reason: '근무시간 조정',
  counselMethod: 'phone',
  consent: 'agreed',
  counseleeRelation: '보호자(자녀)',
  content: '전화로 변경을 안내했고 보호자가 동의했다고 말함',
  status: 'draft',
  confirmedAt: null,
  updatedAt: '2026-10-02T00:00:00.000Z',
  ...over,
})

const item = (id: number, defaultChangedOn: string, n: StaffNoteRecord | null = null, over: Partial<StaffNoteItem> = {}): StaffNoteItem => ({
  changeLogId: id,
  recipientCode: 'A01',
  displayName: null,
  fromCaregivers: ['C01'],
  toCaregivers: ['C03'],
  changedAt: `${defaultChangedOn}T01:00:00.000Z`,
  defaultChangedOn,
  note: n,
  ...over,
})

describe('날짜', () => {
  it('UTC 시각을 한국시간 날짜로 바꾼다(자정 경계)', () => {
    expect(kstDateOf('2026-10-01T14:59:59.000Z')).toBe('2026-10-01')
    expect(kstDateOf('2026-10-01T15:00:00.000Z')).toBe('2026-10-02')
  })
  it('날짜 더하기는 월·연 경계를 넘는다', () => {
    expect(addDays('2026-10-25', 14)).toBe('2026-11-08')
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08')
  })
})

describe('기한(변경일 + 14일)', () => {
  it('기한 당일까지는 기한 내, 다음 날부터 지남', () => {
    const i = item(1, '2026-10-01')
    expect(dueOf(i, '2026-10-15')).toMatchObject({ deadline: '2026-10-15', daysLeft: 0, due: 'due_soon' })
    expect(dueOf(i, '2026-10-16')).toMatchObject({ daysLeft: -1, due: 'overdue' })
  })
  it('3일 이하 남으면 곧 기한, 그 전은 여유', () => {
    const i = item(1, '2026-10-01')
    expect(dueOf(i, '2026-10-12').due).toBe('due_soon')
    expect(dueOf(i, '2026-10-11').due).toBe('ok')
  })
  it('일지의 변경일자를 고치면 기한도 그 날짜 기준으로 바뀐다', () => {
    const i = item(1, '2026-10-01', note({ changedOn: '2026-10-05' }))
    expect(dueOf(i, '2026-10-10').deadline).toBe('2026-10-19')
  })
  it('확정된 일지는 기한이 지나도 완료', () => {
    const i = item(1, '2026-09-01', note({ status: 'confirmed', confirmedAt: '2026-09-20T00:00:00.000Z' }))
    expect(dueOf(i, '2026-10-30').due).toBe('done')
  })
})

describe('사실 문장', () => {
  it('변경 전/후 담당과 변경일만 말하고 사유·동의는 말하지 않는다', () => {
    const s = changeFactSentence(item(1, '2026-10-01'), '2026-10-01')
    expect(s).toBe('2026-10-01 A01 어르신의 담당 요양보호사가 C01에서 C03(으)로 변경되었습니다.')
    expect(s).not.toMatch(/동의|사유|안내/)
  })
  it('후임이 없으면 해제로만 표현한다', () => {
    const s = changeFactSentence(item(1, '2026-10-01', null, { toCaregivers: [] }), '2026-10-01')
    expect(s).toContain('C01에서 해제되었습니다')
    expect(s).toContain('새 담당자는 아직 배정되지 않았습니다')
  })
})

describe('입력 검사', () => {
  const ok = { changedOn: '2026-10-01', reason: '사유', counselMethod: 'visit' as const, consent: 'agreed' as const, counseleeRelation: '본인', content: '안내함', confirm: true }
  it('초안은 비어 있어도 저장할 수 있다', () => {
    expect(validateStaffNote({ ...ok, reason: '', counselMethod: null, counseleeRelation: '', content: '', confirm: false }, '2026-10-02')).toBeNull()
  })
  it('확정은 사유·방법·대상자·내용을 모두 요구한다', () => {
    expect(validateStaffNote(ok, '2026-10-02')).toBeNull()
    expect(validateStaffNote({ ...ok, reason: '  ' }, '2026-10-02')).toContain('변경 사유')
    expect(validateStaffNote({ ...ok, counselMethod: null }, '2026-10-02')).toContain('상담 방법')
    expect(validateStaffNote({ ...ok, counseleeRelation: '' }, '2026-10-02')).toContain('상담 대상자')
    expect(validateStaffNote({ ...ok, consent: null }, '2026-10-02')).toContain('동의 여부를 선택')
    expect(validateStaffNote({ ...ok, content: '' }, '2026-10-02')).toContain('동의')
  })
  it('날짜 형식·미래 날짜·길이·식별번호를 거부한다', () => {
    expect(validateStaffNote({ ...ok, changedOn: '2026-13-40' }, '2026-10-02')).toContain('날짜')
    expect(validateStaffNote({ ...ok, changedOn: '2026-10-03' }, '2026-10-02')).toContain('뒤일 수 없습니다')
    expect(validateStaffNote({ ...ok, content: 'ㄱ'.repeat(CONTENT_MAX + 1) }, '2026-10-02')).toContain('이내')
    expect(validateStaffNote({ ...ok, counseleeRelation: '010-1234-5678' }, '2026-10-02')).toContain('관계')
  })
})

describe('정렬·건수', () => {
  it('기한 지남 → 곧 기한 → 여유 → 확정 순으로, 확정은 최근 것이 먼저', () => {
    const today = '2026-10-10'
    const items = [
      item(1, '2026-10-09'), // 기한 10-23 여유
      item(2, '2026-09-20', note({ changedOn: '2026-09-20', status: 'confirmed', confirmedAt: '2026-09-21T00:00:00.000Z' })),
      item(3, '2026-09-20'), // 기한 10-04 지남
      item(4, '2026-09-27'), // 기한 10-11 곧
      item(5, '2026-09-25', note({ changedOn: '2026-09-25', status: 'confirmed', confirmedAt: '2026-09-26T00:00:00.000Z' })),
    ]
    expect(sortStaffNotes(items, today).map((i) => i.changeLogId)).toEqual([3, 4, 1, 5, 2])
  })
  it('쓸 일지 수는 확정되지 않은 것(미작성+작성 중)만 센다', () => {
    const items = [item(1, '2026-10-01'), item(2, '2026-10-01', note()), item(3, '2026-10-01', note({ status: 'confirmed', confirmedAt: 'x' }))]
    expect(pendingCount(items)).toBe(2)
  })
})


describe('초안 만들기 입력', () => {
  const base: StaffNoteDraftInput = { reasonLabel: '근무시간 조정', reasonMemo: '', counselMethod: 'phone', relation: '보호자(자녀)', consent: 'agreed', opinionMemo: '' }
  it('필수 선택이 모두 있으면 통과', () => {
    expect(validateDraftInput(base)).toBeNull()
  })
  it('사유·대상자 누락, 기타 사유 설명 누락, 의견 있음인데 의견 누락을 거부', () => {
    expect(validateDraftInput({ ...base, reasonLabel: '' })).toContain('사유')
    expect(validateDraftInput({ ...base, relation: ' ' })).toContain('대상자')
    expect(validateDraftInput({ ...base, reasonLabel: '기타(직접 입력)' })).toContain('직접 적어')
    expect(validateDraftInput({ ...base, consent: 'agreed_with_opinion' })).toContain('어떤 의견')
    expect(validateDraftInput({ ...base, consent: 'agreed_with_opinion', opinionMemo: '시간대가 걱정됨' })).toBeNull()
  })
  it('전화번호·주민번호처럼 보이는 숫자와 너무 긴 설명을 거부', () => {
    expect(validateDraftInput({ ...base, opinionMemo: '010-1234-5678로 연락', consent: 'not_agreed' })).toContain('숫자')
    expect(validateDraftInput({ ...base, reasonMemo: 'ㄱ'.repeat(201) })).toContain('이내')
  })
})

describe('기본 문장 초안(AI 없이)', () => {
  const base: StaffNoteDraftInput = { reasonLabel: '근무시간 조정', reasonMemo: '', counselMethod: 'phone', relation: '보호자(자녀)', consent: 'agreed', opinionMemo: '' }
  it('동의함: 안내와 동의가 두 줄로 나온다', () => {
    const d = buildTemplateDraft(base)
    expect(d.reason).toBe('근무시간 조정에 따른 담당 요양보호사 변경')
    expect(d.content).toBe('[안내] 전화로 보호자(자녀)에게 담당 요양보호사 변경 사실과 사유(근무시간 조정)를 안내함.\n[의견·동의] 변경에 동의함.')
  })
  it('동의하지 않음·의견 있음은 고른 대로만 쓴다(의견은 입력 그대로)', () => {
    expect(buildTemplateDraft({ ...base, consent: 'not_agreed', opinionMemo: '기존 선생님을 원함' }).content).toContain('변경에 동의하지 않음. 의견: 기존 선생님을 원함')
    expect(buildTemplateDraft({ ...base, consent: 'not_agreed' }).content).toMatch(/동의하지 않음\.$/)
    expect(buildTemplateDraft({ ...base, consent: 'agreed_with_opinion', opinionMemo: '시간대 조정 희망' }).content).toContain('변경에 동의함. 의견: 시간대 조정 희망')
  })
  it('아직 안내하지 못함: 동의했다는 표현이 없고 재확인 필요로 끝난다', () => {
    const d = buildTemplateDraft({ ...base, consent: 'not_reached', counselMethod: 'visit' })
    expect(d.content).toContain('방문했으나 만나지 못해')
    expect(d.content).toContain('아직 안내하지 못함')
    expect(d.content).not.toMatch(/동의함|동의하였/)
    expect(d.content).toContain('다시 확인 필요')
  })
  it('기타 사유는 입력한 문장 그대로, 추가 설명은 괄호 없이 덧붙인다', () => {
    expect(buildTemplateDraft({ ...base, reasonLabel: '기타(직접 입력)', reasonMemo: '요양보호사 퇴사' }).reason).toBe('요양보호사 퇴사')
    expect(buildTemplateDraft({ ...base, reasonMemo: '오전 일정 겹침' }).reason).toBe('근무시간 조정, 오전 일정 겹침에 따른 담당 요양보호사 변경')
  })
  it('입력에 없는 숫자·이름을 만들지 않는다', () => {
    const d = buildTemplateDraft(base)
    expect(`${d.reason}${d.content}`).not.toMatch(/\d/)
  })
})

describe('AI 결과 검증(checkAiDraft)', () => {
  const base: StaffNoteDraftInput = { reasonLabel: '근무시간 조정', reasonMemo: '', counselMethod: 'phone', relation: '보호자(자녀)', consent: 'agreed', opinionMemo: '' }
  const good = { reason: '근무시간 조정으로 담당 요양보호사가 변경됨.', content: '[안내] 전화로 보호자(자녀)에게 변경 사실을 안내하였음.\n[의견·동의] 보호자가 변경에 동의함.' }
  it('선택과 맞고 구조가 갖춰진 결과는 통과', () => {
    expect(checkAiDraft(good, base)).toBe(true)
  })
  it('동의를 고르지 않았는데 동의했다고 쓴 결과를 거부(동의하지 않음·아직 안내 못함)', () => {
    expect(checkAiDraft(good, { ...base, consent: 'not_agreed' })).toBe(false)
    expect(checkAiDraft(good, { ...base, consent: 'not_reached' })).toBe(false)
  })
  it('동의함을 골랐는데 동의하지 않았다고 쓴 결과를 거부', () => {
    const bad = { ...good, content: '[안내] 전화로 보호자(자녀)에게 안내함.\n[의견·동의] 보호자가 동의하지 않음.' }
    expect(checkAiDraft(bad, base)).toBe(false)
  })
  it('입력에 없던 숫자(날짜·전화번호·금액)를 만든 결과를 거부, 입력에 있던 숫자는 허용', () => {
    expect(checkAiDraft({ ...good, content: good.content.replace('안내하였음', '3월 5일에 안내하였음') }, base)).toBe(false)
    const withMemo = { ...base, consent: 'agreed_with_opinion' as const, opinionMemo: '오후 2시 이후를 원함' }
    const ok2 = { reason: good.reason, content: '[안내] 전화로 보호자(자녀)에게 안내함.\n[의견·동의] 변경에 동의하였으며 오후 2시 이후를 원함.' }
    expect(checkAiDraft(ok2, withMemo)).toBe(true)
  })
  it('구조·대상자 누락, 길이 초과, 타입 오류를 거부', () => {
    expect(checkAiDraft({ ...good, content: '변경에 동의함.' }, base)).toBe(false)
    expect(checkAiDraft({ ...good, content: good.content.replace('보호자(자녀)', '가족') }, base)).toBe(false)
    expect(checkAiDraft({ ...good, content: good.content + 'ㄱ'.repeat(CONTENT_MAX) }, base)).toBe(false)
    expect(checkAiDraft({ reason: 1, content: good.content }, base)).toBe(false)
    expect(checkAiDraft({ reason: '', content: good.content }, base)).toBe(false)
  })
})
