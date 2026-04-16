import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { processHtml } from '../services/PageProcessor';
import * as CacheManager from '../services/CacheManager';
import * as MeshManager from '../services/MeshManager';

const SEARCH_ENGINE = 'https://www.google.com/search?q=';

function isUrl(text) {
  const t = text.trim();
  if (/^https?:\/\//i.test(t)) return true;
  // Looks like a domain: has a dot, no spaces
  if (!t.includes(' ') && /^[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}/.test(t)) return true;
  return false;
}

export default function BrowserScreen({ navigation }) {
  const [input, setInput] = useState('');
  const [currentUrl, setCurrentUrl] = useState('https://www.google.com');
  const [loading, setLoading] = useState(false);
  const [caching, setCaching] = useState(false);
  const [pageTitle, setPageTitle] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [progress, setProgress] = useState(0);
  const webViewRef = useRef(null);
  const captureResolve = useRef(null);
  const captureReject = useRef(null);

  const handleWebViewMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'cache-capture') {
        if (data.error) {
          captureReject.current?.(new Error(data.error));
        } else {
          captureResolve.current?.(data.html);
        }
      }
    } catch (e) {
      // Not our message, ignore
    }
  };

  const handleSubmit = () => {
    const text = input.trim();
    if (!text) return;

    let target;
    if (isUrl(text)) {
      target = text.startsWith('http') ? text : 'https://' + text;
    } else {
      target = SEARCH_ENGINE + encodeURIComponent(text);
    }
    setCurrentUrl(target);
  };

  const cachePage = async () => {
    setCaching(true);
    try {
      // Inject JS to capture the rendered DOM directly from the WebView
      const capturedHtml = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out capturing page')), 10000);
        webViewRef.current?.injectJavaScript(`
          (function() {
            try {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'cache-capture',
                html: document.documentElement.outerHTML,
                title: document.title
              }));
            } catch(e) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'cache-capture',
                error: e.message
              }));
            }
          })();
          true;
        `);
        // Store resolve/reject so onMessage can call them
        captureResolve.current = (data) => { clearTimeout(timeout); resolve(data); };
        captureReject.current = (err) => { clearTimeout(timeout); reject(err); };
      });

      const { html, title } = await processHtml(currentUrl, capturedHtml);
      const result = await CacheManager.storeSnapshot(currentUrl, title, html);

      // Share updated catalog with mesh
      MeshManager.shareCatalog();

      if (result.deduplicated) {
        Alert.alert('Already Cached', `"${title}" is already in your cache.`);
      } else {
        Alert.alert(
          '✅ Page Cached!',
          `"${title}" saved (${CacheManager.formatSize(result.size)}).`,
          [
            { text: 'View Cache', onPress: () => navigation.navigate('Cache') },
            { text: 'OK' },
          ]
        );
      }
    } catch (error) {
      Alert.alert('Cache Failed', error.message);
    } finally {
      setCaching(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* ── URL / Search Bar ───────────────────────────────── */}
      <View style={styles.urlBar}>
        <View style={styles.urlInputContainer}>
          <Ionicons
            name={loading ? 'hourglass-outline' : 'search-outline'}
            size={18}
            color="#6c63ff"
          />
          <TextInput
            style={styles.urlInput}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={handleSubmit}
            placeholder="Search or enter URL..."
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="web-search"
            returnKeyType="go"
            selectTextOnFocus
          />
          {input.length > 0 && (
            <TouchableOpacity onPress={() => setInput('')} style={styles.clearBtn}>
              <Ionicons name="close-circle" size={18} color="#555" />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={handleSubmit} style={styles.goBtn}>
            <Ionicons name="arrow-forward-circle" size={28} color="#6c63ff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Browser Nav Bar ────────────────────────────────── */}
      <View style={styles.navBar}>
        <TouchableOpacity
          onPress={() => webViewRef.current?.goBack()}
          disabled={!canGoBack}
          style={styles.navBtn}
        >
          <Ionicons
            name="chevron-back"
            size={22}
            color={canGoBack ? '#fff' : '#333'}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => webViewRef.current?.goForward()}
          disabled={!canGoForward}
          style={styles.navBtn}
        >
          <Ionicons
            name="chevron-forward"
            size={22}
            color={canGoForward ? '#fff' : '#333'}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => webViewRef.current?.reload()}
          style={styles.navBtn}
        >
          <Ionicons name="refresh-outline" size={20} color="#888" />
        </TouchableOpacity>

        {/* Page title (center) */}
        <View style={styles.navTitleWrap}>
          <Text style={styles.navTitle} numberOfLines={1}>
            {pageTitle || 'New Tab'}
          </Text>
        </View>

        {/* Cache button */}
        <TouchableOpacity
          style={[styles.cacheBtn, caching && styles.cacheBtnDisabled]}
          onPress={cachePage}
          disabled={caching}
        >
          {caching ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="download-outline" size={16} color="#fff" />
              <Text style={styles.cacheBtnText}>Cache</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Progress Bar ───────────────────────────────────── */}
      {loading && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${Math.max(progress * 100, 10)}%` }]} />
        </View>
      )}

      {/* ── WebView ────────────────────────────────────────── */}
      <View style={styles.webviewContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: currentUrl }}
          style={styles.webview}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
          onNavigationStateChange={(state) => {
            setCurrentUrl(state.url);
            setInput(state.url);
            setCanGoBack(state.canGoBack);
            setCanGoForward(state.canGoForward);
            if (state.title) setPageTitle(state.title);
          }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          onMessage={handleWebViewMessage}
          startInLoadingState={true}
          renderLoading={() => (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#6c63ff" />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d1a' },

  // URL bar
  urlBar: {
    paddingTop: 50,
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: '#1a1a2e',
  },
  urlInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d0d1a',
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  urlInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    paddingVertical: 10,
  },
  clearBtn: { padding: 2 },
  goBtn: { padding: 2 },

  // Nav bar
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 8,
    paddingBottom: 6,
    gap: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff10',
  },
  navBtn: {
    padding: 6,
    borderRadius: 8,
  },
  navTitleWrap: {
    flex: 1,
    paddingHorizontal: 8,
  },
  navTitle: {
    color: '#666',
    fontSize: 11,
    fontWeight: '500',
  },
  cacheBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6c63ff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  cacheBtnDisabled: { backgroundColor: '#444' },
  cacheBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Progress
  progressBar: {
    height: 3,
    backgroundColor: '#ffffff10',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#6c63ff',
    borderRadius: 2,
  },

  // WebView
  webviewContainer: { flex: 1 },
  webview: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0d0d1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { color: '#888', marginTop: 12, fontSize: 14 },
});
