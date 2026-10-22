import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { OrbitMobileEngine, filterInboxConversations, computeDeliveryLabel } from '../src/App';

const API_BASE_URL = Constants.expoConfig?.extra?.apiUrl ?? 'http://localhost:3000';

interface Conversation {
  id: string;
  workspaceId: string;
  kind: 'direct' | 'group' | 'branch';
  title: string | null;
  participants: Array<{ workspaceId: string; displayName: string; handle: string; avatarUrl?: string }>;
  unreadCount: number;
  lastMessageSnippet?: string;
  lastMessageAt?: string;
  isPinned: boolean;
  isMuted: boolean;
  isArchived: boolean;
  isE2EE: boolean;
}

interface Message {
  id: string;
  conversationId: string;
  senderWorkspaceId: string;
  senderName?: string;
  body: string;
  createdAt: string;
  deliveryState: 'sent' | 'delivered' | 'read' | 'failed';
}

interface InboxResponse {
  data: {
    conversations: Conversation[];
    messages: Message[];
  };
}

type FilterType = 'all' | 'unread' | 'personal' | 'business';

export default function InboxScreen() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeWorkspace, setActiveWorkspace] = useState<{ id: string; type: 'personal' | 'business' } | null>(null);
  const [engine] = useState(() => new OrbitMobileEngine({ id: '', ownerAccountId: '', type: 'personal', displayName: '', handle: '', createdAt: '' }));

  const loadData = async () => {
    try {
      const token = await SecureStore.getItemAsync('orbit.auth.token');
      const workspaceId = await SecureStore.getItemAsync('orbit.workspace.active');

      if (!token) {
        router.replace('/(auth)/login');
        return;
      }

      // Fetch workspace info
      const workspaceRes = await fetch(`${API_BASE_URL}/v1/workspaces`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const workspaceData = await workspaceRes.json();
      const workspaces = workspaceData.data ?? [];
      const currentWorkspace = workspaces.find((w: any) => w.id === workspaceId) ?? workspaces[0];
      setActiveWorkspace({ id: currentWorkspace.id, type: currentWorkspace.type });

      // Update engine
      engine.switchWorkspace({ ...currentWorkspace, ownerAccountId: '', createdAt: '' });

      // Fetch conversations and messages
      const res = await fetch(`${API_BASE_URL}/v1/conversations`, {
        headers: { Authorization: `Bearer ${token}`, 'x-workspace-id': currentWorkspace.id },
      });
      const data = await res.json();
      const inboxData = data.data as InboxResponse['data'];
      setConversations(inboxData.conversations);
      setMessages(inboxData.messages);
    } catch (err) {
      console.error('Failed to load inbox:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredConversations = filterInboxConversations(conversations, filter, activeWorkspace?.type ?? 'personal');

  const renderConversation = ({ item }: { item: Conversation }) => {
    const lastMessage = messages.find((m) => m.conversationId === item.id);
    const deliveryLabel = lastMessage ? computeDeliveryLabel(lastMessage, activeWorkspace?.id ?? '') : '';
    const otherParticipant = item.participants.find((p) => p.workspaceId !== activeWorkspace?.id);
    const displayName = item.title ?? otherParticipant?.displayName ?? 'Conversation';
    const avatarInitials = otherParticipant?.displayName
      ? otherParticipant.displayName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
      : '?';

    return (
      <TouchableOpacity
        style={styles.conversationItem}
        onPress={() => router.push(`/(app)/chat/${item.id}`)}
        activeOpacity={0.7}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{avatarInitials}</Text>
        </View>
        <View style={styles.conversationContent}>
          <View style={styles.conversationHeader}>
            <Text style={styles.conversationName}>{displayName}</Text>
            {item.lastMessageAt && (
              <Text style={styles.conversationTime}>
                {new Date(item.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            )}
          </View>
          <View style={styles.conversationFooter}>
            <Text style={styles.conversationSnippet} numberOfLines={1}>
              {item.lastMessageSnippet ?? 'No messages yet'}
            </Text>
            {deliveryLabel && <Text style={styles.deliveryLabel}>{deliveryLabel}</Text>}
            {item.unreadCount > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0066ff" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Orbit</Text>
        <TouchableOpacity onPress={() => router.push('/(app)/settings')} style={styles.settingsButton}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterBar}>
        {(['all', 'unread', 'personal', 'business'] as FilterType[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[
              styles.filterButton,
              filter === f ? styles.filterButtonActive : null,
            ]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterButtonText, filter === f ? styles.filterButtonTextActive : null]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filteredConversations}
        renderItem={renderConversation}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={loadData} colors={['#0066ff']} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {filter === 'unread' ? 'No unread conversations' : 'No conversations yet'}
            </Text>
            <Text style={styles.emptySubtext}>Start a new conversation to get started</Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
  },
  settingsButton: {
    padding: 8,
  },
  settingsIcon: {
    fontSize: 20,
  },
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#1a1d24',
    borderWidth: 1,
    borderColor: '#333',
  },
  filterButtonActive: {
    backgroundColor: '#0066ff',
    borderColor: '#0066ff',
  },
  filterButtonText: {
    color: '#ccc',
    fontSize: 13,
    fontWeight: '600',
  },
  filterButtonTextActive: {
    color: '#ffffff',
  },
  conversationItem: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0066ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  conversationContent: {
    flex: 1,
    justifyContent: 'center',
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  conversationName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  conversationTime: {
    color: '#888',
    fontSize: 12,
  },
  conversationFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  conversationSnippet: {
    color: '#aaa',
    fontSize: 14,
    flex: 1,
  },
  deliveryLabel: {
    color: '#00cc66',
    fontSize: 11,
    fontWeight: '600',
  },
  unreadBadge: {
    backgroundColor: '#0066ff',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtext: {
    color: '#888',
    fontSize: 14,
  },
  listContent: {
    paddingBottom: 20,
  },
});