import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { FontAwesome } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import Button from '../components/Button';
import * as CacheManager from '../services/CacheManager';

export default function ViewerScreen({ route, navigation }) {
  const { theme, spacing, typography, isDark } = useTheme();
  const { hash } = route.params;
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadContent();
  }, [hash]);

  const loadContent = async () => {
    try {
      const data = await CacheManager.getByHash(hash);
      if (!data) {
        setError('Content not found in cache');
      } else {
        setContent(data);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Retrieving Page...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <FontAwesome name="exclamation-circle" size={56} color={theme.error} />
        <Text style={[styles.errorText, { color: theme.textPrimary }]}>{error}</Text>
        <Button
          variant="secondary"
          title="Go Back"
          onPress={() => navigation.goBack()}
          style={{ width: 140, marginTop: 12 }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <FontAwesome name="chevron-left" size={20} color={theme.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: theme.textPrimary }]} numberOfLines={1}>
            {content.title}
          </Text>
          <Text style={[styles.headerUrl, { color: theme.textSecondary }]} numberOfLines={1}>
             {content.source === 'mesh' ? '🔗 MESH NETWORK' : '📱 LOCAL CACHE'}
          </Text>
        </View>
      </View>

      {/* Sandboxed WebView */}
      <WebView
        source={{ html: content.html }}
        style={[styles.webview, { backgroundColor: '#FFFFFF' }]}
        javaScriptEnabled={true}
        scrollEnabled={true}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={[styles.webviewLoading, { backgroundColor: theme.background }]}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        )}
        onShouldStartLoadWithRequest={(event) => {
          if (event.url === 'about:blank' || event.url.startsWith('data:')) return true;
          return false;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: { marginTop: 16, fontSize: 14, fontWeight: '500' },
  errorText: { fontSize: 15, fontWeight: '600', textAlign: 'center', marginBottom: 8, lineHeight: 22 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    gap: 12,
  },
  headerBtn: { 
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  headerUrl: { fontSize: 10, fontWeight: '700', marginTop: 2, letterSpacing: 0.5 },
  webview: { flex: 1 },
  webviewLoading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
