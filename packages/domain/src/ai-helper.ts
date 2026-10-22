/**
 * AI Helper Stub (Spec 17 Phase 5 — Local AI Helper)
 *
 * Provides heuristic-based conversation summarization, reply suggestions,
 * and entity extraction without external API dependencies.
 * Designed for future OpenAI/Anthropic integration via AiProvider interface.
 */

import type { MessageEnvelope } from '@orbit/schemas';

export interface ConversationSummary {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
}

export interface ReplySuggestion {
  suggestedText: string;
  confidence: number;
}

export interface ExtractedEntities {
  people: string[];
  dates: string[];
  tasks: string[];
  links: string[];
}

export interface AiProvider {
  summarizeConversation(
    _conversationId: string,
    messages: MessageEnvelope[]
  ): Promise<ConversationSummary>;
  suggestReply(
    _conversationId: string,
    context: { recentMessages: MessageEnvelope[]; userWorkspaceId: string }
  ): Promise<ReplySuggestion>;
  extractEntities(messages: MessageEnvelope[]): Promise<ExtractedEntities>;
}

export class LocalAIHelper implements AiProvider {
  private static readonly GREETING_PATTERNS = [
    /^(hi|hello|hey|good morning|good afternoon|good evening)/i,
    /^(thanks|thank you|thx)/i,
  ];
  private static readonly QUESTION_PATTERNS = [
    /\?$/,
    /^(what|how|when|where|why|who|can you|could you|would you)/i,
  ];
  private static readonly ACTION_PATTERNS = [
    /(please|kindly|can you|need to|should|must|action required|todo|follow up)/i,
    /(schedule|book|arrange|set up|organize)/i,
  ];
  private static readonly DATE_PATTERNS = [
    /\b(today|tomorrow|yesterday|next week|this week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4}?\b/i,
  ];
  private static readonly LINK_PATTERN = /https?:\/\/[^\s]+/g;
  private static readonly EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  private static readonly MENTION_PATTERN = /@(\w+)/g;

  async summarizeConversation(
    _conversationId: string,
    messages: MessageEnvelope[]
  ): Promise<ConversationSummary> {
    const validMessages = messages.filter((m) => !m.isDeleted && m.body?.trim());
    if (validMessages.length === 0) {
      return {
        summary: 'No messages in this conversation.',
        keyPoints: [],
        actionItems: [],
      };
    }

    const sorted = [...validMessages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const firstMessage = sorted[0];
    const lastMessage = sorted[sorted.length - 1];
    const participantWorkspaces = new Set(validMessages.map((m) => m.senderWorkspaceId));
    const totalWords = validMessages.reduce((sum, m) => sum + (m.body?.split(/\s+/).length ?? 0), 0);

    const summary = this.generateSummary(firstMessage, lastMessage, validMessages.length, participantWorkspaces.size, totalWords);
    const keyPoints = this.extractKeyPoints(validMessages);
    const actionItems = this.extractActionItems(validMessages);

    return { summary, keyPoints, actionItems };
  }

  async suggestReply(
    _conversationId: string,
    context: { recentMessages: MessageEnvelope[]; userWorkspaceId: string }
  ): Promise<ReplySuggestion> {
    const { recentMessages, userWorkspaceId } = context;
    const lastIncoming = [...recentMessages]
      .reverse()
      .find((m) => m.senderWorkspaceId !== userWorkspaceId && !m.isDeleted);

    if (!lastIncoming) {
      return {
        suggestedText: 'Hi! How can I help you?',
        confidence: 0.3,
      };
    }

    const text = lastIncoming.body?.toLowerCase() ?? '';
    let suggestion: string;
    let confidence: number;

    if (this.isGreeting(text)) {
      suggestion = 'Hello! How can I assist you today?';
      confidence = 0.85;
    } else if (this.isQuestion(text)) {
      suggestion = "That's a great question. Let me look into that and get back to you.";
      confidence = 0.7;
    } else if (this.hasActionRequest(text)) {
      suggestion = 'Understood. I\'ll take care of that and confirm once done.';
      confidence = 0.75;
    } else if (text.includes('thanks') || text.includes('thank you')) {
      suggestion = 'You\'re welcome! Let me know if you need anything else.';
      confidence = 0.8;
    } else {
      suggestion = 'Thanks for the update. I\'ll review this.';
      confidence = 0.45;
    }

    return { suggestedText: suggestion, confidence };
  }

  async extractEntities(messages: MessageEnvelope[]): Promise<ExtractedEntities> {
    const allText = messages.filter((m) => !m.isDeleted).map((m) => m.body ?? '').join(' ');

    const people = this.extractPeople(allText);
    const dates = this.extractDates(allText);
    const tasks = this.extractTasks(messages);
    const links = this.extractLinks(allText);

    return { people, dates, tasks, links };
  }

  private generateSummary(
    first: MessageEnvelope,
    last: MessageEnvelope,
    messageCount: number,
    participantCount: number,
    wordCount: number
  ): string {
    const firstSnippet = first.body?.slice(0, 80) ?? '';
    const lastSnippet = last.body?.slice(0, 80) ?? '';
    const timeSpan = this.formatTimeSpan(first.createdAt, last.createdAt);

    return `Conversation with ${participantCount} participant${participantCount !== 1 ? 's' : ''} (${messageCount} messages, ~${wordCount} words) over ${timeSpan}. Started: "${firstSnippet}${firstSnippet.length >= 80 ? '…' : ''}" Latest: "${lastSnippet}${lastSnippet.length >= 80 ? '…' : ''}"`;
  }

  private extractKeyPoints(messages: MessageEnvelope[]): string[] {
    const points: string[] = [];
    const seen = new Set<string>();

    for (const msg of messages) {
      if (msg.isDeleted) continue;
      const text = msg.body?.trim() ?? '';
      if (text.length < 20) continue;

      const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 15);
      for (const sentence of sentences) {
        const normalized = sentence.toLowerCase();
        if (seen.has(normalized)) continue;
        if (this.isSignificantSentence(sentence)) {
          points.push(sentence);
          seen.add(normalized);
          if (points.length >= 5) break;
        }
      }
      if (points.length >= 5) break;
    }

    return points.slice(0, 5);
  }

