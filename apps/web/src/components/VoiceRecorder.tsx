import React from 'react';
import { AlertCircle, Loader2, Mic, Pause, Play, Square, Trash2, X } from 'lucide-react';

export interface VoiceRecorderProps {
  onDone: (blob: Blob, durationSeconds: number) => void;
  onCancel?: () => void;
}

export interface VoiceNotePlayerProps {
  src: string;
  durationSeconds?: number;
}

type RecorderStatus = 'requesting' | 'recording' | 'denied' | 'error';

const formatTime = (totalSeconds: number): string => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  onDone,
  onCancel,
}) => {
  const [status, setStatus] = React.useState<RecorderStatus>('requesting');
  const [errorMessage, setErrorMessage] = React.useState('');
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);

  const streamRef = React.useRef<MediaStream | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const timerRef = React.useRef<number | null>(null);
  const startedAtRef = React.useRef<number | null>(null);
  const finishedRef = React.useRef(false);
  const onDoneRef = React.useRef(onDone);

  React.useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const stopTracks = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const start = async () => {
      if (
        typeof MediaRecorder === 'undefined' ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setStatus('error');
        setErrorMessage('Recording is not supported in this browser.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;

        const recorder = new MediaRecorder(stream);
        chunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };
        recorder.onstop = () => {
          const startedAt = startedAtRef.current;
          const duration = startedAt !== null ? (Date.now() - startedAt) / 1000 : 0;
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || 'audio/webm',
          });
          chunksRef.current = [];
          clearTimer();
          stopTracks();
          if (!finishedRef.current) {
            finishedRef.current = true;
            onDoneRef.current(blob, Number(duration.toFixed(1)));
          }
        };
        recorderRef.current = recorder;
        recorder.start();
        startedAtRef.current = Date.now();
        setStatus('recording');
        setElapsedSeconds(0);
        timerRef.current = window.setInterval(() => {
          const startedAt = startedAtRef.current;
          if (startedAt !== null) {
            setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
          }
        }, 250);
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setStatus('denied');
        } else {
          setStatus('error');
          setErrorMessage('Could not start recording. Please try again.');
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      clearTimer();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        try {
          recorder.stop();
        } catch {
          // recorder already stopped
        }
      }
      recorderRef.current = null;
      chunksRef.current = [];
      stopTracks();
    };
  }, [clearTimer, stopTracks]);

  const handleCancel = () => {
    finishedRef.current = true;
    clearTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        // recorder already stopped
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];
    stopTracks();
    onCancel?.();
  };

  const handleStop = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  };

  const shellStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 14px',
    borderRadius: '12px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface)',
    boxShadow: 'var(--shadow-sm)',
  };

  if (status === 'requesting') {
    return (
      <div role="status" aria-live="polite" style={shellStyle}>
        <Loader2
          size={16}
          aria-hidden="true"
          style={{
            color: 'var(--accent-primary)',
            animation: 'pulseGlow 1.2s ease-in-out infinite',
          }}
        />
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          Requesting microphone access…
        </span>
      </div>
    );
  }

  if (status === 'denied' || status === 'error') {
    return (
      <div role="alert" style={{ ...shellStyle, borderColor: 'var(--danger)' }}>
        <AlertCircle size={16} style={{ color: 'var(--danger)', flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: '12px', color: 'var(--text-primary)' }}>
          {status === 'denied' ? 'Microphone access denied' : errorMessage}
        </span>
        <button
          type="button"
          onClick={handleCancel}
          aria-label="Close voice recorder"
          title="Close"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            borderRadius: '9999px',
            border: 'none',
            backgroundColor: 'var(--surface-muted)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" style={shellStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <span
          aria-hidden="true"
          style={{
            width: '10px',
            height: '10px',
            borderRadius: '9999px',
            backgroundColor: 'var(--danger)',
            animation: 'pulseGlow 1.4s ease-in-out infinite',
          }}
        />
        <Mic size={14} style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
        <span
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatTime(elapsedSeconds)}
        </span>
      </div>

      <span
        style={{
          flex: 1,
          fontSize: '12px',
          color: 'var(--text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        Recording voice note…
      </span>

      <button
        type="button"
        onClick={handleCancel}
        aria-label="Cancel recording"
        title="Cancel recording"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          height: '32px',
          padding: '0 10px',
          borderRadius: '9999px',
          border: '1px solid var(--border-subtle)',
          backgroundColor: 'transparent',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 600,
          transition: 'background-color var(--duration-fast) var(--ease-standard)',
        }}
      >
        <Trash2 size={14} />
        Cancel
      </button>

      <button
        type="button"
        onClick={handleStop}
        aria-label="Send voice note"
        title="Send voice note"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          height: '32px',
          padding: '0 12px',
          borderRadius: '9999px',
          border: 'none',
          backgroundColor: 'var(--accent-primary)',
          color: 'var(--accent-text)',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 700,
          transition: 'background-color var(--duration-fast) var(--ease-standard)',
        }}
      >
        <Square size={12} />
        Send
      </button>
    </div>
  );
};

export const VoiceNotePlayer: React.FC<VoiceNotePlayerProps> = ({
  src,
  durationSeconds,
}) => {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [metadataDuration, setMetadataDuration] = React.useState<number | null>(null);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  };

  const totalDuration = durationSeconds ?? metadataDuration ?? 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        maxWidth: '320px',
        padding: '8px 12px',
        borderRadius: '12px',
        border: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--surface-muted)',
      }}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setProgress(0);
        }}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value)) setMetadataDuration(value);
        }}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            setProgress(audio.currentTime / audio.duration);
          }
        }}
      />
      <button
        type="button"
        onClick={togglePlayback}
        aria-label={isPlaying ? 'Pause voice note' : 'Play voice note'}
        title={isPlaying ? 'Pause' : 'Play'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '32px',
          height: '32px',
          flexShrink: 0,
          borderRadius: '9999px',
          border: 'none',
          backgroundColor: 'var(--accent-primary)',
          color: 'var(--accent-text)',
          cursor: 'pointer',
          transition: 'background-color var(--duration-fast) var(--ease-standard)',
        }}
      >
        {isPlaying ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <div
        aria-hidden="true"
        style={{
          flex: 1,
          height: '4px',
          borderRadius: '9999px',
          backgroundColor: 'var(--border-subtle)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`,
            height: '100%',
            borderRadius: '9999px',
            backgroundColor: 'var(--accent-primary)',
            transition: 'width var(--duration-fast) linear',
          }}
        />
      </div>
      <span
        style={{
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--text-muted)',
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
        }}
      >
        {formatTime(totalDuration)}
      </span>
    </div>
  );
};
