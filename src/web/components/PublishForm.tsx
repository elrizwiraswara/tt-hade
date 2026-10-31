import { useEffect, useState, type FormEvent } from 'react';

import type { AccountSummary, CreatorInfo, HealthResponse, Job, PostMode, PrivacyLevel, Variant } from '../../shared/api.js';
import { api, errorMessage } from '../api.js';

interface PublishFormProps {
  job: Job;
  variant: Variant;
  health: HealthResponse;
  accounts: AccountSummary[];
  onPublished: () => Promise<void>;
}

const PRIVACY_LABELS: Record<PrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: 'Everyone',
  MUTUAL_FOLLOW_FRIENDS: 'Friends',
  FOLLOWER_OF_CREATOR: 'Followers',
  SELF_ONLY: 'Only me',
};

const MODES: { mode: PostMode; scope: string; label: string }[] = [
  { mode: 'inbox', scope: 'video.upload', label: 'Inbox draft' },
  { mode: 'direct', scope: 'video.publish', label: 'Direct post' },
];

export function PublishForm({ job, variant, health, accounts, onPublished }: PublishFormProps) {
  const [openId, setOpenId] = useState(accounts[0]?.openId ?? '');
  const [mode, setMode] = useState<PostMode>('inbox');
  const [creator, setCreator] = useState<CreatorInfo | null>(null);
  const [privacy, setPrivacy] = useState<PrivacyLevel | ''>('');
  const [title, setTitle] = useState('');
  const [disableComment, setDisableComment] = useState(false);
  const [disableDuet, setDisableDuet] = useState(false);
  const [disableStitch, setDisableStitch] = useState(false);
  const [discloseCommercial, setDiscloseCommercial] = useState(false);
  const [brandOrganic, setBrandOrganic] = useState(false);
  const [brandContent, setBrandContent] = useState(false);
  const [isAigc, setIsAigc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account = accounts.find((candidate) => candidate.openId === openId);
  const allowedModes = MODES.filter((option) => account?.scopes.includes(option.scope)).map((option) => option.mode);
  const fallbackMode = allowedModes[0];
  const modeAllowed = allowedModes.includes(mode);

  useEffect(() => {
    if (!openId && accounts[0]) {
      setOpenId(accounts[0].openId);
    }
  }, [accounts, openId]);

  useEffect(() => {
    if (fallbackMode && !modeAllowed) {
      setMode(fallbackMode);
    }
  }, [fallbackMode, modeAllowed]);

  const directAllowed = allowedModes.includes('direct');

  useEffect(() => {
    setCreator(null);

    if (mode !== 'direct' || !openId || !directAllowed) {
      return;
    }

    let cancelled = false;

    api
      .creatorInfo(openId)
      .then((info) => {
        if (cancelled) {
          return;
        }

        setCreator(info);
        setPrivacy(!health.appAudited && info.privacyLevelOptions.includes('SELF_ONLY') ? 'SELF_ONLY' : '');
      })
      .catch((caught: unknown) => !cancelled && setError(errorMessage(caught)));

    return () => {
      cancelled = true;
    };
  }, [mode, openId, directAllowed, health.appAudited]);

  if (!accounts.length) {
    return <p className="muted small">Connect a TikTok account in the TikTok accounts tab to post this variant.</p>;
  }

  if (!fallbackMode) {
    return (
      <p className="muted small">
        {account?.displayName ?? 'This account'} didn't grant a posting permission (<code>video.upload</code> or{' '}
        <code>video.publish</code>). Enable it in your TikTok app, then reconnect the account.
      </p>
    );
  }

  const privacyAllowed = (level: PrivacyLevel) => health.appAudited || level === 'SELF_ONLY';
  const brandedButPrivate = discloseCommercial && brandContent && privacy === 'SELF_ONLY';
  const commercialIncomplete = discloseCommercial && !brandOrganic && !brandContent;
  const directBlocked = mode === 'direct' && (!creator || !privacy || brandedButPrivate || commercialIncomplete);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await api.publish(job.id, variant.id, {
        openId,
        mode,
        ...(mode === 'direct'
          ? {
              title,
              privacyLevel: privacy || undefined,
              disableComment,
              disableDuet,
              disableStitch,
              brandOrganicToggle: discloseCommercial && brandOrganic,
              brandContentToggle: discloseCommercial && brandContent,
              isAigc,
            }
          : {}),
      });
      await onPublished();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack-sm" onSubmit={(event) => void submit(event)}>
      <h4>Post to TikTok</h4>

      <div className="grid-2">
        <label className="field">
          <span className="field-label">Account</span>
          <select value={openId} onChange={(event) => setOpenId(event.target.value)}>
            {accounts.map((account) => (
              <option key={account.openId} value={account.openId}>
                {account.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Mode</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as PostMode)}>
            {MODES.map((option) => (
              <option key={option.mode} value={option.mode} disabled={!allowedModes.includes(option.mode)}>
                {option.label}
                {allowedModes.includes(option.mode) ? '' : ` (needs ${option.scope})`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {mode === 'direct' && !creator && !error && <p className="muted small">Loading creator settings…</p>}

      {mode === 'direct' && creator && (
        <div className="card-muted stack-sm">
          <p className="small">
            Posting as <strong>{creator.creatorNickname || creator.creatorUsername}</strong>
            {creator.maxVideoPostDurationSec ? ` · max ${creator.maxVideoPostDurationSec}s` : ''}
          </p>

          <label className="field">
            <span className="field-label">Title</span>
            <textarea value={title} maxLength={2200} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <label className="field">
            <span className="field-label">Who can view this video</span>
            <select value={privacy} onChange={(event) => setPrivacy(event.target.value as PrivacyLevel)}>
              <option value="" disabled>
                Choose…
              </option>
              {creator.privacyLevelOptions.map((level) => (
                <option key={level} value={level} disabled={!privacyAllowed(level)}>
                  {PRIVACY_LABELS[level]}
                  {privacyAllowed(level) ? '' : ' (needs an audited app)'}
                </option>
              ))}
            </select>
          </label>

          <div className="row">
            <label className="check">
              <input
                type="checkbox"
                checked={disableComment || creator.commentDisabled}
                disabled={creator.commentDisabled}
                onChange={(event) => setDisableComment(event.target.checked)}
              />
              Turn off comments
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={disableDuet || creator.duetDisabled}
                disabled={creator.duetDisabled}
                onChange={(event) => setDisableDuet(event.target.checked)}
              />
              Turn off Duet
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={disableStitch || creator.stitchDisabled}
                disabled={creator.stitchDisabled}
                onChange={(event) => setDisableStitch(event.target.checked)}
              />
              Turn off Stitch
            </label>
            <label className="check">
              <input type="checkbox" checked={isAigc} onChange={(event) => setIsAigc(event.target.checked)} />
              AI-generated content
            </label>
          </div>

          <label className="check">
            <input type="checkbox" checked={discloseCommercial} onChange={(event) => setDiscloseCommercial(event.target.checked)} />
            This video promotes a brand, product or service
          </label>

          {discloseCommercial && (
            <div className="row" style={{ paddingLeft: 24 }}>
              <label className="check">
                <input type="checkbox" checked={brandOrganic} onChange={(event) => setBrandOrganic(event.target.checked)} />
                Your brand
              </label>
              <label className="check">
                <input type="checkbox" checked={brandContent} onChange={(event) => setBrandContent(event.target.checked)} />
                Branded content (paid partnership)
              </label>
            </div>
          )}

          {commercialIncomplete && <p className="small error-text">Choose what the video promotes.</p>}
          {brandedButPrivate && <p className="small error-text">Branded content can't be posted as "Only me".</p>}

          <p className="muted small">
            By posting, you agree to TikTok's{' '}
            <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">
              Music Usage Confirmation
            </a>
            {discloseCommercial && brandContent && (
              <>
                {' '}
                and{' '}
                <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">
                  Branded Content Policy
                </a>
              </>
            )}
            .
          </p>
        </div>
      )}

      {mode === 'inbox' && (
        <p className="muted small">
          The video lands in the TikTok app's inbox. Open the notification, finish the post there, and set it to Everyone so the
          served-quality check can read it.
        </p>
      )}

      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={busy || !openId || directBlocked}>
          {busy ? 'Starting…' : mode === 'direct' ? 'Post now' : 'Send to TikTok inbox'}
        </button>
      </div>

      {error && <p className="error-text small">{error}</p>}
    </form>
  );
}
