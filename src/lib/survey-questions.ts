// =============================================================================
// LexDraft practitioner study - single source of truth for the /survey page.
// Mirrors lexdraft-survey.md (which strictly subsumes Legal_AI_Survey.md -
// every Legal_AI_Survey question maps to an equivalent or richer lexdraft
// question, so the merged form has no duplicates).
//
// 11 functional steps + a welcome and a thank-you. The Welcome step has no
// inputs; the survey "progress" indicator counts Step 2 through Step 11.
//
// The API has its own Zod schema in apps/api/src/routes/survey.routes.ts that
// must stay aligned with this metadata; DB CHECK constraints in
// 0031_survey_responses.sql are the third line of defence.
// =============================================================================

export type Cohort = 'solo' | 'small' | 'medium' | 'large';

export type FieldKind =
  | 'text'
  | 'email'
  | 'tel'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'rankings';

export interface Option {
  value: string;
  label: string;
  cohorts?: Cohort[];          // option-level cohort gate (e.g. dms is medium/large only)
}

export interface Field {
  name: string;                // form-field name (camelCase)
  prompt: string;
  kind: FieldKind;
  required: boolean;
  options?: Option[];
  hasOther?: boolean;          // value() === 'other' or array includes 'other'
  otherValue?: string;         // the option value that triggers the inline text field
  helper?: string;
  placeholder?: string;
  autocomplete?: string;
  maxPick?: number;            // for checkbox groups (e.g. practice areas: 5)
  cohorts?: Cohort[];          // field-level cohort gate (skip the field entirely)
}

export interface StepDef {
  index: number;               // step number (1..12)
  title: string;
  helper?: string;
  fields: Field[];
  /** Some steps split into two variants by cohort (Step 4). Each variant has
   *  its own fields list and its own cohort gate. */
  variants?: { cohorts: Cohort[]; fields: Field[] }[];
}

export const COHORT_LABELS: Record<Cohort, string> = {
  solo: 'Solo - only me',
  small: 'Small - 2 to 10 advocates',
  medium: 'Mid-size - 11 to 50 advocates',
  large: 'Large - 50+ advocates',
};

// =============================================================================
// Step definitions
// =============================================================================

const o = (value: string, label: string, cohorts?: Cohort[]): Option =>
  cohorts ? { value, label, cohorts } : { value, label };

const STEP_2_CONTACT: StepDef = {
  index: 2,
  title: 'Contact details',
  helper: 'Stored on India servers, DPDP Act 2023 compliant. Used only to share study findings and (if you opt in) follow up.',
  fields: [
    { name: 'name',  prompt: 'Full name',                              kind: 'text',  required: true, autocomplete: 'name' },
    { name: 'email', prompt: 'Email',                                  kind: 'email', required: true, autocomplete: 'email' },
    { name: 'phone', prompt: 'Phone (WhatsApp preferred)',             kind: 'tel',   required: true, autocomplete: 'tel-national' },
    { name: 'city',  prompt: 'City or town',                           kind: 'text',  required: true, placeholder: 'e.g. Chennai, Madurai' },
    {
      name: 'barCouncil',
      prompt: 'State Bar Council of enrolment',
      kind: 'select',
      required: true,
      options: [
        o('tamil-nadu-puducherry', 'Tamil Nadu and Puducherry'),
        o('karnataka',             'Karnataka'),
        o('andhra-pradesh',        'Andhra Pradesh'),
        o('telangana',             'Telangana'),
        o('kerala',                'Kerala'),
        o('other',                 'Other'),
      ],
    },
  ],
};

