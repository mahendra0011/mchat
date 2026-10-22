import { Button } from '@orbit/ui-web';

/**
 * Migration target: the conversation list shell (App Router).
 *
 * The existing Vite client renders the list + canvas together. Under Next.js the
 * list is a client component that reads cached conversations (from IndexedDB via
 * @orbit/domain offline-cache) and navigates to /chat/[conversationId].
 */
export default function ChatListPage() {
  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 24 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Conversations</h1>
      <p style={{ color: '#5F6478', margin: 0 }}>
        Wire this to @orbit/api-client listConversations() + the offline cache.
      </p>
      <div>
        <Button variant="primary" size="md">
          New conversation
        </Button>
      </div>
    </main>
  );
}
