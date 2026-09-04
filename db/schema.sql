-- AI365 CARE DREAM · 60초 AI 돌봄보고 (CARE REPORT) 실증 파일럿 스키마
-- Supabase(Postgres) SQL Editor에서 그대로 실행한다.
-- 이 파일은 파일럿 전용이며 기존 AI365 CARE DREAM 확장형 MVP의 데이터/스키마와 무관하다.
--
-- 개인정보 원칙: 실명/주민등록번호/주소/장기요양 인정번호를 저장하는 컬럼은
-- 이 스키마에 존재하지 않는다. 참여자(요양보호사)와 수급자는 가명 코드로만 식별한다.

create extension if not exists pgcrypto;

-- ── 참여자(요양보호사) ────────────────────────────────────────────────
create table if not exists participants (
  code text primary key,              -- 'C01' ~ 'C09'
  pin_hash text not null,             -- bcrypt 해시. 평문 PIN은 저장하지 않는다.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 수급자 가명 코드 ──────────────────────────────────────────────────
create table if not exists recipients (
  code text primary key,              -- 'A01', 'A02' ...
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── 돌봄보고 ──────────────────────────────────────────────────────────
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),

  participant_code text not null references participants(code),
  recipient_code text not null references recipients(code),

  report_type text not null check (report_type in ('daily', 'additional')),
  report_date date not null,          -- KST 기준 실증 날짜 (YYYY-MM-DD)
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  input_method text check (input_method in ('voice', 'text')),

  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  completion_seconds integer,

  -- 최초 입력 (음성 인식 원문 또는 텍스트 원문) — 사용자의 말 그대로.
  raw_input text not null default '',

  -- AI 추가 질문 / 참여자 답변 (최대 3회, 각 {question, missingField, answeredAt})
  followup_questions jsonb not null default '[]'::jsonb,
  followup_answers jsonb not null default '[]'::jsonb,

  -- AI 구조화 보고문 {change, action, result, escalation}
  ai_generated_report jsonb,
  -- 참여자가 확인/수정한 최종 보고문 (제출본)
  caregiver_final_report jsonb,

  -- 참여자 자가 평가 (선택, 파일럿 지표용)
  caregiver_helpfulness_score smallint check (caregiver_helpfulness_score between 1 and 5),
  caregiver_would_reuse boolean,

  -- "특이사항 없음" 대응 흐름 전용 필드 ─────────────────────────────
  initial_status_choice text check (initial_status_choice in ('changed', 'similar', 'uncertain')),
  no_change_initial_input boolean not null default false,
  observed_domains_json jsonb not null default '[]'::jsonb,
  changed_domains_json jsonb not null default '[]'::jsonb,
  unobserved_domains_json jsonb not null default '[]'::jsonb,
  uncertain_domains_json jsonb not null default '[]'::jsonb,
  no_change_followup_count smallint not null default 0,
  no_change_followup_answered smallint not null default 0,
  initial_information_count smallint not null default 0,
  final_information_count smallint not null default 0,
  information_added_count smallint not null default 0,
  no_information_report boolean not null default false,
  report_source text not null default 'live' check (report_source in ('live', 'scenario')),
  scenario_id text,

  -- 관리자 평가 1단계: 최초 원문만 보고 평가 (AI 결과 공개 전)
  raw_immediately_actionable boolean,
  raw_followup_needed boolean,
  raw_completeness_score smallint check (raw_completeness_score between 1 and 5),
  raw_eval_note text,
  raw_evaluated_at timestamptz,
  raw_eval_history jsonb not null default '[]'::jsonb, -- 재평가 시 이전 값 보관

  -- 관리자 평가 2단계: AI 적용 후(최종 보고) 평가
  ai_immediately_actionable boolean,
  ai_followup_needed boolean,
  ai_completeness_score smallint check (ai_completeness_score between 1 and 5),
  actual_followup_type text check (actual_followup_type in ('none', 'sms', 'call')),
  ai_usefulness_score smallint check (ai_usefulness_score between 1 and 5),
  ai_inaccuracy_detected boolean,
  ai_eval_note text,
  manager_status text check (manager_status in ('confirmed', 'needs_followup', 'called', 'closed')),
  ai_evaluated_at timestamptz,
  ai_eval_history jsonb not null default '[]'::jsonb,

  deleted boolean not null default false,
  delete_reason text,
  deleted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reports_participant_date_idx on reports (participant_code, report_date);
create index if not exists reports_status_idx on reports (status) where deleted = false;
create index if not exists reports_submitted_at_idx on reports (submitted_at);
create index if not exists reports_source_idx on reports (report_source);

-- 이미 이 스키마를 한 번 실행해 reports 테이블이 존재하는 환경에서도 이 파일을
-- 다시 실행하면 "특이사항 없음" 흐름 컬럼이 안전하게 추가되도록 멱등 처리한다.
alter table reports add column if not exists initial_status_choice text;
alter table reports add column if not exists no_change_initial_input boolean not null default false;
alter table reports add column if not exists observed_domains_json jsonb not null default '[]'::jsonb;
alter table reports add column if not exists changed_domains_json jsonb not null default '[]'::jsonb;
alter table reports add column if not exists unobserved_domains_json jsonb not null default '[]'::jsonb;
alter table reports add column if not exists uncertain_domains_json jsonb not null default '[]'::jsonb;
alter table reports add column if not exists no_change_followup_count smallint not null default 0;
alter table reports add column if not exists no_change_followup_answered smallint not null default 0;
alter table reports add column if not exists initial_information_count smallint not null default 0;
alter table reports add column if not exists final_information_count smallint not null default 0;
alter table reports add column if not exists information_added_count smallint not null default 0;
alter table reports add column if not exists no_information_report boolean not null default false;
alter table reports add column if not exists report_source text not null default 'live';
alter table reports add column if not exists scenario_id text;

-- ── 관리자 감사 로그 (열람/평가/다운로드/PIN초기화/삭제) ──────────────
create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,               -- 'view_report' | 'evaluate_raw' | 'evaluate_ai' |
                                       -- 'export_csv' | 'reset_pin' | 'delete_report' | 'login'
  target text,                        -- report id 또는 participant code
  detail jsonb,
  created_at timestamptz not null default now()
);

