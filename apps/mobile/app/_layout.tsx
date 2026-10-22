import { Stack } from 'expo-router';
import { ReactNode } from 'react';

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="(auth)/login" options={{ presentation: 'modal' }} />
      <Stack.Screen name="(app)/inbox" />
      <Stack.Screen name="(app)/chat/[id]" />
      <Stack.Screen name="(app)/settings" />
    </Stack>
  );
}