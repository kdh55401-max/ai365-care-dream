export const modules = ['업무현황', '직원관리', '수급자관리', '방문일정', '기관평가', '서류함', '회원승인', '매뉴얼'] as const
export type Module = typeof modules[number]
export const workerTabs = ['기본정보', '급여', '방문일정', '관리기록', '배상책임', '수당설정', '사회보험/소득세', '기타정보', '서류&서식', '파일함']
export const patientTabs = ['기본정보', '계약이력', '등급·인정이력', '본인부담률 이력', '담당', '급여계획', '방문일정', '청구내역', '본인부담금', '기초평가', '관리기록', '파일함', '업무수행일지', '서식', '기타', '준비현황']
export const forms = ['표준근로계약서(재가용)', '근로계약서(시급제)', '근로계약서(월급제)', '직원 상담일지', '인사기록카드', '휴가신청서', '재직증명서', '경력증명서', '휴직신청서', '복직신청서', '사직서']
export interface Person { id: string; kind: 'worker' | 'patient'; name: string; status: string; category: string; start: string; end: string; examination: string; notes: Record<string, string> }
export interface Visit { id: string; date: string; time: string; workerId: string; workerIds?: string[]; patientId: string; service: string; minutes: number }
export function monthDays(year: number, month: number) { return Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`) }
export function filterPeople(people: Person[], kind: Person['kind'], query: string, status: string) { return people.filter(p => p.kind === kind && p.name.includes(query.trim()) && (!status || p.status === status)) }
