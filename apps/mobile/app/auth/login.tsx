import React, { useState } from 'react';
import { View, Text, TextInput, Button, Alert, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const API_BASE_URL = Constants.expoConfig?.extra?.apiUrl ?? 'http://localhost:3000';

interface LoginResponse {
  data: {
    token: string;
    user: {
      id: string;
      email: string;
      displayName: string;
      statusEmoji: string | null;
    };
    activeWorkspace: {
      id: string;
      handle: string;
      displayName: string;
      type: 'personal' | 'business';
    };
  };
}

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please enter both email and password');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Login failed');
      }

      const { token, user, activeWorkspace } = data.data as LoginResponse['data'];

      // Store auth token and workspace
      await SecureStore.setItemAsync('orbit.auth.token', token);
      await SecureStore.setItemAsync('orbit.workspace.active', activeWorkspace.id);

      // Navigate to inbox
      router.replace('/(app)/inbox');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    // Passkey login would use WebAuthn via expo-web-auth-session
    Alert.alert('Passkey Login', 'Passkey authentication will be implemented with expo-web-auth-session');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.logoContainer}>
          <Text style={styles.logo}>Orbit</Text>
          <Text style={styles.tagline}>Calm, fast, private messaging</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.title}>Sign In</Text>

          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TextInput
            style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            disabled={isLoading}
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            disabled={isLoading}
          />

          <Button
            title="Sign In"
            onPress={handleLogin}
            disabled={isLoading}
            color="#0066ff"
            style={styles.button}
          />

          {isLoading && <ActivityIndicator style={styles.spinner} size="large" color="#0066ff" />}

          <View style={styles.divider}>
            <Text style={styles.dividerText}>or</Text>
          </View>

          <Button
            title="Sign in with Passkey"
            onPress={handlePasskeyLogin}
            disabled={isLoading}
            color="#0066ff"
            style={styles.buttonSecondary}
          />
        </View>

        <Text style={styles.footer}>
          Don't have an account? Contact your workspace admin for an invite.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f1118',
  },
  scrollContent: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    fontSize: 36,
    fontWeight: '700',
    color: '#ffffff',
  },
  tagline: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
  },
  form: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 24,
  },
  errorContainer: {
    backgroundColor: '#3a1a1a',
    border: '1px solid #ff4444',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#ff8888',
    fontSize: 14,
  },
  input: {
    backgroundColor: '#1a1d24',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 14,
    color: '#ffffff',
    fontSize: 16,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#0066ff',
    padding: 14,
    borderRadius: 8,
    marginBottom: 8,
  },
  spinner: {
    marginVertical: 12,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dividerText: {
    color: '#888',
    fontSize: 14,
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#0066ff',
    padding: 14,
    borderRadius: 8,
  },
  footer: {
    textAlign: 'center',
    color: '#666',
    fontSize: 13,
    marginTop: 32,
  },
});