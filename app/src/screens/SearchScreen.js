import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as CacheManager from '../services/CacheManager';
import * as MeshManager from '../services/MeshManager';

export default function SearchScreen({ navigation }) {
  const [query, setQuery] = useState('');
  const [localResults, setLocalResults] = useState([]);
  const [meshResults, setMeshResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [meshSearching, setMeshSearching] = useState(false);

  useEffect(() => {
    const onSearchResponse = ({ requestId, results }) => {
      setMeshResults((prev) => {
        // Deduplicate by hash
        const existing = new Set(prev.map((r) => r.hash));
        const newResults = results.filter((r) => !existing.has(r.hash));
        return [...prev, ...newResults.map((r) => ({ ...r, source: 'mesh' }))];
      });
      setMeshSearching(false);
    };

    MeshManager.on('search-response', onSearchResponse);
    return () => MeshManager.off('search-response', onSearchResponse);
  }, []);

  const performSearch = useCallback(async (text) => {
    if (!text.trim()) {
      setLocalResults([]);
      setMeshResults([]);
      return;
    }

    setSearching(true);
    setMeshResults([]);

    try {
      // Local search
      const local = await CacheManager.search(text);
      setLocalResults(local.map((r) => ({ ...r, source: r.source || 'local' })));

      // Mesh search (if connected)
      if (MeshManager.isConnected()) {
        setMeshSearching(true);
        MeshManager.searchMesh(text);
        // Auto-stop after 3 seconds
        setTimeout(() => setMeshSearching(false), 3000);
      }
    } catch (e) {
      console.log('Search error:', e);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      performSearch(query);
    }, 300);
    return () => clearTimeout(timeout);
  }, [query, performSearch]);

  const allResults = [...localResults, ...meshResults.filter(
    (mr) => !localResults.find((lr) => lr.hash === mr.hash)
  )];

  const viewPage = (item) => {
    if (item.source === 'mesh' && !localResults.find((lr) => lr.hash === item.hash)) {
      // Need to download first
      const meshPeers = MeshManager.getMeshPeers();
      for (const [peerId, peer] of Object.entries(meshPeers)) {
        if (peer.catalog.find((c) => c.hash === item.hash)) {
          MeshManager.requestContent(peerId, item.hash);
          break;
        }
      }
      return;
    }
    navigation.navigate('Viewer', { hash: item.hash });
  };

  const renderResult = ({ item, index }) => (
    <TouchableOpacity
      style={styles.resultCard}
      onPress={() => viewPage(item)}
      activeOpacity={0.7}
    >
      <View style={styles.resultLeft}>
        <View style={[
          styles.sourceTag,
          { backgroundColor: item.source === 'mesh' ? '#00d2ff20' : '#6c63ff20' }
        ]}>
          <Text style={[
            styles.sourceText,
            { color: item.source === 'mesh' ? '#00d2ff' : '#6c63ff' }
          ]}>
            {item.source === 'mesh' ? '🔗 Mesh' : '📱 Local'}
          </Text>
        </View>
        <Text style={styles.resultTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.resultUrl} numberOfLines={1}>{item.url}</Text>
        <View style={styles.resultMeta}>
          <Text style={styles.metaText}>{CacheManager.formatSize(item.size)}</Text>
          {item.accessCount > 1 && (
            <>
              <Text style={styles.metaDot}>•</Text>
              <Text style={styles.metaText}>🔥 {item.accessCount}× viewed</Text>
            </>
          )}
        </View>
      </View>
      <Ionicons
        name={item.source === 'mesh' ? 'cloud-download-outline' : 'eye-outline'}
        size={20}
        color="#6c63ff"
      />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🔍 Search</Text>
        <Text style={styles.headerHint}>Local + Mesh</Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={20} color="#6c63ff" />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search the offline web..."
            placeholderTextColor="#666"
            autoFocus={false}
            returnKeyType="search"
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={18} color="#666" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Status */}
      {(searching || meshSearching) && (
        <View style={styles.statusBar}>
          <ActivityIndicator size="small" color="#6c63ff" />
          <Text style={styles.statusText}>
            {meshSearching ? 'Searching mesh network...' : 'Searching...'}
          </Text>
        </View>
      )}

      {/* Results count */}
      {query.trim() && !searching && (
        <View style={styles.resultsCount}>
          <Text style={styles.resultsCountText}>
            {allResults.length} result{allResults.length !== 1 ? 's' : ''}
            {meshSearching ? ' (mesh searching...)' : ''}
          </Text>
        </View>
      )}

      {/* Results */}
      <FlatList
        data={allResults}
        keyExtractor={(item, index) => `${item.hash}-${index}`}
        renderItem={renderResult}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          query.trim() && !searching ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={48} color="#333" />
              <Text style={styles.emptyText}>No results found</Text>
              <Text style={styles.emptyHint}>
                {MeshManager.isConnected()
                  ? 'Try different keywords'
                  : 'Connect to mesh for more results'}
              </Text>
            </View>
          ) : !query.trim() ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={48} color="#333" />
              <Text style={styles.emptyText}>Search the offline web</Text>
              <Text style={styles.emptyHint}>
                Find pages from your cache and nearby devices
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d1a' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: '#1a1a2e',
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },
  headerHint: { fontSize: 12, color: '#6c63ff', fontWeight: '600' },
  searchContainer: { paddingHorizontal: 16, paddingTop: 12 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    paddingHorizontal: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#6c63ff33',
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 12 },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 8,
  },
  statusText: { color: '#888', fontSize: 12 },
  resultsCount: { paddingHorizontal: 20, paddingTop: 10 },
  resultsCountText: { color: '#666', fontSize: 12, fontWeight: '500' },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100 },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  resultLeft: { flex: 1 },
  sourceTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 4,
  },
  sourceText: { fontSize: 10, fontWeight: '700' },
  resultTitle: { fontSize: 14, fontWeight: '700', color: '#fff' },
  resultUrl: { fontSize: 11, color: '#666', marginTop: 2 },
  resultMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
  metaText: { fontSize: 11, color: '#888' },
  metaDot: { color: '#444' },
  empty: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyText: { fontSize: 16, color: '#555', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#444', textAlign: 'center', paddingHorizontal: 40 },
});
