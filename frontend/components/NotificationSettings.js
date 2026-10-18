'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * The notification settings list (2026-10-17). One short list in place
 * of the 32 per-item switches, shown in the bell (behind its Settings
 * button) and in Dashboard, Account & settings:
 *
 *   This phone        push on or off here; "Open settings" when Android
 *                     has notifications off for CivicView. In a browser
 *                     (2026-10-18): "This browser" ("This app" when
 *                     installed), web push on or off, the permission
 *                     asked only from the Turn on tap; on an iPhone in
 *                     Safari, Turn on shows the Add to Home Screen guide
 *   one row per kind  a dropdown: Bell and push, Bell only, Off (and
 *                     email where there is one)
 *   Weekly email digest
 *   Quiet hours, Push alerts, Notification details (the app, and
 *                     browsers that can get web push)
 *
 * The rows live on the account (lib/alertSettings.js) and the server
 * enforces them, so they are the same on every device. Quiet hours,
 * push timing and notification details are the synced channel prefs
 * (lib/channelPrefs.js). Signed out, only the phone and timing rows
 * show: a signed-out phone only gets posts and polls from officials it
 * tracks.
 */

import { useEffect, useState } from 'react';
import { useCitizenAuth } from '@/lib/citizenAuth';
import { setAlertSetting, useAlertSettings } from '@/lib/alertSettings';
import { setChannelPrefs, useChannelPrefs } from '@/lib/channelPrefs';
import {
  ALERT_CHOICE_LABELS, ALERT_ROWS, CHANNEL_SCHEMA, DIGEST_ROW, choiceHasEmail, choiceHasPush,
} from '@/lib/notificationPrefs';
import HomeScreenGuide, { HOME_SCREEN_GUIDE } from './HomeScreenGuide';
import {
  canOpenNotificationSettings, disablePush, enablePush, getLastOsStatus, getPushChoice,
  isNativeApp, openNotificationSettings, refreshOsStatus, subscribeOsStatus,
} from '@/lib/push';
import { isStandalone, webPermission, webPushStatus } from '@/lib/webPush';

/**
 * Push on this device: in the Android app, the phone and what Android
 * says about it; in a browser, the Home Screen app or the Windows app
 * (2026-10-18), web push and the browser's permission. web: web push is
 * offered here (set up, and the browser can do it or can be added to
 * the Home Screen). guide: the Add to Home Screen guide to show
 * ('home_screen'), after a Turn on in an iPhone's Safari tab.
 */
export function usePhonePush() {
  const [native, setNative] = useState(false);
  const [webStatus, setWebStatus] = useState('unconfigured');
  const [permission, setPermission] = useState('default');
  const [installed, setInstalled] = useState(false);
  const [choice, setChoice] = useState(null);
  const [os, setOs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    const isApp = isNativeApp();
    setNative(isApp);
    if (!isApp) {
      // The browser's permission can change in its site settings: read
      // it again when the tab comes back and when lib/push.js says so.
      const read = () => {
        setWebStatus(webPushStatus());
        setPermission(webPermission());
        setInstalled(isStandalone());
        setChoice(getPushChoice());
      };
      read();
      window.addEventListener('cv:push-state', read);
      document.addEventListener('visibilitychange', read);
      return () => {
        window.removeEventListener('cv:push-state', read);
        document.removeEventListener('visibilitychange', read);
      };
    }
    setChoice(getPushChoice());
    setOs(getLastOsStatus());
    refreshOsStatus().then((s) => { if (s) setOs(s); });
    return subscribeOsStatus((s) => { setOs(s); setChoice(getPushChoice()); });
  }, []);

  const turnOn = async () => {
    setBusy(true);
    setNote('');
    const res = await enablePush();
    setChoice(getPushChoice());
    if (native) {
      const s = await refreshOsStatus();
      if (s) setOs(s);
    } else {
      setPermission(webPermission());
      if (res && res.reason === 'ios_home_screen') setGuide('home_screen');
      else if (res && !res.ok && res.reason !== 'denied' && res.reason !== 'dismissed') {
        setNote('Could not turn on push here. Please try again.');
      }
    }
    setBusy(false);
  };
  const turnOff = async () => {
    setBusy(true);
    await disablePush();
    setChoice(getPushChoice());
    setBusy(false);
  };
  // Android's live answer wins; the stored 'denied' (the prompt was
  // refused) only counts until Android has answered, so turning
  // notifications on in Android settings shows "Push is off, Turn on".
  const osOff = native && (os ? os.enabled === false : choice === 'denied');
  const webReady = !native && webStatus === 'ready';
  return {
    native, busy, osOff,
    web: !native && ['ready', 'ios_home_screen', 'ios_old'].includes(webStatus),
    webStatus, installed,
    webBlocked: webReady && permission === 'denied',
    on: native ? choice === 'enabled' && !osOff : webReady && choice === 'enabled' && permission === 'granted',
    blocked: (os && os.blockedChannels) || [],
    guide, closeGuide: () => setGuide(null), note,
    turnOn, turnOff,
  };
}

