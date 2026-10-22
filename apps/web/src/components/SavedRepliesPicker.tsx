import React from 'react';
import { Bookmark, Search, X } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch.js';
import { useI18n } from '../i18n-context.js';

export interface SavedReply {
  id: string;
  workspaceId: string;
  title: string;
  body: string;
  shortcut?: string;
  teamId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SavedRepliesPickerProps {
  workspaceId: string;
  draftText: string;
  onInsert: (body: string) => void;
  onClose: () => void;
}

export const SavedRepliesPicker: React.FC<SavedRepliesPickerProps> = ({
  workspaceId,
  draftText,
  onInsert,
  onClose,
}) => {
  const { t } = useI18n();
  const [replies, setReplies] = React.useState<SavedReply[]>([]);
  const [query, setQuery] = React.useState('');
  const [isSaveOpen, setIsSaveOpen] = React.useState(false);
  const [saveTitle, setSaveTitle] = React.useState('');
  const [status, setStatus] = React.useState<string | null>(null);
  const [isError, setIsError] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await apiFetch<SavedReply[]>('/v1/saved-replies', { workspaceId });
      setReplies(Array.isArray(res) ? res : []);
    } catch {
      setReplies([]);
    }
  }, [workspaceId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const filtered = replies.filter((r) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q);
  });

  const saveReply = async () => {
    const title = saveTitle.trim();
    const body = draftText.trim();
    if (!title || !body || isSaving) return;
    setIsSaving(true);
    setStatus(null);
    try {
      await apiFetch('/v1/saved-replies', {
        method: 'POST',
        workspaceId,
        body: { title, body },
      });
      setStatus(t('savedReplies.created'));
      setIsError(false);
      setSaveTitle('');
      setIsSaveOpen(false);
      await load();
    } catch {
      setStatus(t('savedReplies.failed'));
      setIsError(true);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label={t('savedReplies.title')}
      data-canvas-popover="saved-replies"
      style={{
        position: 'absolute',
        bottom: '72px',
        left: '20px',
        width: '320px',
        maxHeight: '420px',
        overflowY: 'auto',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '12px',
        boxShadow: 'var(--shadow-lg)',
        padding: '12px',
        zIndex: 60,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Bookmark size={15} style={{ color: 'var(--accent-primary)' }} />
          <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{t('savedReplies.title')}</strong>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ position: 'relative', marginBottom: '10px' }}>
        <Search
          size={14}
          style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
        />
        <input
          type="text"
          aria-label={t('savedReplies.search')}
          placeholder={t('savedReplies.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '7px 8px 7px 28px',
            borderRadius: '8px',
            border: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--surface-muted)',
            color: 'var(--text-primary)',
            fontSize: '12px',
            outline: 'none',
          }}
        />
      </div>

      {status && (
        <p
          role="status"
          style={{
            margin: '0 0 10px',
            fontSize: '12px',
            fontWeight: 600,
            color: isError ? 'var(--danger)' : 'var(--positive)',
          }}
        >
          {status}
        </p>
      )}

      {filtered.length === 0 ? (
        <p style={{ margin: '0 0 10px', fontSize: '12px', color: 'var(--text-muted)' }}>{t('savedReplies.empty')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
          {filtered.map((reply) => (
            <button
              key={reply.id}
              type="button"
              onClick={() => {
                onInsert(reply.body);
                onClose();
              }}
              style={{
                textAlign: 'left',
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--surface-muted)',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{reply.title}</div>
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {reply.body}
              </div>
            </button>
          ))}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
        {!isSaveOpen ? (
          <button
            type="button"
            onClick={() => setIsSaveOpen(true)}
            disabled={!draftText.trim()}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '8px',
              border: '1px dashed var(--border-subtle)',
              background: 'transparent',
              color: draftText.trim() ? 'var(--accent-primary)' : 'var(--text-muted)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: draftText.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            {t('savedReplies.save')}
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <input
              type="text"
              aria-label={t('savedReplies.name')}
              placeholder={t('savedReplies.name')}
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              style={{
                padding: '7px 8px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--surface-muted)',
                color: 'var(--text-primary)',
                fontSize: '12px',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                onClick={() => setIsSaveOpen(false)}
                style={{
                  flex: 1,
                  padding: '7px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={isSaving || !saveTitle.trim() || !draftText.trim()}
                onClick={() => void saveReply()}
                style={{
                  flex: 1,
                  padding: '7px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: 'var(--accent-primary)',
                  color: 'var(--accent-text)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: isSaving || !saveTitle.trim() || !draftText.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {t('savedReplies.create')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
