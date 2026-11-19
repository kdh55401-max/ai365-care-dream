-- 2026-11-19 · 논문 연구용 요양보호사 흐름: 하루 전사본 저장 + 주간 상태변화기록 초안
--
-- 적용 방법: Supabase 대시보드 > SQL Editor에 이 파일 전체를 붙여 한 번 실행한다(여러 번 실행해도 안전).
-- 선행 조건: db/schema.sql
-- 성격: 추가형 — 기존 행·컬럼·보고를 바꾸거나 지우지 않는다.
--   · reports.transcript_only: AI 정리본 없이 원자료 전사본(첫 발화 + 되묻기 문답)만 제출한 하루 기록
--   · reports.ai_questions_source: 하루 되묻기 질문을 만든 방식('ai' | 'rule')
--   · weekly_drafts: 요양보호사·어르신·주(월요일 시작) 단위 주간 초안.
--       원자료(묶은 보고 id) / AI 초안 / 요양보호사 수정본 / 관리자 확정본을 각각 따로 보관한다.
--   · research_settings(사전·사후 기준일), research_participants(연구 동의·고수준 태그),
--     research_pre_records(도입 이전 상태변화기록, 사전 자료)
--
-- 적용 후 확인:
--   select exists(select 1 from information_schema.columns where table_name='reports' and column_name='transcript_only') as transcript_only,
--          exists(select 1 from information_schema.tables where table_name='weekly_drafts') as weekly_drafts;

alter table reports add column if not exists transcript_only boolean not null default false;
alter table reports add column if not exists ai_questions_source text;

create table if not exists weekly_drafts (
  id uuid primary key default gen_random_uuid(),
  participant_code text not null references participants(code),
  recipient_code text not null references recipients(code),
  week_start date not null,                         -- 그 주 월요일(KST)
  source_report_ids jsonb not null default '[]'::jsonb,  -- 초안을 만들 때 묶은 하루 기록 id
  ai_draft text,                                    -- AI 초안(원문 그대로 보관, 이후 수정하지 않음)
  ai_model text,                                    -- 'rule'이면 AI 없이 만든 자동 정리
  ai_created_at timestamptz,
  caregiver_text text,                              -- 요양보호사가 고쳐 보낸 수정본
  caregiver_edit_seconds integer,                   -- 초안을 연 뒤 전송까지 걸린 시간
  status text not null default 'draft' check (status in ('draft', 'sent', 'confirmed')),
  sent_at timestamptz,
  admin_final_text text,                            -- 관리자 확정본(4단계)
  admin_note text,                                  -- 상담 기록(4단계)
  admin_followup text,                              -- 후속조치 기록(4단계)
  admin_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (participant_code, recipient_code, week_start)
);

create index if not exists weekly_drafts_status_idx on weekly_drafts (status, week_start);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on weekly_drafts to service_role';
  end if;
end $$;

-- ── 연구용 데이터 설계(5단계) ─────────────────────────────────────────
-- 사전·사후 기준일 등 연구 설정. key='cutoff_date' 값이 없으면
--   앱 기록(reports·weekly_drafts)은 사후, 도입 전 기록(research_pre_records)은 사전으로 본다.
create table if not exists research_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- 요양보호사 연구 참여 동의·고수준 태그. 동의한 사람만 연구용 내보내기에 들어간다.
create table if not exists research_participants (
  caregiver_code text primary key references participants(code),
  consented boolean not null default false,
  consent_date date,
  high_baseline boolean not null default false,   -- 기록 수준이 이미 높은 요양보호사(분석에서 따로 구분)
  note text,
  updated_at timestamptz not null default now()
);

-- 도입 이전(사전) 상태변화기록. 종이·이지케어 기록을 관리자가 옮겨 적는다. 앱 기록과 섞지 않는다.
create table if not exists research_pre_records (
  id uuid primary key default gen_random_uuid(),
  caregiver_code text not null references participants(code),
  recipient_code text not null references recipients(code),
  record_date date not null,
  record_text text not null,
  writing_seconds integer check (writing_seconds is null or writing_seconds >= 0),
  source text not null default 'paper' check (source in ('paper', 'easycare', 'other')),
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists research_pre_records_date_idx on research_pre_records (record_date) where deleted = false;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on research_settings, research_participants, research_pre_records to service_role';
  end if;
end $$;
