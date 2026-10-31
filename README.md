# TT HADE

> **Experimental tool.** TT HADE tests unproven techniques against a platform that can change at any time. Results aren't guaranteed, features and file formats may change without notice, and it isn't meant for production use.

An internal tool for testing whether MP4 container patches change the quality TikTok serves. It:

1. Patches the MP4 container of a video without re-encoding it. The audio and video bytes are copied unchanged.
2. Posts the patched file to TikTok through the official Content Posting API (Direct Post or Inbox draft).
3. Measures what TikTok actually serves for the post, so different technique combinations can be compared.

No technique is guaranteed to work. TikTok controls its own processing pipeline and can change it at any time. The tool is set up as an experiment bench: one source video, several variants, each posted and measured.

## Requirements

- Node.js 22 or newer
- ffmpeg and ffprobe on `PATH`, or set `FFMPEG_PATH` and `FFPROBE_PATH`. They're used for audio normalization and the full decode check; patching works without them.
- A TikTok developer app, needed for posting (see below)

## Quick start

```bash
npm install
cp .env.example .env      # fill in the TikTok keys
npm run dev               # API on :3455, UI on http://localhost:5173
```

For production:

```bash
npm run build
npm start                 # serves API and UI on http://localhost:3455
```

Other scripts: `npm test` (vitest; uses ffmpeg to generate fixtures) and `npm run typecheck`.

## TikTok app setup

1. Create an app at <https://developers.tiktok.com/apps> (app type **Other**). Under **Basic information → Platforms**, tick only **Desktop**. Desktop apps may use `localhost` redirect URIs, and sign-in uses PKCE. The app icon is in `branding/app-icon.png`.
2. Add the **Login Kit** and **Content Posting API** products.
3. Request the scopes `user.info.basic` and `video.upload`. Sandbox apps can't get `video.publish` (Direct Post). Add it to `TIKTOK_SCOPES` only if the app is ever audited.
4. Register the redirect URI exactly as it appears in `.env`: `http://localhost:3455/api/auth/tiktok/callback/`
5. In the app's Sandbox, add the TikTok accounts you will post from as target users.
6. Put the client key and secret in `.env`, restart, then use **TikTok accounts → Connect account** in the UI.

### Unaudited apps

TikTok's App Review Guidelines reject apps "for private or personal use", so this internal tool is meant to run on the app's **Sandbox** and is not submitted for review.

Sandbox apps only get the `video.upload` scope, so TT HADE posts in **Inbox** mode: the video lands in the TikTok app's inbox, where you finish the post and pick the visibility yourself. Set it to Everyone so the served-quality check can read it. The post form only offers the modes the connected account has permission for.

Direct Post needs `video.publish`, which only audited apps get. Even then, until the app is audited:

- Direct Post publishes as `SELF_ONLY` ("Only me"). The server enforces this while `TIKTOK_APP_AUDITED=false`.
- It only works while the TikTok account itself is set to private.
- At most 5 users can post through the app in any 24 hours.

API limits to keep in mind:

- Video init: 6 requests per minute per user.
- Status fetch: 30 requests per minute.
- At most 5 pending inbox shares per 24 hours.
- Videos up to 4 GB and 10 minutes.

## Workflow

1. **Experiments → Add a source video.** Export at 1080×1920, constant 30 or 60 fps, H.264 (or HEVC) with AAC audio, at a high bitrate.
2. **Create variants.** Start with **Control** as the baseline, then **Light** and **Full**, or switch individual techniques on and off. Every variant is checked before it's saved:
   - the structure parses;
   - every chunk offset points inside the media data;
   - the media bytes are identical to the source;
   - optionally, ffmpeg decodes every frame.
3. **Post each variant** to TikTok.
4. **Check served quality.** Paste the public post link into the variant's served-quality form. The tool:
   - reads the list of versions TikTok offers for the post;
   - downloads the top version and inspects it;
   - reports the share of source bitrate that was kept, and whether your encoder tag survived. If the tag survived, TikTok kept your container instead of rebuilding it.
5. Compare the variants in the **Results** table.

**Inspect** reads any MP4: your exports, the patched variants, or a version downloaded from TikTok. It can also check any public post without linking it to an experiment.

## Techniques

| Technique | What changes |
| --- | --- |
| Header first | Moves `moov` before `mdat` and shifts every chunk offset to match. |
| Unknown movie duration | Sets `mvhd.duration` to all ones (the ISO "unknown" value). Some players show 0:00. |
| 0×0 sample entry size | Zeroes the width and height declared in the video sample description (`avc1`/`hvc1`). |
| 0×0 track header size | Zeroes the display size in the video `tkhd`. |
| Decoy AAC track | Clones the AAC track as a new track. It references the same samples, uses a new track ID, shares the alternate group, and can be disabled. Needs AAC audio, so turn on audio normalization for MP3 or silent sources. |
| Encoder tag | Writes `moov/udta/meta/ilst/©too`. Used to detect whether TikTok kept the container. |
| Junk tail | Appends filler bytes after the last box, either raw or wrapped in a `free` box. |
| Normalize audio | ffmpeg copies the video and re-encodes the audio to AAC 48 kHz stereo at 320 kbps. Adds silent audio if the source has none. |

The 0×0 changes only affect tools that trust the container. Decoders still read the real frame size from the H.264/HEVC stream.

## Notes

- Everything runs locally. Uploads, variants, and TikTok tokens are stored under `data/`, which is git-ignored.
- The served-quality check reads TikTok's public post page. If TikTok changes that page's format, the check fails with a clear error until the parser is updated in `src/server/services/served-quality.service.ts`.
- Posting files built to change how TikTok processes them may conflict with TikTok's developer terms. TikTok can restrict or revoke the app. Use test accounts.

## Project structure

```
src/
  mp4/        Container library (no Node dependencies): parse, inspect, patch plan, verify
  server/     Fastify API: jobs, variants, ffmpeg, TikTok sign-in, posting, served-quality checks
  shared/     API types shared by server and UI
  web/        React UI (Vite)
test/         Vitest suites: patching against ffmpeg fixtures, upload chunking, UI render
```
