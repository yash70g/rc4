import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { initCache } from './src/services/CacheManager';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function boot() {
      try {
        await initCache();
      } catch (e) {
        console.log('Cache init error:', e);
      }
      setReady(true);
    }
    boot();
  }, []);

  if (!ready) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashLogo}>⚡</Text>
        <Text style={styles.splashTitle}>Reality Cache</Text>
        <ActivityIndicator color="#6c63ff" size="large" style={{ marginTop: 20 }} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <>
      <AppNavigator />
      <StatusBar style="light" />
    </>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#0d0d1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashLogo: { fontSize: 64 },
  splashTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    marginTop: 12,
    letterSpacing: 1,
  },
});
