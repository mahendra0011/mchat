export const en = {
  common: {
    appName: 'Orbit Chat',
    personal: 'Personal',
    business: 'Business',
    loading: 'Loading…',
    error: 'An error occurred',
    retry: 'Retry',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    search: 'Search messages, people, vault…',
    send: 'Send',
    offline: 'You are currently offline. Outbound messages are queued.',
    deletedMessage: 'This message was deleted',
  },
  composer: {
    placeholder: 'Write a message… (Shift+Enter for new line)',
    sendingAs: 'Sending as',
    internalNoteWarning: 'INTERNAL NOTE — Visible only to business team. Never shared with customer.',
    addInternalNote: 'Add Internal Note',
    sendToCustomer: 'Send to Customer',
    scheduleSend: 'Schedule send',
    attachFile: 'Attach file',
    voiceNote: 'Record voice note',
  },
  business: {
    sharedInbox: 'Shared Inbox',
    open: 'Open',
    assignedToMe: 'Assigned to Me',
    unassigned: 'Unassigned',
    waiting: 'Waiting',
    resolved: 'Resolved',
    assignee: 'Assignee',
    priority: 'Priority',
  },
  vault: {
    title: 'Context Vault',
    decisions: 'Decisions',
    ideas: 'Ideas',
    receipts: 'Receipts',
    reading: 'Reading',
    saveItem: 'Save to Vault',
    savedToVault: 'Saved to Context Vault',
  },
  privacy: {
    receiptTitle: 'Privacy Receipt',
    whoCanSee: 'Who can see this conversation?',
    retention: 'Data Retention',
    encryption: 'Encryption Status',
    linkedDevices: 'Authorized Devices',
    e2eeNotice: 'End-to-End Encryption verified for active participants.',
    businessNotice: 'Customer conversation managed via Business Workspace.',
  },
  settings: {
    title: 'Settings',
    account: 'Account & Profile',
    privacy: 'Privacy & Permissions',
    security: 'Security & Devices',
    appearance: 'Appearance & Themes',
    notifications: 'Notifications',
    businessWorkspace: 'Business Workspace',
    accessibility: 'Accessibility',
  },
};

type DeepStringRecord<T> = {
  [K in keyof T]: T[K] extends object ? DeepStringRecord<T[K]> : string;
};

export type TranslationCatalog = DeepStringRecord<typeof en>;