const STEP_3_PRACTICE: StepDef = {
  index: 3,
  title: 'Role, experience, and firm',
  helper: 'Sets your cohort - branches the rest of the survey.',
  fields: [
    {
      name: 'role',
      prompt: 'Your role',
      kind: 'select',
      required: true,
      options: [
        o('designated-senior',   'Designated Senior Advocate'),
        o('senior-partner',      'Senior Partner / Managing Partner'),
        o('partner',             'Partner / Equity Partner'),
        o('senior-associate',    'Senior Associate / Of Counsel'),
        o('associate',           'Associate'),
        o('junior',              'Junior Associate / Paralegal'),
        o('solo-own',            'Solo Practitioner - own chamber'),
        o('solo-under-senior',   'Solo Practitioner - under a senior'),
        o('in-house',            'In-house Counsel'),
        o('other',               'Other'),
      ],
      hasOther: true,
      otherValue: 'other',
    },
    {
      name: 'years',
      prompt: 'Years of practice',
      kind: 'radio',
      required: true,
      options: [
        o('0-2',   '0 to 2'),
        o('3-5',   '3 to 5'),
        o('6-10',  '6 to 10'),
        o('11-20', '11 to 20'),
        o('20+',   'More than 20'),
      ],
    },
    {
      name: 'firmSize',
      prompt: 'Firm size',
      kind: 'radio',
      required: true,
      helper: 'Count advocates only - exclude clerks, munshis, paralegals.',
      options: [
        o('solo',   'Solo - only me'),
        o('small',  'Small - 2 to 10 advocates'),
        o('medium', 'Mid-size - 11 to 50 advocates'),
        o('large',  'Large - 50+ advocates'),
      ],
    },
  ],
};

const STEP_4_FIRM: StepDef = {
  index: 4,
  title: 'About your firm or chamber',
  variants: [
    {
      cohorts: ['small', 'medium', 'large'],
      fields: [
        {
          name: 'firmDepartments',
          prompt: 'Departments or practice groups',
          kind: 'textarea',
          required: false,
          helper: 'List the top 2 to 3 by headcount, comma-separated.',
        },
        {
          name: 'supportStaff',
          prompt: 'Non-advocate support staff',
          kind: 'radio',
          required: false,
          options: [
            o('0',    '0'),
            o('1-3',  '1 to 3'),
            o('4-10', '4 to 10'),
            o('10+',  'More than 10'),
          ],
        },
        {
          name: 'procurement',
          prompt: 'Technology procurement',
          kind: 'radio',
          required: false,
          cohorts: ['large'],
          options: [
            o('central-it',      'Centralised - IT / Ops / KM lead evaluation'),
            o('practice-group',  'Practice-group-driven - each group buys'),
            o('rfp',             'Committee-based with formal RFP'),
            o('partner',         'Partner-by-partner discretionary'),
            o('dont-know',       "Don't know"),
          ],
        },
        {
          name: 'decision',
          prompt: 'Tool-purchase decision-makers',
          kind: 'checkbox',
          required: false,
          cohorts: ['small', 'medium'],
          options: [
            o('managing-partner', 'Managing / Senior Partner only'),
            o('committee',        "Partners' committee"),
            o('each-partner',     'Each partner for their own team'),
            o('practice-head',    'Practice group head'),
            o('ops-finance',      'Operations / Finance manager'),
            o('me',               'I do'),
            o('dont-know',        "Don't know"),
          ],
        },
      ],
    },
    {
      cohorts: ['solo'],
      fields: [
        {
          name: 'supportStaff',
          prompt: 'Non-advocate support',
          kind: 'radio',
          required: false,
          helper: 'Clerks, munshis, typists, paralegals.',
          options: [
            o('0',   '0'),
            o('1-2', '1 to 2'),
            o('3-5', '3 to 5'),
            o('5+',  'More than 5'),
          ],
        },
        {
          name: 'decisionSolo',
          prompt: 'Tool purchase decision',
          kind: 'radio',
          required: false,
          options: [
            o('fully',   'I decide, fully'),
            o('consult', 'I consult my senior first'),
            o('follow',  'I generally use whatever my senior uses'),
          ],
        },
      ],
    },
  ],
  fields: [],
};

