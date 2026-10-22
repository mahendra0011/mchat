import { notFound } from 'next/navigation';

/**
 * Migration target: the conversation canvas (dynamic App Router segment).
 *
 * Message virtualization (@orbit/domain computeVirtualWindow) and E2EE decrypt +
 * local search indexing hook in here: decrypt on read, feed plaintext to the
 * on-device index, and virtualize long histories instead of rendering every row.
 */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  if (!conversationId) notFound();

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid #E3E6EF' }}>
        Conversation {conversationId}
      </header>
      <section style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {/* Virtualized message list goes here. */}
      </section>
      <footer style={{ padding: 12, borderTop: '1px solid #E3E6EF' }}>
        <input
          placeholder="Type a message"
          style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #CBD1E1' }}
        />
      </footer>
    </main>
  );
}
