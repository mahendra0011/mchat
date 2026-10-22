import React from 'react';
import { FileText, ImageOff, Paperclip } from 'lucide-react';
import type { MessageAttachment } from '@orbit/schemas';

export interface ImageMessageProps {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  onOpen?: () => void;
}

export interface VideoMessageProps {
  src: string;
  poster?: string;
}

export interface AudioMessageProps {
  src: string;
  duration?: number;
  waveform?: number[];
}

export interface MediaMessageProps {
  attachment: MessageAttachment;
}

const WAVEFORM_FALLBACK_HEIGHTS = [
  6, 12, 18, 10, 22, 14, 20, 8, 16, 24, 12, 18, 9, 15, 21, 11, 17, 7, 13, 19,
  10, 22, 14, 8, 16, 20, 12, 6, 18, 11, 21, 9,
];

export const formatDurationLabel = (totalSeconds: number): string => {
  const safe =
    Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const formatBytesLabel = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const toWaveformHeights = (waveform?: number[]): number[] => {
  if (!waveform || waveform.length === 0) return WAVEFORM_FALLBACK_HEIGHTS;
  const max = Math.max(...waveform.map((v) => Math.abs(v)), 0.0001);
  return waveform.map((v) => Math.max(4, Math.round((Math.abs(v) / max) * 20) + 4));
};

export const ImageMessage: React.FC<ImageMessageProps> = ({
  src,
  alt = 'Shared image',
  width,
  height,
  onOpen,
}) => {
  const [hasError, setHasError] = React.useState(false);

  if (hasError) {
    return (
      <div
        role="img"
        aria-label="Image failed to load"
        style={{
          maxWidth: '320px',
          minHeight: '120px',
          borderRadius: '12px',
          border: '1px dashed var(--border-strong)',
          backgroundColor: 'var(--surface-muted)',
          color: 'var(--text-muted)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          padding: '16px',
          fontSize: '12px',
          fontWeight: 600,
        }}
      >
        <ImageOff size={20} />
        <span>Image failed to load</span>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: '320px',
        borderRadius: '12px',
        overflow: 'hidden',
        border: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--surface-muted)',
        lineHeight: 0,
      }}
    >
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        onError={() => setHasError(true)}
        onClick={onOpen}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          maxHeight: '360px',
          objectFit: 'contain',
          cursor: onOpen ? 'zoom-in' : undefined,
        }}
      />
    </div>
  );
};

export const VideoMessage: React.FC<VideoMessageProps> = ({ src, poster }) => (
  <div
    style={{
      maxWidth: '420px',
      borderRadius: '12px',
      overflow: 'hidden',
      border: '1px solid var(--border-subtle)',
      backgroundColor: '#000000',
      lineHeight: 0,
    }}
  >
    <video
      src={src}
      poster={poster}
      controls
      preload="metadata"
      style={{
        display: 'block',
        width: '100%',
        maxHeight: '320px',
        backgroundColor: '#000000',
      }}
    />
  </div>
);

export const AudioMessage: React.FC<AudioMessageProps> = ({
  src,
  duration,
  waveform,
}) => {
  const heights = toWaveformHeights(waveform);

  return (
    <div
      style={{
        maxWidth: '320px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '10px 12px',
        borderRadius: '12px',
        border: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--surface-muted)',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          height: '28px',
        }}
      >
        {heights.map((h, i) => (
          <div
            key={i}
            style={{
              width: '3px',
              height: `${h}px`,
              borderRadius: '2px',
              backgroundColor: 'var(--accent-primary)',
              opacity: 0.65,
            }}
          />
        ))}
      </div>
      <audio src={src} controls preload="metadata" style={{ width: '100%' }} />
      {duration !== undefined && (
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--text-muted)',
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatDurationLabel(duration)}
        </span>
      )}
    </div>
  );
};

interface FileCardProps {
  filename: string;
  sizeBytes?: number;
  icon: React.ReactNode;
  accent?: boolean;
  href?: string;
}

const FileCard: React.FC<FileCardProps> = ({
  filename,
  sizeBytes,
  icon,
  accent,
  href,
}) => {
  const content = (
    <>
      <span
        style={{
          display: 'flex',
          flexShrink: 0,
          color: accent ? 'var(--danger)' : 'var(--text-secondary)',
        }}
      >
        {icon}
      </span>
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          gap: '1px',
        }}
      >
        <span
          style={{
            fontWeight: 600,
            fontSize: '12px',
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {filename || 'Attachment'}
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {sizeBytes !== undefined ? formatBytesLabel(sizeBytes) : 'File'}
        </span>
      </span>
    </>
  );

  const cardStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    maxWidth: '320px',
    padding: '10px 12px',
    borderRadius: '12px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-muted)',
    textDecoration: 'none',
    color: 'inherit',
  };

  if (href) {
    return (
      <a href={href} download={filename} style={cardStyle}>
        {content}
      </a>
    );
  }

  return <div style={cardStyle}>{content}</div>;
};

export const MediaMessage: React.FC<MediaMessageProps> = ({ attachment }) => {
  const { mimeType, name, url, sizeBytes, durationSeconds, waveform } = attachment;

  if (mimeType.startsWith('image/')) {
    return <ImageMessage src={url} alt={name} />;
  }
  if (mimeType.startsWith('video/')) {
    return <VideoMessage src={url} />;
  }
  if (mimeType.startsWith('audio/')) {
    return (
      <AudioMessage src={url} duration={durationSeconds} waveform={waveform} />
    );
  }
  if (mimeType === 'application/pdf') {
    return (
      <FileCard
        filename={name}
        sizeBytes={sizeBytes}
        href={url}
        accent
        icon={<FileText size={18} />}
      />
    );
  }
  return (
    <FileCard
      filename={name}
      sizeBytes={sizeBytes}
      href={url}
      icon={<Paperclip size={18} />}
    />
  );
};
