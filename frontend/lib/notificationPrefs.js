/**
 * Notification Preferences Schema
 *
 * Central source of truth for what you can be alerted about per tracked
 * subject type (representative / candidate / bill / election), the default
 * state each pref starts in, and human-readable labels + tooltips for the
 * My Tracked UI.
 *
 * Defaults follow the "sensible mixed" model: key events ON (election day,
 * bill passes, wins/losses, resignations), chatter OFF (every vote, every
 * event, every endorsement).
 *
 * Per-type shape lives under `PREF_SCHEMA[type]`:
 *   options: [{ key, label, description, default }]
 *   sliders: [{ key, label, description, choices: ['monthly', ...], default }]
 *
 * The UI walks `options` to render checkboxes and `sliders` to render
 * radios / segmented controls. Storage is keyed identically (`prefs[key]`).
 */

export const PREF_TYPES = {
  representative: 'representative',
  candidate: 'candidate',
  bill: 'bill',
  election: 'election',
};

export const PREF_SCHEMA = {
  representative: {
    label: 'Representative',
    options: [
      {
        key: 'on_new_bill',
        label: 'New bill introduced',
        description: 'Alert when they sponsor or co-sponsor a new bill.',
        default: true,
      },
      {
        key: 'on_vote_for',
        label: 'Votes in favor',
        description: 'Alert whenever they vote YEA on a roll-call vote.',
        default: false,
      },
      {
        key: 'on_vote_against',
        label: 'Votes against',
        description: 'Alert whenever they vote NAY on a roll-call vote.',
        default: false,
      },
      {
        key: 'on_key_vote',
        label: 'Key vote (marquee bill)',
        description: 'Alert only on high-profile / whipped votes.',
        default: true,
      },
      {
        key: 'on_event',
        label: 'Public event scheduled',
        description: 'Town halls, fundraisers, appearances near you.',
        default: false,
      },
      {
        key: 'on_upcoming_election',
        label: 'Upcoming election',
        description: 'Alert when their seat is on an upcoming ballot.',
        default: true,
      },
      {
        key: 'on_resignation',
        label: 'Resignation or removal',
        description: 'Alert if they leave office early (resign, recall, expelled).',
        default: true,
      },
      {
        key: 'on_committee_change',
        label: 'Committee assignment change',
        description: 'Joined, left, or took a leadership role on a committee.',
        default: false,
      },
    ],
    sliders: [],
  },

  candidate: {
    label: 'Candidate',
    options: [
      {
        key: 'on_event',
        label: 'Campaign event',
        description: 'Rallies, debates, town halls, fundraisers.',
        default: false,
      },
      {
        key: 'on_debate',
        label: 'Debate scheduled',
        description: 'Alert when a debate they\u2019re participating in is announced.',
        default: true,
      },
      {
        key: 'on_endorsement',
        label: 'New endorsement',
        description: 'Newspapers, unions, officials, PACs endorsing them.',
        default: false,
      },
      {
        key: 'on_position_change',
        label: 'Position statement',
        description: 'They publish a new position on a policy issue.',
        default: false,
      },
      {
        key: 'on_drop_out',
        label: 'Drops out of race',
        description: 'Alert if they suspend or end their campaign.',
        default: true,
      },
      {
        key: 'on_win',
        label: 'Wins the election',
        description: 'Race is called in their favor.',
        default: true,
      },
      {
        key: 'on_loss',
        label: 'Loses the election',
        description: 'Race is called against them.',
        default: true,
      },
      {
        key: 'on_fundraising',
        label: 'Major fundraising milestone',
        description: 'Quarterly report, large bundling event, or notable single donation.',
        default: false,
      },
    ],
    sliders: [],
  },

  bill: {
    label: 'Bill',
    options: [
      {
        key: 'on_action',
        label: 'Any action taken',
        description: 'Every procedural step (referred, reported, etc.).',
        default: false,
      },
      {
        key: 'on_committee_action',
        label: 'Committee action',
        description: 'Markup, vote out of committee, hearing scheduled.',
        default: true,
      },
      {
        key: 'on_vote_scheduled',
        label: 'Vote scheduled',
        description: 'Floor vote on the schedule for either chamber.',
        default: true,
      },
      {
        key: 'on_pass',
        label: 'Passes a chamber',
        description: 'House or Senate passes the bill.',
        default: true,
      },
      {
        key: 'on_fail',
        label: 'Fails a vote',
        description: 'Chamber vote fails or the bill is defeated.',
        default: true,
      },
      {
        key: 'on_signed',
        label: 'Signed into law',
        description: 'President / Governor signs the bill.',
        default: true,
      },
      {
        key: 'on_veto',
        label: 'Vetoed',
        description: 'Executive vetoes the bill.',
        default: true,
      },
      {
        key: 'on_amendment',
        label: 'Amendment filed',
        description: 'Any amendment is filed to the bill text.',
        default: false,
      },
    ],
    sliders: [],
  },

  election: {
    label: 'Election',
    options: [
      {
        key: 'on_election_day',
        label: 'On election day',
        description: 'Morning-of reminder to vote.',
        default: true,
      },
      {
        key: 'on_registration_deadline',
        label: 'Voter registration deadline',
        description: 'Alert a few days before registration closes.',
        default: true,
      },
      {
        key: 'on_early_voting',
        label: 'Early voting window opens',
        description: 'Alert when early / absentee voting begins.',
        default: true,
      },
      {
        key: 'on_mail_ballot_deadline',
        label: 'Mail-ballot deadlines',
        description: 'Request + return deadlines for vote-by-mail.',
        default: true,
      },
      {
        key: 'on_candidate_join',
        label: 'New candidate enters race',
        description: 'Someone files to run in this election.',
        default: false,
      },
      {
        key: 'on_candidate_drop',
        label: 'Candidate drops out',
        description: 'A candidate suspends their campaign.',
        default: true,
      },
      {
        key: 'on_winner_announced',
        label: 'Winner called',
        description: 'Race is called by election authorities.',
        default: true,
      },
      {
        key: 'on_debate_scheduled',
        label: 'Debate scheduled',
        description: 'Any official debate is announced for this race.',
        default: false,
      },
    ],
    sliders: [
      {
        key: 'frequency',
        label: 'Reminder cadence',
        description: 'How often a general \u201Celection is coming up\u201D nudge is sent.',
        choices: ['monthly', 'biweekly', 'weekly', 'daily'],
        default: 'weekly',
      },
    ],
  },
};

