-- =============================================================================
-- 0006_practitioner_status_and_trim.sql
-- =============================================================================
-- Adds the practitioner_status / institution / course columns so the contact
-- step can branch between enrolled advocates and law students, and relaxes
-- bar_council so students can submit without it.
--
-- Also relaxes the legacy "low signal" columns (firm_departments,
-- support_staff, decision, decision_solo, ai_wish, switching) — the new
-- code path no longer writes them, but we keep the columns nullable on
-- disk so old rows remain queryable without a destructive drop.
-- =============================================================================

-- New Step-2 columns ---------------------------------------------------------
alter table survey_responses
  add column if not exists practitioner_status   text,
  add column if not exists institution           text,
  add column if not exists course                text;

-- practitioner_status: required for new rows; nullable so legacy rows pass.
alter table survey_responses
  drop constraint if exists survey_practitioner_status_chk;
alter table survey_responses
  add constraint survey_practitioner_status_chk check (
    practitioner_status is null or practitioner_status in ('enrolled','student')
  );

-- institution / course: soft length cap.
alter table survey_responses
  drop constraint if exists survey_institution_length;
alter table survey_responses
  add constraint survey_institution_length check (
    institution is null or char_length(institution) <= 200
  );

alter table survey_responses
  drop constraint if exists survey_course_length;
alter table survey_responses
  add constraint survey_course_length check (
    course is null or char_length(course) <= 200
  );

-- Cross-field gate: enrolled => bar_council required & student fields blank;
-- student => institution + course required & bar fields blank. Applied only
-- when practitioner_status is set, so historic rows (status NULL) are
-- exempt and don't trip the constraint.
alter table survey_responses
  drop constraint if exists survey_practitioner_status_branch_chk;
alter table survey_responses
  add constraint survey_practitioner_status_branch_chk check (
    practitioner_status is null
    or (practitioner_status = 'enrolled'
        and bar_council is not null
        and institution is null
        and course is null)
    or (practitioner_status = 'student'
        and bar_council is null
        and bar_enrollment_number is null
        and institution is not null
        and course is not null)
  );

-- bar_council: was NOT NULL, now nullable (students don't have one).
alter table survey_responses
  alter column bar_council drop not null;

-- Trim columns: keep on disk for existing rows but relax their NOT NULL
-- (none of them were NOT NULL in 0001 — included here for completeness/audit).
-- No-op statements left for documentation; safe to re-run.
alter table survey_responses alter column firm_departments  drop not null;
alter table survey_responses alter column support_staff     drop not null;
alter table survey_responses alter column decision_solo     drop not null;
alter table survey_responses alter column ai_wish           drop not null;
