/**
 * WebRTC SFU control plane (Spec 10 — WebRTC SFU adapter for group calls).
 *
 * A Selective Forwarding Unit does not mix media; it decides, per participant,
 * which published tracks should be forwarded to whom. This module is the pure
 * signaling/forwarding controller: it tracks rooms, participants, and published
 * tracks, answers "what should peer X receive?" and relays signaling messages
 * (offer/answer/ICE) between peers.
 *
 * It is deliberately transport- and WebRTC-library-agnostic so it can drive a real
 * SFU (mediasoup / werift / livekit) or be unit-tested in isolation. No heavy
 * native WebRTC dependency is required for the control-plane logic itself.
 */

export type TrackKind = 'audio' | 'video' | 'screen';
export type PeerState = 'connecting' | 'connected' | 'disconnected';

export interface MediaTrack {
  id: string;
  ownerParticipantId: string;
  kind: TrackKind;
  muted: boolean;
}

export interface Participant {
  id: string;
  displayName: string;
  state: PeerState;
  /** Remote track ids this participant wants forwarded (managed by subscribe/unsubscribe). */
  subscriptions: Set<string>;
}

interface Room {
  participants: Map<string, Participant>;
  tracks: Map<string, MediaTrack>;
}

export type SignalingMessage =
  | { type: 'join'; participantId: string; displayName?: string }
  | { type: 'leave'; participantId: string }
  | { type: 'publish'; participantId: string; track: MediaTrack }
  | { type: 'unpublish'; participantId: string; trackId: string }
  | { type: 'subscribe'; participantId: string; trackId: string }
  | { type: 'unsubscribe'; participantId: string; trackId: string }
  | { type: 'mute'; participantId: string; trackId: string; muted: boolean }
  | { type: 'offer' | 'answer' | 'candidate'; from: string; to: string; payload: unknown };

export interface ForwardDecision {
  trackId: string;
  ownerParticipantId: string;
  kind: TrackKind;
  /** Local track id the receiver should map this to (identity for now). */
  forwardAs: string;
}

export class SfuController {
  private rooms = new Map<string, Room>();

  private room(roomId: string): Room {
    let r = this.rooms.get(roomId);
    if (!r) {
      r = { participants: new Map(), tracks: new Map() };
      this.rooms.set(roomId, r);
    }
    return r;
  }

  join(roomId: string, participantId: string, displayName = participantId): Participant {
    const room = this.room(roomId);
    const existing = room.participants.get(participantId);
    if (existing) {
      existing.state = 'connected';
      return existing;
    }

    const participant: Participant = {
      id: participantId,
      displayName,
      state: 'connected',
      subscriptions: new Set(),
    };
    room.participants.set(participantId, participant);

    // Auto-subscribe the newcomer to every track already published in the room.
    for (const trackId of room.tracks.keys()) participant.subscriptions.add(trackId);

    // Existing participants auto-subscribe to the newcomer (they publish later).
    return participant;
  }

  leave(roomId: string, participantId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Remove tracks owned by the leaver and purge them from every subscription.
    for (const [trackId, track] of [...room.tracks]) {
      if (track.ownerParticipantId !== participantId) continue;
      room.tracks.delete(trackId);
      for (const p of room.participants.values()) p.subscriptions.delete(trackId);
    }

    room.participants.delete(participantId);

    if (room.participants.size === 0) this.rooms.delete(roomId);
  }

  publish(roomId: string, track: MediaTrack): void {
    const room = this.room(roomId);
    if (!room.participants.has(track.ownerParticipantId)) {
      throw new Error(`Participant ${track.ownerParticipantId} is not in room ${roomId}`);
    }
    room.tracks.set(track.id, track);

    // Auto-subscribe every *other* participant to the new track.
    for (const p of room.participants.values()) {
      if (p.id !== track.ownerParticipantId) p.subscriptions.add(track.id);
    }
  }

  unpublish(roomId: string, participantId: string, trackId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const track = room.tracks.get(trackId);
    if (track && track.ownerParticipantId !== participantId) {
      throw new Error('Only the publishing participant can unpublish a track');
    }
    room.tracks.delete(trackId);
    for (const p of room.participants.values()) p.subscriptions.delete(trackId);
  }

  subscribe(roomId: string, participantId: string, trackId: string): void {
    const room = this.room(roomId);
    const p = room?.participants.get(participantId);
    if (!p) throw new Error(`Participant ${participantId} is not in room ${roomId}`);
    p.subscriptions.add(trackId);
  }

  unsubscribe(roomId: string, participantId: string, trackId: string): void {
    this.room(roomId).participants.get(participantId)?.subscriptions.delete(trackId);
  }

  setMuted(roomId: string, trackId: string, muted: boolean): void {
    const track = this.room(roomId).tracks.get(trackId);
    if (track) track.muted = muted;
  }

  /**
   * Which tracks the SFU should forward to `participantId`: subscribed remote,
   * unmuted tracks (never their own).
   */
  forwardPlanFor(roomId: string, participantId: string): ForwardDecision[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    const self = room.participants.get(participantId);
    if (!self) return [];

    const plan: ForwardDecision[] = [];
    for (const track of room.tracks.values()) {
      if (track.ownerParticipantId === participantId) continue;
      if (track.muted) continue;
      if (!self.subscriptions.has(track.id)) continue;
      plan.push({
        trackId: track.id,
        ownerParticipantId: track.ownerParticipantId,
        kind: track.kind,
        forwardAs: `${participantId}<-${track.id}`,
      });
    }
    return plan;
  }

  roster(roomId: string): Participant[] {
    return [...(this.rooms.get(roomId)?.participants.values() ?? [])];
  }

  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  /**
   * Relay a signaling message (offer/answer/ICE). Returns the message unchanged
   * for delivery to `to`, or `null` when either endpoint is not in the room.
   */
  relaySignal(
    roomId: string,
    msg: Extract<SignalingMessage, { type: 'offer' | 'answer' | 'candidate' }>
  ): (typeof msg) | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (!room.participants.has(msg.from) || !room.participants.has(msg.to)) return null;
    return msg;
  }
}
