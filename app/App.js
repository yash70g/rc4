import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import { initCache } from './src/services/CacheManager';
import MeshManager from './src/services/MeshManager';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { FontAwesome } from '@expo/vector-icons';

function AppContent() {
  const [ready, setReady] = useState(false);
  const { theme, isDark } = useTheme();

  useEffect(() => {
    let didCleanup = false;

    async function boot() {
      try {
        await initCache();
      } catch (e) {
        console.warn('Cache init error:', e);
      }

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
      <View style={[styles.splash, { backgroundColor: theme.background }]}>
        <FontAwesome name="bolt" size={80} color={theme.primary} />
        <Text style={[styles.splashTitle, { color: theme.textPrimary }]}>Reality Cache</Text>
        <ActivityIndicator color={theme.primary} size="large" style={{ marginTop: 20 }} />
        <StatusBar style={isDark ? "light" : "dark"} />
      </View>
    );
  }

  return (
    <>
      <AppNavigator />
      <StatusBar style={isDark ? "light" : "dark"} />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashTitle: {
    fontSize: 28,
    fontWeight: '800',
    marginTop: 20,
    letterSpacing: 1,
  },
});
