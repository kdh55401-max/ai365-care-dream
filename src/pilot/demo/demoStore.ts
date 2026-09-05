import type { CareReportRecord } from '../../../shared/careTypes.js'

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
export const DEMO_RECIPIENT_CODES = ['A01', 'A02', 'A03']
export const DEMO_PIN = '1234'
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

interface DemoDb {
  reports: CareReportRecord[]
  participants: DemoParticipant[]
  careSession: string | null // 로그인한 참여자 코드
  adminSession: boolean
}

function emptyDb(): DemoDb {
  return {
    reports: [],
    participants: DEMO_PARTICIPANT_CODES.map((code) => ({ code, active: true, pin: DEMO_PIN })),
    careSession: null,
    adminSession: false,
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
    return { ...emptyDb(), ...parsed }
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

// ── 보고 CRUD ─────────────────────────────────────────────────────────
export function demoAllReports(): CareReportRecord[] {
  return readDb().reports.filter((r) => !r.deleted)
}

export function demoGetReport(id: string): CareReportRecord | undefined {
  return readDb().reports.find((r) => r.id === id && !r.deleted)
}

export function demoCreateReport(record: CareReportRecord) {
  const db = readDb()
  db.reports.push(record)
  writeDb(db)
}

export function demoUpdateReport(id: string, patch: Partial<CareReportRecord>) {
  const db = readDb()
  const idx = db.reports.findIndex((r) => r.id === id)
  if (idx === -1) return undefined
  db.reports[idx] = { ...db.reports[idx], ...patch, updated_at: new Date().toISOString() }
  writeDb(db)
  return db.reports[idx]
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
