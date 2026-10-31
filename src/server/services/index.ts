import { join } from 'node:path';

import type { FastifyBaseLogger } from 'fastify';

import type { AppConfig } from '../config.js';
import { FfmpegService } from './ffmpeg.service.js';
import { JobService } from './job.service.js';
import { JobStore } from './job.store.js';
import { PublishService } from './publish.service.js';
import { ServedQualityService } from './served-quality.service.js';
import { AccountStore } from './tiktok/account.store.js';
import { TikTokOAuthService } from './tiktok/oauth.service.js';
import { TikTokPostingService } from './tiktok/posting.service.js';

export interface Services {
  config: AppConfig;
  jobStore: JobStore;
  jobs: JobService;
  ffmpeg: FfmpegService;
  accounts: AccountStore;
  oauth: TikTokOAuthService;
  posting: TikTokPostingService;
  publish: PublishService;
  served: ServedQualityService;
}

export async function createServices(config: AppConfig, log: FastifyBaseLogger): Promise<Services> {
  const tempDir = join(config.dataDir, 'tmp');
  const jobStore = new JobStore(join(config.dataDir, 'jobs'));
  const accounts = new AccountStore(join(config.dataDir, 'accounts.json'));

  await Promise.all([jobStore.load(), accounts.load()]);

  const ffmpeg = new FfmpegService(config.ffmpegPath, config.ffprobePath);
  const oauth = new TikTokOAuthService(config.tiktok, accounts);
  const posting = new TikTokPostingService(oauth);
  const publish = new PublishService(
    jobStore,
    accounts,
    posting,
    { audited: config.tiktok.audited, chunkBytes: config.uploadChunkBytes },
    log,
  );

  await publish.recoverInterrupted();

  return {
    config,
    jobStore,
    jobs: new JobService(jobStore, ffmpeg, config.marker, tempDir),
    ffmpeg,
    accounts,
    oauth,
    posting,
    publish,
    served: new ServedQualityService(config.marker, tempDir),
  };
}