  private extractActionItems(messages: MessageEnvelope[]): string[] {
    const items: string[] = [];

    for (const msg of messages) {
      if (msg.isDeleted) continue;
      const text = msg.body?.trim() ?? '';
      if (this.hasActionRequest(text)) {
        const clean = text.replace(/^(please|kindly|can you|could you|need to|should|must)\s+/i, '');
        const sentence = clean.split(/[.!?]/)[0]?.trim();
        if (sentence && sentence.length > 10 && sentence.length < 120) {
          items.push(sentence);
        }
      }
    }

    return items.slice(0, 5);
  }

  private isGreeting(text: string): boolean {
    return LocalAIHelper.GREETING_PATTERNS.some((p) => p.test(text));
  }

  private isQuestion(text: string): boolean {
    return LocalAIHelper.QUESTION_PATTERNS.some((p) => p.test(text));
  }

  private hasActionRequest(text: string): boolean {
    return LocalAIHelper.ACTION_PATTERNS.some((p) => p.test(text));
  }

  private isSignificantSentence(sentence: string): boolean {
    const words = sentence.split(/\s+/);
    if (words.length < 5 || words.length > 30) return false;
    const hasEntity = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/.test(sentence);
    const hasNumber = /\d/.test(sentence);
    return hasEntity || hasNumber || words.length > 10;
  }

  private extractPeople(text: string): string[] {
    const people = new Set<string>();
    const words = text.split(/\s+/);
    for (let i = 0; i < words.length - 1; i++) {
      if (/^[A-Z][a-z]+$/.test(words[i]) && /^[A-Z][a-z]+$/.test(words[i + 1])) {
        people.add(`${words[i]} ${words[i + 1]}`);
      }
    }
    const mentions = [...text.matchAll(LocalAIHelper.MENTION_PATTERN)].map((m) => m[1]);
    mentions.forEach((m) => people.add(m));
    return [...people].slice(0, 10);
  }

  private extractDates(text: string): string[] {
    const dates = new Set<string>();
    for (const pattern of LocalAIHelper.DATE_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) matches.forEach((m) => dates.add(m));
    }
    return [...dates].slice(0, 10);
  }

  private extractTasks(messages: MessageEnvelope[]): string[] {
    const tasks: string[] = [];
    for (const msg of messages) {
      if (msg.isDeleted) continue;
      const text = msg.body?.trim() ?? '';
      if (this.hasActionRequest(text)) {
        const clean = text.replace(/^(please|kindly|can you|could you|need to|should|must)\s+/i, '');
        const sentence = clean.split(/[.!?]/)[0]?.trim();
        if (sentence && sentence.length > 10) {
          tasks.push(sentence);
        }
      }
    }
    return tasks.slice(0, 10);
  }

  private extractLinks(text: string): string[] {
    const links = text.match(LocalAIHelper.LINK_PATTERN) ?? [];
    const emails = text.match(LocalAIHelper.EMAIL_PATTERN) ?? [];
    return [...new Set([...links, ...emails])].slice(0, 10);
  }

  private formatTimeSpan(start: string, end: string): string {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffDays > 0) return `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
    if (diffHours > 0) return `${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
    return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''}`;
  }
}

export const localAIHelper = new LocalAIHelper();
