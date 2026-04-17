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
import { FontAwesome } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import Button from '../components/Button';
import { processHtml } from '../services/PageProcessor';
import * as CacheManager from '../services/CacheManager';
import MeshManager from '../services/MeshManager';

const SEARCH_ENGINE = 'https://www.google.com/search?q=';

function isUrl(text) {
  const t = text.trim();
  if (/^https?:\/\//i.test(t)) return true;
  if (!t.includes(' ') && /^[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}/.test(t)) return true;
  return false;
}

export default function BrowserScreen({ navigation }) {
  const { theme, spacing, typography, isDark } = useTheme();
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
      // Ignore
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
    console.log('[Browser] Starting cache capture...');
    try {
      const capturedHtml = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out capturing page content')), 15000);
        
        console.log('[Browser] Injecting capture script...');
        webViewRef.current?.injectJavaScript(`
          (function() {
            try {
              const html = document.documentElement.outerHTML;
              const title = document.title || 'Untitled Page';
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'cache-capture',
                html: html,
                title: title
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
        
        captureResolve.current = (data) => { 
          clearTimeout(timeout); 
          resolve(data); 
        };
        captureReject.current = (err) => { 
          clearTimeout(timeout); 
          reject(err); 
        };
      });

      if (!capturedHtml || typeof capturedHtml !== 'string') {
        throw new Error('Invalid HTML content captured');
      }

      console.log('[Browser] Processing HTML snapshot...');
      const { html, title } = await processHtml(currentUrl, capturedHtml);
      
      console.log('[Browser] Storing to database:', { url: currentUrl, title });
      const result = await CacheManager.storeSnapshot(currentUrl, title, html);
      
      console.log('[Browser] Syncing mesh catalog...');
      await MeshManager.shareCatalog();

      if (result.deduplicated) {
        Alert.alert('Knowledge Exists', `"${title}" is already in your local radius.`);
      } else {
        Alert.alert(
          '✅ Page Cached',
          `"${title}" is now physically stored on this device.`,
          [
            { text: 'Open Library', onPress: () => navigation.navigate('Cache') },
            { text: 'Done' },
          ]
        );
      }
    } catch (error) {
      console.error('[Browser] Cache failed:', error);
      Alert.alert('Cache Interrupted', error.message);
    } finally {
      setCaching(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* ── URL / Search Bar ───────────────────────────────── */}
      <View style={[styles.urlBar, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <View style={[styles.urlInputContainer, { backgroundColor: isDark ? '#0F1115' : '#F3F4F6' }]}>
          <FontAwesome
            name={loading ? 'hourglass-half' : 'search'}
            size={18}
            color={theme.primary}
          />
          <TextInput
            style={[styles.urlInput, { color: theme.textPrimary }]}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={handleSubmit}
            placeholder="Search or enter URL..."
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="web-search"
            returnKeyType="go"
            selectTextOnFocus
          />
          {input.length > 0 && (
            <TouchableOpacity onPress={() => setInput('')} style={styles.clearBtn}>
              <FontAwesome name="times-circle" size={18} color={theme.textSecondary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={handleSubmit} style={styles.goBtn}>
            <FontAwesome name="arrow-circle-right" size={30} color={theme.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Browser Nav Bar ────────────────────────────────── */}
      <View style={[styles.navBar, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <TouchableOpacity
          onPress={() => webViewRef.current?.goBack()}
          disabled={!canGoBack}
          style={styles.navBtn}
        >
          <FontAwesome
            name="chevron-left"
            size={20}
            color={canGoBack ? theme.textPrimary : theme.border}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => webViewRef.current?.goForward()}
          disabled={!canGoForward}
          style={styles.navBtn}
        >
          <FontAwesome
            name="chevron-right"
            size={20}
            color={canGoForward ? theme.textPrimary : theme.border}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => webViewRef.current?.reload()}
          style={styles.navBtn}
        >
          <FontAwesome name="refresh" size={18} color={theme.textSecondary} />
        </TouchableOpacity>

        <View style={styles.navTitleWrap}>
          <Text style={[styles.navTitle, { color: theme.textSecondary }]} numberOfLines={1}>
            {pageTitle || 'New Tab'}
          </Text>
        </View>

        <Button
          variant="primary"
          title="Cache"
          loading={caching}
          onPress={cachePage}
          style={styles.cacheBtn}
          textStyle={{ fontSize: 13 }}
          icon={<FontAwesome name="download" size={16} color="#fff" />}
        />
      </View>

      {/* ── Progress Bar ───────────────────────────────────── */}
      {loading && (
        <View style={[styles.progressBar, { backgroundColor: theme.border }]}>
          <View style={[styles.progressFill, { backgroundColor: theme.primary, width: `${Math.max(progress * 100, 10)}%` }]} />
        </View>
      )}

      {/* ── WebView ────────────────────────────────────────── */}
      <View style={styles.webviewContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: currentUrl }}
          style={[styles.webview, { backgroundColor: theme.background }]}
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
            <View style={[styles.loadingOverlay, { backgroundColor: theme.background }]}>
              <ActivityIndicator size="large" color={theme.primary} />
              <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Loading Knowledge...</Text>
            </View>
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  urlBar: {
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  urlInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 48,
  },
  urlInput: {
    flex: 1,
    fontSize: 15,
    marginLeft: 10,
  },
  clearBtn: { padding: 4 },
  goBtn: { marginLeft: 8 },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  navBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navTitleWrap: {
    flex: 1,
    paddingHorizontal: 12,
  },
  navTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  cacheBtn: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
  },
  progressBar: {
    height: 2,
  },
  progressFill: {
    height: '100%',
  },
  webviewContainer: { flex: 1 },
  webview: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { marginTop: 16, fontSize: 14, fontWeight: '500' },
});
