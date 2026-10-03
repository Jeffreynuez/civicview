'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * PageChrome: the pinned navbar + back row for a standalone route,
 * with every navbar button working in place.
 *
 * Before (2026-10-03), /bills and /stats wired the navbar's buttons to
 * router.push('/'), so Citizen login, Subscribe, Help build this,
 * Feedback, My Tracked and the dashboard all dumped the visitor on the
 * home map and lost their place. This component owns the same windows
 * /polls owns (citizen sign-in, waitlist, My Tracked, the citizen
 * dashboard, Help build, Feedback) and opens them over the page.
 *
 * It also answers requestCitizenLogin() (lib/loginRequest.js), so a
 * deep component such as a bill's like button opens the sign-in here
 * without a callback threaded down to it.
 *
 * Usage:
 *   <PageChrome backLabel="Back to map" onBack={() => router.push('/')} />
 *   // optional: navbarProps={{ hidePollsLink: true }}
 *
 * Renders StickyPageHeader (navbar + translucent back row) where it is
 * placed, and the windows as overlays. The page wrapper that holds it
 * must set flex-shrink: 0 (see StickyPageHeader.css).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import CitizenLoginModal from '@/components/CitizenLoginModal';
import CitizenWaitlistModal from '@/components/CitizenWaitlistModal';
import ConstituentDashboard from '@/components/ConstituentDashboard';
import FeedbackView from '@/components/FeedbackView';
import HelpBuildThisView from '@/components/HelpBuildThisView';
import MyTrackedModal from '@/components/MyTrackedModal';
import Navbar from '@/components/Navbar';
import StickyPageHeader from '@/components/StickyPageHeader';
import { logoutCitizen, useCitizenAuth } from '@/lib/citizenAuth';
import { useCitizenLoginRequest } from '@/lib/loginRequest';

export default function PageChrome({ backLabel = 'Back to map', onBack, navbarProps = {} }) {
  const router = useRouter();
  const { citizen } = useCitizenAuth();

  const [citizenLoginOpen, setCitizenLoginOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [trackedOpen, setTrackedOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [dashboardInitialView, setDashboardInitialView] = useState('overview');
  const [helpBuildOpen, setHelpBuildOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useCitizenLoginRequest(() => setCitizenLoginOpen(true));

  const goHome = () => router.push('/');
  const openMember = (m) => {
    if (m?.bioguide_id) router.push(`/?member=${encodeURIComponent(m.bioguide_id)}`);
    else goHome();
  };
  const openCandidate = (c) => {
    if (c?.id) router.push(`/?candidate=${encodeURIComponent(c.id)}`);
    else goHome();
  };
  const openPage = (officialId) => {
    if (officialId) router.push(`/?page=${encodeURIComponent(officialId)}`);
  };
  const signOut = async () => {
    try { await logoutCitizen(); } catch { /* signed out either way */ }
    setDashboardOpen(false);
  };

  // Each window closes before the next opens, so only one is up.
  const only = (open) => () => {
    setTrackedOpen(false);
    setDashboardOpen(false);
    setHelpBuildOpen(false);
    setFeedbackOpen(false);
    open();
  };
  const openLogin = () => setCitizenLoginOpen(true);
  const openWaitlist = only(() => setWaitlistOpen(true));
  const openTracked = only(() => setTrackedOpen(true));
  const openDashboard = only(() => { setDashboardInitialView('overview'); setDashboardOpen(true); });
  const openHelpBuild = only(() => setHelpBuildOpen(true));
  const openFeedback = only(() => setFeedbackOpen(true));

  // Navbar handlers for the windows' own embedded navbars too.
  const sharedNavbarProps = {
    citizen,
    onCitizenLogin: openLogin,
    onCitizenLogout: signOut,
    onCitizenDashboard: openDashboard,
    onOpenTracked: openTracked,
    onSubscribe: openWaitlist,
    onOpenHelpBuild: openHelpBuild,
    onOpenFeedback: openFeedback,
  };

  return (
    <>
      <StickyPageHeader backLabel={backLabel} onBack={onBack}>
        <Navbar
          compact
          {...sharedNavbarProps}
          onMemberPick={openMember}
          onCandidatePick={openCandidate}
          onOpenRepDashboard={(r) => openPage(r?.official_id)}
          onOpenCandidateDashboard={(c) => openPage(c?.candidate_id)}
          onHome={goHome}
          {...navbarProps}
        />
      </StickyPageHeader>

      <CitizenLoginModal
        open={citizenLoginOpen}
        onClose={() => setCitizenLoginOpen(false)}
        onSuccess={() => setCitizenLoginOpen(false)}
      />
      <CitizenWaitlistModal
        open={waitlistOpen}
        onClose={() => setWaitlistOpen(false)}
        clickedFrom="subscribe"
      />
      <MyTrackedModal
        open={trackedOpen}
        onClose={() => setTrackedOpen(false)}
        onMemberPick={(m) => { setTrackedOpen(false); openMember(m); }}
        onOpenInDashboard={() => {
          setTrackedOpen(false);
          setDashboardInitialView('tracked');
          setDashboardOpen(true);
        }}
      />

      {/* Same fixed scroll container the home page and /polls use, so
          the dashboard opens at its top whatever this page's scroll. */}
      {dashboardOpen && citizen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'var(--cl-bg)', overflowY: 'auto' }}>
          <ConstituentDashboard
            citizen={citizen}
            onClose={() => setDashboardOpen(false)}
            initialView={dashboardInitialView}
            onNavigate={{
              openOfficial: (member) => { setDashboardOpen(false); openMember(member); },
              manageTracked: () => { setDashboardOpen(false); setTrackedOpen(true); },
            }}
            navbarProps={sharedNavbarProps}
          />
        </div>
      )}

      {helpBuildOpen && (
        <HelpBuildThisView onClose={() => setHelpBuildOpen(false)} compactNavbarProps={sharedNavbarProps} />
      )}
      {feedbackOpen && (
        <FeedbackView onClose={() => setFeedbackOpen(false)} compactNavbarProps={sharedNavbarProps} />
      )}
    </>
  );
}
