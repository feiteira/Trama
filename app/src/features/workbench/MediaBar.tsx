import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Crosshair, Pause, Play, RotateCcw, RotateCw, Video, VideoOff } from 'lucide-react';
import type { MediaRef } from '../../core/model/types';
import { useProject } from '../../shell/AppState';
import { IconButton } from '../../ui/components/Button';
import { Spinner } from '../../ui/components/Feedback';
import { MenuButton } from '../../ui/components/Menu';
import { useI18n } from '../../ui/i18n';
import { formatTime } from './model/paragraphs';

// The recording of a transcript: decrypted into memory as a Blob URL (revoked when the
// document closes), played from a bar under the text. The viewer follows along: clicking a
// timestamp seeks there, and the paragraph being spoken is marked as it plays.

export interface MediaHandle {
  seek: (ms: number, play?: boolean) => void;
  toggle: () => void;
  skip: (deltaMs: number) => void;
  /** Playing, or the focus is on the player: Alt+←/→ skip rather than go back. */
  active: () => boolean;
}

export interface MediaBarProps {
  media: MediaRef;
  follow: boolean;
  onFollow: (v: boolean) => void;
  onTime: (ms: number, playing: boolean) => void;
  keys: { toggle: string; back: string; forward: string };
}

const RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const isVideo = (mime: string) => mime.startsWith('video/');

export const MediaBar = forwardRef<MediaHandle, MediaBarProps>(function MediaBar({ media, follow, onFollow, onTime, keys }, ref) {
  const { t } = useI18n();
  const project = useProject();
  const el = useRef<HTMLMediaElement | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState<number>(1);
  const [showVideo, setShowVideo] = useState(true);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;
  const video = isVideo(media.mime);

  useEffect(() => {
    let live = true;
    let made: string | null = null;
    setUrl(null);
    setError(null);
    setPlaying(false);
    setNow(0);
    project
      .readBlob(media)
      .then((bytes) => {
        if (!live) return;
        made = URL.createObjectURL(new Blob([bytes as BlobPart], { type: media.mime || 'application/octet-stream' }));
        setUrl(made);
      })
      .catch((e: unknown) => {
        console.error('reading the recording failed', e);
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [project, media]);

  const seek = useCallback((ms: number, play = true) => {
    const m = el.current;
    if (!m) return;
    m.currentTime = Math.max(0, ms / 1000);
    setNow(ms);
    onTimeRef.current(ms, !m.paused || play);
    if (play) void m.play().catch(() => undefined);
  }, []);
  const toggle = useCallback(() => {
    const m = el.current;
    if (!m) return;
    if (m.paused) void m.play().catch(() => undefined);
    else m.pause();
  }, []);
  const skip = useCallback((delta: number) => {
    const m = el.current;
    if (!m) return;
    m.currentTime = Math.max(0, Math.min(m.duration || Infinity, m.currentTime + delta / 1000));
  }, []);
  const active = useCallback(() => {
    const m = el.current;
    return (!!m && !m.paused) || !!bar.current?.contains(document.activeElement);
  }, []);
  useImperativeHandle(ref, () => ({ seek, toggle, skip, active }), [seek, toggle, skip, active]);

  useEffect(() => {
    if (el.current) el.current.playbackRate = rate;
  }, [rate, url]);

  const bind = {
    ref: (n: HTMLMediaElement | null) => {
      el.current = n;
    },
    src: url ?? undefined,
    preload: 'metadata',
    onPlay: () => setPlaying(true),
    onPause: () => {
      setPlaying(false);
      onTimeRef.current((el.current?.currentTime ?? 0) * 1000, false);
    },
    onEnded: () => setPlaying(false),
    onLoadedMetadata: () => setDuration((el.current?.duration ?? 0) * 1000),
    onDurationChange: () => setDuration((el.current?.duration ?? 0) * 1000),
    onTimeUpdate: () => {
      const ms = (el.current?.currentTime ?? 0) * 1000;
      setNow(ms);
      onTimeRef.current(ms, !(el.current?.paused ?? true));
    },
    'data-testid': 'media-element',
  } as const;

  const name = media.filename;
  return (
    <div ref={bar} className="wb-media" data-testid="media-bar">
      {video ? (
        <div className={showVideo && url ? 'wb-media__video' : 'wb-media__video is-hidden'}>
          <video {...bind} playsInline />
        </div>
      ) : (
        <audio {...bind} />
      )}
      {error ? (
        <div className="wb-media__error" role="alert">
          {t('workbench.media.failed', { message: error })}
        </div>
      ) : !url ? (
        <div className="wb-media__loading">
          <Spinner size={14} />
          {t('workbench.media.loading')}
        </div>
      ) : (
        <>
          <IconButton size="sm" icon={RotateCcw} label={t('workbench.media.back')} shortcut={keys.back} onClick={() => skip(-5000)} data-testid="media-back" />
          <button
            type="button"
            className="wb-media__play"
            onClick={toggle}
            aria-label={playing ? t('workbench.media.pause') : t('workbench.media.play')}
            title={`${playing ? t('workbench.media.pause') : t('workbench.media.play')} (${keys.toggle})`}
            data-testid="media-play"
          >
            {playing ? <Pause size={15} aria-hidden fill="currentColor" strokeWidth={1.5} /> : <Play size={15} aria-hidden fill="currentColor" strokeWidth={1.5} />}
          </button>
          <IconButton size="sm" icon={RotateCw} label={t('workbench.media.forward')} shortcut={keys.forward} onClick={() => skip(5000)} data-testid="media-forward" />
          <span className="wb-media__time t-tabular" data-testid="media-time">
            {formatTime(now)}
            <span className="wb-media__sep"> / </span>
            {formatTime(duration)}
          </span>
          <input
            type="range"
            className="wb-media__scrub"
            min={0}
            max={Math.max(1, Math.round(duration))}
            step={100}
            value={Math.min(Math.round(now), Math.max(1, Math.round(duration)))}
            onChange={(e) => seek(Number(e.target.value), playing)}
            aria-label={t('workbench.media.position')}
            aria-valuetext={formatTime(now)}
            style={{ ['--pct' as string]: `${duration ? Math.min(100, (now / duration) * 100) : 0}%` }}
            data-testid="media-scrub"
          />
          <span className="wb-media__name" title={name}>
            {name}
          </span>
          <MenuButton
            size="sm"
            variant="ghost"
            label={`${rate}×`}
            align="end"
            side="top"
            items={RATES.map((r) => ({ id: String(r), label: `${r}×`, checked: r === rate, onSelect: () => setRate(r) }))}
            data-testid="media-rate"
          />
          {video ? (
            <IconButton size="sm" icon={showVideo ? VideoOff : Video} label={showVideo ? t('workbench.media.hideVideo') : t('workbench.media.showVideo')} onClick={() => setShowVideo((v) => !v)} />
          ) : null}
          <IconButton size="sm" icon={Crosshair} label={t('workbench.media.follow')} pressed={follow} onClick={() => onFollow(!follow)} data-testid="media-follow" />
        </>
      )}
    </div>
  );
});
