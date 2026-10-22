import { SendMessageRequest } from '@orbit/schemas';

export interface QueuedMessage {
  id: string; // clientMessageId
  request: SendMessageRequest;
  timestamp: number;
  retryCount: number;
  status: 'pending' | 'sending' | 'failed';
}

export class OfflineQueue {
  private queue: QueuedMessage[] = [];
  private listeners: ((queue: QueuedMessage[]) => void)[] = [];

  enqueue(request: SendMessageRequest): QueuedMessage {
    const existing = this.queue.find((q) => q.id === request.clientMessageId);
    if (existing) {
      return existing;
    }

    const queuedItem: QueuedMessage = {
      id: request.clientMessageId,
      request,
      timestamp: Date.now(),
      retryCount: 0,
      status: 'pending',
    };

    this.queue.push(queuedItem);
    this.notify();
    return queuedItem;
  }

  dequeue(clientMessageId: string): void {
    this.queue = this.queue.filter((item) => item.id !== clientMessageId);
    this.notify();
  }

  updateStatus(clientMessageId: string, status: 'pending' | 'sending' | 'failed'): void {
    const item = this.queue.find((q) => q.id === clientMessageId);
    if (item) {
      item.status = status;
      if (status === 'sending') {
        item.retryCount += 1;
      }
      this.notify();
    }
  }

  getAll(): QueuedMessage[] {
    return [...this.queue];
  }

  subscribe(callback: (queue: QueuedMessage[]) => void): () => void {
    this.listeners.push(callback);
    callback(this.getAll());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  private notify(): void {
    const snapshot = this.getAll();
    this.listeners.forEach((l) => l(snapshot));
  }
}
