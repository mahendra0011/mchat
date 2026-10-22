import {
  UserAccount,
  IdentityWorkspace,
  Conversation,
  MessageEnvelope,
  SendMessageRequest,
  BusinessInternalNote,
  CreateInternalNoteRequest,
  WorkflowCard,
  VaultCollection,
  VaultItem,
  PrivacyReceipt,
  CreateConversationRequest,
  CreateBusinessWorkspaceRequest,
  LoginRequest,
  KeyBundle,
} from '@orbit/schemas';

export class OrbitApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public requestId?: string
  ) {
    super(message);
    this.name = 'OrbitApiError';
  }
}

export class OrbitHttpClient {
  private baseUrl: string;
  private token: string | null = null;
  private activeWorkspaceId: string | null = null;

  constructor(baseUrl = 'http://localhost:4000') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setAuthToken(token: string | null): void {
    this.token = token;
  }

  setActiveWorkspaceId(workspaceId: string | null): void {
    this.activeWorkspaceId = workspaceId;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    if (this.activeWorkspaceId) {
      headers['x-workspace-id'] = this.activeWorkspaceId;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorBody: any;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = { error: { code: 'HTTP_ERROR', message: response.statusText } };
      }
      throw new OrbitApiError(
        errorBody?.error?.code || 'UNKNOWN_ERROR',
        errorBody?.error?.message || response.statusText,
        response.status,
        errorBody?.error?.requestId
      );
    }

    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  }

  // Auth & Account
  async login(payload: LoginRequest): Promise<{ token: string; user: UserAccount; workspaces: IdentityWorkspace[] }> {
    return this.request('/v1/auth/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getMe(): Promise<{ user: UserAccount; workspaces: IdentityWorkspace[] }> {
    return this.request('/v1/me');
  }

  // Workspaces
  async getWorkspaces(): Promise<IdentityWorkspace[]> {
    return this.request('/v1/workspaces');
  }

  async createBusinessWorkspace(payload: CreateBusinessWorkspaceRequest): Promise<IdentityWorkspace> {
    return this.request('/v1/workspaces/business', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Conversations
  async getConversations(workspaceId: string): Promise<Conversation[]> {
    return this.request(`/v1/workspaces/${workspaceId}/conversations`);
  }

  async createConversation(payload: CreateConversationRequest): Promise<Conversation> {
    return this.request('/v1/conversations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Messages
  async getMessages(conversationId: string, opts?: { limit?: number; cursor?: string }): Promise<MessageEnvelope[]> {
    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts?.cursor !== undefined) params.set('cursor', opts.cursor);
    const qs = params.toString();
    const result = await this.request<MessageEnvelope[] | { data: MessageEnvelope[]; nextCursor: string | null }>(
      `/v1/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`
    );
    // Paginated responses return an envelope; legacy returns a bare array
    return Array.isArray(result) ? result : result.data;
  }

  async getMessagesPage(
    conversationId: string,
    opts?: { limit?: number; cursor?: string }
  ): Promise<{ data: MessageEnvelope[]; nextCursor: string | null }> {
    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts?.cursor !== undefined) params.set('cursor', opts.cursor);
    const qs = params.toString();
    return this.request<{ data: MessageEnvelope[]; nextCursor: string | null }>(
      `/v1/conversations/${conversationId}/messages?${qs || 'limit=50'}`
    );
  }

  async sendMessage(payload: SendMessageRequest): Promise<MessageEnvelope> {
    return this.request(`/v1/conversations/${payload.conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async editMessage(messageId: string, body: string): Promise<MessageEnvelope> {
    return this.request(`/v1/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    });
  }

  async deleteMessage(messageId: string): Promise<{ success: boolean }> {
    return this.request(`/v1/messages/${messageId}`, {
      method: 'DELETE',
    });
  }

  async toggleReaction(messageId: string, emoji: string): Promise<MessageEnvelope> {
    return this.request(`/v1/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    });
  }

  async forwardMessage(messageId: string, targetConversationId: string, note?: string): Promise<MessageEnvelope> {
    return this.request(`/v1/messages/${messageId}/forward`, {
      method: 'POST',
      body: JSON.stringify({ targetConversationId, note }),
    });
  }

  async pinMessage(messageId: string): Promise<{ success: boolean; messageId: string; pinned: boolean }> {
    return this.request(`/v1/messages/${messageId}/pin`, { method: 'POST' });
  }

  async togglePinConversation(conversationId: string): Promise<{ success: boolean; isPinned: boolean }> {
    return this.request(`/v1/conversations/${conversationId}/pin`, { method: 'POST' });
  }

  async toggleMuteConversation(conversationId: string): Promise<{ success: boolean; isMuted: boolean }> {
    return this.request(`/v1/conversations/${conversationId}/mute`, { method: 'POST' });
  }

  async toggleArchiveConversation(conversationId: string): Promise<{ success: boolean; isArchived: boolean }> {
    return this.request(`/v1/conversations/${conversationId}/archive`, { method: 'POST' });
  }

  async markConversationRead(conversationId: string, upToMessageId?: string): Promise<{ success: boolean; markedCount: number }> {
    return this.request(`/v1/conversations/${conversationId}/read`, {
      method: 'POST',
      body: JSON.stringify({ upToMessageId }),
    });
  }

  async setTyping(conversationId: string): Promise<{ success: boolean }> {
    return this.request(`/v1/conversations/${conversationId}/typing`, { method: 'POST' });
  }

  async stopTyping(conversationId: string): Promise<{ success: boolean }> {
    return this.request(`/v1/conversations/${conversationId}/typing`, { method: 'DELETE' });
  }

  async getDraft(conversationId: string): Promise<{ data: { body: string; updatedAt: string } | null }> {
    return this.request(`/v1/conversations/${conversationId}/draft`);
  }

  async saveDraft(conversationId: string, body: string): Promise<{ data: { body: string } }> {
    return this.request(`/v1/conversations/${conversationId}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ body }),
    });
  }

  async deleteDraft(conversationId: string): Promise<{ success: boolean }> {
    return this.request(`/v1/conversations/${conversationId}/draft`, { method: 'DELETE' });
  }

  async searchMessages(q: string, opts?: { scope?: string; conversationId?: string; limit?: number }): Promise<{ data: unknown[]; count: number }> {
    const params = new URLSearchParams({ q });
    if (opts?.scope) params.set('scope', opts.scope);
    if (opts?.conversationId) params.set('conversationId', opts.conversationId);
    if (opts?.limit) params.set('limit', String(opts.limit));
    return this.request(`/v1/search/messages?${params}`);
  }

  async searchConversations(q: string, limit?: number): Promise<{ data: unknown[]; count: number }> {
    const params = new URLSearchParams({ q });
    if (limit) params.set('limit', String(limit));
    return this.request(`/v1/search/conversations?${params}`);
  }

  // Business Shared Inbox & Internal Notes (STRICTLY SEGREGATED)
  async getInternalNotes(workspaceId: string, conversationId: string): Promise<BusinessInternalNote[]> {
    return this.request(`/v1/business/${workspaceId}/conversations/${conversationId}/internal-notes`);
  }

  async createInternalNote(
    workspaceId: string,
    conversationId: string,
    payload: CreateInternalNoteRequest
  ): Promise<BusinessInternalNote> {
    return this.request(`/v1/business/${workspaceId}/conversations/${conversationId}/internal-notes`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Vault & Privacy
  async getVaultCollections(): Promise<VaultCollection[]> {
    return this.request('/v1/vault/collections');
  }

  async getVaultItems(collectionId: string): Promise<VaultItem[]> {
    return this.request(`/v1/vault/collections/${collectionId}/items`);
  }

  async getPrivacyReceipt(conversationId: string): Promise<PrivacyReceipt> {
    return this.request(`/v1/privacy/receipt?conversationId=${encodeURIComponent(conversationId)}`);
  }

  // Workflow Cards
  async getWorkflowCards(conversationId: string): Promise<WorkflowCard[]> {
    return this.request(`/v1/conversations/${conversationId}/workflows`);
  }

  // E2EE key exchange (Spec 10/31)
  async getKeyBundle(accountId: string): Promise<KeyBundle> {
    const result = await this.request<{ bundle: KeyBundle }>(
      `/v1/crypto/keys/${encodeURIComponent(accountId)}`
    );
    return result.bundle;
  }

  async getKeyBundleForWorkspace(workspaceId: string): Promise<KeyBundle> {
    const result = await this.request<{ bundle: KeyBundle }>(
      `/v1/crypto/keys/workspace/${encodeURIComponent(workspaceId)}`
    );
    return result.bundle;
  }

  async registerKeyBundle(payload: {
    identityKeyPub: string;
    signedPreKeyPub: string;
    signedPreKeySig?: string;
    deviceId?: string;
  }): Promise<KeyBundle> {
    const result = await this.request<{ success: boolean; bundle: KeyBundle }>('/v1/crypto/keys', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return result.bundle;
  }

  async safetyNumber(contactAccountId: string): Promise<{
    contactAccountId: string;
    safetyNumber: string;
    qrPayload: string;
    status: string;
    fingerprints: { myFingerprint: string; contactFingerprint: string };
  }> {
    return this.request('/v1/crypto/safety-number', {
      method: 'POST',
      body: JSON.stringify({ contactAccountId }),
    });
  }

  async verifyContactKey(contactAccountId: string, verified: boolean): Promise<{ success: boolean }> {
    return this.request('/v1/crypto/verify', {
      method: 'POST',
      body: JSON.stringify({ contactAccountId, verified }),
    });
  }

  // Trust & Safety (Spec 14)
  async submitReport(payload: {
    targetUserId: string;
    targetHandle: string;
    targetConversationId?: string;
    reason: string;
    details?: string;
    evidenceMessageIds?: string[];
  }): Promise<{ data: { id: string; status: string } }> {
    return this.request('/v1/admin/reports', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getMyReports(): Promise<{ data: Array<{ id: string; status: string; appealStatus?: string }> }> {
    return this.request('/v1/reports/mine');
  }

  async appealReport(reportId: string, reason: string): Promise<{ data: { id: string; appealStatus: string } }> {
    return this.request(`/v1/admin/reports/${reportId}/appeal`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }
}
