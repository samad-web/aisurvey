import { Router } from 'express';
import { z } from 'zod';
import { surveyService } from '../services/survey.service.js';
import { validate } from '../middleware/validate.js';

// =============================================================================
// /api/survey - public market-research questionnaire.
//
// Mounted without requireAuth from routes/index.ts under a signUpLimiter-style
// IP rate limit. Branching rules are enforced here (defence-in-depth: the
// React form hides hidden fields and the DB has matching CHECK constraints
// in 0031_survey_responses.sql, so a malformed client can't poison the
// table). Slug values mirror apps/web/src/lib/survey-questions.ts.
// =============================================================================

// ---- Slug domains -----------------------------------------------------------

const BarCouncil = z.enum(['tamil-nadu-puducherry','karnataka','andhra-pradesh','telangana','kerala','other']);
const PractitionerStatus = z.enum(['enrolled','student']);
const Role = z.enum([
  'designated-senior','senior-partner','partner','senior-associate','associate',
  'junior','solo-own','solo-under-senior','in-house','other',
]);
const Years = z.enum(['0-2','3-5','6-10','11-20','20+']);
const FirmSize = z.enum(['solo','small','medium','large']);
const Procurement = z.enum(['central-it','practice-group','rfp','partner','dont-know']);
const DecisionSolo = z.enum(['fully','consult','follow']);
const Decision = z.enum([
  'managing-partner','committee','each-partner','practice-head','ops-finance','me','dont-know',
]);
const SupportStaff = z.enum(['0','1-3','4-10','10+','1-2','3-5','5+']);
const Language = z.enum(['english','tamil','telugu','kannada','malayalam','hindi','urdu','other']);
const Forum = z.enum([
  'madras-hc-chennai','madras-hc-madurai','other-hc','sc','district','magistrate',
  'nclt','itat','drt','consumer','family','rera','cat-sat','ngt','arbitration',
  'lok-adalat','tax-authorities','other-forum',
]);
const Practice = z.enum([
  'civil','criminal-def','criminal-pros','138','corporate','banking','ibc',
  'direct-tax','gst','ip','labour','family','real-estate','arbitration','writ',
  'service','consumer','cyber','white-collar','land-records','other-practice',
]);
const Clients = z.enum([
  'individuals','sme','midmarket','large-corp','govt','referral','startups','ngo','pro-bono',
]);
const Research = z.enum([
  'scc','scc-ai','manupatra','manupatra-ai','westlaw','lexis','air','taxmann',
  'kanoon','casemine','legitquest','supreme-today','vidur','bharatlaw','livelaw',
  'court-sites','physical','other-research',
]);
const Drafting = z.enum([
  'word-templates','word-fresh','gdocs','ai-direct','ai-embedded','handwritten','dictation','other',
]);
const Storage = z.enum([
  'local','physical','gdrive','gworkspace','onedrive','dropbox','onprem','dms',
  'indian-pms','whatsapp','email','other',
]);
const StorageMediumLargeOnly: ReadonlySet<string> = new Set(['dms']);
const CaseMgmt = z.enum(['yes','no','unsure']);
const Efile = z.enum([
  'ecourts','madras-hc','sc-efile','nclt','itat','drt','gst','it','mca','rera',
  'other-efile','none-efile',
]);
const Rankings = z.enum([
  'research','petitions','notices','contracts','review','chronology','summary',
  'translation','cause-list','client-comm','filing','billing','org','juniors',
]);
const RankingsFirmOnly: ReadonlySet<string> = new Set(['juniors']);
const Hurdle = z.enum([
  'time','info','repetitive','juniors','court-infra','clients','updates','payments','other',
]);
const HurdleFirmOnly: ReadonlySet<string> = new Set(['juniors']);
const AdminHours = z.enum(['<1','1-2','2-4','4+']);
const AiUsage = z.enum(['daily','weekly','occasional','stopped','never','unsure']);
const AiTools = z.enum([
  'chatgpt','claude','gemini','copilot','perplexity','scc-ai','manupatra-ai',
  'amicus','legitquest','vidur','bharatlaw','harvey','lexis','cocounsel',
  'free-india','draft-bot-pro','other-ai',
]);
const StopReason = z.enum([
  'hallucination','outdated','privacy','bar-rules','court-reception','liability',
  'conventions','cost','verify','workflow','seniors','other',
]);
const Spend = z.enum([
  '<10k','10-25k','25-50k','50k-1L','1L+','na',
  '<25k','1-3L','3-10L','10L+',
  '<1L','10-25L','25L+',
  '<5L','5-10L','25L-1Cr','1Cr+',
]);
const SPEND_BY_COHORT: Record<z.infer<typeof FirmSize>, ReadonlySet<string>> = {
  solo:   new Set(['<10k','10-25k','25-50k','50k-1L','1L+','na']),
  small:  new Set(['<25k','25-50k','50k-1L','1-3L','3-10L','10L+','na']),
  medium: new Set(['<1L','1-3L','3-10L','10-25L','25L+','na']),
  large:  new Set(['<5L','5-10L','10-25L','25L-1Cr','1Cr+','na']),
};
const WillPay = z.enum([
  '<500','500-1000','1000-2500','2500-5000','5000+','free-only',
  '<1000','5000-10000','10000+',
  '<2500','10000-20000','20000+',
  '<5000','10000-25000','25000-50000','50000+','enterprise',
]);
const WILL_PAY_BY_COHORT: Record<z.infer<typeof FirmSize>, ReadonlySet<string>> = {
  solo:   new Set(['<500','500-1000','1000-2500','2500-5000','5000+','free-only']),
  small:  new Set(['<1000','1000-2500','2500-5000','5000-10000','10000+','free-only']),
  medium: new Set(['<2500','2500-5000','5000-10000','10000-20000','20000+','free-only']),
  large:  new Set(['<5000','5000-10000','10000-25000','25000-50000','50000+','enterprise']),
};
const PricingModel = z.enum([
  'monthly','annual','firm-flat','usage','freemium','tiered','one-time',
]);
const PricingModelFirmOnly: ReadonlySet<string> = new Set(['firm-flat']);
const Switching = z.enum([
  'immediate','backup','parallel','junior-first','disruptive','trust-current',
]);
const SwitchingFirmOnly: ReadonlySet<string> = new Set(['junior-first']);
const Concern = z.enum([
  'hallucination','confidentiality','bar-rules','liability','cost','learning',
  'seniors','integration','infrastructure','juniors-skill','other',
]);
const ConcernFirmOnly: ReadonlySet<string> = new Set(['seniors','juniors-skill']);
const DataLocation = z.enum([
  'india-strict','india','encrypted','onprem','unsure',
]);
const Recommended = z.enum([
  'very-likely','likely','neutral','unlikely','very-unlikely',
]);
const YesNo = z.enum(['yes','no']);
const YesMaybeNo = z.enum(['yes','maybe','no']);

