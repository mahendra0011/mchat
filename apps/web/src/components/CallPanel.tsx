import React from 'react';
import {
  Check,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Smartphone,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import { generateQRCodeDataURL } from '../lib/qrcode.js';
import { getAccessToken } from '../lib/secure-storage.js';

export type CallState = 'connecting' | 'ringing' | 'active' | 'ended';

export interface CallParticipant {
  id: string;
  name: string;
  isMuted?: boolean;
  hasVideo?: boolean;
  isLocal?: boolean;
}

export interface CallPanelProps {
  participants: CallParticipant[];
  isMuted: boolean;
  isVideoOn: boolean;
  isScreenSharing: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onLeave: () => void;
  callState: CallState;
  isIncoming?: boolean;
  onAccept?: () => void;
  callId?: string;
  activeWorkspaceId?: string;
  onHandoff?: (token: string) => void;
}

export interface ParticipantTileProps {
  name: string;
  isMuted?: boolean;
  hasVideo?: boolean;
  videoEl?: React.ReactNode;
}

interface ControlButtonProps {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  highlighted?: boolean;
}

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const initials = parts.map((part) => part.charAt(0).toUpperCase()).join('');
  return initials || '?';
};

const ControlButton: React.FC<ControlButtonProps> = ({
  label,
  onClick,
  children,
  danger,
  highlighted,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '44px',
      height: '44px',
      borderRadius: '9999px',
      border: 'none',
      cursor: 'pointer',
      transition: 'background-color var(--duration-fast) var(--ease-standard)',
      backgroundColor: danger
        ? 'var(--danger)'
        : highlighted
          ? 'var(--danger-soft)'
          : 'var(--surface-muted)',
      color: danger ? '#FFFFFF' : highlighted ? 'var(--danger)' : 'var(--text-primary)',
    }}
  >
    {children}
  </button>
);

export const ParticipantTile: React.FC<ParticipantTileProps> = ({
  name,
  isMuted,
  hasVideo,
  videoEl,
}) => (
  <div
    style={{
      position: 'relative',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      backgroundColor: 'var(--surface-sunken)',
      border: '1px solid var(--border-subtle)',
      aspectRatio: '16 / 9',
      minHeight: '140px',
    }}
  >
    {hasVideo && videoEl ? (
      <div style={{ position: 'absolute', inset: 0, lineHeight: 0 }}>{videoEl}</div>
    ) : (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '9999px',
            backgroundColor: 'var(--accent-soft)',
            color: 'var(--accent-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            fontWeight: 700,
          }}
        >
          {getInitials(name)}
        </div>
      </div>
    )}
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '14px 10px 8px',
        background: 'linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent)',
        color: '#FFFFFF',
        fontSize: '12px',
        fontWeight: 600,
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      {isMuted && <MicOff size={14} aria-label="Muted" />}
    </div>
  </div>
);

