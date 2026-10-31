import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import { inspectFile } from '../../mp4/index.js';
import type { ServedDownload, ServedReport, ServedRung } from '../../shared/api.js';
import { AppError } from '../errors.js';
import { withFileSource } from './file-source.js';

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
const REHYDRATION_PATTERN = /<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/;

type JsonRecord = Record<string, unknown>;

interface RungWithUrl extends ServedRung {
  url: string | null;
}

export type ServedCheckResult = Omit<ServedReport, 'id' | 'sourceBitrateKbps' | 'retention'>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function asNumber(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;

  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function firstUrl(playAddr: JsonRecord | null): string | null {
  const list = playAddr?.UrlList ?? playAddr?.url_list;

  return Array.isArray(list) ? asString(list[0]) : null;
}

function rungFromBitrateInfo(entry: unknown): RungWithUrl | null {
  const record = asRecord(entry);

  if (!record) {
    return null;
  }

  const playAddr = asRecord(record.PlayAddr);
  const bitrate = asNumber(record.Bitrate);

  return {
    gearName: asString(record.GearName) ?? 'unknown',
    codec: asString(record.CodecType) ?? 'unknown',
    qualityType: asNumber(record.QualityType),
    bitrateKbps: bitrate === null ? null : Math.round(bitrate / 1000),
    width: asNumber(playAddr?.Width),
    height: asNumber(playAddr?.Height),
    sizeBytes: asNumber(playAddr?.DataSize),
    url: firstUrl(playAddr),
  };
}

function fallbackRung(video: JsonRecord): RungWithUrl | null {
  const url = asString(video.playAddr);

  if (!url) {
    return null;
  }

  const bitrate = asNumber(video.bitrate);

  return {
    gearName: 'default',
    codec: asString(video.codecType) ?? 'unknown',
    qualityType: null,
    bitrateKbps: bitrate === null ? null : Math.round(bitrate / 1000),
    width: asNumber(video.width),
    height: asNumber(video.height),
    sizeBytes: null,
    url,
  };
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]!)
    .join('; ');
}

function stripUrl({ url: _url, ...rung }: RungWithUrl): ServedRung {
  return rung;
}

export class ServedQualityService {
  constructor(
    private readonly marker: string,
    private readonly tempDir: string,
  ) {}

  async check(url: string, download: boolean): Promise<ServedCheckResult> {
    const target = new URL(url);

    if (!/(^|\.)tiktok\.com$/i.test(target.hostname)) {
      throw new AppError(400, 'invalid_tiktok_url', 'Paste a tiktok.com post link.');
    }

    const page = await fetch(target, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (!page.ok) {
      throw new AppError(502, 'tiktok_page_unavailable', `TikTok returned HTTP ${page.status} for the post page.`);
    }

    const cookies = cookieHeader(page);
    const item = this.extractItem(await page.text());
    const video = asRecord(item.video) ?? {};
    const bitrateInfo = Array.isArray(video.bitrateInfo) ? video.bitrateInfo : [];
    const rungs = bitrateInfo
      .map(rungFromBitrateInfo)
      .filter((rung): rung is RungWithUrl => rung !== null)
      .sort((left, right) => (right.bitrateKbps ?? 0) - (left.bitrateKbps ?? 0));

    if (!rungs.length) {
      const fallback = fallbackRung(video);

      if (fallback) {
        rungs.push(fallback);
      }
    }

    const top = rungs[0] ?? null;
    let downloaded: ServedDownload | null = null;
    let downloadError: string | null = null;

    if (download && top?.url) {
      try {
        downloaded = await this.downloadAndInspect(top.url, cookies);
      } catch (error) {
        downloadError = error instanceof Error ? error.message : String(error);
      }
    } else if (download) {
      downloadError = 'TikTok did not expose a downloadable video URL for this post.';
    }

    return {
      url,
      videoId: asString(item.id),
      checkedAt: new Date().toISOString(),
      rungs: rungs.map(stripUrl),
      topRung: top ? stripUrl(top) : null,
      download: downloaded,
      downloadError,
    };
  }

  private extractItem(html: string): JsonRecord {
    const match = REHYDRATION_PATTERN.exec(html);

    if (!match) {
      throw new AppError(502, 'tiktok_page_format', 'The post page did not include video data. TikTok may have changed its page format or blocked the request.');
    }

    const data = asRecord(JSON.parse(match[1]!));
    const detail = asRecord(asRecord(data?.__DEFAULT_SCOPE__)?.['webapp.video-detail']);
    const item = asRecord(asRecord(detail?.itemInfo)?.itemStruct);

    if (!item) {
      const status = asNumber(detail?.statusCode);

      throw new AppError(
        404,
        'tiktok_post_unavailable',
        `TikTok returned no post data${status === null ? '' : ` (status ${status})`}. The post may be private, deleted or region-locked.`,
      );
    }

    return item;
  }

  private async downloadAndInspect(url: string, cookies: string): Promise<ServedDownload> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Referer: 'https://www.tiktok.com/',
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!response.ok || !response.body) {
      throw new Error(`The video download returned HTTP ${response.status}.`);
    }

    await mkdir(this.tempDir, { recursive: true });

    const path = join(this.tempDir, `served-${randomUUID()}.mp4`);
    let received = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        callback(received > MAX_DOWNLOAD_BYTES ? new Error('The served video is larger than 1 GB.') : null, chunk);
      },
    });

    try {
      await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), limit, createWriteStream(path));

      const report = await withFileSource(path, inspectFile);

      return { report, markerFound: report.encoderTag === this.marker };
    } finally {
      await rm(path, { force: true });
    }
  }
}
