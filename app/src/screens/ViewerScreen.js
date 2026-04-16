import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import * as CacheManager from '../services/CacheManager';

export default function ViewerScreen({ route, navigation }) {
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
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6c63ff" />
        <Text style={styles.loadingText}>Loading from cache...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color="#ff4444" />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {content.title}
          </Text>
          <Text style={styles.headerUrl} numberOfLines={1}>
            📦 Cached • {content.source === 'mesh' ? '🔗 From Mesh' : '📱 Local'}
          </Text>
        </View>
      </View>

      {/* Sandboxed WebView */}
      <WebView
        source={{ html: content.html }}
        style={styles.webview}
        javaScriptEnabled={true}
        scrollEnabled={true}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={styles.webviewLoading}>
            <ActivityIndicator size="large" color="#6c63ff" />
          </View>
        )}
        onShouldStartLoadWithRequest={(event) => {
          // Block external navigation — sandbox mode
          if (event.url === 'about:blank' || event.url.startsWith('data:')) return true;
          return false;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d1a' },
  center: {
    flex: 1,
    backgroundColor: '#0d0d1a',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: { color: '#888', fontSize: 14 },
  errorText: { color: '#ff4444', fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
  backBtn: {
    backgroundColor: '#6c63ff',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 8,
  },
  backBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#1a1a2e',
    gap: 12,
  },
  headerBtn: { padding: 4 },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  headerUrl: { fontSize: 11, color: '#888', marginTop: 2 },
  webview: { flex: 1, backgroundColor: '#fff' },
  webviewLoading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0d0d1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
