import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import type { FastifyBaseLogger } from 'fastify';

import { primaryVideo } from '../../mp4/index.js';
import type { Job, Publication, PublicationStatus, PublishRequest } from '../../shared/api.js';
import { AppError, notFound } from '../errors.js';
import type { JobStore } from './job.store.js';
import type { AccountStore } from './tiktok/account.store.js';
import { planUploadChunks, type UploadChunkPlan } from './tiktok/chunking.js';
import type { DirectPostInfo, TikTokPostingService } from './tiktok/posting.service.js';
import { videoContentType } from './uploads.js';

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 15 * 60_000;
const TERMINAL_STATUSES: readonly PublicationStatus[] = ['inbox', 'published', 'failed'];
const INTERRUPTED_STATUSES: readonly PublicationStatus[] = ['initializing', 'uploading'];

interface PublicationRef {
  jobId: string;
  variantId: string;
  publicationId: string;
}

interface PublishSettings {
  audited: boolean;
  chunkBytes: number;
}

function mapStatus(tiktokStatus: string, current: PublicationStatus): PublicationStatus {
  switch (tiktokStatus) {
    case 'PUBLISH_COMPLETE':
      return 'published';
    case 'SEND_TO_USER_INBOX':
      return 'inbox';
    case 'FAILED':
      return 'failed';
    case 'PROCESSING_UPLOAD':
    case 'PROCESSING_DOWNLOAD':
      return 'processing';
    default:
      return current;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PublishService {
  constructor(
    private readonly store: JobStore,
    private readonly accounts: AccountStore,
    private readonly posting: TikTokPostingService,
    private readonly settings: PublishSettings,
    private readonly log: FastifyBaseLogger,
  ) {}

  async recoverInterrupted(): Promise<void> {
    for (const job of this.store.list()) {
      const interrupted = job.variants.some((variant) =>
        variant.publications.some((publication) => INTERRUPTED_STATUSES.includes(publication.status)),
      );

      if (!interrupted) {
        continue;
      }

      await this.store.update(job.id, (target) => {
        for (const publication of target.variants.flatMap((variant) => variant.publications)) {
          if (INTERRUPTED_STATUSES.includes(publication.status)) {
            publication.status = 'failed';
            publication.failReason = 'Interrupted by a server restart before the upload finished.';
            publication.updatedAt = new Date().toISOString();
          }
        }
      });
    }
  }

  async start(jobId: string, variantId: string, request: PublishRequest): Promise<Publication> {
    const { job, variant } = this.store.requireVariant(jobId, variantId);
    const account = this.accounts.require(request.openId);
    const requiredScope = request.mode === 'direct' ? 'video.publish' : 'video.upload';

    if (!account.scopes.includes(requiredScope)) {
      throw new AppError(
        403,
        'missing_scope',
        `${account.displayName} didn't grant ${requiredScope}. Enable it in your TikTok app, then reconnect the account.`,
      );
    }

    const path = this.store.variantPath(jobId, variant);
    const plan = this.chunkPlan((await stat(path)).size);
    const postInfo = request.mode === 'direct' ? await this.directPostInfo(request, job) : null;
    const now = new Date().toISOString();

    const publication: Publication = {
      id: randomBytes(6).toString('hex'),
      openId: account.openId,
      accountName: account.displayName,
      mode: request.mode,
      status: 'initializing',
      publishId: null,
      uploadedBytes: 0,
      totalBytes: plan.videoSize,
      tiktokStatus: null,
      failReason: null,
      postIds: [],
      privacyLevel: postInfo?.privacy_level ?? null,
      title: postInfo?.title ?? null,
      createdAt: now,
      updatedAt: now,
    };

    await this.store.update(jobId, (target) => {
      target.variants.find((candidate) => candidate.id === variantId)!.publications.unshift(publication);
    });

    const ref = { jobId, variantId, publicationId: publication.id };

    void this.run(ref, account.openId, path, videoContentType(variant.fileName), plan, postInfo).catch((error) =>
      this.markFailed(ref, errorMessage(error)),
    );

    return publication;
  }

  async refresh(ref: PublicationRef): Promise<Publication> {
    const current = this.requirePublication(ref);

    if (!current.publishId) {
      return current;
    }

    const status = await this.posting.fetchStatus(current.openId, current.publishId);

    return this.patch(ref, {
      status: mapStatus(status.status, current.status),
      tiktokStatus: status.status,
      failReason: status.failReason,
      postIds: status.postIds.length ? status.postIds : current.postIds,
    });
  }

  private chunkPlan(size: number): UploadChunkPlan {
    try {
      return planUploadChunks(size, this.settings.chunkBytes);
    } catch (error) {
      throw new AppError(422, 'upload_size_invalid', errorMessage(error));
    }
  }

  private async directPostInfo(request: PublishRequest, job: Job): Promise<DirectPostInfo> {
    const privacy = request.privacyLevel;

    if (!privacy) {
      throw new AppError(400, 'privacy_required', 'Choose who can view the post.');
    }

    if (!this.settings.audited && privacy !== 'SELF_ONLY') {
      throw new AppError(
        400,
        'unaudited_privacy',
        'Until TikTok audits your app, Direct Post can only publish as "Only me". Use Inbox mode to pick visibility in the TikTok app.',
      );
    }

    const creator = await this.posting.creatorInfo(request.openId);

    if (!creator.privacyLevelOptions.includes(privacy)) {
      throw new AppError(400, 'privacy_not_allowed', `This account can't post with "${privacy}" right now.`);
    }

    const duration = job.sourceReport.durationSeconds ?? primaryVideo(job.sourceReport)?.durationSeconds ?? null;

    if (duration && creator.maxVideoPostDurationSec && duration > creator.maxVideoPostDurationSec) {
      throw new AppError(
        400,
        'video_too_long',
        `This account can post videos up to ${creator.maxVideoPostDurationSec}s; the video is ${Math.ceil(duration)}s.`,
      );
    }

    return {
      title: request.title?.trim() || undefined,
      privacy_level: privacy,
      disable_comment: Boolean(request.disableComment || creator.commentDisabled),
      disable_duet: Boolean(request.disableDuet || creator.duetDisabled),
      disable_stitch: Boolean(request.disableStitch || creator.stitchDisabled),
      brand_content_toggle: Boolean(request.brandContentToggle),
      brand_organic_toggle: Boolean(request.brandOrganicToggle),
      is_aigc: Boolean(request.isAigc),
    };
  }

  private async run(
    ref: PublicationRef,
    openId: string,
    path: string,
    contentType: string,
    plan: UploadChunkPlan,
    postInfo: DirectPostInfo | null,
  ): Promise<void> {
    const upload = postInfo
      ? await this.posting.initDirectPost(openId, postInfo, plan)
      : await this.posting.initInboxUpload(openId, plan);

    await this.patch(ref, { status: 'uploading', publishId: upload.publishId });
    await this.posting.uploadFile(upload.uploadUrl, path, contentType, plan, async (uploadedBytes) => {
      await this.patch(ref, { uploadedBytes });
    });
    await this.patch(ref, { status: 'processing', uploadedBytes: plan.videoSize });

    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await delay(POLL_INTERVAL_MS);

      const publication = await this.refresh(ref);

      if (TERMINAL_STATUSES.includes(publication.status)) {
        return;
      }
    }
  }

  private async markFailed(ref: PublicationRef, reason: string): Promise<void> {
    this.log.warn({ ...ref, reason }, 'Publication failed');

    try {
      await this.patch(ref, { status: 'failed', failReason: reason });
    } catch (error) {
      this.log.error({ ...ref, error: errorMessage(error) }, 'Could not record the failed publication');
    }
  }

  private requirePublication(ref: PublicationRef): Publication {
    const { variant } = this.store.requireVariant(ref.jobId, ref.variantId);
    const publication = variant.publications.find((candidate) => candidate.id === ref.publicationId);

    if (!publication) {
      throw notFound('Publication');
    }

    return publication;
  }

  private async patch(ref: PublicationRef, changes: Partial<Publication>): Promise<Publication> {
    const publication = this.requirePublication(ref);

    await this.store.update(ref.jobId, () => {
      Object.assign(publication, changes, { updatedAt: new Date().toISOString() });
    });

    return { ...publication };
  }
}
