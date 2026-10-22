import {
  UserAccount,
  IdentityWorkspace,
  Conversation,
  MessageEnvelope,
  BusinessInternalNote,
  WorkflowCard,
  VaultCollection,
  VaultItem,
  PrivacyReceipt,
} from '@orbit/schemas';

export const FIXTURE_IDS = {
  // Stable UUIDs for reproducible testing
  accountAlex: 'a1000000-0000-0000-0000-000000000001',
  accountMaya: 'a2000000-0000-0000-0000-000000000002',
  accountSam: 'a3000000-0000-0000-0000-000000000003',

  wsPersonalAlex: 'b1000000-0000-0000-0000-000000000001',
  wsBusinessAcme: 'b2000000-0000-0000-0000-000000000002',
  wsPersonalMaya: 'b3000000-0000-0000-0000-000000000003',
  wsPersonalSam: 'b4000000-0000-0000-0000-000000000004',

  convPersonalAlexMaya: 'c1000000-0000-0000-0000-000000000001',
  convBusinessCustomerMaya: 'c2000000-0000-0000-0000-000000000002',
  convBranchDesignReview: 'c3000000-0000-0000-0000-000000000003',

  msgPersonal1: 'd1000000-0000-0000-0000-000000000001',
  msgPersonal2: 'd2000000-0000-0000-0000-000000000002',
  msgBusinessCustomer1: 'd3000000-0000-0000-0000-000000000003',
  msgBusinessCustomer2: 'd4000000-0000-0000-000000000004',

  internalNote1: 'e1000000-0000-0000-0000-000000000001',
  workflowCard1: 'f1000000-0000-0000-0000-000000000001',
  vaultCollection1: '81000000-0000-0000-0000-000000000001',
  vaultItem1: '91000000-0000-0000-000000000001',
};

// Synthetic user generator - deterministic but varied
const SYNTHETIC_HANDLES = [
  'alice_design',
  'bob_engineering',
  'carol_product',
  'dave_support',
  'eve_research',
  'frank_ops',
  'grace_data',
  'henry_security',
];

function generateSyntheticHandle(): string {
  const base = SYNTHETIC_HANDLES[Math.floor(Math.random() * SYNTHETIC_HANDLES.length)];
  const timestampPart = Date.now().toString().slice(-6);
  return `${base}${timestampPart}`;
}

function generateSyntheticEmail(handle: string): string {
  const clean = handle.replace(/_/g, ' ');
  const parts = clean.split(' ');
  return `${parts[0].toLowerCase()}.${parts[1]?.toLowerCase() ?? 'user'}@orbit.local`;
}

function generateSyntheticDisplayName(handle: string): string {
  const clean = handle.replace(/_/g, ' ');
  const parts = clean.split(' ');
  return `${parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')}`;
}

export function generateSyntheticUser(overrides?: Partial<UserAccount>): UserAccount {
  const handle = generateSyntheticHandle();
  const email = generateSyntheticEmail(handle);
  const displayName = generateSyntheticDisplayName(handle);

  const base: UserAccount = {
    id: `${handle}-id`,
    email,
    displayName,
    status: 'active',
    createdAt: '2026-01-01T10:00:00Z',
  };

  return { ...base, ...overrides } as UserAccount;
}

