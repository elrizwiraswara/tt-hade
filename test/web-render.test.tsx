import { renderToString } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assemblePlanInMemory,
  buildPatchPlan,
  inspectFile,
  MemorySource,
  PATCH_PRESETS,
  presetOptions,
  verifyPatchedFile,
} from '../src/mp4/index.js';
import type { AccountSummary, HealthResponse, Job, Publication, ServedReport } from '../src/shared/api.js';
import { AccountsView } from '../src/web/components/AccountsView.js';
import { ExperimentsView } from '../src/web/components/ExperimentsView.js';
import { InspectView } from '../src/web/components/InspectView.js';
import { JobListItem } from '../src/web/components/JobListItem.js';
import { JobView } from '../src/web/components/JobView.js';
import { createFixtures, ffmpegAvailable, type FixtureSet } from './fixtures.js';

const MARKER = 'tt-hade-test';
const NOW = '2026-10-31T12:00:00.000Z';

const health: HealthResponse = {
  ffmpeg: true,
  tiktokConfigured: false,
  appAudited: false,
  marker: MARKER,
  redirectUri: 'http://localhost:3455/api/auth/tiktok/callback/',
  chunkSizeMb: 10,
};

const account: AccountSummary = {
  openId: 'open-1',
  displayName: 'Test Account',
  avatarUrl: null,
  scopes: ['user.info.basic', 'video.publish', 'video.upload'],
  connectedAt: NOW,
  accessExpiresAt: NOW,
  refreshExpiresAt: NOW,
};

function publication(status: Publication['status'], overrides: Partial<Publication> = {}): Publication {
  return {
    id: `pub-${status}`,
    openId: account.openId,
    accountName: account.displayName,
    mode: 'direct',
    status,
    publishId: 'v_pub_123',
    uploadedBytes: 5_000_000,
    totalBytes: 10_000_000,
    tiktokStatus: null,
    failReason: null,
    postIds: [],
    privacyLevel: 'SELF_ONLY',
    title: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe.skipIf(!ffmpegAvailable)('web components render', () => {
  let fixtures: FixtureSet;
  let job: Job;

  beforeAll(async () => {
    fixtures = createFixtures();

    const source = new MemorySource(fixtures.h264MoovEnd);
    const sourceReport = await inspectFile(source);
    const options = presetOptions('full', MARKER);
    const result = await buildPatchPlan(source, options);
    const output = new MemorySource(assemblePlanInMemory(result.plan, fixtures.h264MoovEnd));
    const report = await inspectFile(output);
    const served: ServedReport = {
      id: 'served-1',
      url: 'https://www.tiktok.com/@test/video/1',
      videoId: '1',
      checkedAt: NOW,
      rungs: [
        { gearName: 'normal_1080_0', codec: 'h264', qualityType: 2, bitrateKbps: 6200, width: 1080, height: 1920, sizeBytes: 3_000_000 },
        { gearName: 'normal_720_0', codec: 'h264', qualityType: 10, bitrateKbps: 2100, width: 720, height: 1280, sizeBytes: 1_000_000 },
      ],
      topRung: { gearName: 'normal_1080_0', codec: 'h264', qualityType: 2, bitrateKbps: 6200, width: 1080, height: 1920, sizeBytes: 3_000_000 },
      download: { report, markerFound: true },
      downloadError: null,
      sourceBitrateKbps: 12000,
      retention: 0.517,
    };

    job = {
      id: '11111111-1111-4111-8111-111111111111',
      originalName: 'clip.mp4',
      sourceFileName: 'source.mp4',
      createdAt: NOW,
      sourceSize: fixtures.h264MoovEnd.length,
      sourceReport,
      variants: [
        {
          id: 'abcdef0123',
          label: 'Full',
          preset: 'full',
          options,
          normalizedAudio: false,
          createdAt: NOW,
          fileName: 'abcdef0123.mp4',
          size: result.plan.size,
          applied: result.applied,
          report,
          checks: await verifyPatchedFile(output, result.expectation),
          publications: [
            publication('uploading'),
            publication('failed', { failReason: 'spam_risk_too_many_posts' }),
            publication('inbox', { mode: 'inbox', tiktokStatus: 'SEND_TO_USER_INBOX' }),
            publication('published', { postIds: ['7300000000000000000'], tiktokStatus: 'PUBLISH_COMPLETE' }),
          ],
          servedChecks: [served],
        },
      ],
    };
  });

  afterAll(() => {
    fixtures?.cleanup();
  });

  it('renders a job with variants, publications and served checks', () => {
    for (const accounts of [[], [account]]) {
      const html = renderToString(
        <JobView
          job={job}
          health={health}
          presets={[...PATCH_PRESETS]}
          accounts={accounts}
          onChanged={async () => undefined}
          onDeleted={() => undefined}
        />,
      );

      expect(html).toContain('clip.mp4');
      expect(html).toContain('New variant');
      expect(html).toContain('Results');
      expect(html).toContain('Encoder tag survived');
      expect(html).toContain('52%');
      expect(html).toContain('spam_risk_too_many_posts');
    }
  });

  it('renders a job card with a source video player', () => {
    const html = renderToString(<JobListItem job={job} selected onSelect={() => undefined} />);

    expect(html).toContain('<video');
    expect(html).toContain(`/api/jobs/${job.id}/source#t=0.1`);
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('H.264 360×640');
    expect(html).toContain('aspect-ratio:360 / 640');
  });

  it('renders the other views', () => {
    expect(renderToString(<AccountsView health={health} accounts={[account]} onChanged={async () => undefined} />)).toContain(
      'Test Account',
    );
    expect(renderToString(<InspectView />)).toContain('Inspect a file');
    expect(renderToString(<ExperimentsView health={health} presets={[...PATCH_PRESETS]} accounts={[]} />)).toContain(
      'Add a source video',
    );
  });
});
