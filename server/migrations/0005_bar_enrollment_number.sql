-- =============================================================================
-- 0005_bar_enrollment_number.sql
-- =============================================================================
-- Optional Bar Council enrolment number captured in the contact-details step.
-- Format varies wildly by state (and across decades), so we store it as free
-- text with a soft length cap; the client marks the field optional and the
-- Zod schema mirrors that. NULL is the default for legacy rows.
-- =============================================================================

alter table survey_responses
  add column if not exists bar_enrollment_number text;

alter table survey_responses
  drop constraint if exists survey_bar_enrollment_number_length;

alter table survey_responses
  add constraint survey_bar_enrollment_number_length check (
    bar_enrollment_number is null or char_length(bar_enrollment_number) <= 64
  );
