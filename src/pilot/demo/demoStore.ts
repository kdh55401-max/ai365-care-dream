import { normalizeReportRecord, type CareReportRecord } from '../../../shared/careTypes.js'
import type { ActionEvent, ActionObligation, ActionVerification, AdminDecision, CareAction, FieldRequest, FieldResponse, ReportEvent, SafetyReview } from '../../../shared/workflow.js'
import type { ActionBaselineLink, BaselineEntry, ReferenceChoice, SourceDocument } from '../../../shared/baseline.js'
import type { CandidateReview } from '../../../shared/changeCandidates.js'

/** 데모 모드 전용 저장소. Supabase/Gemini 없이도 /care?demo=1, /admin?demo=1 화면
 * 전체 흐름을 즉시 시연할 수 있도록 브라우저 localStorage에만 저장한다.
 *
 * 범위: 같은 브라우저의 "같은 프로필" 안에서 열린 일반 탭/창끼리는 localStorage와
 * BroadcastChannel로 즉시 동기화된다(관리자 화면을 다른 탭에서 열어 실시간 반영을
 * 확인하는 시연에 사용). 시크릿(프라이빗) 창은 저장소가 분리되어 있어 동기화되지
 * 않는다 — 이는 브라우저의 근본적인 프라이버시 격리이며, 데모 모드가 이 경계를
 * 넘어 데이터를 공유하면 오히려 개인정보 원칙에 어긋난다.
 *
 * 데모 데이터에는 실제 개인정보를 절대 넣지 않는다(참여자 C01~C09, 수급자
 * A01~A03 가명 코드만 사용, 이름 없음).
 */

const STORAGE_KEY = 'ai365_care_demo_db_v1'
const CHANNEL_NAME = 'ai365_care_demo_sync'

export const DEMO_PARTICIPANT_CODES = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09']
export const DEMO_RECIPIENT_CODES = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09']
export const DEMO_PIN = '1234'

/** 요양보호사(C코드) ↔ 수급자(A코드) 사전 배정 관계. 한 요양보호사는 자신에게
 * 배정된 수급자만 조회/보고할 수 있다 — 모든 C코드에 모든 A코드가 보이면 안 된다.
 * 실제 배정은 관리자가 조정하며, 이 표는 데모 시연/개발 테스트용 seed 데이터다. */
export const DEMO_ASSIGNMENTS: Record<string, string[]> = {
  C01: ['A01', 'A02'],
  C02: ['A03'],
  C03: ['A04', 'A05'],
  C04: ['A06'],
  C05: ['A07'],
  C06: ['A08'],
  C07: ['A09'],
  C08: [],
  C09: [],
}

/** 로그인한 요양보호사(caregiverCode)에게 배정된 수급자 코드만 돌려준다.
 * 배정 관계가 아예 없는(오타 등) 코드는 빈 배열 — 다른 요양보호사의 수급자로
 * 폴백하지 않는다. */
export function demoAssignedRecipients(caregiverCode: string): string[] {
  return demoAssignmentMap()[caregiverCode] ?? []
}
export const DEMO_ADMIN_PASSWORD = 'demo1234'

/** 9/18 실증 시연용 별칭 로그인. 운영 인증(참여자별 PIN, 관리자 비밀번호 해시)은
 * 전혀 바꾸지 않고, 데모 모드(?demo=1)에서만 "c1~c9 / 6003", "관리자 / 65036300"
 * 같은 외우기 쉬운 값을 받아 내부적으로 기존 C01~C09 참여자로 그대로 로그인
 * 시키는 얇은 별칭 계층이다. */
export const DEMO_ALIAS_PASSWORD = '6003'
export const DEMO_ADMIN_ALIAS_PASSWORD = '65036300'

/** "c1", "C1", "c01", "C01" 등 다양한 표기를 기존 참여자 코드 형식(C01~C09)으로
 * 정규화한다. 매칭되지 않으면 대문자로 트림한 원본을 그대로 돌려준다(기존
 * 운영 코드 입력과의 호환을 위해). */
export function canonicalizeParticipantCode(input: string): string {
  const trimmed = input.trim().toUpperCase()
  const match = trimmed.match(/^C0?([1-9])$/)
  return match ? `C0${match[1]}` : trimmed
}

interface DemoParticipant {
  code: string
  active: boolean
  pin: string
}

/** 관리자 업무(2단계) 기록 — 실서버의 2단계 테이블과 같은 모양. */
export interface DemoWorkflow {
  decisions: AdminDecision[]
  safetyReviews: SafetyReview[]
  actions: CareAction[]
  obligations: ActionObligation[]
  actionEvents: ActionEvent[]
  reportEvents: ReportEvent[]
  /** 3단계 */
  fieldRequests: FieldRequest[]
  fieldResponses: FieldResponse[]
  verifications: ActionVerification[]
  /** 4단계(없으면 빈 것으로 본다). 원본 파일 바이트는 DEMO_FILES_KEY에 따로 둔다. */
  baseline?: DemoBaseline
  /** 5단계 후보 판단(없으면 빈 것으로 본다). */
  candidateReviews?: CandidateReview[]
}