const STEP_5_PRACTICE_PROFILE: StepDef = {
  index: 5,
  title: 'Where and what you practise',
  fields: [
    {
      name: 'language',
      prompt: 'Languages of court work',
      kind: 'checkbox',
      required: true,
      hasOther: true,
      otherValue: 'other',
      options: [
        o('english',   'English'),
        o('tamil',     'Tamil'),
        o('telugu',    'Telugu'),
        o('kannada',   'Kannada'),
        o('malayalam', 'Malayalam'),
        o('hindi',     'Hindi'),
        o('urdu',      'Urdu'),
        o('other',     'Other'),
      ],
    },
    {
      name: 'forum',
      prompt: 'Courts and forums',
      kind: 'checkbox',
      required: true,
      hasOther: true,
      otherValue: 'other-forum',
      options: [
        // Bench-level Madras HC split was 2 options; folded into one to
        // shorten the list (existing slug retained so historical drafts
        // submitting `madras-hc-chennai` remain valid).
        o('madras-hc-chennai', 'Madras HC (any bench)'),
        o('other-hc',          'Other High Court'),
        o('sc',                'Supreme Court'),
        o('district',          'District / Sessions'),
        o('magistrate',        'Magistrate (CJM, JMFC)'),
        o('nclt',              'NCLT / NCLAT'),
        o('itat',              'ITAT / GSTAT'),
        o('drt',               'DRT / DRAT'),
        o('consumer',          'Consumer Commission'),
        o('family',            'Family Court'),
        o('rera',              'RERA'),
        o('cat-sat',           'CAT / SAT / TDSAT / AFT'),
        o('ngt',               'NGT'),
        o('arbitration',       'Arbitration'),
        o('lok-adalat',        'Lok Adalat / Mediation'),
        o('tax-authorities',   'IT / GST authorities'),
        o('other-forum',       'Other'),
      ],
    },
    {
      name: 'practice',
      prompt: 'Practice areas (pick up to 5)',
      kind: 'checkbox',
      required: true,
      maxPick: 5,
      hasOther: true,
      otherValue: 'other-practice',
      options: [
        // Conservative consolidation: defence + prosecution -> one bucket;
        // direct tax + GST -> one tax bucket; real-estate + land-records ->
        // one real-estate bucket. Existing slugs retained so prior responses
        // remain valid against the DB CHECK + Zod enum.
        o('civil',          'Civil Litigation'),
        o('criminal-def',   'Criminal (defence or prosecution)'),
        o('138',            'Cheque Dishonour (138 NI)'),
        o('corporate',      'Corporate / M&A'),
        o('banking',        'Banking / SARFAESI'),
        o('ibc',            'IBC / Insolvency'),
        o('direct-tax',     'Tax (Direct + GST)'),
        o('ip',             'Intellectual Property'),
        o('labour',         'Labour & Employment'),
        o('family',         'Family / Matrimonial'),
        o('real-estate',    'Real Estate / RERA / Land Records'),
        o('arbitration',    'Arbitration / ADR'),
        o('writ',           'Constitutional / Writ'),
        o('service',        'Service Matters'),
        o('consumer',       'Consumer Protection'),
        o('cyber',          'Cyber / Data Protection'),
        o('white-collar',   'White-Collar (PMLA, FEMA)'),
        o('other-practice', 'Other'),
      ],
    },
    {
      name: 'clients',
      prompt: 'Typical client mix',
      kind: 'checkbox',
      required: true,
      options: [
        o('individuals', 'Individuals'),
        o('sme',         'SMEs / family firms'),
        o('midmarket',   'Mid-market corporates'),
        o('large-corp',  'Large / listed corporates'),
        o('govt',        'Government / PSUs'),
        o('referral',    'Other law firms (referrals)'),
        o('startups',    'Startups'),
        o('ngo',         'NGOs / non-profits'),
        o('pro-bono',    'Pro bono / legal aid'),
      ],
    },
  ],
};