/**
 * Build a fresh prefs object for a given type using the declared defaults.
 * Safe to call when first tracking a new subject.
 */
export function defaultPrefsFor(type) {
  const schema = PREF_SCHEMA[type];
  if (!schema) return {};
  const out = {};
  for (const opt of schema.options) out[opt.key] = opt.default;
  for (const s of schema.sliders) out[s.key] = s.default;
  return out;
}

/**
 * Merge a stored prefs object with the current default schema. Any newly
 * introduced pref keys get their declared defaults; unknown legacy keys are
 * preserved so we never silently drop user-set values.
 */
export function mergePrefs(type, stored) {
  const base = defaultPrefsFor(type);
  if (!stored || typeof stored !== 'object') return base;
  return { ...base, ...stored };
}

/**
 * Channel-level (global) notification preferences for the navbar bell.
 * Kept in the same module so UIs can import one schema module.
 */
export const CHANNEL_SCHEMA = {
  label: 'Delivery',
  options: [
    {
      key: 'in_app',
      label: 'In-app toasts',
      description: 'Show a banner inside CivicLens while you\u2019re using it.',
      default: true,
      available: true,
    },
    {
      key: 'desktop_push',
      label: 'Desktop notifications',
      description: 'Browser push notifications (coming soon).',
      default: false,
      available: false,
    },
    {
      key: 'email',
      label: 'Email digests',
      description: 'Daily or weekly roll-up to your inbox (coming soon).',
      default: false,
      available: false,
    },
    {
      key: 'sms',
      label: 'SMS / text',
      description: 'Text messages for urgent alerts only (coming soon).',
      default: false,
      available: false,
    },
    {
      key: 'mobile_push',
      label: 'Mobile push',
      description: 'Alerts through the CivicLens mobile app (coming soon).',
      default: false,
      available: false,
    },
  ],
  sliders: [
    {
      key: 'quiet_hours',
      label: 'Quiet hours',
      description: 'Pause non-urgent alerts during these hours (local time).',
      choices: ['off', 'nights', 'nights_weekends', 'work_hours_only'],
      default: 'nights',
    },
    {
      key: 'digest_cadence',
      label: 'Digest cadence',
      description: 'How often to batch non-urgent alerts into a summary.',
      choices: ['realtime', 'daily', 'weekly'],
      default: 'daily',
    },
  ],
};

export function defaultChannelPrefs() {
  const out = {};
  for (const opt of CHANNEL_SCHEMA.options) out[opt.key] = opt.default;
  for (const s of CHANNEL_SCHEMA.sliders) out[s.key] = s.default;
  return out;
}

export function mergeChannelPrefs(stored) {
  const base = defaultChannelPrefs();
  if (!stored || typeof stored !== 'object') return base;
  return { ...base, ...stored };
}
