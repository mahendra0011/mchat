import { apiUrl } from '../config';
import React from 'react';
import {
  Search,
  UserCheck,
  UserX,
  Share2,
  Copy,
  X,
  Clock,
  Send,
  Shield,
  Users,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { ContactRequest, ContactDiscoveryResult } from '@orbit/schemas';
import { generateQRCodeDataURL } from '../lib/qrcode';
import { useI18n } from '../i18n-context';
import { trackDiscoveryToAcceptance, trackPermissionPromptShown } from '../lib/telemetry';

interface ContactDiscoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartChatWithUser?: (handle: string) => void;
  inviteLink?: string;
}

interface ContactMatchResult {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  matched: boolean;
}

export const ContactDiscoveryModal: React.FC<ContactDiscoveryModalProps> = ({
  isOpen,
  onClose,
  onStartChatWithUser,
  inviteLink = 'https://chat.orbit.local/invite/orbit-alex-2026',
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = React.useState<'search' | 'requests' | 'share' | 'contacts'>('search');
  const [searchHandle, setSearchHandle] = React.useState('');
  const [isSearching, setIsSearching] = React.useState(false);
  const [searchResult, setSearchResult] = React.useState<ContactDiscoveryResult | null>(null);
  const [hasSearched, setHasSearched] = React.useState(false);

  const [contactRequests, setContactRequests] = React.useState<ContactRequest[]>([]);
  const [copiedLink, setCopiedLink] = React.useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = React.useState<string>('');

  const [contactMatches, setContactMatches] = React.useState<ContactMatchResult[]>([]);
  const [isMatchingContacts, setIsMatchingContacts] = React.useState(false);
  const [contactPickerSupported, setContactPickerSupported] = React.useState(false);
  const [contactsError, setContactsError] = React.useState<string | null>(null);

  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    dialogRef.current?.focus();
    const qr = generateQRCodeDataURL(inviteLink, { darkColor: '#000000', lightColor: '#ffffff' });
    setQrCodeDataUrl(qr);
    const supported = 'contacts' in navigator && 'ContactsManager' in window;
    setContactPickerSupported(supported);
  }, [isOpen, inviteLink]);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  React.useEffect(() => {
    if (isOpen && activeTab === 'requests') {
      loadRequests();
    }
  }, [isOpen, activeTab]);

  const loadRequests = async () => {
    try {
      const res = await fetch(apiUrl("/v1/contacts/requests"));
      const data = await res.json();
      if (data?.data) {
        setContactRequests(data.data);
      }
    } catch (err) {
      console.error('Failed to load contact requests', err);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchHandle.trim()) return;

    setIsSearching(true);
    setHasSearched(true);
    setSearchResult(null);

    try {
      const res = await fetch(apiUrl("/v1/contacts/search"), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: searchHandle.trim() }),
      });
      const json = await res.json();
      if (json?.data) {
        setSearchResult(json.data);
      }
    } catch (err) {
      console.error('Search failed', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleRespondRequest = async (id: string, action: 'accepted' | 'ignored' | 'blocked') => {
    const startTime = Date.now();
    try {
      await fetch(apiUrl(`/v1/contacts/requests/${id}/respond`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      setContactRequests((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: action } : r))
      );
      if (action === 'accepted') {
        trackDiscoveryToAcceptance('invite_link', true, Date.now() - startTime);
      }
    } catch (err) {
      console.error('Failed to respond to contact request', err);
    }
  };

  const handleSendInvite = async () => {
    if (!searchResult?.handle) return;
    const startTime = Date.now();
    try {
      await fetch(apiUrl("/v1/contacts/requests"), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientHandle: searchResult.handle,
          introMessage: 'Hello! I would like to connect on Orbit.',
        }),
      });
      trackDiscoveryToAcceptance('invite_link', false, Date.now() - startTime);
      alert(`Contact request sent to @${searchResult.handle}!`);
      if (onStartChatWithUser) onStartChatWithUser(searchResult.handle);
    } catch (err) {
      console.error('Failed to send contact request', err);
    }
  };

  const handleFindContacts = async () => {
    if (!contactPickerSupported) {
      setContactsError(t('discovery.contactsNotSupported'));
      return;
    }

    setIsMatchingContacts(true);
    setContactsError(null);
    setContactMatches([]);

    try {
      const manager = (navigator as any).contacts;
      const contacts = await manager.select(['name', 'email', 'tel'], { multiple: true });

      const results: ContactMatchResult[] = [];
      for (const contact of contacts) {
        const emails = contact.email ?? [];
        const phones = contact.tel ?? [];
        const identifiers = [...emails.map((e: any) => e.value), ...phones.map((p: any) => p.value)];

        for (const id of identifiers) {
          try {
            const res = await fetch(apiUrl("/v1/contacts/match"), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ identifier: id }),
            });
            const data = await res.json();
            if (data?.data?.matched) {
              results.push({
                handle: data.data.handle,
                displayName: data.data.displayName,
                avatarUrl: data.data.avatarUrl,
                matched: true,
              });
            }
          } catch {
            // Ignore individual match failures
          }
        }
      }

      setContactMatches(results);
      if (results.length === 0) {
        setContactsError(t('discovery.noContactsMatched'));
      }
      trackPermissionPromptShown('contacts', results.length > 0);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setContactsError(t('discovery.contactsPermissionDenied'));
        trackPermissionPromptShown('contacts', false);
      } else {
        setContactsError(t('discovery.contactsError'));
      }
      console.error('Contact matching failed', err);
    } finally {
      setIsMatchingContacts(false);
    }
  };

  const handleInviteContact = async (handle: string) => {
    const startTime = Date.now();
    try {
      await fetch(apiUrl("/v1/contacts/requests"), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientHandle: handle,
          introMessage: 'Hello! I would like to connect on Orbit.',
        }),
      });
      trackDiscoveryToAcceptance('contact_match', false, Date.now() - startTime);
      alert(`Contact request sent to @${handle}!`);
      setContactMatches((prev) => prev.map((c) => (c.handle === handle ? { ...c, matched: true } : c)));
      if (onStartChatWithUser) onStartChatWithUser(handle);
    } catch (err) {
      console.error('Failed to send contact request', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="discovery-title"
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
          maxWidth: '600px',
          backgroundColor: 'var(--surface)',
          borderRadius: '20px',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-xl)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '85vh',
        }}
      >
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h2 id="discovery-title" style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              {t('discovery.title')}
            </h2>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {t('discovery.subtitle')}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              padding: '6px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            padding: '8px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            gap: '8px',
            backgroundColor: 'var(--surface-muted)',
            overflowX: 'auto',
          }}
        >
          <button
            onClick={() => setActiveTab('search')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'search' ? 'var(--surface)' : 'transparent',
              color: activeTab === 'search' ? 'var(--brand-primary)' : 'var(--text-secondary)',
              boxShadow: activeTab === 'search' ? 'var(--shadow-sm)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            <Search size={14} /> {t('discovery.tabSearch')}
          </button>

          <button
            onClick={() => setActiveTab('requests')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'requests' ? 'var(--surface)' : 'transparent',
              color: activeTab === 'requests' ? 'var(--brand-primary)' : 'var(--text-secondary)',
              boxShadow: activeTab === 'requests' ? 'var(--shadow-sm)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            <Clock size={14} /> {t('discovery.tabRequests')}
            {contactRequests.filter((r) => r.status === 'pending').length > 0 && (
                <span
                  style={{
                    background: 'var(--brand-primary)',
                    color: 'var(--accent-text)',
                    borderRadius: '9999px',
                    fontSize: '10px',
                    padding: '1px 6px',
                    fontWeight: 700,
                  }}
                >
                  {contactRequests.filter((r) => r.status === 'pending').length}
                </span>
              )}
          </button>

          <button
            onClick={() => setActiveTab('contacts')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'contacts' ? 'var(--surface)' : 'transparent',
              color: activeTab === 'contacts' ? 'var(--brand-primary)' : 'var(--text-secondary)',
              boxShadow: activeTab === 'contacts' ? 'var(--shadow-sm)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            <Users size={14} /> {t('discovery.tabContacts')}
          </button>

          <button
            onClick={() => setActiveTab('share')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'share' ? 'var(--surface)' : 'transparent',
              color: activeTab === 'share' ? 'var(--brand-primary)' : 'var(--text-secondary)',
              boxShadow: activeTab === 'share' ? 'var(--shadow-sm)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            <Share2 size={14} /> {t('discovery.tabShare')}
          </button>
        </div>

        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
          {activeTab === 'search' && (
            <div>
              <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Search
                    size={16}
                    color="var(--text-tertiary)"
                    style={{ position: 'absolute', left: '12px', top: '12px' }}
                  />
                  <input
                    type="text"
                    aria-label={t('discovery.searchPlaceholder')}
                    value={searchHandle}
                    onChange={(e) => setSearchHandle(e.target.value)}
                    placeholder={t('discovery.searchPlaceholder')}
                    style={{
                      width: '100%',
                      padding: '10px 14px 10px 36px',
                      borderRadius: '10px',
                      border: '1px solid var(--border-subtle)',
                      backgroundColor: 'var(--surface-sunken)',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSearching}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '10px',
                    background: 'var(--brand-primary)',
                    color: 'var(--accent-text)',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: isSearching ? 'wait' : 'pointer',
                  }}
                >
                  {isSearching ? <Loader2 size={14} className="animate-spin" /> : t('common.search')}
                </button>
              </form>

              {hasSearched && (
                <div>
                  {searchResult && searchResult.found ? (
                    <div
                      style={{
                        padding: '16px',
                        borderRadius: '12px',
                        border: '1px solid var(--border-subtle)',
                        backgroundColor: 'var(--surface-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div
                          style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '12px',
                            backgroundColor: 'var(--brand-primary)',
                            color: 'var(--accent-text)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '16px',
                          }}
                        >
                          {searchResult.displayName?.charAt(0) || searchResult.handle.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                              {searchResult.displayName || searchResult.handle}
                            </strong>
                            <Shield size={14} color="var(--brand-primary)" />
                          </div>
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            @{searchResult.handle}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={handleSendInvite}
                        style={{
                          padding: '8px 16px',
                          borderRadius: '8px',
                          background: 'var(--brand-primary)',
                          color: 'var(--accent-text)',
                          border: 'none',
                          fontWeight: 600,
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <Send size={14} /> {t('discovery.connect')}
                      </button>
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: '24px',
                        textAlign: 'center',
                        color: 'var(--text-secondary)',
                        fontSize: '13px',
                        border: '1px dashed var(--border-subtle)',
                        borderRadius: '12px',
                      }}
                    >
                      {t('discovery.noUserFound', { handle: searchHandle })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'requests' && (
            <div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px' }}>
                {t('discovery.requestsDesc')}
              </p>

              {contactRequests.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-secondary)', fontSize: '13px' }}>
                  {t('discovery.noRequests')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {contactRequests.map((req) => (
                    <div
                      key={req.id}
                      style={{
                        padding: '16px',
                        borderRadius: '12px',
                        border: '1px solid var(--border-subtle)',
                        backgroundColor: 'var(--surface-muted)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div>
                          <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                            {req.requesterDisplayName}
                          </strong>
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginLeft: '6px' }}>
                            @{req.requesterHandle}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '9999px',
                            backgroundColor:
                              req.status === 'accepted'
                                ? 'var(--positive-soft)'
                                : req.status === 'blocked'
                                ? 'var(--danger-soft)'
                                : 'var(--accent-soft)',
                            color:
                              req.status === 'accepted'
                                ? 'var(--positive)'
                                : req.status === 'blocked'
                                ? 'var(--danger)'
                                : 'var(--brand-primary)',
                          }}
                        >
                          {req.status}
                        </span>
                      </div>

                      {req.introMessage && (
                        <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: '0 0 12px', lineHeight: 1.4 }}>
                          "{req.introMessage}"
                        </p>
                      )}

                      {req.status === 'pending' && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => handleRespondRequest(req.id, 'accepted')}
                            style={{
                              padding: '6px 14px',
                              borderRadius: '8px',
                              background: 'var(--positive)',
                              color: 'var(--accent-text)',
                              border: 'none',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <UserCheck size={14} /> {t('discovery.accept')}
                          </button>
                          <button
                            onClick={() => handleRespondRequest(req.id, 'ignored')}
                            style={{
                              padding: '6px 14px',
                              borderRadius: '8px',
                              background: 'var(--surface)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border-subtle)',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {t('discovery.ignore')}
                          </button>
                          <button
                            onClick={() => handleRespondRequest(req.id, 'blocked')}
                            style={{
                              padding: '6px 14px',
                              borderRadius: '8px',
                              background: 'transparent',
                              color: 'var(--danger)',
                              border: '1px solid var(--danger)',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <UserX size={14} /> {t('discovery.block')}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'contacts' && (
            <div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px' }}>
                {t('discovery.contactsDesc')}
              </p>

              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '10px',
                  background: 'var(--accent-soft)',
                  border: '1px solid var(--brand-primary)',
                  marginBottom: '16px',
                  fontSize: '12px',
                  color: 'var(--accent-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <Shield size={16} /> {t('discovery.contactsPrivacyNote')}
              </div>

              <button
                onClick={handleFindContacts}
                disabled={isMatchingContacts || !contactPickerSupported}
                style={{
                  padding: '12px 20px',
                  borderRadius: '10px',
                  background: contactPickerSupported ? 'var(--brand-primary)' : 'var(--surface-muted)',
                  color: contactPickerSupported ? 'var(--accent-text)' : 'var(--text-tertiary)',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: isMatchingContacts ? 'wait' : (contactPickerSupported ? 'pointer' : 'not-allowed'),
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '20px',
                  boxShadow: contactPickerSupported ? 'var(--shadow-accent)' : 'none',
                }}
              >
                {isMatchingContacts ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> {t('discovery.findingContacts')}
                  </>
                ) : contactPickerSupported ? (
                  <>
                    <Users size={16} /> {t('discovery.findContacts')}
                  </>
                ) : (
                  <>
                    <AlertCircle size={16} /> {t('discovery.contactsNotSupportedBtn')}
                  </>
                )}
              </button>

              {!contactPickerSupported && (
                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                  {t('discovery.contactsNotSupportedDesc')}
                </p>
              )}

              {contactsError && (
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
                  <AlertCircle size={16} /> {contactsError}
                </div>
              )}

              {contactMatches.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px' }}>
                    {t('discovery.matchedContacts', { count: contactMatches.length })}
                  </h4>
                  {contactMatches.map((contact) => (
                    <div
                      key={contact.handle}
                      style={{
                        padding: '16px',
                        borderRadius: '12px',
                        border: '1px solid var(--border-subtle)',
                        backgroundColor: 'var(--surface-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div
                          style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '12px',
                            backgroundColor: contact.avatarUrl ? 'transparent' : 'var(--brand-primary)',
                            backgroundImage: contact.avatarUrl ? `url(${contact.avatarUrl})` : undefined,
                            backgroundSize: 'cover',
                            color: contact.avatarUrl ? 'transparent' : 'var(--accent-text)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '16px',
                          }}
                        >
                          {contact.avatarUrl ? '' : (contact.displayName?.charAt(0) || contact.handle.charAt(0).toUpperCase())}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                              {contact.displayName || contact.handle}
                            </strong>
                            <Shield size={14} color="var(--brand-primary)" />
                          </div>
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            @{contact.handle}
                          </span>
                        </div>
                      </div>

                      {!contact.matched && (
                        <button
                          onClick={() => handleInviteContact(contact.handle)}
                          disabled={isMatchingContacts}
                          style={{
                            padding: '8px 16px',
                            borderRadius: '8px',
                            background: 'var(--brand-primary)',
                            color: 'var(--accent-text)',
                            border: 'none',
                            fontWeight: 600,
                            fontSize: '12px',
                            cursor: isMatchingContacts ? 'wait' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <Send size={14} /> {t('discovery.invite')}
                        </button>
                      )}

                      {contact.matched && (
                        <span
                          style={{
                            padding: '6px 12px',
                            borderRadius: '9999px',
                            background: 'var(--positive-soft)',
                            color: 'var(--positive)',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}
                        >
                          {t('discovery.alreadyConnected')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'share' && (
            <div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px' }}>
                {t('discovery.shareDesc')}
              </p>

              <div
                style={{
                  padding: '20px',
                  borderRadius: '12px',
                  backgroundColor: 'var(--surface-muted)',
                  border: '1px solid var(--border-subtle)',
                  textAlign: 'center',
                  marginBottom: '16px',
                }}
              >
                <div
                  style={{
                    width: '120px',
                    height: '120px',
                    margin: '0 auto 16px',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: 'var(--shadow-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: '#ffffff',
                  }}
                >
                  <img
                    src={qrCodeDataUrl}
                    alt={t('discovery.qrAlt')}
                    style={{ width: '112px', height: '112px', borderRadius: '8px' }}
                  />
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  {t('discovery.qrDesc')}
                </div>
              </div>

              <label
                htmlFor="invite-link"
                style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}
              >
                {t('discovery.inviteLinkLabel')}
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  id="invite-link"
                  type="text"
                  readOnly
                  value={inviteLink}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--surface-sunken)',
                    fontSize: '12px',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(inviteLink);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    background: copiedLink ? 'var(--positive)' : 'var(--brand-primary)',
                    color: 'var(--accent-text)',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <Copy size={14} /> {copiedLink ? t('common.copied') : t('common.copy')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};