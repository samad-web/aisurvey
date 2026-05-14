// =============================================================================
// Slug → human-readable label maps for the /dashboard view.
//
// Derived from STEPS + cohort templates in `./survey-questions.ts`. Building
// this once at module load keeps chart rendering O(1) per slug, and lets the
// dashboard show "ChatGPT" instead of "chatgpt" without re-walking the
// question metadata on every render.
// =============================================================================

import {
  STEPS,
  SPEND_BY_COHORT,
  WILL_PAY_BY_COHORT,
  COHORT_LABELS,
  type Cohort,
  type StepDef,
} from './survey-questions';

const fieldOptions: Record<string, Record<string, string>> = {};

function collectFromStep(step: StepDef) {
  const collect = (fields: typeof step.fields) => {
    for (const f of fields) {
      if (!f.options) continue;
      const map = (fieldOptions[f.name] ??= {});
      for (const opt of f.options) {
        map[opt.value] = opt.label;
      }
    }
  };
  collect(step.fields);
  if (step.variants) {
    for (const v of step.variants) collect(v.fields);
  }
}
for (const s of STEPS) collectFromStep(s);

// Cohort-templated options (spend, willPay) - merged across cohorts so the
// dashboard can show the right label whichever cohort produced the slug.
const spendLabels: Record<string, string> = {};
const willPayLabels: Record<string, string> = {};
for (const cohort of Object.keys(SPEND_BY_COHORT) as Cohort[]) {
  for (const o of SPEND_BY_COHORT[cohort]) spendLabels[o.value] = o.label;
  for (const o of WILL_PAY_BY_COHORT[cohort]) willPayLabels[o.value] = o.label;
}
fieldOptions.spend   = spendLabels;
fieldOptions.willPay = willPayLabels;

// Step 3 firmSize uses the cohort label map directly.
fieldOptions.firmSize = { ...COHORT_LABELS };

/** Returns the human label for a slug under a given field, or the slug itself
 *  if no mapping exists (e.g. legacy slugs that were renamed). */
export function labelFor(field: string, slug: string): string {
  const m = fieldOptions[field];
  return m?.[slug] ?? slug;
}

export function cohortLabel(c: Cohort): string {
  return COHORT_LABELS[c];
}

// Step 7 rankings labels live under the field name 'rankings'.
export const RANKING_LABELS: Record<string, string> = fieldOptions.rankings ?? {};

// Display order helpers for ordinal scales. The numeric/ordinal categories
// have a natural sort that's not alphabetical, so we precompute the order.
export const YEARS_ORDER = ['0-2', '3-5', '6-10', '11-20', '20+'];
export const ADMIN_HOURS_ORDER = ['<1', '1-2', '2-4', '4+'];
export const AI_USAGE_ORDER = ['daily', 'weekly', 'occasional', 'stopped', 'never', 'unsure'];
export const RECOMMENDED_ORDER = ['very-likely', 'likely', 'neutral', 'unlikely', 'very-unlikely'];
export const COHORT_ORDER: Cohort[] = ['solo', 'small', 'medium', 'large'];

export const SPEND_ORDER_BY_COHORT: Record<Cohort, string[]> = {
  solo:   SPEND_BY_COHORT.solo.map((o) => o.value),
  small:  SPEND_BY_COHORT.small.map((o) => o.value),
  medium: SPEND_BY_COHORT.medium.map((o) => o.value),
  large:  SPEND_BY_COHORT.large.map((o) => o.value),
};

export const WILL_PAY_ORDER_BY_COHORT: Record<Cohort, string[]> = {
  solo:   WILL_PAY_BY_COHORT.solo.map((o) => o.value),
  small:  WILL_PAY_BY_COHORT.small.map((o) => o.value),
  medium: WILL_PAY_BY_COHORT.medium.map((o) => o.value),
  large:  WILL_PAY_BY_COHORT.large.map((o) => o.value),
};