const label = { fontSize: '0.8rem', fontWeight: 600, color: 'var(--cl-text)' };
const hint = { fontSize: '0.68rem', color: 'var(--cl-text-light)', marginTop: 1, lineHeight: 1.35 };
const heading = {
  fontSize: '0.68rem', fontWeight: 800, color: 'var(--cl-text-light)',
  textTransform: 'uppercase', letterSpacing: '0.5px', margin: '10px 2px 4px',
};
const selectStyle = {
  flexShrink: 0, width: 152, maxWidth: '55%', padding: '4px 6px', borderRadius: 8,
  border: '1px solid var(--cl-border)', background: 'white', color: 'var(--cl-text)',
  fontSize: '0.74rem', fontFamily: 'inherit', cursor: 'pointer',
};
const buttonStyle = {
  flexShrink: 0, padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
  border: '1px solid var(--cl-accent)', background: 'white', color: 'var(--cl-accent)',
  fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit',
};

function Row({ title, sub, note, children }) {
  return (
    <div style={{ padding: '6px 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={label}>{title}</div>
          {sub && <div style={hint}>{sub}</div>}
        </div>
        {children}
      </div>
      {note && <div style={{ ...hint, color: '#8a5a00', marginTop: 3 }}>{note}</div>}
    </div>
  );
}

function Dropdown({ ariaLabel, value, choices, labels, onChange, disabled }) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...selectStyle, opacity: disabled ? 0.6 : 1 }}
    >
      {choices.map((c) => <option key={c} value={c}>{labels[c] || c}</option>)}
    </select>
  );
}

/** A choice with its email part taken off (demo accounts get no email). */
function withoutEmail(value) {
  if (value === 'bell_push_email') return 'bell_push';
  if (value === 'bell_email') return 'bell';
  return value;
}