const STEP_6_TOOLS: StepDef = {
  index: 6,
  title: 'Tools you use today',
  fields: [
    {
      name: 'research',
      prompt: 'Research platforms',
      kind: 'checkbox',
      required: true,
      hasOther: true,
      otherValue: 'other-research',
      options: [
        o('scc',            'SCC Online'),
        o('scc-ai',         'SCC Online + AI'),
        o('manupatra',      'Manupatra'),
        o('manupatra-ai',   'Manupatra AI / Manuworks'),
        o('westlaw',        'Westlaw India'),
        o('lexis',          'Lexis+ / Lexis+ AI'),
        o('air',            'AIR Online'),
        o('taxmann',        'Taxmann'),
        o('kanoon',         'Indian Kanoon (free)'),
        o('casemine',       'Casemine / AMICUS'),
        o('legitquest',     'LegitQuest'),
        o('supreme-today',  'Supreme Today AI'),
        o('vidur',          'VIDUR AI'),
        o('bharatlaw',      'BharatLaw.AI'),
        o('livelaw',        'LiveLaw / Bar & Bench'),
        o('court-sites',    'Court websites directly'),
        o('physical',       'Physical law reports'),
        o('other-research', 'Other'),
      ],
    },
    {
      name: 'drafting',
      prompt: 'Primary drafting tools',
      kind: 'checkbox',
      required: true,
      hasOther: true,
      otherValue: 'other',
      helper: 'Pick all that apply.',
      options: [
        o('word-templates', 'MS Word with firm or personal templates'),
        o('word-fresh',     'MS Word without templates'),
        o('gdocs',          'Google Docs'),
        o('ai-direct',      'AI tools directly (ChatGPT, Claude, Copilot)'),
        o('ai-embedded',    'AI tools embedded in legal platforms'),
        o('handwritten',    'Handwritten then typed'),
        o('dictation',      'Voice dictation'),
        o('other',          'Other'),
      ],
    },
    {
      name: 'storage',
      prompt: 'Document storage',
      kind: 'checkbox',
      required: true,
      hasOther: true,
      otherValue: 'other',
      options: [
        o('local',       'Local computer'),
        o('physical',    'Physical files only'),
        o('gdrive',      'Google Drive (personal)'),
        o('gworkspace',  'Google Workspace (firm)'),
        o('onedrive',    'OneDrive / SharePoint'),
        o('dropbox',     'Dropbox'),
        o('onprem',      'Firm on-premise server'),
        o('dms',         'iManage / NetDocuments', ['medium', 'large']),
        o('indian-pms',  'Indian case mgmt (LegalDesk, CaseFox)'),
        o('whatsapp',    'WhatsApp'),
        o('email',       'Email folders'),
        o('other',       'Other'),
      ],
    },
    {
      name: 'caseMgmt',
      prompt: 'Case / practice management software',
      kind: 'radio',
      required: false,
      options: [
        o('yes',    'Yes'),
        o('no',     'No'),
        o('unsure', 'Not sure'),
      ],
    },
    {
      name: 'caseMgmtSpec',
      prompt: 'If yes, which one?',
      kind: 'text',
      required: false,
      placeholder: 'e.g. PracticePanther, LegalDesk',
    },
    {
      name: 'efile',
      prompt: 'E-filing systems',
      kind: 'checkbox',
      required: false,
      hasOther: true,
      otherValue: 'other-efile',
      options: [
        o('ecourts',     'eCourts CIS / CNR'),
        o('madras-hc',   'Madras HC e-filing'),
        o('sc-efile',    'Supreme Court e-filing'),
        o('nclt',        'NCLT'),
        o('itat',        'ITAT / GSTAT'),
        o('drt',         'DRT'),
        o('gst',         'GST portal'),
        o('it',          'Income Tax portal'),
        o('mca',         'MCA V3 portal'),
        o('rera',        'TN RERA portal'),
        o('other-efile', 'Other'),
        o('none-efile',  'None'),
      ],
    },
  ],
};

