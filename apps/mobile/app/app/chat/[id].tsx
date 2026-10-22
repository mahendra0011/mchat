import React, { useState, useEffect, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const API_BASE_URL = Constants.expoConfig?.extra?.apiUrl ?? 'http://localhost:3000';

interface Message {
  id: string;
  conversationId: string;
  senderWorkspaceId: string;
  senderName?: string;
  body: string;
  createdAt: string;
  deliveryState: 'sent' | 'delivered' | 'read' | 'failed';
  isDeleted?: boolean;
  isEncrypted?: boolean;
}

interface Conversation {
  id: string;
  workspaceId: string;
  kind: 'direct' | 'group' | 'branch';
  title: string | null;
  participants: Array<{ workspaceId: string; displayName: string; handle: string; avatarUrl?: string }>;
}

interface ChatResponse {
  data: {
    conversation: Conversation;
    messages: Message[];
  };
}

interface SendMessageResponse {
  data: Message;
}

export default function ChatScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<Message>>(null);

  const loadData = async () => {
    try {
      const token = await SecureStore.getItemAsync('orbit.auth.token');
      const workspaceId = await SecureStore.getItemAsync('orbit.workspace.active');

      if (!token || !workspaceId) {
        router.replace('/(auth)/login');
        return;
      }

      setActiveWorkspaceId(workspaceId);

      const res = await fetch(`${API_BASE_URL}/v1/conversations/${id}`, {
        headers: { Authorization: `Bearer ${token}`, 'x-workspace-id': workspaceId },
      });
      const data = await res.json();
      const chatData = data.data as ChatResponse['data'];
      setConversation(chatData.conversation);
      setMessages(chatData.messages);
    } catch (err) {
      console.error('Failed to load chat:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  const sendMessage = async () => {
    if (!draft.trim() || isSending || !activeWorkspaceId) return;

    const text = draft.trim();
    setDraft('');
    setIsSending(true);

    try {
      const token = await SecureStore.getItemAsync('orbit.auth.token');
      const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const res = await fetch(`${API_BASE_URL}/v1/conversations/${id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-workspace-id': activeWorkspaceId,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ body: text, contentType: 'text/plain' }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to send');

      // Optimistically add the message
      const newMessage: Message = data.data;
      setMessages((prev) => [...prev, newMessage]);
      scrollToBottom();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to send message');
      setDraft(text); // Restore draft on error
    } finally {
      setIsSending(false);
    }
  };

  const scrollToBottom = () => {
    flatListRef.current?.scrollToEnd({ animated: true });
  };

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length]);

  const renderMessage = ({ item }: { item: Message }) => {
    const isOwn = item.senderWorkspaceId === activeWorkspaceId;
    const isDeleted = item.isDeleted;
    const showText = isDeleted ? 'This message was deleted' : item.body;

    return (
      <View
        style={[
          styles.messageContainer,
          isOwn ? styles.messageOwn : styles.messageOther,
        ]}
      >
        {!isOwn && (
          <Text style={styles.senderName}>{item.senderName ?? 'Unknown'}</Text>
        )}
        <View style={[
          styles.messageBubble,
          isOwn ? styles.messageBubbleOwn : styles.messageBubbleOther,
        ]}>
          <Text style={[
            styles.messageText,
            isOwn ? styles.messageTextOwn : styles.messageTextOther,
          ]}>
            {showText}
          </Text>
        </View>
        <View style={styles.messageFooter}>
          <Text style={styles.messageTime}>
            {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
          {isOwn && (
            <Text style={styles.deliveryState}>
              {item.deliveryState === 'read' ? 'Read' :
               item.deliveryState === 'delivered' ? 'Delivered' :
               item.deliveryState === 'sent' ? 'Sent' : 'Failed'}
            </Text>
          )}
        </View>
      </View>
    );
  };

  const otherParticipant = conversation?.participants.find(
    (p) => p.workspaceId !== activeWorkspaceId
  );
  const displayName = conversation?.title ?? otherParticipant?.displayName ?? 'Conversation';

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0066ff" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
      keyboardVerticalOffset={0}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>{displayName}</Text>
          {conversation?.isE2EE && (
            <View style={styles.e2eeBadge}>
              <Text style={styles.e2eeBadgeText}>🔒 E2EE</Text>
            </View>
          )}
        </View>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        inverted={false}
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          multiline
          maxLength={4000}
          disabled={isSending}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!draft.trim() || isSending) && styles.sendButtonDisabled,
          ]}
          onPress={sendMessage}
          disabled={!draft.trim() || isSending}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.sendButtonText}>Send</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f1118',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  backButton: {
    padding: 8,
  },
  backIcon: {
    fontSize: 28,
    color: '#ffffff',
    fontWeight: '300',
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  e2eeBadge: {
    marginTop: 2,
  },
  e2eeBadgeText: {
    fontSize: 10,
    color: '#00cc66',
  },
  listContent: {
    padding: 16,
    paddingBottom: 20,
  },
  messageContainer: {
    marginBottom: 12,
    maxWidth: '85%',
  },
  messageOwn: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  messageOther: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  senderName: {
    color: '#888',
    fontSize: 12,
    marginBottom: 2,
    marginLeft: 4,
  },
  messageBubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  messageBubbleOwn: {
    backgroundColor: '#0066ff',
    borderBottomRightRadius: 4,
  },
  messageBubbleOther: {
    backgroundColor: '#1a1d24',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },
  messageTextOwn: {
    color: '#ffffff',
  },
  messageTextOther: {
    color: '#ffffff',
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    marginHorizontal: 4,
  },
  messageTime: {
    color: '#666',
    fontSize: 11,
  },
  deliveryState: {
    color: '#00cc66',
    fontSize: 11,
    fontWeight: '600',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#222',
    backgroundColor: '#0f1118',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#1a1d24',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 16,
    maxHeight: 120,
    minHeight: 48,
  },
  sendButton: {
    backgroundColor: '#0066ff',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#333',
    opacity: 0.6,
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});