export const CallPanel: React.FC<CallPanelProps> = ({
  participants,
  isMuted,
  isVideoOn,
  isScreenSharing,
  onToggleMute,
  onToggleVideo,
  onToggleScreenShare,
  onLeave,
  callState,
  isIncoming,
  onAccept,
  callId,
  activeWorkspaceId,
  onHandoff,
}) => {
  const localVideoPlaceholder = (
    <video
      muted
      autoPlay
      playsInline
      style={{ width: '100%', height: '100%', objectFit: 'cover', backgroundColor: '#000000' }}
    />
  );

  const [showHandoffQR, setShowHandoffQR] = React.useState<string | null>(null);

  const generateHandoffToken = async () => {
    if (!callId || !activeWorkspaceId || !onHandoff) return;
    try {
      const token = await getAccessToken();
      const res = await fetch(`/v1/calls/${callId}/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) throw new Error('Failed to generate handoff token');
      const { data } = await res.json();
      setShowHandoffQR(data.token);
      onHandoff(data.token);
    } catch (err) {
      console.error('Handoff token generation failed:', err);
    }
  };

  const stateLabel =
    callState === 'connecting'
      ? 'Connecting…'
      : callState === 'ringing'
        ? isIncoming
          ? 'Incoming call'
          : 'Ringing…'
        : callState === 'ended'
          ? 'Call ended'
          : 'Active call';

  const centerOverlayStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '24px',
    textAlign: 'center',
    backgroundColor: 'var(--surface)',
  };

  const pillButtonStyle = (color: string, background: string): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    height: '40px',
    padding: '0 18px',
    borderRadius: '9999px',
    border: 'none',
    backgroundColor: background,
    color,
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 700,
    transition: 'background-color var(--duration-fast) var(--ease-standard)',
  });

  return (
    <section
      aria-label="Call panel"
      className="animate-scale-in"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: '360px',
        borderRadius: 'var(--radius-xl)',
        border: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--surface)',
        boxShadow: 'var(--shadow-xl)',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--surface-elevated)',
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: '13px',
            fontWeight: 700,
            color: 'var(--text-primary)',
          }}
        >
          {stateLabel}
        </span>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {participants.length} {participants.length === 1 ? 'participant' : 'participants'}
        </span>
        {isScreenSharing && callState === 'active' && (
          <span
            role="status"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 10px',
              borderRadius: '9999px',
              backgroundColor: 'var(--positive-soft)',
              color: 'var(--positive)',
              fontSize: '11px',
              fontWeight: 700,
            }}
          >
            <ScreenShare size={12} aria-hidden="true" />
            Sharing screen
          </span>
        )}
        {callState === 'active' && callId && activeWorkspaceId && (
          <button
            type="button"
            onClick={generateHandoffToken}
            aria-label="Handoff to another device"
            title="Handoff to another device"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 10px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--surface-muted)',
              color: 'var(--text-primary)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Smartphone size={14} /> Handoff
          </button>
        )}
      </header>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {showHandoffQR && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '16px',
              padding: '24px',
              backgroundColor: 'var(--surface)',
              zIndex: 10,
              borderRadius: 'var(--radius-xl)',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                Handoff to Another Device
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Scan this QR code with the Orbit app on your other device to transfer the call.
              </p>
              <img
                src={generateQRCodeDataURL(showHandoffQR, { moduleSize: 6, margin: 8 })}
                alt="Handoff QR code"
                style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', backgroundColor: '#fff' }}
              />
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px' }}>
                Token expires in 5 minutes
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowHandoffQR(null)}
              style={{
                padding: '10px 20px',
                borderRadius: '9999px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--surface-muted)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        )}
        {callState === 'active' && !showHandoffQR ? (
          <div
            style={{
              height: '100%',
              display: 'grid',
              gap: '12px',
              padding: '16px',
              alignContent: 'center',
              gridTemplateColumns: `repeat(auto-fit, minmax(${participants.length > 2 ? '180px' : '260px'}, 1fr))`,
              overflow: 'auto',
            }}
          >
            {participants.map((participant) => {
              const showVideo = participant.isLocal
                ? isVideoOn && !isScreenSharing
                : Boolean(participant.hasVideo);
              return (
                <ParticipantTile
                  key={participant.id}
                  name={participant.name}
                  isMuted={participant.isLocal ? isMuted : participant.isMuted}
                  hasVideo={showVideo}
                  videoEl={participant.isLocal ? localVideoPlaceholder : undefined}
                />
              );
            })}
          </div>
        ) : (
          <div style={centerOverlayStyle}>
            {callState === 'connecting' && (
              <>
                <Loader2
                  size={28}
                  aria-hidden="true"
                  style={{
                    color: 'var(--accent-primary)',
                    animation: 'pulseGlow 1.2s ease-in-out infinite',
                  }}
                />
                <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                  Connecting…
                </span>
              </>
            )}

            {callState === 'ringing' && (
              <>
                <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {isIncoming ? 'Incoming call' : 'Ringing…'}
                </span>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {participants.map((p) => p.name).join(', ') || 'Unknown caller'}
                </span>
                {isIncoming && onAccept ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
                    <button
                      type="button"
                      onClick={onAccept}
                      aria-label="Accept call"
                      title="Accept call"
                      style={pillButtonStyle('#FFFFFF', 'var(--positive)')}
                    >
                      <Check size={16} />
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={onLeave}
                      aria-label="Decline call"
                      title="Decline call"
                      style={pillButtonStyle('#FFFFFF', 'var(--danger)')}
                    >
                      <PhoneOff size={16} />
                      Decline
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={onLeave}
                    aria-label="Cancel call"
                    title="Cancel call"
                    style={{
                      ...pillButtonStyle('var(--text-primary)', 'var(--surface-muted)'),
                      marginTop: '8px',
                    }}
                  >
                    <PhoneOff size={16} />
                    Cancel
                  </button>
                )}
              </>
            )}

            {callState === 'ended' && (
              <>
                <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Call ended
                </span>
                <button
                  type="button"
                  onClick={onLeave}
                  aria-label="Close call panel"
                  title="Close"
                  style={pillButtonStyle('var(--text-primary)', 'var(--surface-muted)')}
                >
                  <X size={16} />
                  Close
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {callState === 'active' && (
        <footer
          role="toolbar"
          aria-label="Call controls"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            padding: '12px 16px',
            borderTop: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--surface-elevated)',
          }}
        >
          <ControlButton
            label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            onClick={onToggleMute}
            highlighted={isMuted}
          >
            {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
          </ControlButton>
          <ControlButton
            label={isVideoOn ? 'Turn off camera' : 'Turn on camera'}
            onClick={onToggleVideo}
            highlighted={!isVideoOn}
          >
            {isVideoOn ? <Video size={18} /> : <VideoOff size={18} />}
          </ControlButton>
          <ControlButton
            label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
            onClick={onToggleScreenShare}
            highlighted={isScreenSharing}
          >
            {isScreenSharing ? <ScreenShareOff size={18} /> : <ScreenShare size={18} />}
          </ControlButton>
          <ControlButton label="Leave call" onClick={onLeave} danger>
            <PhoneOff size={18} />
          </ControlButton>
        </footer>
      )}
    </section>
  );
};
