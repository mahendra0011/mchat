import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  can,
  capabilitiesFor,
  assignPrimary,
  addWatcher,
  removeWatcher,
  type ConversationAssignment,
} from './capabilities.js';

describe('Spec 07 — Capability matrix', () => {
  it('owner has all capabilities', () => {
    const ownerCaps = capabilitiesFor('owner');
    assert.ok(ownerCaps.includes('workspace.ownership.transfer'));
    assert.ok(ownerCaps.includes('workspace.delete'));
    assert.ok(ownerCaps.includes('inbox.view_all'));
    assert.ok(ownerCaps.includes('audit.view'));
  });

  it('admin cannot transfer ownership or delete workspace', () => {
    assert.ok(!can('admin', 'workspace.ownership.transfer'));
    assert.ok(!can('admin', 'workspace.delete'));
    assert.ok(!can('admin', 'workspace.billing'));
  });

  it('agent can reply and add internal notes but cannot view all inbox or manage team', () => {
    assert.ok(can('agent', 'inbox.send_reply'));
    assert.ok(can('agent', 'inbox.add_internal_note'));
    assert.ok(!can('agent', 'inbox.view_all'));
    assert.ok(!can('agent', 'team.invite'));
    assert.ok(!can('agent', 'team.change_role'));
  });

  it('analyst is read-only on permitted reports only', () => {
    assert.ok(can('analyst', 'reports.view'));
    assert.ok(!can('analyst', 'reports.export'));
    assert.ok(!can('analyst', 'inbox.send_reply'));
    assert.ok(!can('analyst', 'inbox.add_internal_note'));
    assert.ok(!can('analyst', 'audit.view'));
  });

  it('no role other than owner can transfer ownership', () => {
    for (const role of ['admin', 'agent', 'analyst'] as const) {
      assert.ok(!can(role, 'workspace.ownership.transfer'), `${role} must not transfer ownership`);
    }
  });
});

describe('Spec 07 — Assignment model', () => {
  const base: ConversationAssignment = {
    conversationId: 'conv-1',
    primaryAssigneeWorkspaceId: null,
    watcherWorkspaceIds: [],
    changedByWorkspaceId: 'ws-owner',
    changedAt: '2026-01-01T00:00:00.000Z',
  };

  it('assignPrimary sets assignee and records audit fields', () => {
    const next = assignPrimary(base, 'ws-agent-1', 'ws-admin');
    assert.strictEqual(next.primaryAssigneeWorkspaceId, 'ws-agent-1');
    assert.strictEqual(next.changedByWorkspaceId, 'ws-admin');
    assert.notStrictEqual(next.changedAt, base.changedAt);
  });

  it('addWatcher is idempotent', () => {
    const a = addWatcher(base, 'ws-w1', 'ws-admin');
    const b = addWatcher(a, 'ws-w1', 'ws-admin');
    assert.deepStrictEqual(a.watcherWorkspaceIds, ['ws-w1']);
    assert.deepStrictEqual(b.watcherWorkspaceIds, ['ws-w1']);
  });

  it('removeWatcher removes only the target watcher', () => {
    const a = addWatcher(addWatcher(base, 'ws-w1', 'ws-admin'), 'ws-w2', 'ws-admin');
    const b = removeWatcher(a, 'ws-w1', 'ws-admin');
    assert.deepStrictEqual(b.watcherWorkspaceIds, ['ws-w2']);
  });
});