export interface DemoBaseline {
  documents: SourceDocument[]
  entries: BaselineEntry[]
  choices: ReferenceChoice[]
  links: ActionBaselineLink[]
}

/** 데모 원본 파일(base64) — 이 브라우저에만 저장되고 서버로 보내지 않는다. */
export const DEMO_FILES_KEY = 'ai365_care_demo_files_v1'

interface DemoDb {
  reports: CareReportRecord[]
  participants: DemoParticipant[]
  careSession: string | null // 로그인한 참여자 코드
  adminSession: boolean
  workflow: DemoWorkflow
  /** 배정 변경을 시연·검증할 때만 쓰는 덮어쓰기(없으면 DEMO_ASSIGNMENTS). */
  assignments?: Record<string, string[]>
}

/** 지금 유효한 데모 배정(요양보호사 → 수급자). */
export function demoAssignmentMap(): Record<string, string[]> {
  return readDb().assignments ?? DEMO_ASSIGNMENTS
}

function emptyWorkflow(): DemoWorkflow {
  return { decisions: [], safetyReviews: [], actions: [], obligations: [], actionEvents: [], reportEvents: [], fieldRequests: [], fieldResponses: [], verifications: [] }
}

function emptyDb(): DemoDb {
  return {
    reports: [],
    participants: DEMO_PARTICIPANT_CODES.map((code) => ({ code, active: true, pin: DEMO_PIN })),
    careSession: null,
    adminSession: false,
    workflow: emptyWorkflow(),
  }
}

let channel: BroadcastChannel | null = null
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME)
  return channel
}

function readDb(): DemoDb {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyDb()
    const parsed = JSON.parse(raw) as Partial<DemoDb>
    return { ...emptyDb(), ...parsed, workflow: { ...emptyWorkflow(), ...(parsed.workflow ?? {}) } }
  } catch {
    return emptyDb()
  }
}

function writeDb(db: DemoDb) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    // 저장 공간을 쓸 수 없어도(프라이빗 모드 등) 화면 진행은 막지 않는다.
  }
  getChannel()?.postMessage({ type: 'updated', at: Date.now() })
}

export function resetDemoData() {
  writeDb(emptyDb())
  try {
    localStorage.removeItem(DEMO_FILES_KEY)
  } catch {
    // 저장 공간을 쓸 수 없어도 초기화 진행은 막지 않는다.
  }
}

export function subscribeDemoUpdates(onChange: () => void): () => void {
  const ch = getChannel()
  const onMessage = () => onChange()
  ch?.addEventListener('message', onMessage)
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onChange()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    ch?.removeEventListener('message', onMessage)
    window.removeEventListener('storage', onStorage)
  }
}

// ── 참여자 세션 ───────────────────────────────────────────────────────
export function demoCareLogin(code: string, pin: string): boolean {
  const db = readDb()
  const trimmedPin = pin.trim()

  if (trimmedPin === DEMO_ALIAS_PASSWORD) {
    const canonical = canonicalizeParticipantCode(code)
    const aliasParticipant = db.participants.find((x) => x.code === canonical && x.active)
    if (aliasParticipant) {
      db.careSession = canonical
      writeDb(db)
      return true
    }
  }

  const p = db.participants.find((x) => x.code === code && x.active)
  if (!p || p.pin !== trimmedPin) return false
  db.careSession = code
  writeDb(db)
  return true
}

export function demoCareLogout() {
  const db = readDb()
  db.careSession = null
  writeDb(db)
}

export function demoCareSession(): string | null {
  return readDb().careSession
}

export function demoAdminLogin(password: string): boolean {
  if (password !== DEMO_ADMIN_PASSWORD && password !== DEMO_ADMIN_ALIAS_PASSWORD) return false
  const db = readDb()
  db.adminSession = true
  writeDb(db)
  return true
}

export function demoAdminLogout() {
  const db = readDb()
  db.adminSession = false
  writeDb(db)
}

export function demoAdminSession(): boolean {
  return readDb().adminSession
}

export function demoResetParticipantPin(code: string, newPin: string) {
  const db = readDb()
  const p = db.participants.find((x) => x.code === code)
  if (p) p.pin = newPin
  writeDb(db)
}

export function demoListParticipants(): DemoParticipant[] {
  return readDb().participants
}