const STEP_7_PAIN: StepDef = {
  index: 7,
  title: 'Where the time goes',
  fields: [
    {
      name: 'painOpen',
      prompt: 'Which tasks feel most repetitive or frustrating?',
      kind: 'textarea',
      required: true,
      helper: 'A few examples. e.g. "drafting 138 NI notices over and over with only names and figures changing".',
    },
    {
      name: 'rankings',
      prompt: 'Top 3 most time-consuming tasks',
      kind: 'rankings',
      required: true,
      helper: 'Tap to add in priority order; tap again to remove. Up to three.',
      options: [
        o('research',    'Legal research / finding precedents'),
        o('petitions',   'Drafting petitions, pleadings, submissions'),
        o('notices',     'Drafting statutory notices (138, 80 CPC, SARFAESI)'),
        o('contracts',   'Drafting contracts and agreements'),
        o('review',      'Reviewing documents / due diligence'),
        o('chronology',  'Building chronology of facts'),
        o('summary',     'Summarising judgments and orders'),
        o('translation', 'Translating English ↔ regional language'),
        o('cause-list',  'Cause-list tracking, hearing reminders'),
        o('client-comm', 'Client communication / status updates'),
        o('filing',      'Physical court filing, procedural compliance'),
        o('billing',     'Billing, invoicing, fee collection'),
        o('org',         'Organising case files'),
        o('juniors',     'Managing juniors, delegation, review', ['small', 'medium', 'large']),
      ],
    },
    {
      name: 'hurdle',
      prompt: 'Biggest hurdles in your day-to-day work',
      kind: 'checkbox',
      required: true,
      hasOther: true,
      otherValue: 'other',
      helper: 'Pick all that apply.',
      options: [
        o('time',        'Time pressure / too many matters'),
        o('info',        'Information overload'),
        o('repetitive',  'Manual / repetitive paperwork'),
        o('juniors',     'Coordinating with juniors / clerks', ['small', 'medium', 'large']),
        o('court-infra', 'Court infrastructure / e-filing issues'),
        o('clients',     'Client management'),
        o('updates',     'Keeping up with judgments and updates'),
        o('payments',    'Recovering payments from clients'),
        o('other',       'Other'),
      ],
    },
    {
      name: 'adminHours',
      prompt: 'Hours per day on non-billable admin',
      kind: 'radio',
      required: true,
      options: [
        o('<1',  'Less than 1'),
        o('1-2', '1 to 2'),
        o('2-4', '2 to 4'),
        o('4+',  'More than 4'),
      ],
    },
  ],
};

const STEP_8_AI: StepDef = {
  index: 8,
  title: 'Your experience with AI',
  fields: [
    {
      name: 'aiUsage',
      prompt: 'Current use of AI in legal work',
      kind: 'radio',
      required: true,
      options: [
        o('daily',      'Daily for substantive work'),
        o('weekly',     'Weekly'),
        o('occasional', 'Occasionally, for non-critical tasks'),
        o('stopped',    'Tried and stopped'),
        o('never',      'Have not used AI'),
        o('unsure',     'Not sure what counts as AI'),
      ],
    },
    {
      name: 'aiTools',
      prompt: 'AI tools used in the last 6 months',
      kind: 'checkbox',
      required: false,
      hasOther: true,
      otherValue: 'other-ai',
      helper: 'Shown if you have used AI in the past six months.',
      options: [
        o('chatgpt',       'ChatGPT'),
        o('claude',        'Claude'),
        o('gemini',        'Google Gemini'),
        o('copilot',       'Microsoft Copilot'),
        o('perplexity',    'Perplexity'),
        o('scc-ai',        'SCC Online AI'),
        o('manupatra-ai',  'Manupatra AI'),
        o('amicus',        'Casemine AMICUS'),
        o('legitquest',    'LegitQuest iDraf'),
        o('vidur',         'VIDUR AI'),
        o('bharatlaw',     'BharatLaw.AI'),
        o('harvey',        'Harvey AI'),
        o('lexis',         'Lexis+ AI'),
        o('cocounsel',     'CoCounsel'),
        o('free-india',    'NyayGuru / KanoonGPT'),
        o('draft-bot-pro', 'Draft Bot Pro'),
        o('other-ai',      'Other'),
      ],
    },
    {
      name: 'stopReason',
      prompt: 'Why did you stop or reduce usage?',
      kind: 'checkbox',
      required: false,
      hasOther: true,
      otherValue: 'other',
      helper: 'Shown only if you tried AI but stopped or use it occasionally.',
      options: [
        o('hallucination',    'Hallucinated or fabricated citations'),
        o('outdated',         "Didn't reflect current Indian law"),
        o('privacy',          'Privacy / confidentiality concerns'),
        o('bar-rules',        'Bar Council Rules - Rule 36'),
        o('court-reception',  'Court reception of AI work'),
        o('liability',        'Liability for wrong output'),
        o('conventions',      "Didn't match Indian conventions"),
        o('cost',             'Cost relative to value'),
        o('verify',           'Had to re-verify everything'),
        o('workflow',         "Didn't fit workflow"),
        o('seniors',          'Seniors discouraged use'),
        o('other',            'Other'),
      ],
    },
    {
      name: 'aiWants',
      prompt: 'Which AI features would be most valuable to you?',
      kind: 'textarea',
      required: true,
      helper: 'One or two sentences.',
    },
    {
      name: 'aiWish',
      prompt: 'A feature you wish existed but does not, in any tool',
      kind: 'textarea',
      required: false,
    },
  ],
};

