import { useEffect, useRef, useState } from 'react'
import type { AdminRepo } from '../shared/adminRepo'
import { DISPLAY_NAME_MAX, validateDisplayName, validateRecipientCode, type RecipientAdminRow, type RecipientAdminView } from '../../../shared/recipientAdmin'
import { SpinnerIcon } from './adminBadges'

/** 관리자 "수급자 관리" — 수급자 목록·등록·정보 수정·담당 요양보호사 배정·활성 전환.
 * 저장은 서버(DB 함수)가 한 번에 처리하고, 이 화면은 입력을 모으고 결과를 보여준다.
 * 실패하면 입력값을 지우지 않고 그 자리에 오류를 보인다. 삭제는 없다(비활성화·배정 해제만). */

interface FormState {
  mode: 'create' | 'edit'
  code: string
  displayName: string
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
  return { mode: 'create', code: '', displayName: '', customCode: '', active: true, caregivers: [], expectedUpdatedAt: '', requestId: newRequestId() }
}

function formFor(row: RecipientAdminRow): FormState {
  return {
    mode: 'edit',
    code: row.code,
    displayName: row.displayName ?? '',
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

export function RecipientAdminPanel({ repo, onOpenRecipient }: { repo: AdminRepo; onOpenRecipient: (code: string) => void }) {
  const [view, setView] = useState<RecipientAdminView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<{ message: string; conflict: boolean } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
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

  const patch = (changes: Partial<FormState>, keepRequest = true) =>
    setForm((f) => (f ? { ...f, ...changes, requestId: keepRequest || f.mode === 'create' ? f.requestId : newRequestId() } : f))

  const toggleCaregiver = (code: string) =>
    setForm((f) => {
      if (!f) return f
      const caregivers = f.caregivers.includes(code) ? f.caregivers.filter((c) => c !== code) : [...f.caregivers, code]
      return { ...f, caregivers: caregivers.sort(), requestId: f.mode === 'create' ? f.requestId : newRequestId() }
    })

  const openCreate = () => {
    setNotice(null)
    setFormError(null)
    setForm(emptyForm())
  }
  const openEdit = (row: RecipientAdminRow) => {
    setNotice(null)
    setFormError(null)
    setForm(formFor(row))
  }
  const closeForm = () => {
    if (savingRef.current) return
    setForm(null)
    setFormError(null)
  }

  const submit = async () => {
    if (!form || savingRef.current) return
    const nameError = validateDisplayName(form.displayName)
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
          displayName: form.displayName.trim(),
          caregiverCodes: form.caregivers,
          active: form.active,
          code: form.customCode.trim() ? form.customCode.trim().toUpperCase() : undefined,
          requestId: form.requestId,
        })
        setNotice(`수급자 ${res.code}을(를) 등록했습니다.${form.caregivers.length === 0 ? ' 담당자가 아직 배정되지 않았습니다.' : ''}`)
      } else {
        const res = await repo.updateRecipient({
          code: form.code,
          displayName: form.displayName.trim(),
          active: form.active,
          caregiverCodes: form.caregivers,
          expectedUpdatedAt: form.expectedUpdatedAt || undefined,
          requestId: form.requestId,
        })
        setNotice(`수급자 ${res.code} 정보를 저장했습니다.`)
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">수급자 관리 · {view.recipients.length}명</h2>
          <p className="text-slate-400 text-xs mt-0.5">별칭(표시명)으로 등록합니다. 삭제는 없고, 사용하지 않는 수급자는 비활성화합니다.</p>
        </div>
        <button onClick={openCreate} disabled={form?.mode === 'create'} className="shrink-0 min-h-[44px] px-4 rounded-full bg-teal-600 text-white font-bold text-sm disabled:opacity-40">
          수급자 추가
        </button>
      </div>

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

          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-slate-700">표시명(별칭)</span>
            <input
              value={form.displayName}
              onChange={(e) => patch({ displayName: e.target.value }, false)}
              maxLength={DISPLAY_NAME_MAX + 10}
              disabled={saving}
              placeholder="예: 햇살 어르신"
              className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-base"
            />
            <span className="text-xs text-slate-400">실명·주민등록번호·전화번호는 넣지 마세요. 앱 안에서 구분하기 위한 별칭입니다. 이 값은 AI에 전달되지 않습니다.</span>
          </label>

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

      {view.recipients.length === 0 && <p className="text-slate-400 text-center py-10">등록된 수급자가 없습니다. &lsquo;수급자 추가&rsquo;로 시작하세요.</p>}
      <ul className="flex flex-col gap-2" aria-label="수급자 목록">
        {view.recipients.map((r) => (
          <li key={r.code} data-recipient-code={r.code} className={`rounded-2xl border shadow-sm p-4 ${r.active ? 'bg-white border-slate-100' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-900">{r.code}</span>
                  <span className={`text-base ${r.displayName ? 'text-slate-900' : 'text-slate-400'}`}>{r.displayName ?? '표시명 없음'}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.active ? 'bg-teal-100 text-teal-800' : 'bg-slate-200 text-slate-600'}`}>{r.active ? '활성' : '비활성'}</span>
                </div>
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
        ))}
      </ul>
    </div>
  )
}