// updated_at을 CAS(조건부 갱신) 토큰으로 쓰므로, 같은 밀리초 안에 연속으로 갱신되면
// `new Date().toISOString()`이 같은 값을 반환해 충돌 감지가 무력화될 수 있다(실제로
// 자동테스트에서 재현됨). 항상 이전에 발급한 값보다 엄격히 큰 타임스탬프를 보장한다.
let lastIssuedMs = 0
function nextTimestamp(): string {
  let ms = Date.now()
  if (ms <= lastIssuedMs) ms = lastIssuedMs + 1
  lastIssuedMs = ms
  return new Date(ms).toISOString()
}

// ── 보고 CRUD ─────────────────────────────────────────────────────────
// normalizeReportRecord: 옛 localStorage 데이터(캐어기버노트/응급플래그/검토 필드
// 도입 이전에 저장된 레코드)를 읽을 때 한 번만 보정한다 — 원본 저장값은 안 바꾼다.
export function demoAllReports(): CareReportRecord[] {
  return readDb()
    .reports.filter((r) => !r.deleted)
    .map(normalizeReportRecord)
}

export function demoGetReport(id: string): CareReportRecord | undefined {
  const found = readDb().reports.find((r) => r.id === id && !r.deleted)
  return found ? normalizeReportRecord(found) : undefined
}

export function demoCreateReport(record: CareReportRecord) {
  const db = readDb()
  // started_at/created_at/updated_at도 CAS 토큰(nextTimestamp)의 단조증가 계열에
  // 편입시켜, 생성 직후 첫 갱신이 같은 밀리초에 일어나도 값이 겹치지 않게 한다.
  const ts = nextTimestamp()
  db.reports.push({ ...record, started_at: ts, created_at: ts, updated_at: ts })
  writeDb(db)
}

/** expectedUpdatedAt이 주어지면 현재 저장된 updated_at과 비교해 다르면 갱신을
 * 거부하고 undefined를 반환한다("충돌"). 주의: localStorage의 읽기→비교→쓰기는
 * 진짜 원자적 CAS가 아니다(탭 간 락이 없음) — 여기서는 계약(불일치 시 거부)만
 * 모의로 구현한 것이고, 실제 동시 쓰기에 대한 보장은 아니다. */
export function demoUpdateReport(id: string, patch: Partial<CareReportRecord>, expectedUpdatedAt?: string) {
  const db = readDb()
  const idx = db.reports.findIndex((r) => r.id === id)
  if (idx === -1) return undefined
  if (expectedUpdatedAt !== undefined && db.reports[idx].updated_at !== expectedUpdatedAt) return undefined
  const prev = db.reports[idx]
  db.reports[idx] = { ...prev, ...patch, updated_at: nextTimestamp() }
  captureReportEvents(db, prev, db.reports[idx])
  writeDb(db)
  return normalizeReportRecord(db.reports[idx])
}

/** 실DB 트리거(reports_capture_events)와 같은 규칙: 제출 순간 한 번, 승인·반려할 때마다 한 번. */
function captureReportEvents(db: DemoDb, prev: CareReportRecord, next: CareReportRecord) {
  const events = db.workflow.reportEvents
  const recordedAt = new Date().toISOString()
  if (next.status === 'submitted' && prev.status !== 'submitted' && !events.some((e) => e.report_id === next.id && e.event_type === 'submitted')) {
    events.push({ id: newDemoId(), report_id: next.id, event_type: 'submitted', occurred_at: next.submitted_at ?? recordedAt, actor_scope: 'caregiver_session', actor_ref: next.participant_code, request_id: null, recorded_at: recordedAt })
  }
  if ((next.review_status === 'approved' || next.review_status === 'rejected') && next.reviewed_at && (next.reviewed_at !== prev.reviewed_at || next.review_status !== prev.review_status)) {
    events.push({ id: newDemoId(), report_id: next.id, event_type: next.review_status === 'approved' ? 'review_approved' : 'review_rejected', occurred_at: next.reviewed_at, actor_scope: 'org_admin_shared', actor_ref: null, request_id: next.last_review_request_id ?? null, recorded_at: recordedAt })
  }
}

export function demoReadWorkflow(): DemoWorkflow {
  return readDb().workflow
}

/** 업무 기록을 한 번에 바꾼다(데모 저장소는 탭 간 원자성은 없다 — 계약만 흉내 낸다). */
export function demoWriteWorkflow(mutate: (wf: DemoWorkflow) => void) {
  const db = readDb()
  mutate(db.workflow)
  writeDb(db)
}

export function demoDeleteReport(id: string, reason: string) {
  demoUpdateReport(id, { deleted: true } as Partial<CareReportRecord>)
  const db = readDb()
  const idx = db.reports.findIndex((r) => r.id === id)
  if (idx !== -1) (db.reports[idx] as unknown as Record<string, unknown>).delete_reason = reason
  writeDb(db)
}

export function newDemoId(): string {
  return `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