// Cohort-templated spend / willPay options. The slugs are NOT portable across
// cohorts (a "<25k" slug means different things for solo vs small), so the
// API + UI must always know which cohort produced the value.
export const SPEND_BY_COHORT: Record<Cohort, Option[]> = {
  solo: [
    o('<10k',     'Less than ₹10,000'),
    o('10-25k',   '₹10,000 to ₹25,000'),
    o('25-50k',   '₹25,000 to ₹50,000'),
    o('50k-1L',   '₹50,000 to ₹1,00,000'),
    o('1L+',      'More than ₹1,00,000'),
    o('na',       'Prefer not to say'),
  ],
  small: [
    o('<25k',     'Less than ₹25,000'),
    o('25-50k',   '₹25,000 to ₹50,000'),
    o('50k-1L',   '₹50,000 to ₹1,00,000'),
    o('1-3L',     '₹1,00,000 to ₹3,00,000'),
    o('3-10L',    '₹3,00,000 to ₹10,00,000'),
    o('10L+',     'More than ₹10,00,000'),
    o('na',       'Prefer not to say'),
  ],
  medium: [
    o('<1L',      'Less than ₹1,00,000'),
    o('1-3L',     '₹1,00,000 to ₹3,00,000'),
    o('3-10L',    '₹3,00,000 to ₹10,00,000'),
    o('10-25L',   '₹10,00,000 to ₹25,00,000'),
    o('25L+',     'More than ₹25,00,000'),
    o('na',       'Prefer not to say'),
  ],
  large: [
    o('<5L',      'Less than ₹5,00,000'),
    o('5-10L',    '₹5,00,000 to ₹10,00,000'),
    o('10-25L',   '₹10,00,000 to ₹25,00,000'),
    o('25L-1Cr',  '₹25,00,000 to ₹1 Cr'),
    o('1Cr+',     'More than ₹1 Cr'),
    o('na',       'Prefer not to say'),
  ],
};

export const WILL_PAY_BY_COHORT: Record<Cohort, Option[]> = {
  solo: [
    o('<500',       'Less than ₹500'),
    o('500-1000',   '₹500 to ₹1,000'),
    o('1000-2500',  '₹1,000 to ₹2,500'),
    o('2500-5000',  '₹2,500 to ₹5,000'),
    o('5000+',      'More than ₹5,000'),
    o('free-only',  'Only if there is a free tier first'),
  ],
  small: [
    o('<1000',       'Less than ₹1,000'),
    o('1000-2500',   '₹1,000 to ₹2,500'),
    o('2500-5000',   '₹2,500 to ₹5,000'),
    o('5000-10000',  '₹5,000 to ₹10,000'),
    o('10000+',      'More than ₹10,000'),
    o('free-only',   'Only if there is a free tier first'),
  ],
  medium: [
    o('<2500',         'Less than ₹2,500'),
    o('2500-5000',     '₹2,500 to ₹5,000'),
    o('5000-10000',    '₹5,000 to ₹10,000'),
    o('10000-20000',   '₹10,000 to ₹20,000'),
    o('20000+',        'More than ₹20,000'),
    o('free-only',     'Only if there is a free tier first'),
  ],
  large: [
    o('<5000',          'Less than ₹5,000'),
    o('5000-10000',     '₹5,000 to ₹10,000'),
    o('10000-25000',    '₹10,000 to ₹25,000'),
    o('25000-50000',    '₹25,000 to ₹50,000'),
    o('50000+',         'More than ₹50,000'),
    o('enterprise',     'Enterprise - separate discussion'),
  ],
};

