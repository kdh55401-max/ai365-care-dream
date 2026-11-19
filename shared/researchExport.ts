/**
 * 연구용 자료 구분(사전·사후)과 CSV 내보내기 규칙(서버·시연 공용).
 * - 연구 동의(consented=true)한 요양보호사의 기록만 내보낸다.
 * - 사전·사후는 저장 시점에 고정하지 않고 내보낼 때 기준일로 계산한다(기준일을 나중에 바꿔도 일관됨).
 *   기준일이 없으면 앱 기록은 사후, 도입 전 옮겨 적은 기록은 사전으로 본다.
 * - 이름은 내보내지 않는다. 요양보호사·어르신은 코드(C01, A01)만 쓴다.
 */
import { isNoChangeDay, transcriptText } from './researchCare.js'

export type Phase = '사전' | '사후'
export type RecordOrigin = 'app' | 'pre_record'

export interface ResearchParticipant {
  caregiver_code: string
  consented: boolean
  consent_date: string | null
  high_baseline: boolean
  note: string | null
}

export interface PreRecord {
  id: string
  caregiver_code: string
  recipient_code: string
  record_date: string
  record_text: string
  writing_seconds: number | null
  source: 'paper' | 'easycare' | 'other'
}

export interface DailyExportSource {
  id: string
  participant_code: string
  recipient_code: string
  report_date: string
  completion_seconds: number | null
  input_method: string | null
  ai_questions_source?: string | null
  raw_input: string
  followup_answers: Array<{ question: string; answer: string }> | null
}

export interface WeeklyExportSource {
  id: string
  participant_code: string
  recipient_code: string
  week_start: string
  source_report_ids: string[] | null
  ai_model: string | null
  ai_draft: string | null
  caregiver_text: string | null
  caregiver_edit_seconds: number | null
  admin_final_text: string | null
  admin_note: string | null
  admin_followup: string | null
  status: string
  sent_at: string | null
  admin_confirmed_at: string | null
}

export const CUTOFF_KEY = 'cutoff_date'

export function phaseOf(date: string, origin: RecordOrigin, cutoff: string | null): { phase: Phase; basis: string } {
  if (cutoff) return { phase: date < cutoff ? '사전' : '사후', basis: `기준일 ${cutoff}` }
  return origin === 'pre_record' ? { phase: '사전', basis: '도입 전 기록(기준일 미설정)' } : { phase: '사후', basis: '앱 기록(기준일 미설정)' }
}

export function consentedMap(list: ResearchParticipant[]): Map<string, ResearchParticipant> {
  return new Map(list.filter((p) => p.consented).map((p) => [p.caregiver_code, p]))
}

const SOURCE_LABEL: Record<PreRecord['source'], string> = { paper: '종이', easycare: '이지케어', other: '기타' }
const STATUS_LABEL: Record<string, string> = { draft: '요양보호사 확인 중', sent: '관리자 검토 대기', confirmed: '관리자 확정' }
const yesNo = (v: boolean) => (v ? '예' : '아니오')

export const DAILY_HEADERS = [
  '기록ID', '사전사후', '구분근거', '요양보호사', '어르신', '작성일', '작성소요초', '입력방식', '질문생성방식',
  '특이사항없음발화', '원자료전사본', '고수준태그',
]
export function dailyRows(list: DailyExportSource[], people: Map<string, ResearchParticipant>, cutoff: string | null): unknown[][] {
  return list.filter((r) => people.has(r.participant_code)).map((r) => {
    const p = phaseOf(r.report_date, 'app', cutoff)
    const turns = (r.followup_answers ?? []).map((t) => ({ question: t.question, answer: t.answer }))
    return [
      r.id, p.phase, p.basis, r.participant_code, r.recipient_code, r.report_date, r.completion_seconds ?? '',
      r.input_method === 'voice' ? '음성' : '글', r.ai_questions_source === 'ai' ? 'AI' : r.ai_questions_source === 'rule' ? '규칙' : '',
      yesNo(isNoChangeDay(r.raw_input)), transcriptText({ rawInput: r.raw_input, turns }), yesNo(people.get(r.participant_code)!.high_baseline),
    ]
  })
}

export const WEEKLY_HEADERS = [
  '주간ID', '사전사후', '구분근거', '요양보호사', '어르신', '주시작일', '묶은하루기록수', 'AI모델', 'AI초안',
  '요양보호사수정본', '요양보호사수정여부', '수정소요초', '관리자확정본', '상담기록', '후속조치기록', '상태', '보낸일시', '확정일시', '고수준태그',
]
export function weeklyRows(list: WeeklyExportSource[], people: Map<string, ResearchParticipant>, cutoff: string | null): unknown[][] {
  return list.filter((w) => people.has(w.participant_code)).map((w) => {
    const p = phaseOf(w.week_start, 'app', cutoff)
    return [
      w.id, p.phase, p.basis, w.participant_code, w.recipient_code, w.week_start, (w.source_report_ids ?? []).length,
      w.ai_model === 'rule' ? 'AI 없이 자동 정리' : w.ai_model ?? '', w.ai_draft ?? '', w.caregiver_text ?? '',
      w.caregiver_text === null ? '' : yesNo(w.caregiver_text !== w.ai_draft), w.caregiver_edit_seconds ?? '',
      w.admin_final_text ?? '', w.admin_note ?? '', w.admin_followup ?? '', STATUS_LABEL[w.status] ?? w.status,
      w.sent_at ?? '', w.admin_confirmed_at ?? '', yesNo(people.get(w.participant_code)!.high_baseline),
    ]
  })
}

export const PRE_HEADERS = ['기록ID', '사전사후', '구분근거', '요양보호사', '어르신', '작성일', '작성소요초', '출처', '원문기록', '고수준태그']
export function preRows(list: PreRecord[], people: Map<string, ResearchParticipant>, cutoff: string | null): unknown[][] {
  return list.filter((r) => people.has(r.caregiver_code)).map((r) => {
    const p = phaseOf(r.record_date, 'pre_record', cutoff)
    return [
      r.id, p.phase, p.basis, r.caregiver_code, r.recipient_code, r.record_date, r.writing_seconds ?? '',
      SOURCE_LABEL[r.source] ?? r.source, r.record_text, yesNo(people.get(r.caregiver_code)!.high_baseline),
    ]
  })
}

export type ResearchExportType = 'research_daily' | 'research_weekly' | 'research_pre'
export const RESEARCH_EXPORT_TYPES: ResearchExportType[] = ['research_daily', 'research_weekly', 'research_pre']
