import { useEffect, useRef, useState } from 'react'
import type { AdminRepo } from '../shared/adminRepo'
import {
  CONSENT_CHOICES,
  CONSENT_LABEL,
  COUNSEL_METHODS,
  COUNSEL_METHOD_LABEL,
  CONTENT_MAX,
  MEMO_MAX,
  OTHER_REASON_LABEL,
  RELATION_CHOICES,
  RELATION_MAX,
  REASON_CHOICES,
  REASON_MAX,
  STAFF_NOTE_DEADLINE_DAYS,
  changeFactSentence,
  dueOf,
  kstDateOf,
  noteState,
  pendingCount,
  validateDraftInput,
  validateStaffNote,
  type ConsentChoice,
  type CounselMethod,
  type StaffNoteDraftResult,
  type StaffNoteItem,
  type StaffNoteView,
} from '../../../shared/staffChangeNote'
import { SpinnerIcon } from './adminBadges'

/** 직원(담당 요양보호사) 변경 상담일지 — 수급자 관리에서 담당이 해제된 변경마다 한 건이 생긴다.
 * 변경일·전/후 담당·기한은 시스템이 채우고, 변경 사유·상담 방법·대상자(관계)·안내 및 동의 내용은 사람이 쓴다.
 * 확정하면 수정할 수 없다. 실패하면 입력값을 지우지 않고 그 자리에 오류를 보인다. */

interface EditorState {
  changeLogId: number
  changedOn: string
  reason: string
  counselMethod: CounselMethod | null
  consent: ConsentChoice | null
  counseleeRelation: string
  content: string
  /** 초안 만들기 입력(저장되지 않는다 — 결과 문장만 저장된다). */
  reasonChoice: string
  reasonMemo: string
  opinionMemo: string
  /** true면 상담 대상자를 목록이 아니라 직접 입력 중. */
  relationCustom: boolean
  /** 마지막으로 만든 초안(출처 표시와 "직접 고친 내용 덮어쓰기" 확인용). */
  generated: (StaffNoteDraftResult & { at: number }) | null
  /** 일지가 이미 있을 때만 — 읽은 시점의 서버 값(충돌 검사). */
  expectedUpdatedAt: string
}

const messageOf = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)
const statusOf = (e: unknown): number | null =>
  e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number' ? (e as { status: number }).status : null

const todayKst = () => kstDateOf(new Date().toISOString())

function editorFor(item: StaffNoteItem): EditorState {
  const n = item.note
  return {
    changeLogId: item.changeLogId,
    changedOn: n?.changedOn ?? item.defaultChangedOn,
    reason: n?.reason ?? '',
    counselMethod: n?.counselMethod ?? null,
    consent: n?.consent ?? null,
    counseleeRelation: n?.counseleeRelation ?? '',
    content: n?.content ?? '',
    reasonChoice: '',
    reasonMemo: '',
    opinionMemo: '',
    relationCustom: Boolean(n?.counseleeRelation) && !(RELATION_CHOICES as readonly string[]).includes(n?.counseleeRelation ?? ''),
    generated: null,
    expectedUpdatedAt: n?.updatedAt ?? '',
  }
}

const SOURCE_NOTE: Record<string, string> = {
  ai: 'AI가 선택한 내용을 기록문으로 정리했습니다. 사실과 맞는지 꼭 확인해 주세요.',
  demo: '기본 문장 초안입니다(데모에서는 AI를 호출하지 않습니다).',
  not_configured: '기본 문장 초안입니다(AI가 아직 연결되지 않았습니다).',
  failed: 'AI 연결에 실패해 기본 문장으로 만들었습니다.',
  rejected: 'AI 결과가 선택한 내용과 어긋나 기본 문장으로 바꿨습니다.',
}