const STEP_9_PRICING: StepDef = {
  index: 9,
  title: 'What value looks like',
  fields: [
    // spend + willPay options are injected at render time by cohort -
    // see SurveyView. We list them here as placeholders so the step
    // structure stays declarative.
    {
      name: 'spend',
      prompt: 'Annual spend on research and drafting tools',
      kind: 'radio',
      required: true,
      helper: 'Across all licences in your practice.',
      options: [], // cohort-injected
    },
    {
      name: 'willPay',
      prompt: 'Willingness to pay per user, per month (if AI saves 10 hrs/week)',
      kind: 'radio',
      required: true,
      options: [], // cohort-injected
    },
    {
      name: 'pricingModel',
      prompt: 'Preferred pricing models',
      kind: 'checkbox',
      required: true,
      helper: 'Pick all that work for you.',
      options: [
        o('monthly',   'Monthly per user'),
        o('annual',    'Annual per user (with discount)'),
        o('firm-flat', 'Per-firm flat fee', ['small', 'medium', 'large']),
        o('usage',     'Pay-per-use (per draft / query)'),
        o('freemium',  'Freemium with paid premium'),
        o('tiered',    'Tiered (basic / pro / enterprise)'),
        o('one-time',  'One-time perpetual licence'),
      ],
    },
    {
      name: 'switching',
      prompt: 'Switching conditions you would accept for a 60-day trial',
      kind: 'checkbox',
      required: false,
      helper: 'Pick any that apply.',
      options: [
        o('immediate',     'Yes, immediately'),
        o('backup',        'Yes, with offline backup'),
        o('parallel',      'Run both in parallel for a paid period'),
        o('junior-first',  'Let a junior try first', ['small', 'medium', 'large']),
        o('disruptive',    'No, too disruptive'),
        o('trust-current', 'No, I trust my current tool'),
      ],
    },
  ],
};

const STEP_10_TRUST: StepDef = {
  index: 10,
  title: 'Trust and concerns',
  fields: [
    {
      name: 'concern',
      prompt: 'Biggest concerns about adopting AI',
      kind: 'checkbox',
      required: true,
      hasOther: true,
      otherValue: 'other',
      helper: 'Pick all that apply.',
      options: [
        o('hallucination',    'Hallucinated citations / court sanction'),
        o('confidentiality',  'Client confidentiality / privilege'),
        o('bar-rules',        'Bar Council Rules (Rule 36)'),
        o('liability',        'Liability for wrong output'),
        o('cost',             'Cost'),
        o('learning',         'Learning curve'),
        o('seniors',          'Senior colleagues not on board', ['small', 'medium', 'large']),
        o('integration',      "Doesn't integrate with my tools"),
        o('infrastructure',   'Internet / infrastructure reliability'),
        o('juniors-skill',    'Loss of training for juniors', ['small', 'medium', 'large']),
        o('other',            'Other'),
      ],
    },
    {
      name: 'dataLocation',
      prompt: 'Where must your data be stored?',
      kind: 'radio',
      required: true,
      options: [
        o('india-strict', 'India-only, no foreign sub-processor'),
        o('india',        'India-only (DPDP-compliant sub-processors OK)'),
        o('encrypted',    'Anywhere, encrypted'),
        o('onprem',       'On-device / on-premise only'),
        o('unsure',       "Don't know / not a concern"),
      ],
    },
    {
      name: 'recommended',
      prompt: 'Likelihood to try AI on a colleague recommendation',
      kind: 'radio',
      required: true,
      options: [
        o('very-likely',   'Very likely'),
        o('likely',        'Likely'),
        o('neutral',       'Neutral'),
        o('unlikely',      'Unlikely'),
        o('very-unlikely', 'Very unlikely'),
      ],
    },
  ],
};

