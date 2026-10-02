import { useEffect, useRef, useState } from 'react'
import type { AdminRepo } from '../shared/adminRepo'
import {
  DISPLAY_NAME_MAX,
  EMPTY_PROFILE,
  LTC_GRADES,
  cleanProfile,
  ltcValidity,
  validateDisplayName,
  validateProfile,
  validateRecipientCode,
  type RecipientAdminRow,
  type RecipientAdminView,
  type RecipientProfile,
} from '../../../shared/recipientAdmin'
import { SpinnerIcon } from './adminBadges'
import { DocumentFillSection, type AttachedDoc, type FillReport } from './DocumentFillSection'
import { DOC_KIND_LABELS, storedDocType, type ProfileField } from '../../../shared/profileExtraction'

/** 관리자 "수급자" — 이지케어식 수급자 목록(이름·장기요양인정번호·등급·인정 유효기간·담당 요양보호사·상태를 한 줄에)과
 * 등록·정보 수정·담당 배정·활성 전환. 이 앱의 관리자 첫 화면이다.
 * 저장은 서버(DB 함수)가 한 번에 처리하고, 이 화면은 입력을 모으고 결과를 보여준다.
 * 실패하면 입력값을 지우지 않고 그 자리에 오류를 보인다. 삭제는 없다(비활성화·배정 해제만). */

interface FormState {
  mode: 'create' | 'edit'
  code: string
  profile: RecipientProfile
  customCode: string
  active: boolean
  caregivers: string[]
  /** 수정 충돌 검사용 — 이 화면이 읽은 시점의 서버 값. */
  expectedUpdatedAt: string
  /** 같은 저장 요청의 재전송(응답 유실 후 재시도)을 한 번만 반영하는 열쇠. */
  requestId: string
}

