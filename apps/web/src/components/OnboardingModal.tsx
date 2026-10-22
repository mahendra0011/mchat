import React from 'react';
import {
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  X,
  ArrowRight,
  Lock,
  EyeOff,
  Users,
  Mail,
  Smartphone,
  Fingerprint,
  Image,
  User,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { validateHandleFormat, sanitizeSearchHandle } from '@orbit/domain';
import { apiUrl } from '../config';
import { useI18n } from '../i18n-context';
import { trackOnboardingStepCompleted } from '../lib/telemetry';
import { getAccessToken } from '../lib/secure-storage.js';

type SignInMethod = 'email' | 'passkey' | 'phone';
type OnboardingStep = 0 | 1 | 1.5 | 2 | 3 | 4;

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (handle: string, preset: string) => void;
  currentHandle?: string;
}

interface PasskeyCredential {
  id: string;
  rawId: ArrayBuffer;
  response: {
    attestationObject: ArrayBuffer;
    clientDataJSON: ArrayBuffer;
  };
  type: 'public-key';
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  onComplete,
  currentHandle = 'alex',
}) => {
  const { t } = useI18n();
  const [step, setStep] = React.useState<OnboardingStep>(0);
  const [signInMethod, setSignInMethod] = React.useState<SignInMethod>('email');
  const [handle, setHandle] = React.useState(currentHandle);
  const [handleError, setHandleError] = React.useState<string | null>(null);
  const [privacyPreset, setPrivacyPreset] = React.useState<'high' | 'balanced' | 'collaborative'>('high');
  const [displayName, setDisplayName] = React.useState('');
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const stepStartTimes = React.useRef<Record<number, number>>({});

  React.useEffect(() => {
    if (!isOpen) return;
    dialogRef.current?.focus();
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setError('Please select an image file');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError('Image must be less than 5MB');
        return;
      }
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
      setError(null);
    }
  };

  const handleValidateHandle = () => {
    const check = validateHandleFormat(handle);
    if (!check.valid) {
      setHandleError(check.reason || 'Invalid handle format');
      return;
    }
    setHandleError(null);
    const duration = stepStartTimes.current[1] ? Date.now() - stepStartTimes.current[1] : 0;
    trackOnboardingStepCompleted('handle', duration);
    stepStartTimes.current[2] = Date.now();
    setStep(3);
  };

  const handleSignInMethodSelect = (method: SignInMethod) => {
    setSignInMethod(method);
    stepStartTimes.current[1] = Date.now();
    setStep(1);
  };

  const handlePasskeyRegistration = async () => {
    if (!window.PublicKeyCredential) {
      setError('Passkeys are not supported in this browser');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const challengeRes = await fetch(apiUrl('/v1/security/keys/register/begin'), {
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const challengeData = await challengeRes.json();
      if (!challengeData?.data) throw new Error('Failed to get challenge');

      const publicKey: PublicKeyCredentialCreationOptions = {
        challenge: Uint8Array.from(atob(challengeData.data.challenge), c => c.charCodeAt(0)),
        rp: { name: 'Orbit Chat', id: window.location.hostname },
        user: {
          id: Uint8Array.from(atob(challengeData.data.userId), c => c.charCodeAt(0)),
          name: handle,
          displayName: displayName || handle,
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'preferred',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'direct',
      };

      const credential = await navigator.credentials.create({ publicKey }) as PasskeyCredential;
      if (!credential) throw new Error('Passkey creation cancelled');

      const attestationResponse = {
        id: credential.id,
        rawId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))),
        response: {
          attestationObject: btoa(String.fromCharCode(...new Uint8Array(credential.response.attestationObject))),
          clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(credential.response.clientDataJSON))),
        },
        type: credential.type,
      };

      const registerRes = await fetch(apiUrl('/v1/security/keys/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          label: 'Onboarding passkey',
          credential: attestationResponse,
        }),
      });
      if (!registerRes.ok) throw new Error('Failed to register passkey');
      const duration = stepStartTimes.current[2] ? Date.now() - stepStartTimes.current[2] : 0;
      trackOnboardingStepCompleted('privacy_preset', duration);
      stepStartTimes.current[3] = Date.now();
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOTPVerify = async (code: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(apiUrl('/v1/verification/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ channel: 'sms', destination: handle, code }),
      });
      if (!res.ok) throw new Error('Invalid OTP code');
      const duration = stepStartTimes.current[2] ? Date.now() - stepStartTimes.current[2] : 0;
      trackOnboardingStepCompleted('privacy_preset', duration);
      stepStartTimes.current[3] = Date.now();
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  const uploadAvatar = async (): Promise<string | null> => {
    if (!avatarFile) return null;
    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append('file', avatarFile);
      const res = await fetch(apiUrl('/v1/media/upload'), {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: formData,
      });
      if (!res.ok) throw new Error('Avatar upload failed');
      const data = await res.json();
      return data.data?.assetId ?? null;
    } catch {
      return null;
    }
  };

  const saveProfile = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const avatarAssetId = await uploadAvatar();
      const token = await getAccessToken();
      const patch: Record<string, unknown> = {};
      if (displayName.trim()) patch.displayName = displayName.trim();
      if (avatarAssetId) patch.avatarAssetId = avatarAssetId;

      if (Object.keys(patch).length > 0) {
        const res = await fetch(apiUrl('/v1/me'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error('Failed to save profile');
      }
      const duration = stepStartTimes.current[3] ? Date.now() - stepStartTimes.current[3] : 0;
      trackOnboardingStepCompleted('profile', duration);
      stepStartTimes.current[4] = Date.now();
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinish = () => {
    const duration = stepStartTimes.current[4] ? Date.now() - stepStartTimes.current[4] : 0;
    trackOnboardingStepCompleted('complete', duration);
    onComplete(handle, privacyPreset);
    onClose();
  };

  if (!isOpen) return null;

  const signInOptions: Array<{ method: SignInMethod; icon: React.ReactNode; label: string; desc: string; recovery: string }> = [
    { method: 'email', icon: <Mail size={24} />, label: t('onboarding.email'), desc: t('onboarding.emailDesc'), recovery: t('onboarding.emailRecovery') },
    { method: 'passkey', icon: <Fingerprint size={24} />, label: t('onboarding.passkey'), desc: t('onboarding.passkeyDesc'), recovery: t('onboarding.passkeyRecovery') },
    { method: 'phone', icon: <Smartphone size={24} />, label: t('onboarding.phone'), desc: t('onboarding.phoneDesc'), recovery: t('onboarding.phoneRecovery') },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      ref={dialogRef}
      tabIndex={-1}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--overlay-scrim)',
        backdropFilter: 'blur(8px)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        className="animate-scale-in"
        style={{
          width: '100%',
          maxWidth: '560px',
          backgroundColor: 'var(--surface)',
          borderRadius: '20px',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-xl)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '24px 28px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, var(--brand-primary), var(--accent-hover))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-text)',
              }}
            >
              <Sparkles size={18} />
            </div>
            <div>
              <h2 id="onboarding-title" style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                {t('onboarding.welcome')}
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {step === 0
                  ? t('onboarding.stepChooseMethod')
                  : step === 1.5
                  ? t('onboarding.stepOTP')
                  : `Step ${step} of 4`}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close setup modal"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              padding: '6px',
              borderRadius: '8px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '24px 28px', maxHeight: '70vh', overflowY: 'auto' }}>
          {error && (
            <div
              style={{
                padding: '12px',
                borderRadius: '8px',
                background: 'var(--danger-soft)',
                border: '1px solid var(--danger)',
                color: 'var(--danger)',
                fontSize: '13px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertCircle size={16} /> {error}
            </div>
          )}

          {step === 0 && (
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                {t('onboarding.chooseSignInMethod')}
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.4 }}>
                {t('onboarding.chooseSignInMethodDesc')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {signInOptions.map((opt) => (
                  <button
                    key={opt.method}
                    onClick={() => handleSignInMethodSelect(opt.method)}
                    style={{
                      padding: '16px',
                      borderRadius: '12px',
                      border: signInMethod === opt.method ? '2px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                      background: signInMethod === opt.method ? 'var(--accent-soft)' : 'var(--surface-muted)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '12px',
                      transition: 'border-color 150ms ease',
                    }}
                  >
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        background: 'var(--brand-primary)',
                        color: 'var(--accent-text)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {opt.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{opt.label}</strong>
                      </div>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>{opt.desc}</p>
                      <p style={{ fontSize: '11px', color: 'var(--brand-primary)', marginTop: '6px', fontWeight: 500 }}>
                        {opt.recovery}
                      </p>
                    </div>
                    {signInMethod === opt.method && <CheckCircle2 size={20} color="var(--brand-primary)" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && signInMethod === 'email' && (
            <div>
              <div
                style={{
                  padding: '16px',
                  borderRadius: '12px',
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--border-subtle)',
                  marginBottom: '20px',
                }}
              >
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <ShieldCheck size={24} color="var(--brand-primary)" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 4px', color: 'var(--text-primary)' }}>
                      Zero Mandatory Contact Uploads
                    </h3>
                    <p style={{ fontSize: '13px', margin: 0, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      Orbit never demands your phone number or scans your address book. You are identified by your chosen handle, shareable link, or QR code.
                    </p>
                  </div>
                </div>
              </div>

              <label
                htmlFor="onboarding-handle"
                style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}
              >
                {t('onboarding.chooseHandle')}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: '14px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    fontSize: '14px',
                  }}
                >
                  @
                </span>
                <input
                  id="onboarding-handle"
                  type="text"
                  value={handle}
                  onChange={(e) => {
                    setHandle(sanitizeSearchHandle(e.target.value));
                    setHandleError(null);
                  }}
                  placeholder="username"
                  style={{
                    width: '100%',
                    padding: '12px 14px 12px 32px',
                    borderRadius: '10px',
                    border: handleError ? '1px solid var(--danger)' : '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--surface-sunken)',
                    color: 'var(--text-primary)',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                />
              </div>
              {handleError && (
                <p style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '6px' }}>{handleError}</p>
              )}
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                Handles must be 3–30 characters, alphanumeric with underscores. Reserved system names are rejected.
              </p>
            </div>
          )}

          {step === 1 && signInMethod === 'passkey' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <Fingerprint size={48} color="var(--brand-primary)" style={{ marginBottom: '16px' }} />
              <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                {t('onboarding.passkeyRegistration')}
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 auto 24px', maxWidth: '380px', lineHeight: 1.5 }}>
                {t('onboarding.passkeyRegistrationDesc')}
              </p>
              <button
                onClick={handlePasskeyRegistration}
                disabled={isLoading}
                style={{
                  padding: '12px 24px',
                  borderRadius: '10px',
                  background: 'var(--brand-primary)',
                  color: 'var(--accent-text)',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isLoading ? 'wait' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: 'var(--shadow-accent)',
                }}
              >
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : t('onboarding.createPasskey')}
              </button>
            </div>
          )}

          {step === 1.5 && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <Smartphone size={48} color="var(--brand-primary)" style={{ marginBottom: '16px' }} />
              <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                {t('onboarding.otpSent')}
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 auto 24px', maxWidth: '380px', lineHeight: 1.5 }}>
                {t('onboarding.otpSentDesc', { handle })}
              </p>
              <form
                onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget as HTMLFormElement; const input = form.querySelector('input') as HTMLInputElement; if (input?.value) handleOTPVerify(input.value); }}
                style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}
              >
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  style={{
                    width: '120px',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--surface-sunken)',
                    color: 'var(--text-primary)',
                    fontSize: '18px',
                    letterSpacing: '4px',
                    textAlign: 'center',
                    outline: 'none',
                  }}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={isLoading}
                  style={{
                    padding: '12px 24px',
                    borderRadius: '10px',
                    background: 'var(--brand-primary)',
                    color: 'var(--accent-text)',
                    border: 'none',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: isLoading ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  {isLoading ? <Loader2 size={16} className="animate-spin" /> : t('onboarding.verify')}
                </button>
              </form>
            </div>
          )}

          {step === 2 && (
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                {t('onboarding.choosePrivacyPreset')}
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.4 }}>
                {t('onboarding.choosePrivacyPresetDesc')}
              </p>
              <div
                role="radiogroup"
                aria-label="Privacy preset"
                style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
              >
                <div
                  role="radio"
                  aria-checked={privacyPreset === 'high'}
                  tabIndex={0}
                  onClick={() => setPrivacyPreset('high')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPrivacyPreset('high'); } }}
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    border: privacyPreset === 'high' ? '2px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                    background: privacyPreset === 'high' ? 'var(--accent-soft)' : 'var(--surface-muted)',
                    cursor: 'pointer',
                    transition: 'border-color 150ms ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Lock size={16} color="var(--brand-primary)" />
                      <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{t('onboarding.presetHigh')}</strong>
                    </div>
                    {privacyPreset === 'high' && <CheckCircle2 size={18} color="var(--brand-primary)" />}
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                    {t('onboarding.presetHighDesc')}
                  </p>
                </div>
                <div
                  role="radio"
                  aria-checked={privacyPreset === 'balanced'}
                  tabIndex={0}
                  onClick={() => setPrivacyPreset('balanced')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPrivacyPreset('balanced'); } }}
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    border: privacyPreset === 'balanced' ? '2px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                    background: privacyPreset === 'balanced' ? 'var(--accent-soft)' : 'var(--surface-muted)',
                    cursor: 'pointer',
                    transition: 'border-color 150ms ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <EyeOff size={16} color="var(--brand-primary)" />
                      <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{t('onboarding.presetBalanced')}</strong>
                    </div>
                    {privacyPreset === 'balanced' && <CheckCircle2 size={18} color="var(--brand-primary)" />}
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                    {t('onboarding.presetBalancedDesc')}
                  </p>
                </div>
                <div
                  role="radio"
                  aria-checked={privacyPreset === 'collaborative'}
                  tabIndex={0}
                  onClick={() => setPrivacyPreset('collaborative')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPrivacyPreset('collaborative'); } }}
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    border: privacyPreset === 'collaborative' ? '2px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                    background: privacyPreset === 'collaborative' ? 'var(--accent-soft)' : 'var(--surface-muted)',
                    cursor: 'pointer',
                    transition: 'border-color 150ms ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Users size={16} color="var(--brand-primary)" />
                      <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{t('onboarding.presetCollaborative')}</strong>
                    </div>
                    {privacyPreset === 'collaborative' && <CheckCircle2 size={18} color="var(--brand-primary)" />}
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                    {t('onboarding.presetCollaborativeDesc')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                {t('onboarding.profileSetup')}
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.4 }}>
                {t('onboarding.profileSetupDesc')}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label
                    htmlFor="display-name"
                    style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}
                  >
                    {t('onboarding.displayName')} <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>({t('common.optional')})</span>
                  </label>
                  <input
                    id="display-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t('onboarding.displayNamePlaceholder')}
                    maxLength={80}
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: '1px solid var(--border-subtle)',
                      backgroundColor: 'var(--surface-sunken)',
                      color: 'var(--text-primary)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>
                    {t('onboarding.avatar')} <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>({t('common.optional')})</span>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ position: 'relative', width: '80px', height: '80px', flexShrink: 0 }}>
                      {avatarPreview ? (
                        <img
                          src={avatarPreview}
                          alt="Avatar preview"
                          style={{
                            width: '100%',
                            height: '100%',
                            borderRadius: '20px',
                            objectFit: 'cover',
                            border: '1px solid var(--border-subtle)',
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            borderRadius: '20px',
                            background: 'var(--surface-muted)',
                            border: '2px dashed var(--border-subtle)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--text-tertiary)',
                          }}
                        >
                          <User size={32} />
                        </div>
                      )}
                      <label
                        style={{
                          position: 'absolute',
                          bottom: 0,
                          right: 0,
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: 'var(--brand-primary)',
                          color: 'var(--accent-text)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          boxShadow: 'var(--shadow-sm)',
                        }}
                      >
                        <Image size={14} />
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleAvatarChange}
                          style={{ display: 'none' }}
                          id="avatar-upload"
                        />
                      </label>
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                        {t('onboarding.avatarDesc')}
                      </p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarChange}
                        id="avatar-upload-hidden"
                        style={{ display: 'none' }}
                      />
                      <button
                        type="button"
                        onClick={() => document.getElementById('avatar-upload-hidden')?.click()}
                        style={{
                          marginTop: '8px',
                          padding: '8px 16px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-subtle)',
                          background: 'var(--surface-muted)',
                          color: 'var(--text-primary)',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {t('onboarding.chooseFile')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '20px',
                  background: 'linear-gradient(135deg, var(--brand-primary), var(--accent-hover))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent-text)',
                  margin: '0 auto 16px',
                  boxShadow: 'var(--shadow-accent-lg)',
                }}
              >
                <CheckCircle2 size={32} />
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                {t('onboarding.allSet', { handle })}
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 auto 20px', maxWidth: '380px', lineHeight: 1.5 }}>
                {t('onboarding.allSetDesc')}
              </p>

              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '10px',
                  background: 'var(--surface-sunken)',
                  border: '1px solid var(--border-subtle)',
                  display: 'inline-block',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                }}
              >
                <strong>Personal Workspace:</strong> @{handle} &bull; Preset: <strong>{privacyPreset}</strong>
                {displayName && <span> &bull; Name: <strong>{displayName}</strong></span>}
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            padding: '16px 28px',
            borderTop: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--surface-muted)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          {step > 0 && step !== 1.5 ? (
            <button
              onClick={() => setStep((s) => (s - 1) as OnboardingStep)}
              disabled={isLoading}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: isLoading ? 'wait' : 'pointer',
              }}
            >
              {t('common.back')}
            </button>
          ) : step === 0 ? (
            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>No credit card required</span>
          ) : (
            <span />
          )}

          {step === 0 && (
            <span />
          )}

          {step === 1 && signInMethod === 'email' && (
            <button
              onClick={handleValidateHandle}
              disabled={isLoading || !!handleError}
              style={{
                background: 'var(--brand-primary)',
                color: 'var(--accent-text)',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: isLoading || !!handleError ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: 'var(--shadow-accent)',
              }}
            >
              {t('common.next')} <ArrowRight size={16} />
            </button>
          )}

          {step === 1 && signInMethod === 'passkey' && (
            <span />
          )}

          {step === 1.5 && (
            <span />
          )}

          {step === 2 && (
            <button
              onClick={() => setStep(3)}
              disabled={isLoading}
              style={{
                background: 'var(--brand-primary)',
                color: 'var(--accent-text)',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: isLoading ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: 'var(--shadow-accent)',
              }}
            >
              {t('common.next')} <ArrowRight size={16} />
            </button>
          )}

          {step === 3 && (
            <button
              onClick={saveProfile}
              disabled={isLoading}
              style={{
                background: 'var(--brand-primary)',
                color: 'var(--accent-text)',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: isLoading ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: 'var(--shadow-accent)',
              }}
            >
              {isLoading ? <Loader2 size={16} className="animate-spin" /> : t('common.next')} <ArrowRight size={16} />
            </button>
          )}

          {step === 4 && (
            <button
              onClick={handleFinish}
              style={{
                background: 'var(--brand-primary)',
                color: 'var(--accent-text)',
                border: 'none',
                padding: '10px 24px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: 'var(--shadow-accent)',
              }}
            >
              {t('onboarding.startMessaging')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};