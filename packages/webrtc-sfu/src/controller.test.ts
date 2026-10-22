import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SfuController, type MediaTrack } from './controller.js';

function track(ownerParticipantId: string, id = `${ownerParticipantId}-cam`): MediaTrack {
  return { id, ownerParticipantId, kind: 'video', muted: false };
}

describe('SfuController (Wave-10 WebRTC SFU adapter)', () => {
  it('join builds a roster and rejoin reuses the participant', () => {
    const sfu = new SfuController();
    sfu.join('call-1', 'alice', 'Alice');
    sfu.join('call-1', 'bob', 'Bob');

    const roster = sfu.roster('call-1');
    assert.equal(roster.length, 2);
    assert.deepEqual(roster.map((p) => p.id).sort(), ['alice', 'bob']);

    const again = sfu.join('call-1', 'alice');
    assert.equal(again.state, 'connected');
    assert.equal(sfu.roster('call-1').length, 2, 'no duplicate on rejoin');
  });

  it('publish auto-subscribes others but never forwards a peer their own track', () => {
    const sfu = new SfuController();
    sfu.join('call-1', 'alice');
    sfu.join('call-1', 'bob');
    sfu.publish('call-1', track('alice'));

    const forAlice = sfu.forwardPlanFor('call-1', 'alice');
    assert.equal(forAlice.length, 0, "alice must not receive her own track");

    const forBob = sfu.forwardPlanFor('call-1', 'bob');
    assert.equal(forBob.length, 1);
    assert.equal(forBob[0]!.ownerParticipantId, 'alice');
    assert.equal(forBob[0]!.kind, 'video');
  });

  it('newcomer auto-subscribes to tracks already published', () => {
    const sfu = new SfuController();
    sfu.join('call-1', 'alice');
    sfu.publish('call-1', track('alice'));
    sfu.join('call-1', 'carol');

    const plan = sfu.forwardPlanFor('call-1', 'carol');
    assert.equal(plan.length, 1, 'carol receives the pre-existing track');
  });

  it('muted tracks are not forwarded; unmuting resumes forwarding', () => {
    const sfu = new SfuController();
    sfu.join('call-1', 'alice');
    sfu.join('call-1', 'bob');
    sfu.publish('call-1', track('alice'));

    sfu.setMuted('call-1', 'alice-cam', true);
    assert.equal(sfu.forwardPlanFor('call-1', 'bob').length, 0);

    sfu.setMuted('call-1', 'alice-cam', false);
    assert.equal(sfu.forwardPlanFor('call-1', 'bob').length, 1);
  });

  it('unsubscribe removes a track from the forward plan; subscribe restores it', () => {
    const sfu = new SfuController();
    sfu.join('call-1', 'alice');
    sfu.join('call-1', 'bob');
    sfu.publish('call-1', track('alice'));

    sfu.unsubscribe('call-1', 'bob', 'alice-cam');
    assert.equal(sfu.forwardPlanFor('call-1', 'bob').length, 0);

    sfu.subscribe('call-1', 'bob', 'alice-cam');
    assert.equal(sfu.forwardPlanFor('call-1', 'bob').length, 1);
  });

  it('only the owner may unpublish a track', () => {
    const sfu = new SfuController();
    sfu.join('call-1', 'alice');
    sfu.join('call-1', 'bob');
    sfu.publish('call-1', track('alice'));

    assert.throws(() => sfu.unpublish('call-1', 'bob', 'alice-cam'), /Only the publishing participant/);
    sfu.unpublish('call-1', 'alice', 'alice-cam');
    assert.equal(sfu.forwardPlanFor('call-1', 'bob').length, 0);
  });

  it('leave removes the participant, their tracks, and empty rooms are cleaned up', () => {
    const sfu = new SfuController();
    sfu.join('call-1', 'alice');
    sfu.join('call-1', 'bob');
    sfu.publish('call-1', track('alice'));

    sfu.leave('call-1', 'alice');
    const roster = sfu.roster('call-1');
    assert.deepEqual(roster.map((p) => p.id), ['bob']);
    assert.equal(sfu.forwardPlanFor('call-1', 'bob').length, 0, "alice's tracks are gone");

    sfu.leave('call-1', 'bob');
    assert.ok(!sfu.hasRoom('call-1'), 'empty room is removed');
  });

  it('relaySignal delivers offer/answer/candidate between room members only', () => {
    const sfu = new SfuController();
    sfu.join('call-1', 'alice');
    sfu.join('call-1', 'bob');

    const ok = sfu.relaySignal('call-1', {
      type: 'offer',
      from: 'alice',
      to: 'bob',
      payload: { sdp: 'v=0...' },
    });
    assert.ok(ok, 'relay between members succeeds');
    assert.equal(ok!.to, 'bob');

    const unknownTarget = sfu.relaySignal('call-1', {
      type: 'candidate',
      from: 'alice',
      to: 'mallory',
      payload: {},
    });
    assert.equal(unknownTarget, null, 'non-member target is rejected');

    assert.equal(
      sfu.relaySignal('call-999', { type: 'answer', from: 'a', to: 'b', payload: {} }),
      null,
      'unknown room rejects'
    );
  });

  it('forwardPlan is empty for unknown rooms or participants', () => {
    const sfu = new SfuController();
    sfu.join('call-1', 'alice');
    assert.deepEqual(sfu.forwardPlanFor('nope', 'alice'), []);
    assert.deepEqual(sfu.forwardPlanFor('call-1', 'ghost'), []);
  });

  it('handles join/leave/publish/subscribe messages via a uniform handler shape', () => {
    const sfu = new SfuController();
    sfu.join('call-1', 'alice');
    sfu.join('call-1', 'bob');
    sfu.publish('call-1', track('alice'));
    sfu.unsubscribe('call-1', 'bob', 'alice-cam');

    assert.equal(sfu.forwardPlanFor('call-1', 'bob').length, 0);
    assert.equal(sfu.roster('call-1').length, 2);
  });
});