/** 라디오 칩 한 개. 접근성을 위해 실제 radio 입력을 쓰고 선택 상태를 색으로도 보인다. */
function Chip({ name, label, checked, disabled, onSelect }: { name: string; label: string; checked: boolean; disabled?: boolean; onSelect: () => void }) {
  return (
    <label
      className={`flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl border-2 font-bold text-sm cursor-pointer ${checked ? 'border-teal-500 bg-teal-50 text-teal-800' : 'border-slate-200 text-slate-600'} ${disabled ? 'opacity-60' : ''}`}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} disabled={disabled} className="w-4 h-4" />
      {label}
    </label>
  )
}

function DueChip({ item, today }: { item: StaffNoteItem; today: string }) {
  const { deadline, daysLeft, due } = dueOf(item, today)
  if (due === 'done') return <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">확정 완료</span>
  if (due === 'overdue') {
    return <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800">기한 {-daysLeft}일 지남 · {deadline}</span>
  }
  const cls = due === 'due_soon' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{daysLeft === 0 ? '오늘까지' : `${daysLeft}일 남음`} · {deadline}</span>
}

function StateChip({ item }: { item: StaffNoteItem }) {
  const s = noteState(item)
  const label = s === 'confirmed' ? '확정' : s === 'draft' ? '작성 중' : '미작성'
  const cls = s === 'confirmed' ? 'bg-teal-50 text-teal-800 border-teal-100' : s === 'draft' ? 'bg-sky-50 text-sky-800 border-sky-100' : 'bg-amber-50 text-amber-800 border-amber-100'
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>
}

