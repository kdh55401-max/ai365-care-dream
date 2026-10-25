import { visitWorkerIds, type CenterPerson, type CenterVisit } from './centerOperations.js'
import type { CenterDocument } from './centerDocuments.js'
import { parseStateChange, stateChangeQualityWarnings, stateChangeWeekFilled, type StateChangeWeek } from './centerStateChange.js'
import { latestWeekReviews, weekContentDigest, type StoredWeekReview, type WeekReviewValue } from './centerWeekReviews.js'

// 센터장 대시보드 1단계: 한 달 동안 수급자마다 방문(계획)과 상태변화 기록이 언제 있었는지 보여 주는 줄을 계산한다.
// 읽기 전용이다. '유지'·'변화'는 센터장이 남긴 주별 확인(centerWeekReviews)이 있는 주에만 표시하고, 이 파일이 스스로 판단하지 않는다.
export type RhythmService = '' | '요양' | '목욕' | '간호'
export type RhythmWeekState = 'recorded' | 'missing' | 'pending' | 'none'
/** confirmed: 기록 내용과 같은 지문으로 확인됨, stale: 확인 뒤 기록이 바뀜(다시 확인 필요), unreviewed: 기록은 있으나 확인 전, excused: 기록 없는 주에 사유(확인 못함)를 남김, none: 확인할 것 없음 */
export type RhythmReviewStatus = 'confirmed' | 'stale' | 'unreviewed' | 'excused' | 'none'
export interface RhythmWeekReview { status: RhythmReviewStatus; value: WeekReviewValue | null; areas: string[]; note: string; reviewer: string; at: string }
export interface RhythmWeek { startDay: number; endDay: number; state: RhythmWeekState; weekStart: string; digest: string; documentId: string | null; /** 이 주에 속한 상태변화 기록(센터장이 확인 전에 읽는 내용) */ records: StateChangeWeek[]; review: RhythmWeekReview }
export interface RhythmLane {
  patientId: string
  name: string
  workerName: string
  visits: { day: number; planned: boolean }[]
  recordDays: number[]
  weeks: RhythmWeek[]
  missingWeeks: number[]
  pending: boolean
  lastRecord: string
  /** 방문 계획이 있는 주(기록이 필요한 주)와 그중 기록이 있는 주. 평가 24④ 참고용 사실 숫자이며 충족 판정이 아니다. */
  applicableWeeks: number
  recordedWeeks: number
  daysSinceLast: number | null
  expressionChecks: number
  legacyDocs: number
  /** 센터장 확인이 필요한 주 번호(확인 전·다시 확인 필요), 변화 있음으로 확인된 주 번호, 평소와 같음·확인 못함으로 확인된 주 수. */
  reviewPending: number[]
  changedWeeks: number[]
  sameWeeks: number
  notObservedWeeks: number
  summary: string
}
export interface RhythmInput { people: CenterPerson[]; visits: CenterVisit[]; documents: CenterDocument[]; month: string; today: string; service: RhythmService; reviews?: Record<string, readonly StoredWeekReview[]>; /** 주별 확인 저장소를 읽지 못했거나 읽는 중이면 false: 이때는 어떤 주도 '확인 대기'로 표시하지 않는다. */ reviewsAvailable?: boolean }
export interface RhythmResult { daysInMonth: number; weeks: { startDay: number; endDay: number }[]; todayDay: number | null; lanes: RhythmLane[] }

const NOT_ACTIVE = new Set(['계약해지', '타기관'])

export function daysInMonth(month: string) { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate() }
/** 월요일에 시작하는 주 구간(해당 월 안으로 잘라 냄). */
export function monthWeeks(month: string) {
  const [y, m] = month.split('-').map(Number); const total = daysInMonth(month); const weeks: { startDay: number; endDay: number }[] = []
  let start = 1
  while (start <= total) {
    const weekday = new Date(Date.UTC(y, m - 1, start)).getUTCDay() // 0=일
    const untilSunday = weekday === 0 ? 0 : 7 - weekday
    const end = Math.min(start + untilSunday, total)
    weeks.push({ startDay: start, endDay: end }); start = end + 1
  }
  return weeks
}
const dayOf = (date: string, month: string) => date.startsWith(month + '-') ? Number(date.slice(8, 10)) : 0