export default function NotificationSettings({ variant = 'bell' }) {
  const { citizen } = useCitizenAuth();
  const data = useAlertSettings(citizen?.id);
  const { prefs } = useChannelPrefs();
  const phone = usePhonePush();
  const [saveNote, setSaveNote] = useState('');

  const onRow = async (row, value) => {
    setSaveNote('');
    const { ok } = await setAlertSetting(row, value);
    if (!ok) setSaveNote('Could not save. Please try again.');
  };

  const emailOk = !!(data && data.email_available);
  const quiet = CHANNEL_SCHEMA.sliders.find((s) => s.key === 'quiet_hours');
  const cadence = CHANNEL_SCHEMA.sliders.find((s) => s.key === 'push_cadence');
  const lock = CHANNEL_SCHEMA.lockScreen;

  return (
    <div data-testid="notification-settings" style={{ fontFamily: 'var(--cl-font-sans)' }}>
      <div style={{ ...heading, marginTop: variant === 'bell' ? 2 : 0 }}>
        {phone.native ? 'This phone' : phone.installed ? 'This app' : 'This browser'}
      </div>
      {!phone.native && !phone.web ? (
        <div style={{ ...hint, padding: '4px 2px 6px' }}>
          {phone.webStatus === 'unsupported'
            ? "This browser can't show CivicView alerts. They also come through the CivicView Android app on Google Play."
            : 'Push alerts come through the CivicView Android app on Google Play.'}
        </div>
      ) : !phone.native ? (
        phone.webStatus === 'ios_old' ? (
          <div style={{ ...hint, padding: '4px 2px 6px' }}>{HOME_SCREEN_GUIDE.tooOld}</div>
        ) : phone.webBlocked ? (
          <Row
            title="Notifications are blocked"
            sub="Allow them for CivicView in this browser's site settings, then tap Turn on."
          >
            <button type="button" style={buttonStyle} disabled={phone.busy} onClick={phone.turnOn}>
              Turn on
            </button>
          </Row>
        ) : (
          <>
            <Row title={phone.on ? 'Push is on' : 'Push is off'} sub={phone.busy ? 'Setting up…' : null}>
              <button
                type="button"
                style={buttonStyle}
                disabled={phone.busy}
                onClick={phone.on ? phone.turnOff : phone.turnOn}
              >
                {phone.on ? 'Turn off' : 'Turn on'}
              </button>
            </Row>
            {phone.guide && <HomeScreenGuide compact onClose={phone.closeGuide} />}
            {phone.note && <div style={{ ...hint, color: '#b3261e', padding: '0 2px 4px' }}>{phone.note}</div>}
          </>
        )
      ) : phone.osOff ? (
        <Row
          title="Notifications are off"
          sub="They are turned off for CivicView in Android settings."
        >
          {canOpenNotificationSettings() ? (
            <button type="button" style={buttonStyle} onClick={() => openNotificationSettings()}>
              Open settings
            </button>
          ) : null}
        </Row>
      ) : (
        <Row title={phone.on ? 'Push is on' : 'Push is off'} sub={phone.busy ? 'Setting up…' : null}>
          <button
            type="button"
            style={buttonStyle}
            disabled={phone.busy}
            onClick={phone.on ? phone.turnOff : phone.turnOn}
          >
            {phone.on ? 'Turn off' : 'Turn on'}
          </button>
        </Row>
      )}

      {citizen?.id ? (
        <>
          <div style={heading}>Alerts</div>
          {!data ? (
            <div style={{ ...hint, padding: '4px 2px' }}>Loading…</div>
          ) : (
            <>
              {ALERT_ROWS.map((r) => {
                const all = (data.choices && data.choices[r.key]) || [];
                const choices = emailOk ? all : all.filter((c) => !choiceHasEmail(c));
                const raw = (data.settings && data.settings[r.key]) || 'bell_push';
                const value = emailOk ? raw : withoutEmail(raw);
                const blocked = phone.native && phone.blocked.includes(r.channel) && choiceHasPush(value);
                return (
                  <Row
                    key={r.key}
                    title={r.label}
                    sub={r.hint}
                    note={blocked ? 'Push for this is off in Android settings.' : null}
                  >
                    <Dropdown
                      ariaLabel={r.label}
                      value={value}
                      choices={choices}
                      labels={ALERT_CHOICE_LABELS}
                      onChange={(v) => onRow(r.key, v)}
                    />
                  </Row>
                );
              })}
              <Row title={DIGEST_ROW.label} sub={DIGEST_ROW.hint}>
                <Dropdown
                  ariaLabel={DIGEST_ROW.label}
                  value={emailOk ? (data.digest || 'off') : 'off'}
                  choices={DIGEST_ROW.choices}
                  labels={DIGEST_ROW.choiceLabels}
                  disabled={!emailOk}
                  onChange={(v) => onRow('digest', v)}
                />
              </Row>
              {!emailOk && (
                <div style={{ ...hint, padding: '0 2px 4px' }}>
                  Demo accounts use a placeholder address that receives no email.
                </div>
              )}
              {saveNote && <div style={{ ...hint, color: '#b3261e', padding: '0 2px' }}>{saveNote}</div>}
            </>
          )}
        </>
      ) : (
        <div style={{ ...hint, padding: '6px 2px' }}>
          {phone.native
            ? 'Signed out, this phone gets posts and polls from officials you track. Sign in to choose replies, events, bill updates, poll results and election reminders.'
            : phone.web
              ? 'Signed out, this browser gets posts and polls from officials you track. Sign in to choose replies, events, bill updates, poll results and election reminders.'
              : 'Sign in to choose which alerts reach you, and where.'}
        </div>
      )}

      <div style={heading}>Timing</div>
      <Row title={quiet.label} sub={quiet.description}>
        <Dropdown
          ariaLabel={quiet.label}
          value={prefs.quiet_hours || quiet.default}
          choices={quiet.choices}
          labels={quiet.choiceLabels}
          onChange={(v) => setChannelPrefs({ quiet_hours: v })}
        />
      </Row>
      <Row title={cadence.label} sub={cadence.description}>
        <Dropdown
          ariaLabel={cadence.label}
          value={prefs.push_cadence || cadence.default}
          choices={cadence.choices}
          labels={cadence.choiceLabels}
          onChange={(v) => setChannelPrefs({ push_cadence: v })}
        />
      </Row>
      {(phone.native || phone.web) && (
        <Row title={lock.label} sub={lock.description}>
          <Dropdown
            ariaLabel={lock.label}
            value={prefs[lock.key] ? 'show' : 'hide'}
            choices={['hide', 'show']}
            labels={lock.choiceLabels}
            onChange={(v) => setChannelPrefs({ [lock.key]: v === 'show' })}
          />
        </Row>
      )}
    </div>
  );
}