export function StaffNotePanel({ repo, reloadKey }: { repo: AdminRepo; reloadKey: number }) {
  const [view, setView] = useState<StaffNoteView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ message: string; conflict: boolean } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  /** 직접 고친 문장이 있을 때 새 초안으로 바꿀지 묻는 중. */
  const [askOverwrite, setAskOverwrite] = useState(false)
  const savingRef = useRef(false)

  const load = async () => {
    try {
      setView(await repo.getStaffNotes())
      setLoadError(null)
    } catch (e) {
      setLoadError(messageOf(e, '상담일지를 불러오지 못했습니다.'))
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, reloadKey])

  if (loadError && !view) {
    return (
      <section aria-label="직원 변경 상담일지" className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">
        <p role="alert">{loadError}</p>
        <button onClick={() => void load()} className="mt-2 min-h-[40px] px-4 rounded-full border-2 border-slate-900 font-bold text-xs text-slate-900">
          다시 불러오기
        </button>
      </section>
    )
  }
  if (!view) {
    return (
      <div className="flex justify-center py-4">
        <SpinnerIcon className="w-5 h-5 text-teal-600" />
      </div>
    )
  }
  if (!view.ready) {
    return (
      <section aria-label="직원 변경 상담일지" className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-amber-900 text-sm">
        <p className="font-bold">직원 변경 상담일지 준비 중</p>
        <p className="mt-1">DB 마이그레이션(db/migrations/2026-10-03-staff-change-notes.sql)을 아직 적용하지 않았습니다. 적용하면 담당을 바꾼 수급자마다 상담일지를 쓸 수 있습니다.</p>
      </section>
    )
  }

  const today = todayKst()
  const pending = pendingCount(view.items)
  const item = editor ? view.items.find((i) => i.changeLogId === editor.changeLogId) : undefined
  const locked = item?.note?.status === 'confirmed'

  const patch = (changes: Partial<EditorState>) => {
    setConfirming(false)
    setAskOverwrite(false)
    setEditor((e) => (e ? { ...e, ...changes } : e))
  }

  const generate = async (force = false) => {
    if (!editor || generating || locked) return
    const input = {
      reasonLabel: editor.reasonChoice,
      reasonMemo: editor.reasonMemo.trim(),
      counselMethod: editor.counselMethod as CounselMethod,
      relation: editor.counseleeRelation.trim(),
      consent: editor.consent as ConsentChoice,
      opinionMemo: editor.opinionMemo.trim(),
    }
    const problem = !editor.counselMethod || !editor.consent ? '상담 방법과 의견·동의 여부를 선택해 주세요.' : validateDraftInput(input)
    if (problem) {
      setError({ message: problem, conflict: false })
      return
    }
    // 사람이 직접 고친(또는 이미 쓴) 문장이 있으면 덮어쓰기 전에 한 번 묻는다.
    const hasText = editor.reason.trim() !== '' || editor.content.trim() !== ''
    const untouched = editor.generated && editor.reason === editor.generated.reason && editor.content === editor.generated.content
    if (!force && hasText && !untouched) {
      setAskOverwrite(true)
      return
    }
    setGenerating(true)
    setError(null)
    setAskOverwrite(false)
    try {
      const draft = await repo.draftStaffNoteText(input)
      setEditor((e) => (e ? { ...e, reason: draft.reason, content: draft.content, generated: { ...draft, at: Date.now() } } : e))
    } catch (e) {
      setError({ message: messageOf(e, '초안을 만들지 못했습니다. 선택한 내용은 그대로 두었습니다.'), conflict: false })
    } finally {
      setGenerating(false)
    }
  }

  const open = (i: StaffNoteItem) => {
    setNotice(null)
    setError(null)
    setConfirming(false)
    setEditor(editorFor(i))
  }

  const close = () => {
    if (savingRef.current) return
    setEditor(null)
    setError(null)
    setConfirming(false)
  }

  const save = async (confirm: boolean) => {
    if (!editor || savingRef.current) return
    const problem = validateStaffNote({ ...editor, confirm }, today)
    if (problem) {
      setError({ message: problem, conflict: false })
      setConfirming(false)
      return
    }
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const res = await repo.saveStaffNote({
        changeLogId: editor.changeLogId,
        changedOn: editor.changedOn,
        reason: editor.reason.trim(),
        counselMethod: editor.counselMethod,
        consent: editor.consent,
        counseleeRelation: editor.counseleeRelation.trim(),
        content: editor.content.trim(),
        confirm,
        expectedUpdatedAt: editor.expectedUpdatedAt || undefined,
      })
      setNotice(res.status === 'confirmed' ? '상담일지를 확정했습니다. 확정한 일지는 수정할 수 없습니다.' : '초안을 저장했습니다. 확정하기 전까지 이어서 쓸 수 있습니다.')
      setEditor(null)
      setConfirming(false)
      await load()
    } catch (e) {
      setError({ message: messageOf(e, '저장하지 못했습니다. 입력한 내용은 그대로 두었습니다.'), conflict: statusOf(e) === 409 })
      setConfirming(false)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const reopenLatest = async () => {
    if (!editor) return
    try {
      const latest = await repo.getStaffNotes()
      setView(latest)
      const next = latest.items.find((i) => i.changeLogId === editor.changeLogId)
      if (next) setEditor(editorFor(next))
      setError(null)
    } catch (e) {
      setError({ message: messageOf(e, '최신 내용을 불러오지 못했습니다.'), conflict: true })
    }
  }

  return (
    <section aria-label="직원 변경 상담일지" className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-bold text-slate-900">
          직원 변경 상담일지 {pending > 0 && <span className="ml-1 text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">쓸 일지 {pending}건</span>}
        </h3>
        <p className="text-slate-400 text-xs mt-0.5">
          담당 요양보호사가 바뀌면 변경 사실과 사유, 수급자(보호자)에게 안내하고 동의받은 과정을 {STAFF_NOTE_DEADLINE_DAYS}일 안에 남깁니다(이지케어 도움말 기준). 변경일과 담당자는 자동으로 채워지고, 사유와 안내·동의 내용은 직접 확인한 대로 적습니다.
        </p>
      </div>

      {notice && (
        <p role="status" className="rounded-2xl bg-teal-50 border border-teal-200 px-4 py-3 text-teal-800 text-sm font-bold">
          {notice}
        </p>
      )}

      {editor && item && (
        <form
          aria-label={`${item.recipientCode} 직원 변경 상담일지`}
          onSubmit={(e) => {
            e.preventDefault()
            if (locked) return
            // 빈 칸이 있으면 확인창을 띄우기 전에 먼저 알려 준다.
            const problem = validateStaffNote({ ...editor, confirm: true }, today)
            if (problem) {
              setError({ message: problem, conflict: false })
              return
            }
            setError(null)
            setConfirming(true)
          }}
          className="rounded-2xl bg-white border-2 border-teal-200 shadow-sm p-4 flex flex-col gap-4"
        >
          <div>
            <h4 className="font-bold text-slate-900">
              {item.recipientCode}
              {item.displayName ? ` · ${item.displayName}` : ''} 직원 변경 상담일지
            </h4>
            <p className="mt-1 text-sm text-slate-700 bg-slate-50 rounded-xl px-3 py-2" data-testid="staff-note-fact">
              {changeFactSentence(item, editor.changedOn)}
            </p>
            {!locked && <p className="mt-1 text-xs text-slate-400">위 문장은 담당 변경 기록에서 자동으로 만든 것입니다. 사유와 동의 내용은 포함되어 있지 않습니다.</p>}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-slate-700">변경일자</span>
            <input
              type="date"
              value={editor.changedOn}
              max={today}
              onChange={(e) => patch({ changedOn: e.target.value })}
              disabled={saving || locked}
              className="min-h-[44px] w-48 rounded-xl border border-slate-300 px-3 text-base"
            />
            <span className="text-xs text-slate-400">실제로 담당이 바뀐 날입니다. 기한은 이 날짜 + {STAFF_NOTE_DEADLINE_DAYS}일입니다.</span>
          </label>

          {!locked && (
            <div className="rounded-2xl bg-teal-50/60 border border-teal-100 p-3 flex flex-col gap-4">
              <div>
                <p className="text-sm font-bold text-teal-900">빠른 선택 — 고르고 &lsquo;초안 만들기&rsquo;를 누르세요</p>
                <p className="text-xs text-teal-800/70 mt-0.5">고른 내용만으로 사유와 상담 내용 문장을 만듭니다. 고르지 않은 내용은 지어내지 않습니다.</p>
              </div>

              <fieldset className="flex flex-col gap-2" disabled={saving}>
                <legend className="text-sm font-bold text-slate-700">사유 선택</legend>
                <div className="flex flex-wrap gap-2">
                  {REASON_CHOICES.map((r) => (
                    <Chip key={r.id} name="reason-choice" label={r.label} checked={editor.reasonChoice === r.label} onSelect={() => patch({ reasonChoice: r.label })} />
                  ))}
                </div>
                {editor.reasonChoice !== '' && (
                  <input
                    aria-label="사유 추가 설명"
                    value={editor.reasonMemo}
                    onChange={(e) => patch({ reasonMemo: e.target.value })}
                    maxLength={MEMO_MAX + 20}
                    placeholder={editor.reasonChoice === OTHER_REASON_LABEL ? '사유를 직접 적어 주세요(필수)' : '덧붙일 설명이 있으면 적어 주세요(선택)'}
                    className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-base bg-white"
                  />
                )}
              </fieldset>

              <fieldset className="flex flex-col gap-2" disabled={saving}>
                <legend className="text-sm font-bold text-slate-700">상담 방법</legend>
                <div className="flex flex-wrap gap-2">
                  {COUNSEL_METHODS.map((m) => (
                    <Chip key={m} name="counsel-method" label={COUNSEL_METHOD_LABEL[m]} checked={editor.counselMethod === m} onSelect={() => patch({ counselMethod: m })} />
                  ))}
                </div>
              </fieldset>

              <fieldset className="flex flex-col gap-2" disabled={saving}>
                <legend className="text-sm font-bold text-slate-700">상담 대상자(관계)</legend>
                <div className="flex flex-wrap gap-2">
                  {RELATION_CHOICES.map((r) => (
                    <Chip
                      key={r}
                      name="relation-choice"
                      label={r}
                      checked={!editor.relationCustom && editor.counseleeRelation === r}
                      onSelect={() => patch({ counseleeRelation: r, relationCustom: false })}
                    />
                  ))}
                  <Chip name="relation-choice" label="직접 입력" checked={editor.relationCustom} onSelect={() => patch({ relationCustom: true, counseleeRelation: '' })} />
                </div>
                {editor.relationCustom && (
                  <input
                    aria-label="상담 대상자 직접 입력"
                    value={editor.counseleeRelation}
                    onChange={(e) => patch({ counseleeRelation: e.target.value })}
                    maxLength={RELATION_MAX + 10}
                    placeholder="관계만 적어 주세요(예: 요양보호사 가족) — 실명·전화번호는 쓰지 마세요"
                    className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-base bg-white"
                  />
                )}
              </fieldset>

              <fieldset className="flex flex-col gap-2" disabled={saving}>
                <legend className="text-sm font-bold text-slate-700">수급자(보호자)의 의견·동의 여부</legend>
                <div className="flex flex-wrap gap-2">
                  {CONSENT_CHOICES.map((c) => (
                    <Chip key={c} name="consent-choice" label={CONSENT_LABEL[c]} checked={editor.consent === c} onSelect={() => patch({ consent: c })} />
                  ))}
                </div>
                <p className="text-xs text-slate-500">동의 여부는 AI가 정하지 않습니다. 실제로 확인한 것만 고르세요.</p>
                {(editor.consent === 'agreed_with_opinion' || editor.consent === 'not_agreed') && (
                  <input
                    aria-label="의견 내용"
                    value={editor.opinionMemo}
                    onChange={(e) => patch({ opinionMemo: e.target.value })}
                    maxLength={MEMO_MAX + 20}
                    placeholder={editor.consent === 'agreed_with_opinion' ? '어떤 의견이었는지 적어 주세요(필수)' : '반대 이유나 의견이 있으면 적어 주세요(선택)'}
                    className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-base bg-white"
                  />
                )}
              </fieldset>

              <button
                type="button"
                onClick={() => void generate()}
                disabled={saving || generating}
                className="min-h-[48px] rounded-full bg-slate-900 text-white font-bold disabled:opacity-50"
              >
                {generating ? '초안 만드는 중…' : editor.generated ? '초안 다시 만들기' : '초안 만들기'}
              </button>
              {askOverwrite && (
                <div role="alertdialog" aria-label="초안 덮어쓰기 확인" className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-900 text-sm">
                  <p className="font-bold">이미 적은(또는 직접 고친) 문장이 있습니다. 새 초안으로 바꿀까요?</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => void generate(true)} className="min-h-[44px] px-5 rounded-full bg-slate-900 text-white font-bold text-sm">
                      새 초안으로 바꾸기
                    </button>
                    <button type="button" onClick={() => setAskOverwrite(false)} className="min-h-[44px] px-5 rounded-full border-2 border-slate-300 text-slate-600 font-bold text-sm">
                      그대로 두기
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {editor.generated && !locked && (
            <p role="status" data-testid="staff-note-source" className={`rounded-xl px-3 py-2 text-sm font-bold ${editor.generated.source === 'ai' ? 'bg-violet-50 text-violet-800' : 'bg-slate-100 text-slate-700'}`}>
              {editor.generated.source === 'ai' ? 'AI 초안 · ' : '기본 문장 초안 · '}
              {SOURCE_NOTE[editor.generated.source === 'ai' ? 'ai' : (editor.generated.fallbackReason ?? 'not_configured')]}
              {(editor.reason !== editor.generated.reason || editor.content !== editor.generated.content) && ' (직접 고친 내용이 있습니다)'}
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-slate-700">변경 사유 문장{!locked && ' (초안 · 수정 가능)'}</span>
            <textarea
              value={editor.reason}
              onChange={(e) => patch({ reason: e.target.value })}
              maxLength={REASON_MAX}
              rows={2}
              disabled={saving || locked}
              placeholder="위에서 고르고 초안을 만들면 여기에 채워집니다. 직접 적어도 됩니다."
              className="rounded-xl border border-slate-300 px-3 py-2 text-base"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-slate-700">안내한 내용과 의견·동의 문장{!locked && ' (초안 · 수정 가능)'}</span>
            <textarea
              value={editor.content}
              onChange={(e) => patch({ content: e.target.value })}
              maxLength={CONTENT_MAX}
              rows={5}
              disabled={saving || locked}
              placeholder="초안을 만들면 [안내]와 [의견·동의] 두 줄이 채워집니다. 사실과 다르면 고쳐 주세요."
              className="rounded-xl border border-slate-300 px-3 py-2 text-base"
            />
            {locked && (
              <span className="text-xs text-slate-500">
                의견·동의 여부: <b>{editor.consent ? CONSENT_LABEL[editor.consent] : '-'}</b> · 상담 방법: <b>{editor.counselMethod ? COUNSEL_METHOD_LABEL[editor.counselMethod] : '-'}</b> · 대상자: <b>{editor.counseleeRelation || '-'}</b>
              </span>
            )}
          </label>

          {error && (
            <div role="alert" className="rounded-xl bg-red-50 border border-red-100 p-3 text-red-700 text-sm">
              <p>{error.message}</p>
              {error.conflict && (
                <button type="button" onClick={() => void reopenLatest()} className="mt-2 min-h-[40px] px-3 rounded-full border border-red-300 font-bold text-xs">
                  최신 내용으로 다시 열기
                </button>
              )}
            </div>
          )}

          {confirming && !locked && (
            <div role="alertdialog" aria-label="상담일지 확정 확인" className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-900 text-sm">
              <p className="font-bold">확정하면 이 일지는 수정할 수 없습니다. 확정할까요?</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => void save(true)} disabled={saving} className="min-h-[44px] px-5 rounded-full bg-teal-600 text-white font-bold text-sm disabled:opacity-50">
                  {saving ? '확정 중…' : '확정하기'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={saving} className="min-h-[44px] px-5 rounded-full border-2 border-slate-300 text-slate-600 font-bold text-sm">
                  돌아가기
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {!locked && (
              <>
                <button type="button" onClick={() => void save(false)} disabled={saving} className="flex-1 min-h-[48px] rounded-full border-2 border-teal-600 text-teal-700 font-bold disabled:opacity-50">
                  {saving && !confirming ? '저장 중…' : '초안 저장'}
                </button>
                <button type="submit" disabled={saving} className="flex-1 min-h-[48px] rounded-full bg-teal-600 text-white font-bold disabled:opacity-50">
                  확정
                </button>
              </>
            )}
            <button type="button" onClick={close} disabled={saving} className="min-h-[48px] px-5 rounded-full border-2 border-slate-300 text-slate-600 font-bold disabled:opacity-50">
              {locked ? '닫기' : '취소'}
            </button>
          </div>
        </form>
      )}

      {view.items.length === 0 ? (
        <p className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-slate-500 text-sm">
          아직 담당이 바뀐 수급자가 없습니다. 아래 &lsquo;수정&rsquo;에서 담당 요양보호사를 바꾸면 이곳에 상담일지가 생깁니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="직원 변경 상담일지 목록">
          {view.items.map((i) => (
            <li key={i.changeLogId} data-staff-note={i.changeLogId} className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900">{i.recipientCode}</span>
                    {i.displayName && <span className="text-slate-700">{i.displayName}</span>}
                    <StateChip item={i} />
                    <DueChip item={i} today={today} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    담당 {i.fromCaregivers.join(', ')} → {i.toCaregivers.length > 0 ? i.toCaregivers.join(', ') : '미배정'} · 변경일 {i.note?.changedOn ?? i.defaultChangedOn}
                  </p>
                </div>
                <button onClick={() => open(i)} className="shrink-0 min-h-[40px] px-4 rounded-full border-2 border-slate-900 text-slate-900 font-bold text-sm hover:bg-slate-50">
                  {noteState(i) === 'confirmed' ? '보기' : noteState(i) === 'draft' ? '이어쓰기' : '작성'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