const STEP_11_FOLLOWUP: StepDef = {
  index: 11,
  title: 'Follow-up opt-ins',
  helper: 'All optional. Early respondents get free beta access.',
  fields: [
    {
      name: 'interview',
      prompt: '30-minute paid follow-up interview (₹2,500 honorarium)',
      kind: 'radio',
      required: false,
      options: [o('yes', 'Yes'), o('no', 'No')],
    },
    {
      name: 'beta',
      prompt: 'Free beta access when ready',
      kind: 'radio',
      required: false,
      options: [o('yes', 'Yes'), o('no', 'No')],
    },
    {
      name: 'pilot',
      prompt: '30-day paid pilot (₹1,000-5,000 + founder support)',
      kind: 'radio',
      required: false,
      options: [o('yes', 'Yes'), o('maybe', 'Maybe'), o('no', 'No')],
    },
    {
      name: 'founderCall',
      prompt: '15-minute call with the founder',
      kind: 'radio',
      required: false,
      options: [o('yes', 'Yes'), o('no', 'No')],
    },
  ],
};

export const STEPS: StepDef[] = [
  STEP_2_CONTACT,
  STEP_3_PRACTICE,
  STEP_4_FIRM,
  STEP_5_PRACTICE_PROFILE,
  STEP_6_TOOLS,
  STEP_7_PAIN,
  STEP_8_AI,
  STEP_9_PRICING,
  STEP_10_TRUST,
  STEP_11_FOLLOWUP,
];

// =============================================================================
// Visibility / required predicates - single source of truth for branching.
// =============================================================================

export type AnswerValue = string | string[] | undefined;
export type Answers = Record<string, AnswerValue>;

export function getCohort(answers: Answers): Cohort | null {
  const v = answers.firmSize;
  return v === 'solo' || v === 'small' || v === 'medium' || v === 'large' ? v : null;
}

/** Is the given field visible, given the current cohort and AI-usage answers? */
export function isFieldVisible(field: Field, answers: Answers): boolean {
  const cohort = getCohort(answers);

  // Field-level cohort gate.
  if (field.cohorts && cohort && !field.cohorts.includes(cohort)) return false;

  // AI-usage-driven visibility.
  if (field.name === 'aiTools') {
    return answers.aiUsage === 'daily'
      || answers.aiUsage === 'weekly'
      || answers.aiUsage === 'occasional'
      || answers.aiUsage === 'stopped';
  }
  if (field.name === 'stopReason') {
    return answers.aiUsage === 'stopped' || answers.aiUsage === 'occasional';
  }

  // caseMgmtSpec only shown when caseMgmt = 'yes'.
  if (field.name === 'caseMgmtSpec') {
    return answers.caseMgmt === 'yes';
  }

  return true;
}

/** Pick the Step 4 variant for the current cohort. Returns the variant's
 *  fields, or [] if no variant matches (shouldn't happen for valid cohorts). */
export function step4FieldsFor(cohort: Cohort | null): Field[] {
  if (!cohort) return [];
  const v = STEP_4_FIRM.variants?.find((variant) => variant.cohorts.includes(cohort));
  return v ? v.fields : [];
}

/** Option-level cohort gate - used when rendering checkbox/radio options. */
export function isOptionVisible(option: Option, cohort: Cohort | null): boolean {
  if (!option.cohorts) return true;
  if (!cohort) return true;
  return option.cohorts.includes(cohort);
}

/** "Other" is selected if a radio's value equals otherValue, or a checkbox
 *  array contains it. Returns the matched slug, or null. */
export function pickedOther(field: Field, value: AnswerValue): string | null {
  if (!field.hasOther || !field.otherValue) return null;
  if (Array.isArray(value)) return value.includes(field.otherValue) ? field.otherValue : null;
  if (typeof value === 'string') return value === field.otherValue ? field.otherValue : null;
  return null;
}