export function generateSyntheticConversation(overrides?: Partial<Conversation>): Conversation {
  const participantCount = 2 + Math.floor(Math.random() * 3); // 2-4 participants
  const participants = [];

  for (let i = 0; i < participantCount; i++) {
    const wsId = `ws_gen_${i}`;
    participants.push({
      workspaceId: wsId,
      displayName: `User ${i}`,
      handle: `user${i}`,
      role: (i === 0 ? 'member' : 'member') as 'member' | 'admin',
      joinedAt: '2026-01-01T12:00:00Z',
      isOnline: i === 0,
    });
  }

  const base: Conversation = {
    id: `conv_gen_${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: FIXTURE_IDS.wsPersonalAlex,
    kind: 'direct',
    title: `Synthetic Conversation ${Date.now()}`,
    participants,
    intentMode: 'standard',
    studioSettings: {
      density: 'standard',
      bubbleRadius: 'md',
      wallpaper: 'none',
      showAvatars: true,
      soundEnabled: true,
    },
    lastMessageSnippet: 'This is a synthetic conversation for testing.',
    lastMessageAt: '2026-01-02T14:32:00Z',
    unreadCount: 0,
    isPinned: false,
    isMuted: false,
    isArchived: false,
    isE2EE: true,
    membershipApprovalRequired: false,
    retentionDays: 30,
    createdAt: '2026-01-01T12:00:00Z',
    updatedAt: '2026-01-02T14:32:00Z',
  };

  return { ...base, ...overrides } as Conversation;
}

export const fixtureAccounts: UserAccount[] = [
  {
    id: FIXTURE_IDS.accountAlex,
    email: 'alex@orbit.internal',
    displayName: 'Alex Rivera',
    status: 'active',
    createdAt: '2026-01-01T10:00:00Z',
  },
  {
    id: FIXTURE_IDS.accountMaya,
    email: 'maya@orbit.internal',
    displayName: 'Maya Chen',
    status: 'active',
    createdAt: '2026-01-01T10:05:00Z',
  },
  {
    id: FIXTURE_IDS.accountSam,
    email: 'sam@orbit.internal',
    displayName: 'Sam Patel',
    status: 'active',
    createdAt: '2026-01-01T10:10:00Z',
  },
];

export const fixtureWorkspaces: IdentityWorkspace[] = [
  {
    id: FIXTURE_IDS.wsPersonalAlex,
    ownerAccountId: FIXTURE_IDS.accountAlex,
    type: 'personal',
    displayName: 'Alex Rivera',
    handle: 'alex',
    bio: 'Product Designer & Explorer',
    colorCue: '#5955E8',
    isVerified: false,
    status: 'active',
    createdAt: '2026-01-01T10:00:00Z',
  },
  {
    id: FIXTURE_IDS.wsBusinessAcme,
    ownerAccountId: FIXTURE_IDS.accountAlex,
    type: 'business',
    displayName: 'Acme Studio Support',
    handle: 'acme_support',
    bio: 'Official client support & project dispatch for Acme Studio',
    category: 'Design & Engineering Services',
    businessHours: 'Mon-Fri 09:00 - 18:00 EST',
    website: 'https://acme-studio.example',
    colorCue: '#805AD5',
    isVerified: true,
    status: 'active',
    createdAt: '2026-01-01T11:00:00Z',
  },
  {
    id: FIXTURE_IDS.wsPersonalMaya,
    ownerAccountId: FIXTURE_IDS.accountMaya,
    type: 'personal',
    displayName: 'Maya Chen',
    handle: 'maya',
    bio: 'Architect & Creative Director',
    colorCue: '#16866A',
    isVerified: false,
    status: 'active',
    createdAt: '2026-01-01T10:30:00Z',
  },
];

export const fixtureConversations: Conversation[] = [
  {
    id: FIXTURE_IDS.convPersonalAlexMaya,
    workspaceId: FIXTURE_IDS.wsPersonalAlex,
    kind: 'direct',
    title: 'Maya Chen',
    participants: [
      {
        workspaceId: FIXTURE_IDS.wsPersonalAlex,
        displayName: 'Alex Rivera',
        handle: 'alex',
        role: 'member',
        joinedAt: '2026-01-01T12:00:00Z',
        isOnline: true,
      },
      {
        workspaceId: FIXTURE_IDS.wsPersonalMaya,
        displayName: 'Maya Chen',
        handle: 'maya',
        role: 'member',
        joinedAt: '2026-01-01T12:00:00Z',
        isOnline: true,
      },
    ],
    intentMode: 'standard',
    studioSettings: {
      density: 'standard',
      bubbleRadius: 'md',
      wallpaper: 'aurora-glow',
      showAvatars: true,
      soundEnabled: true,
    },
    lastMessageSnippet: 'Here is the draft for the new design system tokens!',
    lastMessageAt: '2026-01-02T14:32:00Z',
    unreadCount: 0,
    isPinned: true,
    isMuted: false,
    isArchived: false,
    isE2EE: true,
    membershipApprovalRequired: false,
    retentionDays: 30,
    createdAt: '2026-01-01T12:00:00Z',
    updatedAt: '2026-01-02T14:32:00Z',
  },
  {
    id: FIXTURE_IDS.convBusinessCustomerMaya,
    workspaceId: FIXTURE_IDS.wsBusinessAcme,
    kind: 'direct',
    title: 'Maya Chen (Project Inquiry)',
    participants: [
      {
        workspaceId: FIXTURE_IDS.wsBusinessAcme,
        displayName: 'Acme Studio Support',
        handle: 'acme_support',
        role: 'admin',
        joinedAt: '2026-01-02T09:00:00Z',
        isOnline: true,
      },
      {
        workspaceId: FIXTURE_IDS.wsPersonalMaya,
        displayName: 'Maya Chen',
        handle: 'maya',
        role: 'member',
        joinedAt: '2026-01-02T09:00:00Z',
        isOnline: true,
      },
    ],
    intentMode: 'support',
    lastMessageSnippet: 'Thank you for reaching out. Our team is reviewing the quote.',
    lastMessageAt: '2026-01-02T10:15:00Z',
    unreadCount: 1,
    isPinned: false,
    isMuted: false,
    isArchived: false,
    isE2EE: false,
    membershipApprovalRequired: false,
    createdAt: '2026-01-02T09:00:00Z',
    updatedAt: '2026-01-02T10:15:00Z',
  },
];

export const fixtureMessages: MessageEnvelope[] = [
  {
    id: FIXTURE_IDS.msgPersonal1,
    conversationId: FIXTURE_IDS.convPersonalAlexMaya,
    senderWorkspaceId: FIXTURE_IDS.wsPersonalMaya,
    senderName: 'Maya Chen',
    idempotencyKey: 'idemp-msg-1',
    clientMessageId: 'client-msg-1',
    contentType: 'text',
    body: 'Hey Alex! Did you get a chance to review the spec pack for our new chat platform?',
    attachments: [],
    deliveryState: 'read',
    reactions: [{ emoji: '👍', count: 1, workspaceIds: [FIXTURE_IDS.wsPersonalAlex] }],
    isEdited: false,
    isDeleted: false,
    isEncrypted: true,
    createdAt: '2026-01-02T14:30:00Z',
  },
  {
    id: FIXTURE_IDS.msgPersonal2,
    conversationId: FIXTURE_IDS.convPersonalAlexMaya,
    senderWorkspaceId: FIXTURE_IDS.wsPersonalAlex,
    senderName: 'Alex Rivera',
    idempotencyKey: 'idemp-msg-2',
    clientMessageId: 'client-msg-2',
    contentType: 'text',
    body: 'Here is the draft for the new design system tokens! Everything is strictly partitioned between personal and business workspaces.',
    attachments: [],
    deliveryState: 'read',
    reactions: [{ emoji: '🔥', count: 2, workspaceIds: [FIXTURE_IDS.wsPersonalAlex, FIXTURE_IDS.wsPersonalMaya] }],
    isEdited: false,
    isDeleted: false,
    isEncrypted: true,
    createdAt: '2026-01-02T14:32:00Z',
  },
  {
    id: FIXTURE_IDS.msgBusinessCustomer1,
    conversationId: FIXTURE_IDS.convBusinessCustomerMaya,
    senderWorkspaceId: FIXTURE_IDS.wsPersonalMaya,
    senderName: 'Maya Chen',
    idempotencyKey: 'idemp-msg-3',
    clientMessageId: 'client-msg-3',
    contentType: 'text',
    body: 'Hi Acme team, we are looking for a brand identity sprint next month. What is your turnaround time?',
    attachments: [],
    deliveryState: 'delivered',
    reactions: [],
    isEdited: false,
    isDeleted: false,
    isEncrypted: false,
    createdAt: '2026-01-02T09:05:00Z',
  },
  {
    id: FIXTURE_IDS.msgBusinessCustomer2,
    conversationId: FIXTURE_IDS.convBusinessCustomerMaya,
    senderWorkspaceId: FIXTURE_IDS.wsBusinessAcme,
    senderName: 'Acme Studio Support',
    idempotencyKey: 'idemp-msg-4',
    clientMessageId: 'client-msg-4',
    contentType: 'text',
    body: 'Thank you for reaching out. Our team is reviewing the quote and will reply shortly!',
    attachments: [],
    deliveryState: 'delivered',
    reactions: [],
    isEdited: false,
    isDeleted: false,
    isEncrypted: false,
    createdAt: '2026-01-02T10:15:00Z',
  },
];

export const fixtureInternalNotes: BusinessInternalNote[] = [
  {
    id: FIXTURE_IDS.internalNote1,
    conversationId: FIXTURE_IDS.convBusinessCustomerMaya,
    workspaceId: FIXTURE_IDS.wsBusinessAcme,
    authorWorkspaceId: FIXTURE_IDS.wsBusinessAcme,
    authorName: 'Alex Rivera (Owner)',
    body: 'INTERNAL NOTE: Maya has a budget of $15k. Let’s assign Sam to handle the onboarding sprint.',
    createdAt: '2026-01-02T09:30:00Z',
    resourceType: 'business_internal_note',
  },
];

export const fixtureWorkflowCards: WorkflowCard[] = [
  {
    id: FIXTURE_IDS.workflowCard1,
    conversationId: FIXTURE_IDS.convPersonalAlexMaya,
    creatorWorkspaceId: FIXTURE_IDS.wsPersonalAlex,
    creatorName: 'Alex Rivera',
    cardType: 'approval',
    title: 'Brand Palette & Contrast Approval',
    description: 'Verify WCAG 2.2 AA contrast adherence across light and dark tokens.',
    status: 'approved',
    assigneeWorkspaceId: FIXTURE_IDS.wsPersonalMaya,
    assigneeName: 'Maya Chen',
    dueDate: '2026-01-05T18:00:00Z',
    history: [
      {
        actionId: 'h1',
        actorWorkspaceId: FIXTURE_IDS.wsPersonalMaya,
        actorName: 'Maya Chen',
        action: 'approved',
        comment: 'Contrast checks verified. Colors look stunning!',
        timestamp: '2026-01-02T15:00:00Z',
      },
    ],
    createdAt: '2026-01-02T14:35:00Z',
    updatedAt: '2026-01-02T15:00:00Z',
  },
];

export const fixtureVaultCollections: VaultCollection[] = [
  {
    id: FIXTURE_IDS.vaultCollection1,
    workspaceId: FIXTURE_IDS.wsPersonalAlex,
    name: 'Design Decisions',
    description: 'Crucial architectural and design tokens decided in chat',
    icon: 'compass',
    visibility: 'private',
    itemCount: 1,
    createdAt: '2026-01-01T12:00:00Z',
  },
];

export const fixtureVaultItems: VaultItem[] = [
  {
    id: FIXTURE_IDS.vaultItem1,
    collectionId: FIXTURE_IDS.vaultCollection1,
    workspaceId: FIXTURE_IDS.wsPersonalAlex,
    itemType: 'decision',
    sourceConversationId: FIXTURE_IDS.convPersonalAlexMaya,
    sourceConversationTitle: 'Maya Chen',
    sourceMessageId: FIXTURE_IDS.msgPersonal2,
    authorName: 'Alex Rivera',
    title: 'Aurora Paper Semantic Tokens Finalized',
    content: 'We agreed on #5955E8 as primary indigo accent and warm neutral canvas #F7F8FC.',
    tags: ['design-system', 'tokens', 'p0'],
    userNote: 'Referenced in 05_DESIGN_SYSTEM.md',
    savedAt: '2026-01-02T14:33:00Z',
  },
];

export const fixturePrivacyReceipt: PrivacyReceipt = {
  conversationId: FIXTURE_IDS.convPersonalAlexMaya,
  title: 'Direct Conversation with Maya Chen',
  encryption: {
    isE2EE: true,
    protocol: 'W3C WebCrypto (AES-256-GCM / Ephemeral Key Exchange)',
    verified: true,
    limitations: 'Applies to participant devices. Cannot prevent physical photographs of screen.',
  },
  participants: [
    {
      workspaceId: FIXTURE_IDS.wsPersonalAlex,
      displayName: 'Alex Rivera',
      role: 'Participant',
      isBusinessAgent: false,
    },
    {
      workspaceId: FIXTURE_IDS.wsPersonalMaya,
      displayName: 'Maya Chen',
      role: 'Participant',
      isBusinessAgent: false,
    },
  ],
  retention: {
    policyName: '30-Day Auto-Expiry',
    retentionDays: 30,
    disappearingMessagesEnabled: true,
    deletionNotice: 'Messages are automatically purged from local cache and relay 30 days after creation.',
  },
  devices: {
    totalAuthorizedDevices: 2,
    unverifiedDevicesCount: 0,
    recentDeviceChanges: false,
  },
  integrations: {
    hasActiveAI: false,
    aiProcessingScope: 'none',
    activeModulesCount: 0,
  },
  accessAuditLog: [
    {
      timestamp: '2026-01-01T12:00:00Z',
      eventType: 'CONVERSATION_INITIALIZED',
      actorName: 'Alex Rivera',
      description: 'Encrypted channel established between @alex and @maya',
    },
  ],
};