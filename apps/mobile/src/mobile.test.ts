import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MobileNavigator } from './navigation/MobileNavigator.js';
import { MobilePushManager } from './push/PushManager.js';
import { MobileSecureStorage } from './storage/SecureStorage.js';
import {
  filterInboxConversations,
  computeDeliveryLabel,
  canSendInConversation,
} from './screens/viewModels.js';
import { fixtureWorkspaces, fixtureConversations, fixtureMessages } from '@orbit/test-fixtures';

const personal = fixtureWorkspaces.find((w) => w.type === 'personal')!;
const business = fixtureWorkspaces.find((w) => w.type === 'business')!;

test('MobileNavigator starts locked and unlocks to Inbox', () => {
  const nav = new MobileNavigator(personal, true);
  assert.equal(nav.current().name, 'LockScreen');
  nav.unlock();
  assert.equal(nav.current().name, 'Inbox');
});

test('MobileNavigator switchWorkspace clears stack to Inbox root', () => {
  const nav = new MobileNavigator(personal, false);
  nav.navigate({ name: 'Conversation', conversationId: 'c1' });
  nav.navigate({ name: 'Settings' });
  nav.switchWorkspace(business);
  assert.equal(nav.getState().stack.length, 1);
  assert.equal(nav.current().name, 'Inbox');
  assert.equal(nav.getState().activeWorkspace.id, business.id);
});

test('MobileNavigator goBack pops stack and refuses to go below root', () => {
  const nav = new MobileNavigator(personal, false);
  nav.navigate({ name: 'Vault' });
  const popped = nav.goBack();
  // goBack pops Vault and returns the new current route (Inbox)
  assert.equal(nav.current().name, 'Inbox');
  assert.equal(popped?.name, 'Inbox');
  const underflow = nav.goBack();
  assert.equal(underflow, null);
  assert.equal(nav.current().name, 'Inbox');
});

test('MobilePushManager registers only when permission granted', async () => {
  let perm: 'granted' | 'denied' = 'granted';
  const mgr = new MobilePushManager({
    requestPermission: async () => perm,
    getDeviceToken: async () => 'tok-123',
  });
  const ok = await mgr.register(personal, 'ios');
  assert.ok(ok);
  assert.equal(ok?.deviceToken, 'tok-123');

  perm = 'denied';
  const blocked = await mgr.register(business, 'android');
  assert.equal(blocked, null);
});

test('MobileSecureStorage driver roundtrip + clearAll', async () => {
  const mem = new Map<string, string>();
  const storage = new MobileSecureStorage({
    getItem: async (k) => mem.get(k) ?? null,
    setItem: async (k, v) => { mem.set(k, v); },
    deleteItem: async (k) => { mem.delete(k); },
  });
  await storage.saveAuthToken('tok');
  assert.equal(await storage.getAuthToken(), 'tok');
  await storage.setActiveWorkspaceId('ws-1');
  assert.equal(await storage.getActiveWorkspaceId(), 'ws-1');
  await storage.clearAll();
  assert.equal(await storage.getAuthToken(), null);
  assert.equal(mem.size, 0);
});

test('filterInboxConversations respects filter and workspace type', () => {
  const unread = filterInboxConversations(fixtureConversations, 'unread', personal.type);
  assert.ok(unread.every((c) => (c.unreadCount ?? 0) > 0));

  const businessOnly = filterInboxConversations(fixtureConversations, 'business', 'business');
  assert.ok(businessOnly.every((c) => c.kind === 'group' || c.kind === 'branch'));

  const noneForPersonal = filterInboxConversations(fixtureConversations, 'business', 'personal');
  assert.equal(noneForPersonal.length, 0);
});

test('computeDeliveryLabel only labels own sent messages', () => {
  const mine = fixtureMessages.find((m) => m.senderWorkspaceId === personal.id);
  if (mine) {
    const label = computeDeliveryLabel(mine, personal.id);
    assert.ok(['', 'Sent', 'Delivered', 'Read', 'Failed'].includes(label));
  }
  const theirs = fixtureMessages.find((m) => m.senderWorkspaceId !== personal.id);
  if (theirs) {
    assert.equal(computeDeliveryLabel(theirs, personal.id), '');
  }
});

test('canSendInConversation blocks empty drafts and archived convs', () => {
  const conv = fixtureConversations[0];
  assert.equal(canSendInConversation(conv, '   ', false), false);
  assert.equal(canSendInConversation(conv, 'hi', true), false);
  assert.equal(canSendInConversation(null, 'hi', false), false);
  const active = { ...conv, isArchived: false };
  assert.equal(canSendInConversation(active, 'hi', false), true);
  const archived = { ...conv, isArchived: true };
  assert.equal(canSendInConversation(archived, 'hi', false), false);
});
