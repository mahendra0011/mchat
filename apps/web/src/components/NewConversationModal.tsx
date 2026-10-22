import React from 'react';
import { Briefcase, MessageSquare, Search, X, Shield, Users, Bell, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { Conversation, CreateBusinessWorkspaceRequest, IdentityWorkspace } from '@orbit/schemas';
import { API_BASE_URL } from '../config';
import { useI18n } from '../i18n-context.js';
import { trackFirstConversationStarted } from '../lib/telemetry';
import { getAccessToken } from '../lib/secure-storage.js';

export interface NewConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeWorkspace: IdentityWorkspace;
  onOpenConversation: (conversation: Conversation) => void;
  onCreateConversation: (participantWorkspaceIds: string[]) => Promise<Conversation | null>;
  onCreateBusinessWorkspace: (payload: CreateBusinessWorkspaceRequest) => Promise<IdentityWorkspace | null>;
}

interface ContactCandidate {
  workspaceId: string;
  displayName: string;
  handle: string;
  avatarUrl?: string;
  existingConversation?: Conversation;
}

interface HandleLookupResult {
  status: 'idle' | 'searching' | 'not-found' | 'unresolvable' | 'error';
  displayName?: string;
}

type BusinessStep = 'form' | 'preview';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  borderRadius: '8px',
  border: '1px solid var(--border-subtle)',
  backgroundColor: 'var(--canvas)',
  color: 'var(--text-primary)',
  fontSize: '13px',
  outline: 'none',
  fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: '4px',
};

const primaryButton: React.CSSProperties = {
  padding: '9px 16px',
  borderRadius: '8px',
  border: 'none',
  backgroundColor: 'var(--accent-primary)',
  color: '#FFF',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '13px',
};

const ghostButton: React.CSSProperties = {
  padding: '9px 14px',
  borderRadius: '8px',
  border: '1px solid var(--border-subtle)',
  backgroundColor: 'transparent',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontSize: '13px',
};

const ROLE_CAPABILITIES: Record<string, readonly string[]> = {
  owner: ['Full ownership', 'Billing & subscriptions', 'Delete workspace', 'Transfer ownership', 'All admin capabilities'],
  admin: ['Team invite/remove', 'Workspace configuration', 'Message templates', 'Analytics access', 'Manage integrations'],
  agent: ['Respond to customers', 'Create internal notes', 'View assigned conversations', 'Use saved replies', 'Access vault items'],
  analyst: ['Read-only analytics', 'Export reports', 'View conversation history', 'No customer messaging'],
} as const;

