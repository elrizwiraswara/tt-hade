import { open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import type { CreatorInfo, PrivacyLevel } from '../../../shared/api.js';
import { TikTokApiError } from '../../errors.js';
import { callOpenApi } from './api-client.js';
import type { UploadChunkPlan } from './chunking.js';
import type { TikTokOAuthService } from './oauth.service.js';

const CHUNK_RETRIES = 3;

interface CreatorInfoResponse {
  creator_avatar_url?: string;
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options?: PrivacyLevel[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
}

interface InitResponse {
  publish_id: string;
  upload_url?: string;
}

interface StatusResponse {
  status?: string;
  fail_reason?: string;
  publicaly_available_post_id?: (number | string)[];
  uploaded_bytes?: number;
}

export interface DirectPostInfo {
  title?: string;
  privacy_level: PrivacyLevel;
  disable_comment?: boolean;
  disable_duet?: boolean;
  disable_stitch?: boolean;
  brand_content_toggle?: boolean;
  brand_organic_toggle?: boolean;
  is_aigc?: boolean;
}

export interface InitializedUpload {
  publishId: string;
  uploadUrl: string;
}

export interface PostStatus {
  status: string;
  failReason: string | null;
  postIds: string[];
  uploadedBytes: number;
}

function sourceInfo(plan: UploadChunkPlan) {
  return {
    source: 'FILE_UPLOAD',
    video_size: plan.videoSize,
    chunk_size: plan.chunkSize,
    total_chunk_count: plan.totalChunkCount,
  };
}

function requireUploadUrl(response: InitResponse): InitializedUpload {
  if (!response.publish_id || !response.upload_url) {
    throw new TikTokApiError(502, 'invalid_response', 'TikTok did not return an upload URL.');
  }

  return { publishId: response.publish_id, uploadUrl: response.upload_url };
}

export class TikTokPostingService {
  constructor(private readonly oauth: TikTokOAuthService) {}

  async creatorInfo(openId: string): Promise<CreatorInfo> {
    const data = await callOpenApi<CreatorInfoResponse>('/v2/post/publish/creator_info/query/', {
      method: 'POST',
      accessToken: await this.oauth.accessToken(openId),
    });

    return {
      creatorAvatarUrl: data.creator_avatar_url ?? null,
      creatorUsername: data.creator_username ?? '',
      creatorNickname: data.creator_nickname ?? '',
      privacyLevelOptions: data.privacy_level_options ?? [],
      commentDisabled: data.comment_disabled ?? false,
      duetDisabled: data.duet_disabled ?? false,
      stitchDisabled: data.stitch_disabled ?? false,
      maxVideoPostDurationSec: data.max_video_post_duration_sec ?? 0,
    };
  }

  async initDirectPost(openId: string, postInfo: DirectPostInfo, plan: UploadChunkPlan): Promise<InitializedUpload> {
    const response = await callOpenApi<InitResponse>('/v2/post/publish/video/init/', {
      method: 'POST',
      accessToken: await this.oauth.accessToken(openId),
      body: { post_info: postInfo, source_info: sourceInfo(plan) },
    });

    return requireUploadUrl(response);
  }

  async initInboxUpload(openId: string, plan: UploadChunkPlan): Promise<InitializedUpload> {
    const response = await callOpenApi<InitResponse>('/v2/post/publish/inbox/video/init/', {
      method: 'POST',
      accessToken: await this.oauth.accessToken(openId),
      body: { source_info: sourceInfo(plan) },
    });

    return requireUploadUrl(response);
  }

  async uploadFile(
    uploadUrl: string,
    filePath: string,
    contentType: string,
    plan: UploadChunkPlan,
    onProgress: (uploadedBytes: number) => Promise<void> | void,
  ): Promise<void> {
    const file = await open(filePath, 'r');

    try {
      for (const chunk of plan.chunks) {
        const length = chunk.end - chunk.start;
        const body = Buffer.allocUnsafe(length);
        const { bytesRead } = await file.read(body, 0, length, chunk.start);

        if (bytesRead !== length) {
          throw new Error(`Could not read bytes ${chunk.start}-${chunk.end} of the video.`);
        }

        await this.putChunk(uploadUrl, body, contentType, chunk.start, plan.videoSize);
        await onProgress(chunk.end);
      }
    } finally {
      await file.close();
    }
  }

  async fetchStatus(openId: string, publishId: string): Promise<PostStatus> {
    const data = await callOpenApi<StatusResponse>('/v2/post/publish/status/fetch/', {
      method: 'POST',
      accessToken: await this.oauth.accessToken(openId),
      body: { publish_id: publishId },
    });

    return {
      status: data.status ?? 'UNKNOWN',
      failReason: data.fail_reason || null,
      postIds: (data.publicaly_available_post_id ?? []).map(String),
      uploadedBytes: data.uploaded_bytes ?? 0,
    };
  }

  private async putChunk(uploadUrl: string, body: Buffer, contentType: string, start: number, total: number): Promise<void> {
    const range = `bytes ${start}-${start + body.length - 1}/${total}`;

    for (let attempt = 1; ; attempt++) {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType, 'Content-Range': range },
        body,
      }).catch((error: unknown) => error as Error);

      if (!(response instanceof Error) && response.ok) {
        await response.body?.cancel();

        return;
      }

      const retryable = response instanceof Error || response.status >= 500;

      if (!retryable || attempt >= CHUNK_RETRIES) {
        const status = response instanceof Error ? 0 : response.status;
        const detail = response instanceof Error ? response.message : await response.text();

        throw new TikTokApiError(status, 'upload_failed', `Uploading ${range} failed${status ? ` with HTTP ${status}` : ''}: ${detail.slice(0, 300)}`);
      }

      await delay(1000 * 2 ** (attempt - 1));
    }
  }
}