const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`)

function emptyForm(): FormState {
  return { mode: 'create', code: '', profile: { ...EMPTY_PROFILE }, customCode: '', active: true, caregivers: [], expectedUpdatedAt: '', requestId: newRequestId() }
}

function formFor(row: RecipientAdminRow): FormState {
  return {
    mode: 'edit',
    code: row.code,
    // 인적사항 이름이 아직 없으면 예전에 입력한 별칭을 이름 칸에 미리 채워 준다(저장하면 이름으로 확정).
    profile: { ...row.profile, fullName: row.profile.fullName || (row.displayName ?? '') },
    customCode: '',
    active: row.active,
    caregivers: [...row.caregivers],
    expectedUpdatedAt: row.updatedAt,
    requestId: newRequestId(),
  }
}

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

function statusOf(e: unknown): number | null {
  return e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number' ? (e as { status: number }).status : null
}

/** 목록에 보일 이름: 인적사항 이름, 없으면 예전 별칭. */
function nameOf(r: RecipientAdminRow): string {
  return r.profile.fullName || r.displayName || ''
}

/** 칸 이름. AI가 채우고 아직 직접 확인하지 않은 칸에는 표시를 붙인다. */
function FieldLabel({ text, ai }: { text: string; ai: boolean }) {
  return (
    <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
      {text}
      {ai && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">AI가 채움 · 확인 필요</span>}
    </span>
  )
}

function CaregiverChips({ codes }: { codes: string[] }) {
  if (codes.length === 0) {
    return <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">담당자 미배정</span>
  }
  return (
    <>
      {codes.map((c) => (
        <span key={c} className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-teal-50 text-teal-800 border border-teal-100">
          {c}
        </span>
      ))}
    </>
  )
}

export function RecipientAdminPanel({ repo, orgId, onOpenRecipient }: { repo: AdminRepo; orgId: string; onOpenRecipient: (code: string) => void }) {
  const [view, setView] = useState<RecipientAdminView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<{ message: string; conflict: boolean } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // ERP 3단계: 서류로 채우기 — 올린 서류, AI가 채운 칸(확인 전), 읽은 결과.
  const [docs, setDocsState] = useState<AttachedDoc[]>([])
  const [aiFilled, setAiFilled] = useState<ProfileField[]>([])
  const [fillReport, setFillReport] = useState<FillReport | null>(null)
  const formRef = useRef<FormState | null>(null)
  const docsRef = useRef<AttachedDoc[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'unassigned' | 'expiring'>('all')
  const savingRef = useRef(false)

  const load = async () => {
    try {
      setView(await repo.getRecipientAdminView())
      setLoadError(null)
    } catch (e) {
      setLoadError(messageOf(e, '수급자 목록을 불러오지 못했습니다.'))
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo])

  formRef.current = form
  docsRef.current = docs
  const setDocs = (update: (prev: AttachedDoc[]) => AttachedDoc[]) => setDocsState(update)
  const resetFill = () => {
    setDocsState([])
    setAiFilled([])
    setFillReport(null)
  }

  const patch = (changes: Partial<FormState>, keepRequest = true) =>
    setForm((f) => (f ? { ...f, ...changes, requestId: keepRequest || f.mode === 'create' ? f.requestId : newRequestId() } : f))

  const aiCls = (f: ProfileField) => (aiFilled.includes(f) ? 'border-amber-400 bg-amber-50' : 'border-slate-300')
  const patchProfile = (changes: Partial<RecipientProfile>) => {
    // 관리자가 직접 고친 칸은 더 이상 "AI가 채움 · 확인 필요"가 아니다.
    setAiFilled((prev) => prev.filter((f) => !(f in changes)))
    setForm((f) => (f ? { ...f, profile: { ...f.profile, ...changes }, requestId: f.mode === 'create' ? f.requestId : newRequestId() } : f))
  }

  const applyAi = (profile: RecipientProfile, filled: ProfileField[]) => {
    setAiFilled((prev) => [...new Set([...prev, ...filled])])
    setForm((f) => (f ? { ...f, profile, requestId: f.mode === 'create' ? f.requestId : newRequestId() } : f))
  }

  const toggleCaregiver = (code: string) =>
    setForm((f) => {
      if (!f) return f
      const caregivers = f.caregivers.includes(code) ? f.caregivers.filter((c) => c !== code) : [...f.caregivers, code]
      return { ...f, caregivers: caregivers.sort(), requestId: f.mode === 'create' ? f.requestId : newRequestId() }
    })

  const openCreate = () => {
    resetFill()
    setNotice(null)
    setFormError(null)
    setForm(emptyForm())
  }
  const openEdit = (row: RecipientAdminRow) => {
    resetFill()
    setNotice(null)
    setFormError(null)
    setForm(formFor(row))
  }
  const closeForm = () => {
    if (savingRef.current) return
    setForm(null)
    setFormError(null)
    resetFill()
  }

  /** 올린 서류 원본을 그 수급자의 비공개 기준문서로 보관한다(4단계 저장소). 실패해도 이미 끝난 수급자 저장은 되돌리지 않고 안내만 한다. */
  const storeOriginals = async (code: string): Promise<string> => {
    const list = docsRef.current
    if (list.length === 0) return ''
    let saved = 0
    let firstError = ''
    for (const d of list) {
      try {
        await repo.uploadDocument(
          orgId,
          {
            recipientCode: code,
            docType: d.extraction ? storedDocType(d.extraction.docKind) : 'other',
            title: d.extraction ? DOC_KIND_LABELS[d.extraction.docKind] : null,
            sourceLabel: '수급자 등록 시 올린 서류',
            requestId: d.id,
          },
          d.file,
        )
        saved += 1
      } catch (e) {
        firstError ||= messageOf(e, '서류 원본을 보관하지 못했습니다.')
      }
    }
    if (saved === list.length) return ` 서류 원본 ${saved}건을 비공개로 보관했습니다.`
    return ` 서류 원본은 ${saved}/${list.length}건만 보관했습니다 — ${firstError} 수급자 상세의 기준문서에서 다시 올릴 수 있습니다.`
  }

  const submit = async () => {
    if (!form || savingRef.current) return
    const profile = cleanProfile(form.profile)
    const nameError = view?.profileReady ? validateProfile(profile, true) : validateDisplayName(profile.fullName)
    const codeError = form.mode === 'create' ? validateRecipientCode(form.customCode) : null
    if (nameError || codeError) {
      setFormError({ message: nameError ?? codeError ?? '', conflict: false })
      return
    }
    savingRef.current = true
    setSaving(true)
    setFormError(null)
    try {
      if (form.mode === 'create') {
        const res = await repo.registerRecipient({
          displayName: profile.fullName,
          caregiverCodes: form.caregivers,
          active: form.active,
          ...(view?.profileReady ? { profile } : {}),
          code: form.customCode.trim() ? form.customCode.trim().toUpperCase() : undefined,
          requestId: form.requestId,
        })
        const kept = await storeOriginals(res.code)
        setNotice(`수급자 ${res.code}을(를) 등록했습니다.${form.caregivers.length === 0 ? ' 담당자가 아직 배정되지 않았습니다.' : ''}${kept}`)
      } else {
        const res = await repo.updateRecipient({
          code: form.code,
          displayName: profile.fullName,
          active: form.active,
          caregiverCodes: form.caregivers,
          ...(view?.profileReady ? { profile } : {}),
          expectedUpdatedAt: form.expectedUpdatedAt || undefined,
          requestId: form.requestId,
        })
        const kept = await storeOriginals(res.code)
        setNotice(`수급자 ${res.code} 정보를 저장했습니다.${kept}`)
      }
      setForm(null)
      await load()
    } catch (e) {
      // 입력값은 그대로 둔다. 충돌이면 최신 내용으로 다시 열 수 있게 안내한다.
      setFormError({ message: messageOf(e, '저장하지 못했습니다. 입력한 내용은 그대로 두었습니다.'), conflict: statusOf(e) === 409 && form.mode === 'edit' })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const reopenLatest = async () => {
    if (!form) return
    try {
      const latest = await repo.getRecipientAdminView()
      setView(latest)
      const row = latest.recipients.find((r) => r.code === form.code)
      if (row) setForm(formFor(row))
      setFormError(null)
    } catch (e) {
      setFormError({ message: messageOf(e, '최신 내용을 불러오지 못했습니다.'), conflict: true })
    }
  }

  if (loadError && !view) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4">
          {loadError}
        </p>
        <button onClick={() => void load()} className="self-start min-h-[44px] px-4 rounded-full border-2 border-slate-900 font-bold text-sm">
          다시 불러오기
        </button>
      </div>
    )
  }
  if (!view) {
    return (
      <div className="flex justify-center py-16">
        <SpinnerIcon className="w-6 h-6 text-teal-600" />
      </div>
    )
  }
  if (!view.ready) {
    return (
      <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-amber-900 text-sm">
        <p className="font-bold">수급자 등록 기능 준비 중</p>
        <p className="mt-1">DB 마이그레이션(db/migrations/2026-10-02-recipient-registration.sql)을 아직 적용하지 않았습니다. 적용하면 이 화면에서 등록·배정할 수 있습니다. 지금도 기존 수급자와 돌봄기록은 그대로 동작합니다.</p>
      </div>
    )
  }

  const assignable = view.caregivers.filter((c) => c.active || form?.caregivers.includes(c.code))
  const unassigned = view.recipients.filter((r) => r.active && r.caregivers.length === 0).length
  const today = new Date().toISOString().slice(0, 10)
  const q = query.trim().toLowerCase().replace(/\s+/g, '')
  const shown = view.recipients.filter((r) => {
    if (filter === 'active' && !r.active) return false
    if (filter === 'unassigned' && !(r.active && r.caregivers.length === 0)) return false
    if (filter === 'expiring' && !['expiring', 'expired'].includes(ltcValidity(r.profile.ltcValidTo, today))) return false
    if (!q) return true
    return [r.code, nameOf(r), r.profile.ltcNumber].some((v) => v.toLowerCase().replace(/\s+/g, '').includes(q))
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">수급자 · {view.recipients.length}명</h2>
          <p className="text-slate-400 text-xs mt-0.5">이름·장기요양인정번호·등급·유효기간을 한눈에 봅니다. 삭제는 없고, 사용하지 않는 수급자는 비활성화합니다.</p>
        </div>
        <button onClick={openCreate} disabled={form?.mode === 'create'} className="shrink-0 min-h-[44px] px-4 rounded-full bg-teal-600 text-white font-bold text-sm disabled:opacity-40">
          수급자 추가
        </button>
      </div>

      {!view.profileReady && (
        <p className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-amber-900 text-xs">
          <b>인적사항(장기요양인정번호·등급·유효기간 등) 저장 준비 중</b> — DB 마이그레이션(db/migrations/2026-10-03-erp-recipient-profile.sql)을 적용하면 입력·표시됩니다. 지금은 이름만 저장됩니다.
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-2xl bg-teal-50 border border-teal-200 px-4 py-3 text-teal-800 text-sm font-bold">
          {notice}
        </p>
      )}
      {unassigned > 0 && (
        <p className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-2 text-amber-800 text-xs font-bold">
          담당자가 배정되지 않은 활성 수급자 {unassigned}명 — 배정하기 전에는 요양보호사가 기록할 수 없습니다.
        </p>
      )}

      {form && (
        <form
          aria-label={form.mode === 'create' ? '수급자 추가' : `수급자 ${form.code} 수정`}
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="rounded-2xl bg-white border-2 border-teal-200 shadow-sm p-4 flex flex-col gap-4"
        >
          <h3 className="font-bold text-slate-900">{form.mode === 'create' ? '수급자 추가' : `수급자 ${form.code} 수정`}</h3>

          {view.profileReady && (
            <DocumentFillSection
              repo={repo}
              docs={docs}
              setDocs={setDocs}
              getProfile={() => formRef.current?.profile ?? EMPTY_PROFILE}
              onApply={applyAi}
              report={fillReport}
              setReport={setFillReport}
              disabled={saving}
            />
          )}

          <fieldset className="flex flex-col gap-3" disabled={saving}>
            <legend className="text-sm font-bold text-slate-700 mb-1">인적사항</legend>
            <label className="flex flex-col gap-1">
              <FieldLabel text="이름" ai={aiFilled.includes('fullName')} />
              <input
                value={form.profile.fullName}
                aria-label="이름"
                onChange={(e) => patchProfile({ fullName: e.target.value })}
                maxLength={DISPLAY_NAME_MAX + 10}
                autoComplete="off"
                className={`min-h-[44px] rounded-xl border ${aiCls('fullName')} px-3 text-base`}
              />
              <span className="text-xs text-slate-400">요양보호사 화면에도 이 이름이 표시됩니다. 기록 대화에서 AI에는 이름이 전달되지 않습니다.</span>
            </label>
            {view.profileReady && (
              <>
                <label className="flex flex-col gap-1">
                  <FieldLabel text="장기요양인정번호" ai={aiFilled.includes('ltcNumber')} />
                  <input
                    value={form.profile.ltcNumber}
                    onChange={(e) => patchProfile({ ltcNumber: e.target.value })}
                    placeholder="L0011097739-103"
                    autoComplete="off"
                    className={`min-h-[44px] rounded-xl border ${aiCls('ltcNumber')} px-3 text-base uppercase`}
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <FieldLabel text="장기요양등급" ai={aiFilled.includes('ltcGrade')} />
                    <select value={form.profile.ltcGrade} onChange={(e) => patchProfile({ ltcGrade: e.target.value })} className={`min-h-[44px] rounded-xl border ${aiCls('ltcGrade')} px-2 text-base bg-white`}>
                      <option value="">선택 안 함</option>
                      {LTC_GRADES.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <FieldLabel text="생년월일" ai={aiFilled.includes('birthDate')} />
                    <input type="date" value={form.profile.birthDate} onChange={(e) => patchProfile({ birthDate: e.target.value })} className={`min-h-[44px] rounded-xl border ${aiCls('birthDate')} px-2 text-base`} />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <FieldLabel text="인정 유효기간 시작" ai={aiFilled.includes('ltcValidFrom')} />
                    <input type="date" value={form.profile.ltcValidFrom} onChange={(e) => patchProfile({ ltcValidFrom: e.target.value })} className={`min-h-[44px] rounded-xl border ${aiCls('ltcValidFrom')} px-2 text-base`} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <FieldLabel text="인정 유효기간 종료" ai={aiFilled.includes('ltcValidTo')} />
                    <input type="date" value={form.profile.ltcValidTo} onChange={(e) => patchProfile({ ltcValidTo: e.target.value })} className={`min-h-[44px] rounded-xl border ${aiCls('ltcValidTo')} px-2 text-base`} />
                  </label>
                </div>
                <label className="flex flex-col gap-1">
                  <FieldLabel text="주소" ai={aiFilled.includes('address')} />
                  <input value={form.profile.address} onChange={(e) => patchProfile({ address: e.target.value })} autoComplete="off" className={`min-h-[44px] rounded-xl border ${aiCls('address')} px-3 text-base`} />
                </label>
                <label className="flex flex-col gap-1">
                  <FieldLabel text="전화번호" ai={aiFilled.includes('phone')} />
                  <input value={form.profile.phone} onChange={(e) => patchProfile({ phone: e.target.value })} inputMode="tel" autoComplete="off" className={`min-h-[44px] rounded-xl border ${aiCls('phone')} px-3 text-base`} />
                </label>
              </>
            )}
          </fieldset>

          <div className="flex flex-col gap-1">
            <span className="text-sm font-bold text-slate-700">수급자 코드</span>
            {form.mode === 'edit' ? (
              <p className="text-base font-bold text-slate-900">{form.code} <span className="text-xs font-normal text-slate-400">· 코드는 바꿀 수 없습니다(과거 기록 연결 유지)</span></p>
            ) : (
              <>
                <p className="text-sm text-slate-600">저장할 때 자동으로 정해집니다(예: 다음 번호 A10).</p>
                <details>
                  <summary className="text-xs text-slate-400 cursor-pointer">코드를 직접 지정하려면</summary>
                  <input
                    value={form.customCode}
                    onChange={(e) => patch({ customCode: e.target.value })}
                    disabled={saving}
                    placeholder="A10"
                    aria-label="수급자 코드 직접 지정"
                    className="mt-2 min-h-[44px] w-32 rounded-xl border border-slate-300 px-3 text-base uppercase"
                  />
                </details>
              </>
            )}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-bold text-slate-700">담당 요양보호사</legend>
            <p className="text-xs text-slate-400">여러 명을 선택할 수 있습니다. 선택하지 않으면 &lsquo;담당자 미배정&rsquo;으로 저장되며, 해제해도 과거 기록은 그대로입니다.</p>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {assignable.map((c) => {
                const checked = form.caregivers.includes(c.code)
                return (
                  <label
                    key={c.code}
                    className={`flex items-center justify-center gap-2 min-h-[44px] rounded-xl border-2 font-bold text-sm cursor-pointer ${checked ? 'border-teal-500 bg-teal-50 text-teal-800' : 'border-slate-200 text-slate-600'}`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleCaregiver(c.code)} disabled={saving} className="w-4 h-4" />
                    {c.code}
                    {!c.active && <span className="text-[10px] text-slate-400">중지</span>}
                  </label>
                )
              })}
            </div>
          </fieldset>

          <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
            <input type="checkbox" aria-label="활성" checked={form.active} onChange={(e) => patch({ active: e.target.checked }, false)} disabled={saving} className="w-5 h-5" />
            <span className="text-sm font-bold text-slate-700 whitespace-nowrap shrink-0">활성</span>
            <span className="text-xs text-slate-400">끄면 요양보호사가 새 기록을 시작할 수 없습니다(기존 기록은 유지).</span>
          </label>

          {formError && (
            <div role="alert" className="rounded-xl bg-red-50 border border-red-100 p-3 text-red-700 text-sm">
              <p>{formError.message}</p>
              {formError.conflict && (
                <button type="button" onClick={() => void reopenLatest()} className="mt-2 min-h-[40px] px-3 rounded-full border border-red-300 font-bold text-xs">
                  최신 내용으로 다시 열기
                </button>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="flex-1 min-h-[48px] rounded-full bg-teal-600 text-white font-bold disabled:opacity-50">
              {saving ? '저장 중…' : '저장'}
            </button>
            <button type="button" onClick={closeForm} disabled={saving} className="min-h-[48px] px-5 rounded-full border-2 border-slate-300 text-slate-600 font-bold disabled:opacity-50">
              취소
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름 · 장기요양인정번호 · 코드로 찾기"
          aria-label="수급자 찾기"
          className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-base bg-white"
        />
        <div className="flex gap-2 overflow-x-auto" role="group" aria-label="수급자 보기 조건">
          {(
            [
              ['all', '전체'],
              ['active', '활성'],
              ['unassigned', '담당 미배정'],
              ['expiring', '유효기간 임박·만료'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
              className={`shrink-0 min-h-[36px] px-3 rounded-full text-xs font-bold border ${filter === id ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view.recipients.length === 0 && <p className="text-slate-400 text-center py-10">등록된 수급자가 없습니다. &lsquo;수급자 추가&rsquo;로 시작하세요.</p>}
      {view.recipients.length > 0 && shown.length === 0 && <p className="text-slate-400 text-center py-8">조건에 맞는 수급자가 없습니다.</p>}
      <ul className="flex flex-col gap-2" aria-label="수급자 목록">
        {shown.map((r) => {
          const validity = ltcValidity(r.profile.ltcValidTo, today)
          return (
            <li key={r.code} data-recipient-code={r.code} className={`rounded-2xl border shadow-sm p-4 ${r.active ? 'bg-white border-slate-100' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900">{r.code}</span>
                    <span className={`text-base font-bold ${nameOf(r) ? 'text-slate-900' : 'text-slate-400'}`}>{nameOf(r) || '이름 없음'}</span>
                    {r.profile.ltcGrade && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-100">{r.profile.ltcGrade}</span>}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.active ? 'bg-teal-100 text-teal-800' : 'bg-slate-200 text-slate-600'}`}>{r.active ? '활성' : '비활성'}</span>
                  </div>
                  {view.profileReady && (
                    <p className="mt-1 text-xs text-slate-500 break-all">
                      <span className="text-slate-400">인정번호 </span>
                      {r.profile.ltcNumber || <span className="text-slate-300">미입력</span>}
                      <span className="text-slate-300"> · </span>
                      <span className="text-slate-400">유효 </span>
                      {r.profile.ltcValidFrom && r.profile.ltcValidTo ? <span className="whitespace-nowrap">{`${r.profile.ltcValidFrom} ~ ${r.profile.ltcValidTo}`}</span> : <span className="text-slate-300">미입력</span>}
                      {validity === 'expiring' && <span className="ml-1 font-bold text-amber-700">· 갱신 시기</span>}
                      {validity === 'expired' && <span className="ml-1 font-bold text-red-700">· 만료</span>}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className="text-xs text-slate-500">담당</span>
                    <CaregiverChips codes={r.caregivers} />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button onClick={() => openEdit(r)} className="min-h-[40px] px-4 rounded-full border-2 border-slate-900 text-slate-900 font-bold text-sm hover:bg-slate-50">
                    수정
                  </button>
                  <button onClick={() => onOpenRecipient(r.code)} className="min-h-[36px] px-3 rounded-full text-teal-700 font-bold text-xs underline">
                    기록 보기
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