export function buildCenterRhythm(input: RhythmInput): RhythmResult {
  const { people, visits, documents, month, today, service, reviews = {}, reviewsAvailable = true } = input
  const total = daysInMonth(month); const weeks = monthWeeks(month)
  const todayDay = today.startsWith(month + '-') ? Number(today.slice(8, 10)) : null
  const todayBefore = today < month + '-01'; const todayAfter = today > month + '-' + String(total).padStart(2, '0')
  const workerNames = new Map(people.filter(p => p.kind === 'worker').map(p => [p.id, p.name]))
  const lanes: RhythmLane[] = []
  for (const patient of people.filter(p => p.kind === 'patient' && !NOT_ACTIVE.has(p.status))) {
    const mine = visits.filter(v => v.patientId === patient.id && dayOf(v.date, month) > 0 && (!service || v.service === service))
    const visitList = mine.map(v => ({ day: dayOf(v.date, month), planned: v.date > today })).sort((a, b) => a.day - b.day)
    const recordDays = new Set<number>(); let expressionChecks = 0; let legacyDocs = 0
    const recordEntries: { day: number; week: StateChangeWeek; docId: string }[] = []
    for (const doc of documents) {
      if (doc.templateId !== 'state-change-record' || doc.subjectId !== patient.id || doc.period !== month) continue
      const record = parseStateChange(doc.content); if (!record) { if (doc.content.trim()) legacyDocs++; continue }
      for (const week of record.weeks) { const day = week.date && stateChangeWeekFilled(week) ? dayOf(week.date, month) : 0; if (day) { recordDays.add(day); recordEntries.push({ day, week, docId: doc.id }) } }
      expressionChecks += stateChangeQualityWarnings(record).length
    }
    const counts = new Map<string, number>(); for (const v of mine) for (const id of visitWorkerIds(v)) counts.set(id, (counts.get(id) ?? 0) + 1)
    const topWorker = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
    const latest = latestWeekReviews(reviews[patient.id] ?? [])
    const weekStates: RhythmWeek[] = weeks.map(w => {
      const hasRecord = [...recordDays].some(d => d >= w.startDay && d <= w.endDay)
      const hasVisit = visitList.some(v => v.day >= w.startDay && v.day <= w.endDay)
      const endDate = `${month}-${String(w.endDay).padStart(2, '0')}`; const startDate = `${month}-${String(w.startDay).padStart(2, '0')}`
      const state: RhythmWeekState = hasRecord ? 'recorded' : !hasVisit ? 'none' : endDate < today || todayAfter ? 'missing' : startDate <= today && !todayBefore ? 'pending' : 'none'
      const weekStart = startDate; const inWeek = recordEntries.filter(e => e.day >= w.startDay && e.day <= w.endDay)
      const digest = weekContentDigest(inWeek.map(e => e.week)); const documentId = inWeek[0]?.docId ?? null; const found = latest.get(weekStart)
      const none: RhythmWeekReview = { status: 'none', value: null, areas: [], note: '', reviewer: '', at: '' }
      const detail = found ? { value: found.value, areas: found.areas as string[], note: found.note, reviewer: found.reviewer, at: found.at } : { value: null, areas: [], note: '', reviewer: '', at: '' }
      const review: RhythmWeekReview = !reviewsAvailable ? none : state === 'recorded' ? (!found ? { ...none, status: 'unreviewed' } : found.digest === digest ? { ...detail, status: 'confirmed' } : { ...detail, status: 'stale' })
        : state === 'missing' && found?.value === 'not_observed' && found.digest === '' ? { ...detail, status: 'excused' } : none
      return { startDay: w.startDay, endDay: w.endDay, state, weekStart, digest, documentId, records: inWeek.map(e => e.week), review }
    })
    const missingWeeks = weekStates.map((w, i) => w.state === 'missing' ? i + 1 : 0).filter(Boolean)
    const pending = weekStates.some(w => w.state === 'pending')
    const sortedRecords = [...recordDays].sort((a, b) => a - b); const last = sortedRecords[sortedRecords.length - 1]
    const lastRecord = last ? `${Number(month.slice(5))}/${last}` : ''
    const applicableWeeks = weekStates.filter(w => w.state !== 'none').length
    const recordedWeeks = weekStates.filter(w => w.state === 'recorded').length
    const daysSinceLast = last && todayDay ? todayDay - last : null
    const reviewPending = weekStates.map((w, i) => w.review.status === 'unreviewed' || w.review.status === 'stale' ? i + 1 : 0).filter(Boolean)
    const changedWeeks = weekStates.map((w, i) => w.review.status === 'confirmed' && w.review.value === 'changed' ? i + 1 : 0).filter(Boolean)
    const sameWeeks = weekStates.filter(w => w.review.status === 'confirmed' && w.review.value === 'same_as_usual').length
    const notObservedWeeks = weekStates.filter(w => w.review.status === 'excused' || (w.review.status === 'confirmed' && w.review.value === 'not_observed')).length
    const base = missingWeeks.length ? `${missingWeeks.map(n => `${n}주차`).join('·')} 상태변화 기록 미작성. 방문 ${visitList.length}회 계획.`
      : pending ? `이번 주 상태변화 기록이 아직 없습니다. 이번 달 방문 ${visitList.length}회 계획.`
      : sortedRecords.length ? `이번 달 기록 ${sortedRecords.length}건, 마지막 기록 ${lastRecord}.`
      : visitList.length ? `이번 달 방문 ${visitList.length}회 계획, 기록은 아직 없습니다.` : '이번 달 방문 계획이 없습니다.'
    const extras = [daysSinceLast !== null && daysSinceLast > 7 ? `마지막 기록 후 ${daysSinceLast}일이 지났습니다.` : '', expressionChecks ? `특이사항 표현 점검이 필요한 기록 ${expressionChecks}건.` : '', changedWeeks.length ? `센터장이 ${changedWeeks.map(n => `${n}주차`).join('·')}에 변화 있음으로 확인했습니다.` : '', reviewPending.length ? `센터장 확인 대기 ${reviewPending.length}주${weekStates.some(w => w.review.status === 'stale') ? '(확인 뒤 기록이 바뀐 주 포함)' : ''}.` : sameWeeks ? `평소와 같음으로 확인된 주 ${sameWeeks}주.` : '', legacyDocs ? `일자 없는 예전 형식 기록 ${legacyDocs}건은 이 화면에 나타나지 않습니다.` : ''].filter(Boolean)
    const summary = [base, ...extras].join(' ')
    lanes.push({ patientId: patient.id, name: patient.name, workerName: (topWorker && workerNames.get(topWorker)) || '담당 미정', visits: visitList, recordDays: sortedRecords, weeks: weekStates, missingWeeks, pending, lastRecord, applicableWeeks, recordedWeeks, daysSinceLast, expressionChecks, legacyDocs, reviewPending, changedWeeks, sameWeeks, notObservedWeeks, summary })
  }
  lanes.sort((a, b) => b.missingWeeks.length - a.missingWeeks.length || b.changedWeeks.length - a.changedWeeks.length || b.reviewPending.length - a.reviewPending.length || Number(b.pending) - Number(a.pending) || b.expressionChecks - a.expressionChecks || a.name.localeCompare(b.name, 'ko'))
  return { daysInMonth: total, weeks, todayDay, lanes }
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
/** 수급자 이름순 인쇄용 표(이지케어 방문현황 '현황표 출력(수급자이름순)'에 해당). */
export function rhythmPrintHtml(lanes: RhythmLane[], month: string, service: RhythmService, preview: boolean) {
  const rows = [...lanes].sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(l => `<tr><td>${esc(l.name)}</td><td>${esc(l.workerName)}</td><td class="n">${l.visits.length}</td><td class="n">${l.recordDays.length}</td><td class="n">${l.recordedWeeks}/${l.applicableWeeks}</td><td>${l.missingWeeks.length ? esc(l.missingWeeks.map(n => `${n}주차`).join(', ')) : ''}</td><td>${esc(l.lastRecord)}</td><td class="n">${l.daysSinceLast ?? ''}</td><td class="n">${l.expressionChecks || ''}</td><td class="n">${l.reviewPending.length || ''}</td><td class="n">${l.changedWeeks.length || ''}</td><td class="n">${l.sameWeeks || ''}</td></tr>`).join('')
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(month)} 방문·기록 현황</title><style>@page{size:A4;margin:12mm}body{font:10pt/1.4 'Malgun Gothic',sans-serif}h1{font-size:15pt;text-align:center;margin:0 0 8px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:3px 6px}th{background:#eee}.n{text-align:right}.mark{text-align:right;font-size:9pt}</style></head><body>${preview ? '<p class="mark">가상자료 시연 · 실제 기관 기록 아님</p>' : ''}<h1>${esc(month)} 방문·상태변화 기록 현황${service ? ` (${esc(service)})` : ''}</h1><table><thead><tr><th>수급자</th><th>담당</th><th>방문 계획</th><th>기록 건수</th><th>기록 주</th><th>미작성 주</th><th>마지막 기록</th><th>경과일</th><th>표현 점검</th><th>확인 대기</th><th>변화 확인</th><th>유지 확인</th></tr></thead><tbody>${rows}</tbody></table></body></html>`
}
const csvCell = (v: string | number) => { const s = String(v); return /^[=+\-@\t\r]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
/** 엑셀로 열 수 있는 CSV(UTF-8 BOM). 수식 주입을 막기 위해 =,+,-,@로 시작하는 값은 앞에 작은따옴표를 붙인다. */
export function rhythmCsv(lanes: RhythmLane[]) {
  const head = ['수급자', '담당', '방문 계획 수', '기록 건수', '기록 주', '미작성 주', '마지막 기록', '경과일', '표현 점검', '확인 대기 주', '변화 확인 주', '유지 확인 주']
  const rows = [...lanes].sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(l => [l.name, l.workerName, l.visits.length, l.recordDays.length, `${l.recordedWeeks}/${l.applicableWeeks}`, l.missingWeeks.map(n => `${n}주차`).join(' '), l.lastRecord, l.daysSinceLast ?? '', l.expressionChecks || '', l.reviewPending.length || '', l.changedWeeks.length || '', l.sameWeeks || ''])
  return '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')
}

export interface RecognitionChip { label: string; tone: 'neutral' | 'warning' | 'danger' }
/** 인정 만료일 칩. 90일 이내 임박 표시는 임시 기준이며 공단 기준이 아니다. */
export const RECOGNITION_SOON_DAYS = 90
export function recognitionChip(periodEnd: string | null | 'loading' | 'error', today: string): RecognitionChip {
  if (periodEnd === 'loading') return { label: '인정 정보 조회 중', tone: 'neutral' }
  if (periodEnd === 'error') return { label: '인정 정보 미조회', tone: 'neutral' }
  if (!periodEnd || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return { label: '인정 정보 없음', tone: 'neutral' }
  const days = Math.round((Date.parse(periodEnd + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86_400_000)
  if (days < 0) return { label: `인정 만료 ${periodEnd} (${-days}일 지남)`, tone: 'danger' }
  return { label: `인정 만료 ${periodEnd} (D-${days})`, tone: days <= RECOGNITION_SOON_DAYS ? 'warning' : 'neutral' }
}

export type RhythmFilter = 'all' | 'review' | 'changed' | 'missing' | 'pending' | 'stale' | 'expression' | 'legacy' | 'recognition'
export const RHYTHM_FILTERS: { id: RhythmFilter; label: string }[] = [
  { id: 'all', label: '전체' }, { id: 'review', label: '확인 대기' }, { id: 'changed', label: '변화 있음 확인' }, { id: 'missing', label: '지난 주 미작성' }, { id: 'pending', label: '이번 주 기록 대기' }, { id: 'stale', label: '마지막 기록 7일 초과' },
  { id: 'expression', label: '표현 점검' }, { id: 'legacy', label: '예전 형식 기록' }, { id: 'recognition', label: '인정 임박·만료' },
]
export type RecognitionEndValue = string | null | 'loading' | 'error'
export function matchesRhythmFilter(lane: RhythmLane, filter: RhythmFilter, recognitionEnd: RecognitionEndValue | undefined, today: string): boolean {
  switch (filter) {
    case 'all': return true
    case 'review': return lane.reviewPending.length > 0
    case 'changed': return lane.changedWeeks.length > 0
    case 'missing': return lane.missingWeeks.length > 0
    case 'pending': return lane.pending
    case 'stale': return lane.daysSinceLast !== null && lane.daysSinceLast > 7
    case 'expression': return lane.expressionChecks > 0
    case 'legacy': return lane.legacyDocs > 0
    case 'recognition': return recognitionChip(recognitionEnd ?? 'loading', today).tone !== 'neutral'
  }
}
export function rhythmFilterCounts(lanes: RhythmLane[], ends: Record<string, RecognitionEndValue>, today: string): Record<RhythmFilter, number> {
  return Object.fromEntries(RHYTHM_FILTERS.map(f => [f.id, lanes.filter(l => matchesRhythmFilter(l, f.id, ends[l.patientId], today)).length])) as Record<RhythmFilter, number>
}

export type RhythmSortKey = 'priority' | 'review' | 'name' | 'worker' | 'visits' | 'weeks' | 'missing' | 'lastRecord' | 'days' | 'expression' | 'recognition'
export function sortRhythmLanes(lanes: RhythmLane[], key: RhythmSortKey, direction: 'asc' | 'desc', ends: Record<string, RecognitionEndValue>): RhythmLane[] {
  if (key === 'priority') return [...lanes] // buildCenterRhythm이 이미 우선순위(미작성 → 대기 → 표현 점검 → 이름)로 정렬해 둠
  const lastDay = (l: RhythmLane) => l.recordDays.length ? l.recordDays[l.recordDays.length - 1] : -1
  const endDate = (l: RhythmLane) => { const v = ends[l.patientId]; return v && v !== 'loading' && v !== 'error' ? v : '9999-99-99' }
  const value = (l: RhythmLane): number | string => key === 'name' ? l.name : key === 'worker' ? l.workerName : key === 'visits' ? l.visits.length : key === 'weeks' ? l.recordedWeeks : key === 'missing' ? l.missingWeeks.length : key === 'review' ? l.reviewPending.length : key === 'lastRecord' ? lastDay(l) : key === 'days' ? (l.daysSinceLast ?? -1) : key === 'expression' ? l.expressionChecks : endDate(l)
  const sign = direction === 'asc' ? 1 : -1
  return [...lanes].sort((a, b) => { const x = value(a), y = value(b); const c = typeof x === 'string' ? x.localeCompare(String(y), 'ko') : Number(x) - Number(y); return c * sign || a.name.localeCompare(b.name, 'ko') })
}
