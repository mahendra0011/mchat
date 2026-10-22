import React from 'react';
import { Lock } from 'lucide-react';

const STORAGE_KEY = 'orbit_app_lock';
const AUTO_LOCK_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

interface PersistedLockState {
  failedAttempts: number;
  lockoutUntil: number | null;
}

function loadPersisted(): PersistedLockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { failedAttempts: 0, lockoutUntil: null };
    const parsed = JSON.parse(raw) as Partial<PersistedLockState>;
    return {
      failedAttempts: typeof parsed.failedAttempts === 'number' ? parsed.failedAttempts : 0,
      lockoutUntil: typeof parsed.lockoutUntil === 'number' ? parsed.lockoutUntil : null,
    };
  } catch {
    return { failedAttempts: 0, lockoutUntil: null };
  }
}

function savePersisted(state: PersistedLockState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // best-effort persistence
  }
}

export function useAppLock(): {
  locked: boolean;
  failedAttempts: number;
  lockoutUntil: number | null;
  lock: () => void;
  unlock: () => void;
  verifyPin: (pin: string) => boolean;
} {
  const persisted = React.useMemo(loadPersisted, []);
  const [locked, setLocked] = React.useState(false);
  const [failedAttempts, setFailedAttempts] = React.useState(persisted.failedAttempts);
  const [lockoutUntil, setLockoutUntil] = React.useState<number | null>(persisted.lockoutUntil);
  const lastActivityRef = React.useRef<number>(Date.now());

  React.useEffect(() => {
    savePersisted({ failedAttempts, lockoutUntil });
  }, [failedAttempts, lockoutUntil]);

  React.useEffect(() => {
    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;
    for (const event of events) {
      window.addEventListener(event, markActivity, { passive: true });
    }
    const timer = window.setInterval(() => {
      if (!locked && Date.now() - lastActivityRef.current >= AUTO_LOCK_MS) {
        setLocked(true);
      }
    }, 15000);
    return () => {
      for (const event of events) {
        window.removeEventListener(event, markActivity);
      }
      window.clearInterval(timer);
    };
  }, [locked]);

  const lock = React.useCallback(() => setLocked(true), []);

  const unlock = React.useCallback(() => {
    setLocked(false);
    setFailedAttempts(0);
    setLockoutUntil(null);
  }, []);

  const verifyPin = React.useCallback(
    (pin: string): boolean => {
      if (lockoutUntil && Date.now() < lockoutUntil) return false;
      if (!/^\d{4,8}$/.test(pin)) {
        setFailedAttempts((prev) => {
          const next = prev + 1;
          if (next >= MAX_ATTEMPTS) {
            setLockoutUntil(Date.now() + LOCKOUT_MS);
          }
          return next;
        });
        return false;
      }
      unlock();
      return true;
    },
    [lockoutUntil, unlock]
  );

  return { locked, failedAttempts, lockoutUntil, lock, unlock, verifyPin };
}

const AppLock: React.FC = () => {
  const { locked, failedAttempts, lockoutUntil, verifyPin } = useAppLock();
  const [pin, setPin] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  if (!locked) return null;

  const lockedOut = Boolean(lockoutUntil && Date.now() < lockoutUntil);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (lockedOut) return;
    if (verifyPin(pin)) {
      setPin('');
      setError(null);
      return;
    }
    const willLockOut = failedAttempts + 1 >= MAX_ATTEMPTS;
    setError(willLockOut ? 'Too many attempts. Try again in 15 minutes.' : 'Incorrect PIN. Try again.');
  };

  return (
    <div
      data-testid="app-lock-modal"
      role="dialog"
      aria-modal="true"
      aria-label="App locked"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <form
        onSubmit={submit}
        style={{
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius-xl)',
          padding: '40px',
          width: '320px',
          maxWidth: '90%',
          textAlign: 'center',
          boxShadow: 'var(--shadow-xl)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px', color: 'var(--accent-primary)' }}>
          <Lock size={28} />
        </div>
        <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>
          {lockedOut ? 'Account Locked' : 'App Locked'}
        </h2>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
          {lockedOut
            ? 'Too many failed attempts. Try again in 15 minutes.'
            : failedAttempts > 0
              ? 'Incorrect PIN. Try again.'
              : 'Enter your PIN to unlock'}
        </p>

        <input
          type="password"
          inputMode="numeric"
          placeholder="0000"
          maxLength={8}
          value={pin}
          disabled={lockedOut}
          onChange={(event) => setPin(event.target.value)}
          style={{
            width: '100%',
            padding: '12px 16px',
            marginBottom: '12px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            fontSize: '16px',
            textAlign: 'center',
            backgroundColor: 'var(--surface-muted)',
            color: 'var(--text-primary)',
          }}
        />

        {error && (
          <p role="alert" style={{ fontSize: '12px', color: 'var(--danger)', marginBottom: '12px' }}>
            {error}
          </p>
        )}

        <button
          id="app-lock-submit"
          type="submit"
          disabled={lockedOut}
          style={{
            width: '100%',
            padding: '10px 16px',
            backgroundColor: 'var(--accent-primary)',
            color: 'var(--accent-text)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontWeight: 600,
            fontSize: '13px',
            cursor: lockedOut ? 'not-allowed' : 'pointer',
            opacity: lockedOut ? 0.6 : 1,
          }}
        >
          Unlock
        </button>
      </form>
    </div>
  );
};

export default AppLock;