export const NewConversationModal: React.FC<NewConversationModalProps> = ({
  isOpen,
  onClose,
  conversations,
  activeWorkspace,
  onOpenConversation,
  onCreateConversation,
  onCreateBusinessWorkspace,
}) => {
  const { t } = useI18n();
  const [mode, setMode] = React.useState<'message' | 'business'>('message');
  const [query, setQuery] = React.useState('');
  const [isCreating, setIsCreating] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [lookup, setLookup] = React.useState<HandleLookupResult>({ status: 'idle' });

  const [bizName, setBizName] = React.useState('');
  const [bizHandle, setBizHandle] = React.useState('');
  const [bizCategory, setBizCategory] = React.useState('');
  const [bizBio, setBizBio] = React.useState('');
  const [bizHours, setBizHours] = React.useState('Mon-Fri 9:00-18:00');
  const [bizWebsite, setBizWebsite] = React.useState('');
  const [bizError, setBizError] = React.useState<string | null>(null);
  const [bizStep, setBizStep] = React.useState<BusinessStep>('form');
  const [previewAcknowledged, setPreviewAcknowledged] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const contacts = React.useMemo<ContactCandidate[]>(() => {
    const byWorkspace = new Map<string, ContactCandidate>();
    for (const conversation of conversations) {
      if (conversation.kind !== 'direct') continue;
      for (const participant of conversation.participants) {
        if (participant.workspaceId === activeWorkspace.id) continue;
        const existing = byWorkspace.get(participant.workspaceId);
        if (!existing) {
          byWorkspace.set(participant.workspaceId, {
            workspaceId: participant.workspaceId,
            displayName: participant.displayName,
            handle: participant.handle,
            avatarUrl: participant.avatarUrl,
            existingConversation: conversation,
          });
        }
      }
    }
    return [...byWorkspace.values()];
  }, [conversations, activeWorkspace.id]);

  const filteredContacts = React.useMemo(() => {
    const normalized = query.trim().toLowerCase().replace(/^@/, '');
    if (!normalized) return contacts;
    return contacts.filter(
      (c) =>
        c.displayName.toLowerCase().includes(normalized) ||
        c.handle.toLowerCase().includes(normalized)
    );
  }, [contacts, query]);

  if (!isOpen) return null;

  const startWithContact = async (contact: ContactCandidate) => {
    const startTime = Date.now();
    setNotice(null);
    setLookup({ status: 'idle' });
    if (contact.existingConversation) {
      onOpenConversation(contact.existingConversation);
      onClose();
      return;
    }
    setIsCreating(true);
    try {
      const created = await onCreateConversation([contact.workspaceId]);
      if (created) {
        trackFirstConversationStarted('handle_search', Date.now() - startTime);
        onClose();
      } else setNotice('This conversation could not be created.');
    } finally {
      setIsCreating(false);
    }
  };

  const lookupHandle = async () => {
    const handle = query.trim().replace(/^@/, '');
    if (!handle) return;
    setNotice(null);
    setLookup({ status: 'searching' });
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_BASE_URL}/v1/contacts/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ handle }),
      });
      const body = (await res.json()) as {
        data?: { found?: boolean; handle?: string; displayName?: string };
      };
      if (!body.data?.found) {
        setLookup({ status: 'not-found' });
        return;
      }
      const known = contacts.find(
        (c) => c.handle.toLowerCase() === (body.data?.handle ?? handle).toLowerCase()
      );
      if (known) {
        setLookup({ status: 'idle' });
        await startWithContact(known);
        return;
      }
      setLookup({ status: 'unresolvable', displayName: body.data.displayName });
    } catch {
      setLookup({ status: 'error' });
    }
  };

  const validateBusinessForm = (): boolean => {
    const name = bizName.trim();
    const handle = bizHandle.trim();
    const category = bizCategory.trim();
    if (name.length < 2) {
      setBizError(t('business.errorName'));
      return false;
    }
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(handle)) {
      setBizError(t('business.errorHandle'));
      return false;
    }
    if (category.length < 2) {
      setBizError(t('business.errorCategory'));
      return false;
    }
    setBizError(null);
    return true;
  };

  const proceedToPreview = () => {
    if (validateBusinessForm()) {
      setBizStep('preview');
      setPreviewAcknowledged(false);
    }
  };

  const submitBusinessWorkspace = async () => {
    if (!previewAcknowledged) return;
    setIsCreating(true);
    try {
      const created = await onCreateBusinessWorkspace({
        displayName: bizName.trim(),
        handle: bizHandle.trim(),
        category: bizCategory.trim(),
        ...(bizBio.trim() ? { bio: bizBio.trim() } : {}),
        ...(bizHours.trim() ? { businessHours: bizHours.trim() } : {}),
        ...(bizWebsite.trim() ? { website: bizWebsite.trim() } : {}),
      });
      if (created) {
        setBizName('');
        setBizHandle('');
        setBizCategory('');
        setBizBio('');
        setBizHours('Mon-Fri 9:00-18:00');
        setBizWebsite('');
        setBizStep('form');
        onClose();
      } else {
        setBizError(t('business.errorCreateFailed'));
      }
    } finally {
      setIsCreating(false);
    }
  };

  const primaryActionLabel =
    mode === 'message'
      ? lookup.status === 'searching'
        ? '\u2026'
        : t('common.search')
      : bizStep === 'form'
      ? isCreating
        ? '\u2026'
        : t('business.preview')
      : isCreating
      ? '\u2026'
      : t('business.confirmCreate');

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('compose.title')}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          borderRadius: '14px',
          padding: '22px',
          width: '520px',
          maxWidth: '92vw',
          maxHeight: '85vh',
          overflowY: 'auto',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
            {t('compose.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.cancel')}
            title={t('common.cancel')}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              padding: '4px',
              borderRadius: '6px',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            onClick={() => { setMode('message'); setBizStep('form'); }}
            aria-pressed={mode === 'message'}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '8px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: mode === 'message' ? 'var(--accent-soft)' : 'var(--surface-muted)',
              color: mode === 'message' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            }}
          >
            <MessageSquare size={14} />
            {t('compose.title')}
          </button>
          <button
            type="button"
            onClick={() => { setMode('business'); setBizStep('form'); }}
            aria-pressed={mode === 'business'}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '8px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: mode === 'business' ? 'var(--accent-soft)' : 'var(--surface-muted)',
              color: mode === 'business' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            }}
          >
            <Briefcase size={14} />
            {t('compose.createBusiness')}
          </button>
        </div>

        {mode === 'message' ? (
          <>
            <div style={{ position: 'relative' }}>
              <Search
                size={15}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLookup({ status: 'idle' });
                  setNotice(null);
                }}
                aria-label={t('compose.searchPlaceholder')}
                placeholder={t('compose.searchPlaceholder')}
                style={{ ...inputStyle, paddingLeft: '32px' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minHeight: '120px' }}>
              {filteredContacts.length === 0 ? (
                <p style={{ margin: '8px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                  {t('compose.noMatches')}
                </p>
              ) : (
                filteredContacts.map((contact) => (
                  <button
                    key={contact.workspaceId}
                    type="button"
                    disabled={isCreating}
                    onClick={() => void startWithContact(contact)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: 'transparent',
                      cursor: isCreating ? 'wait' : 'pointer',
                      textAlign: 'left',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: '30px',
                        height: '30px',
                        flexShrink: 0,
                        borderRadius: '9999px',
                        backgroundColor: contact.avatarUrl ? 'transparent' : 'var(--accent-soft)',
                        backgroundImage: contact.avatarUrl ? `url(${contact.avatarUrl})` : undefined,
                        backgroundSize: 'cover',
                        color: 'var(--accent-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: 700,
                      }}
                    >
                      {contact.avatarUrl ? '' : contact.displayName.charAt(0)}
                    </span>
                    <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600 }}>
                        {contact.displayName}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        @{contact.handle}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>

            {lookup.status === 'not-found' && (
              <p role="alert" style={{ margin: 0, fontSize: '12px', color: 'var(--danger)' }}>
                No Orbit user matches that handle.
              </p>
            )}
            {lookup.status === 'unresolvable' && (
              <p role="status" style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
                Found {lookup.displayName ?? 'that user'}, but they are not in your conversations yet
                {' \u2014 ask them to message you first.'}
              </p>
            )}
            {lookup.status === 'error' && (
              <p role="alert" style={{ margin: 0, fontSize: '12px', color: 'var(--danger)' }}>
                {t('common.error')}
              </p>
            )}
            {notice && (
              <p role="alert" style={{ margin: 0, fontSize: '12px', color: 'var(--danger)' }}>
                {notice}
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" onClick={onClose} style={ghostButton}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void lookupHandle()}
                disabled={!query.trim() || lookup.status === 'searching' || isCreating}
                style={{ ...primaryButton, opacity: !query.trim() ? 0.5 : 1 }}
              >
                {primaryActionLabel}
              </button>
            </div>
          </>
        ) : bizStep === 'form' ? (
          <>
            <div>
              <label style={labelStyle} htmlFor="biz-ws-name">
                {t('business.workspaceName')}
              </label>
              <input
                id="biz-ws-name"
                value={bizName}
                onChange={(e) => setBizName(e.target.value)}
                placeholder={t('business.workspaceNamePlaceholder')}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="biz-ws-handle">
                {t('business.handle')}
              </label>
              <input
                id="biz-ws-handle"
                value={bizHandle}
                onChange={(e) => setBizHandle(e.target.value)}
                placeholder={t('business.handlePlaceholder')}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="biz-ws-category">
                {t('business.category')}
              </label>
              <input
                id="biz-ws-category"
                value={bizCategory}
                onChange={(e) => setBizCategory(e.target.value)}
                placeholder={t('business.categoryPlaceholder')}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="biz-ws-bio">
                {t('business.bio')} ({t('common.optional')})
              </label>
              <textarea
                id="biz-ws-bio"
                value={bizBio}
                onChange={(e) => setBizBio(e.target.value)}
                rows={2}
                maxLength={280}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="biz-ws-hours">
                {t('business.hours')} ({t('common.optional')})
              </label>
              <input
                id="biz-ws-hours"
                value={bizHours}
                onChange={(e) => setBizHours(e.target.value)}
                placeholder={t('business.hoursPlaceholder')}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="biz-ws-website">
                {t('business.website')} ({t('common.optional')})
              </label>
              <input
                id="biz-ws-website"
                type="url"
                value={bizWebsite}
                onChange={(e) => setBizWebsite(e.target.value)}
                placeholder="https://example.com"
                style={inputStyle}
              />
            </div>
            {bizError && (
              <p role="alert" style={{ margin: 0, fontSize: '12px', color: 'var(--danger)' }}>
                {bizError}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" onClick={onClose} style={ghostButton}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={proceedToPreview}
                disabled={isCreating}
                style={{ ...primaryButton, opacity: isCreating ? 0.6 : 1 }}
              >
                {primaryActionLabel}
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                padding: '12px',
                borderRadius: '10px',
                background: 'var(--accent-soft)',
                border: '1px solid var(--brand-primary)',
                marginBottom: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <AlertTriangle size={16} color="var(--brand-primary)" />
                <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                  {t('business.previewTitle')}
                </strong>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                {t('business.previewDesc')}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '50vh', overflowY: 'auto' }}>
              <div
                style={{
                  padding: '16px',
                  borderRadius: '12px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--surface-muted)',
                }}
              >
                <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Shield size={16} color="var(--brand-primary)" />
                  {t('business.customerFacingIdentity')}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 12px', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{t('business.workspaceName')}:</span>
                  <span style={{ color: 'var(--text-primary)' }}>{bizName}</span>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{t('business.handle')}:</span>
                  <span style={{ color: 'var(--text-primary)' }}>@{bizHandle}</span>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{t('business.category')}:</span>
                  <span style={{ color: 'var(--text-primary)' }}>{bizCategory}</span>
                  {bizBio && (
                    <>
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{t('business.bio')}:</span>
                      <span style={{ color: 'var(--text-primary)' }}>{bizBio}</span>
                    </>
                  )}
                  {bizHours && (
                    <>
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{t('business.hours')}:</span>
                      <span style={{ color: 'var(--text-primary)' }}>{bizHours}</span>
                    </>
                  )}
                  {bizWebsite && (
                    <>
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{t('business.website')}:</span>
                      <span style={{ color: 'var(--text-primary)' }}>{bizWebsite}</span>
                    </>
                  )}
                </div>
              </div>

              <div
                style={{
                  padding: '16px',
                  borderRadius: '12px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--surface-muted)',
                }}
              >
                <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Users size={16} color="var(--brand-primary)" />
                  {t('business.teamPermissions')}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {(Object.entries(ROLE_CAPABILITIES) as [string, readonly string[]][]).map(([role, caps]) => (
                    <div
                      key={role}
                      style={{
                        padding: '10px 12px',
                        backgroundColor: 'var(--surface)',
                        borderRadius: '8px',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'capitalize', marginBottom: '6px' }}>
                        {role}
                      </div>
                      <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        {caps.map((cap, i) => (
                          <li key={i}>{cap}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              <div
                style={{
                  padding: '16px',
                  borderRadius: '12px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--surface-muted)',
                }}
              >
                <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Shield size={16} color="var(--brand-primary)" />
                  {t('business.customerPrivacyNotice')}
                </h4>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: 1.5 }}>
                  {t('business.privacyNoticeText')}
                </p>
                <div
                  style={{
                    padding: '10px 12px',
                    backgroundColor: 'var(--surface)',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {t('business.privacyNoticeFull')}
                </div>
              </div>

              <div
                style={{
                  padding: '16px',
                  borderRadius: '12px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--surface-muted)',
                }}
              >
                <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Bell size={16} color="var(--brand-primary)" />
                  {t('business.notificationOwnership')}
                </h4>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: 1.5 }}>
                  {t('business.notificationOwnershipDesc')}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                    <input type="radio" name="notif-owner" defaultChecked style={{ accentColor: 'var(--brand-primary)' }} />
                    <span>{t('business.notifAllAdmins')}</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                    <input type="radio" name="notif-owner" style={{ accentColor: 'var(--brand-primary)' }} />
                    <span>{t('business.notifAssignedOnly')}</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                    <input type="radio" name="notif-owner" style={{ accentColor: 'var(--brand-primary)' }} />
                    <span>{t('business.notifCustom')}</span>
                  </label>
                </div>
              </div>
            </div>

            <div
              style={{
                padding: '12px',
                borderRadius: '8px',
                background: previewAcknowledged ? 'var(--positive-soft)' : 'var(--caution-soft)',
                border: `1px solid ${previewAcknowledged ? 'var(--positive)' : 'var(--caution)'}`,
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <input
                type="checkbox"
                checked={previewAcknowledged}
                onChange={(e) => setPreviewAcknowledged(e.target.checked)}
                style={{ width: '18px', height: '18px', accentColor: 'var(--brand-primary)', flexShrink: 0 }}
              />
              <div style={{ flex: 1, fontSize: '13px', color: previewAcknowledged ? 'var(--positive)' : 'var(--caution)' }}>
                <strong>{previewAcknowledged ? t('business.ackConfirmed') : t('business.ackRequired')}</strong>
                <div style={{ fontSize: '11px', marginTop: '2px', opacity: 0.8 }}>
                  {t('business.ackDesc')}
                </div>
              </div>
              {previewAcknowledged && <CheckCircle2 size={20} color="var(--positive)" />}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setBizStep('form')}
                style={ghostButton}
              >
                {t('common.back')}
              </button>
              <button
                type="button"
                onClick={submitBusinessWorkspace}
                disabled={isCreating || !previewAcknowledged}
                style={{ ...primaryButton, opacity: isCreating || !previewAcknowledged ? 0.6 : 1 }}
              >
                {primaryActionLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};