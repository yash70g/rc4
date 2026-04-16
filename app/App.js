import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { initCache } from './src/services/CacheManager';
import MeshManager from './src/services/MeshManager';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let didCleanup = false;

    async function boot() {
      // ── 1. Cache is critical — await it ───────────────────────────
      try {
        await initCache();
      } catch (e) {
        console.warn('Cache init error (continuing anyway):', e);
      }

      // ── 2. Mesh/BLE is best-effort — don't block the app ────────
      //    In Expo Go the native BLE module isn't available, so
      //    MeshManager.start() may throw or hang. Fire-and-forget.
      try {
        MeshManager.start().catch((e) =>
          console.warn('MeshManager.start background error:', e)
        );
      } catch (e) {
        console.warn('MeshManager.start sync error:', e);
      }

      if (!didCleanup) setReady(true);
    }

    boot();

    // Hard safety timeout — always clear the splash after 5 s
    const safetyTimer = setTimeout(() => {
      setReady((prev) => {
        if (!prev) console.warn('Boot safety timeout — forcing ready');
        return true;
      });
    }, 5000);

    return () => {
      didCleanup = true;
      clearTimeout(safetyTimer);
      MeshManager.stop();
    };
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