-- updated_at 자동 갱신
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists reports_set_updated_at on reports;
create trigger reports_set_updated_at before update on reports
  for each row execute function set_updated_at();

drop trigger if exists participants_set_updated_at on participants;
create trigger participants_set_updated_at before update on participants
  for each row execute function set_updated_at();

-- ── 초기 데이터: 참여자 C01~C09 (PIN은 admin API로 발급/초기화) ──────
-- pin_hash는 임시로 '0000'의 bcrypt 해시가 아니라 즉시 로그인 불가능한 무효값으로 넣고,
-- 관리자가 /admin 참여자 관리 화면에서 "PIN 초기화"를 눌러 실제 PIN을 발급한다.
insert into participants (code, pin_hash, active)
select code, 'unset', true
from unnest(array['C01','C02','C03','C04','C05','C06','C07','C08','C09']) as code
on conflict (code) do nothing;

insert into recipients (code, active)
select code, true
from unnest(array['A01','A02','A03','A04','A05','A06','A07','A08','A09']) as code
on conflict (code) do nothing;

-- ── Row Level Security ───────────────────────────────────────────────
-- 모든 접근은 서버(Vercel 서버리스 함수)가 Service Role 키로만 수행한다.
-- 브라우저는 이 테이블에 직접 접근하지 않으므로 anon 키에 대해서는 전부 차단한다.
alter table participants enable row level security;
alter table recipients enable row level security;
alter table reports enable row level security;
alter table admin_audit_log enable row level security;
-- (정책을 추가하지 않으면 기본적으로 모든 접근이 거부된다. Service Role 키는
--  RLS를 우회하므로 서버 API는 정상 동작한다.)