// ---- Helpers ---------------------------------------------------------------

const trimmed = (min: number) => z.string().trim().min(min);

const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v ?? undefined));

// `.min()` / `.max()` are on ZodArray, but `.superRefine()` returns
// ZodEffects (without them). Apply size bounds first, then the dup check.
const uniqueArray = <T extends z.ZodTypeAny>(
  item: T,
  opts: { min?: number; max?: number } = {},
) => {
  let a = z.array(item);
  if (opts.min !== undefined) a = a.min(opts.min) as typeof a;
  if (opts.max !== undefined) a = a.max(opts.max) as typeof a;
  return a.superRefine((arr, ctx) => {
    if (new Set(arr as readonly string[]).size !== arr.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate options not allowed' });
    }
  });
};

// ---- Top-level schema ------------------------------------------------------

const SurveyInput = z.object({
  // Step 2
  name:                 trimmed(1),
  email:                z.string().trim().email(),
  phone:                trimmed(4),
  city:                 trimmed(1),
  practitionerStatus:   PractitionerStatus,
  barCouncil:           BarCouncil.optional(),   // required only when enrolled (superRefine)
  barEnrollmentNumber:  z
    .string()
    .trim()
    .max(64, 'Enrolment number is too long')
    .transform((v) => (v === '' ? undefined : v))
    .optional(),
  institution:          z.string().trim().max(200).optional(),
  course:               z.string().trim().max(200).optional(),

  // Step 3
  role:      Role,
  years:     Years,
  firmSize:  FirmSize,

  // Step 4 (cohort-dependent - see superRefine below). Only procurement
  // survives the survey trim; the other Step-4 fields were dropped.
  procurement:     Procurement.optional(),

  // Step 5
  language:  uniqueArray(Language, { min: 1 }),
  forum:     uniqueArray(Forum, { min: 1 }),
  practice:  uniqueArray(Practice, { min: 1, max: 5 }),
  clients:   uniqueArray(Clients, { min: 1 }),

  // Step 6
  research:     uniqueArray(Research, { min: 1 }),
  drafting:     uniqueArray(Drafting, { min: 1 }),
  storage:      uniqueArray(Storage, { min: 1 }),
  caseMgmt:     CaseMgmt.optional(),
  caseMgmtSpec: optionalText,
  efile:        uniqueArray(Efile, { min: 1 }).optional(),

  // Step 7
  painOpen:    trimmed(1),
  rankings:    uniqueArray(Rankings, { min: 1, max: 3 }),
  hurdle:      uniqueArray(Hurdle, { min: 1 }),
  adminHours:  AdminHours,

  // Step 8
  aiUsage:     AiUsage,
  aiTools:     uniqueArray(AiTools, { min: 1 }).optional(),
  stopReason:  uniqueArray(StopReason, { min: 1 }).optional(),
  aiWants:     trimmed(1),

  // Step 9
  spend:         Spend,
  willPay:       WillPay,
  pricingModel:  uniqueArray(PricingModel, { min: 1 }),

  // Step 10
  concern:       uniqueArray(Concern, { min: 1 }),
  dataLocation:  DataLocation,
  recommended:   Recommended,

  // Step 11
  interview:    YesNo.optional(),
  beta:         YesNo.optional(),
  pilot:        YesMaybeNo.optional(),
  founderCall:  YesNo.optional(),

  // Other-reveal text inputs, keyed by field name (e.g. role, forum, hurdle).
  otherTexts: z.record(z.string(), z.string()).optional().default({}),
}).superRefine((v, ctx) => {
  const isFirm = v.firmSize === 'small' || v.firmSize === 'medium' || v.firmSize === 'large';

  // Step 2 student/enrolled branch -----------------------------------------
  if (v.practitionerStatus === 'enrolled') {
    if (!v.barCouncil) {
      ctx.addIssue({ code: 'custom', path: ['barCouncil'], message: 'State Bar Council is required for enrolled advocates.' });
    }
    if (v.institution !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['institution'], message: 'Institution is only asked for students.' });
    }
    if (v.course !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['course'], message: 'Course is only asked for students.' });
    }
  } else {
    // student
    if (v.barCouncil !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['barCouncil'], message: 'State Bar Council is only asked for enrolled advocates.' });
    }
    if (v.barEnrollmentNumber !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['barEnrollmentNumber'], message: 'Bar enrolment number is only asked for enrolled advocates.' });
    }
    if (!v.institution || v.institution.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['institution'], message: 'Institution is required for students.' });
    }
    if (!v.course || v.course.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['course'], message: 'Course is required for students.' });
    }
  }

  // Step 4 cohort gates ----------------------------------------------------
  if (v.firmSize !== 'large' && v.procurement !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['procurement'], message: 'Procurement workflow is asked only for large firms.' });
  }

  // Step 6 caseMgmtSpec only when caseMgmt === 'yes'.
  if (v.caseMgmt !== 'yes' && v.caseMgmtSpec !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['caseMgmtSpec'], message: 'Only fill the case-management name if you answered Yes.' });
  }

  // Step 6 storage 'dms' is medium/large only.
  if (v.storage.includes('dms') && v.firmSize !== 'medium' && v.firmSize !== 'large') {
    ctx.addIssue({ code: 'custom', path: ['storage'], message: 'iManage / NetDocuments is only available to medium/large cohorts.' });
  }

  // Step 7 cohort-gated options.
  for (const slug of v.rankings) {
    if (RankingsFirmOnly.has(slug) && !isFirm) {
      ctx.addIssue({ code: 'custom', path: ['rankings'], message: `"${slug}" is only available to firm cohorts.` });
    }
  }
  for (const slug of v.hurdle) {
    if (HurdleFirmOnly.has(slug) && !isFirm) {
      ctx.addIssue({ code: 'custom', path: ['hurdle'], message: `"${slug}" hurdle is only available to firm cohorts.` });
    }
  }

  // Step 8 AI-usage branching.
  const showsAiTools = v.aiUsage === 'daily' || v.aiUsage === 'weekly' || v.aiUsage === 'occasional' || v.aiUsage === 'stopped';
  if (!showsAiTools && v.aiTools !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['aiTools'], message: 'Do not submit aiTools when ai usage is never/unsure.' });
  }
  const showsStopReason = v.aiUsage === 'stopped' || v.aiUsage === 'occasional';
  if (!showsStopReason && v.stopReason !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['stopReason'], message: 'Do not submit stopReason unless ai usage is stopped or occasional.' });
  }

  // Step 9 cohort-templated spend / willPay.
  if (!SPEND_BY_COHORT[v.firmSize].has(v.spend)) {
    ctx.addIssue({ code: 'custom', path: ['spend'], message: `Spend value not valid for ${v.firmSize} cohort.` });
  }
  if (!WILL_PAY_BY_COHORT[v.firmSize].has(v.willPay)) {
    ctx.addIssue({ code: 'custom', path: ['willPay'], message: `Willingness-to-pay not valid for ${v.firmSize} cohort.` });
  }

  // Step 9 cohort-gated options.
  for (const slug of v.pricingModel) {
    if (PricingModelFirmOnly.has(slug) && !isFirm) {
      ctx.addIssue({ code: 'custom', path: ['pricingModel'], message: `"${slug}" pricing model is only available to firm cohorts.` });
    }
  }

  // Step 10 cohort-gated concern options.
  for (const slug of v.concern) {
    if (ConcernFirmOnly.has(slug) && !isFirm) {
      ctx.addIssue({ code: 'custom', path: ['concern'], message: `"${slug}" concern is only available to firm cohorts.` });
    }
  }
});

export type SurveyResponseInput = z.infer<typeof SurveyInput>;

export const surveyRouter: Router = Router();

// RFC 4122 UUID. Anything else is silently dropped to null so a malformed
// header can't break submission — at worst the request loses idempotency.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

surveyRouter.post('/', validate({ body: SurveyInput }), async (req, res, next) => {
  try {
    const ipAddress = req.ip ?? null;
    const userAgent = req.header('user-agent') ?? null;
    const rawKey = req.header('idempotency-key');
    const idempotencyKey = rawKey && UUID_RE.test(rawKey) ? rawKey.toLowerCase() : null;
    const result = await surveyService.create(req.body as SurveyResponseInput, {
      ipAddress,
      userAgent,
      idempotencyKey,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
