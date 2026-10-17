'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /overview: the short video the guided tour's Welcome card links to
 * ("Watch a 2-minute overview", TOUR_VIDEO_URL in lib/tutorialSegments.js).
 *
 * The video, its poster and its captions are static files in
 * public/video/. Their names carry a version (-v1), so a new cut gets a
 * new name and the long cache on /video/ (next.config.js) never serves
 * an old one. Captions are on by default.
 *
 * Every post, poll, comment, reply and alert in the video comes from a
 * demo account, and the page says so (the video says it too).
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import PageChrome from '@/components/PageChrome';
import './overview.css';

const VIDEO = '/video/civicview-tour-overview-v1';

export default function OverviewPage() {
  const router = useRouter();

  return (
    <div className="overview-page">
      <PageChrome backLabel="Back to map" onBack={() => router.push('/')} />

      <div className="overview-hero">
        <div className="overview-hero__inner">
          <p className="overview-hero__eyebrow">Getting started</p>
          <h1 className="overview-hero__title">A quick look at CivicView</h1>
          <p className="overview-hero__sub">
            Find your representatives, explore any state, compare officials,
            and see how Pages, Polls, Floor Bills, Elections and My Tracked
            work.
          </p>
        </div>
      </div>

      <main className="overview-main">
        <video
          className="overview-video"
          controls
          playsInline
          preload="metadata"
          poster={`${VIDEO}.jpg`}
          width={1920}
          height={1080}
        >
          <source src={`${VIDEO}.mp4`} type="video/mp4" />
          <track kind="captions" src={`${VIDEO}.vtt`} srcLang="en" label="English" default />
          Your browser cannot play this video.{' '}
          <a href={`${VIDEO}.mp4`}>Open the video file</a> instead.
        </video>

        <p className="overview-note">
          Captions are on by default and can be turned off in the player.
        </p>

        <section className="overview-section">
          <h2>About what you see</h2>
          <p>
            The posts, polls, comments, replies and alerts in this video come
            from demo accounts: Pat Citizen, the CivicView Test Rep and the
            CivicView Test Candidate. Real officials appear only in public
            records, such as the representatives for an address, a state&apos;s
            officials, a profile, a vote or a certified ballot. Verified
            accounts for officials and candidates are coming.
          </p>
          <p>
            Recorded in October 2026. CivicView keeps changing, so a few
            screens may look different now.
          </p>
        </section>

        <p className="overview-cta">
          <Link href="/">Go to the map</Link>
        </p>
      </main>
    </div>
  );
}
