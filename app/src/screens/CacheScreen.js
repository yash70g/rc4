import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import * as CacheManager from '../services/CacheManager';

export default function CacheScreen({ navigation }) {
  const [pages, setPages] = useState([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'); // all, local, mesh
  const [refreshing, setRefreshing] = useState(false);

  const loadPages = useCallback(async () => {
    try {
      let results;
      if (query.trim()) {
        results = await CacheManager.search(query);
      } else {
        results = await CacheManager.listAll();
      }
      if (filter !== 'all') {
        results = results.filter((p) => p.source === filter);
      }
      setPages(results);
    } catch (e) {
      console.log('Error loading cache:', e);
    }
  }, [query, filter]);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPages();
    setRefreshing(false);
  };

  const deletePage = (hash, title) => {
    Alert.alert('Delete Page', `Remove "${title}" from cache?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await CacheManager.deletePage(hash);
          loadPages();
        },
      },
    ]);
  };

  const viewPage = (hash) => {
    navigation.navigate('Viewer', { hash });
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.pageCard} onPress={() => viewPage(item.hash)} activeOpacity={0.7}>
      <View style={styles.pageIcon}>
        <Ionicons
          name={item.source === 'mesh' ? 'git-network-outline' : 'document-outline'}
          size={22}
          color={item.source === 'mesh' ? '#00d2ff' : '#6c63ff'}
        />
      </View>
      <View style={styles.pageInfo}>
        <Text style={styles.pageTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.pageUrl} numberOfLines={1}>
          {item.url}
        </Text>
        <View style={styles.pageMeta}>
          <Text style={styles.metaText}>{CacheManager.formatSize(item.size)}</Text>
          <Text style={styles.metaDot}>•</Text>
          <Text style={styles.metaText}>{item.accessCount}× viewed</Text>
          <Text style={styles.metaDot}>•</Text>
          <Text style={[styles.metaText, { color: item.source === 'mesh' ? '#00d2ff' : '#6c63ff' }]}>
            {item.source === 'mesh' ? '🔗 Mesh' : '📱 Local'}
          </Text>
        </View>
      </View>
      <TouchableOpacity style={styles.deleteBtn} onPress={() => deletePage(item.hash, item.title)}>
        <Ionicons name="trash-outline" size={18} color="#ff4444" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>📦 Cache</Text>
        <Text style={styles.headerCount}>{pages.length} pages</Text>
      </View>

      {/* Search */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color="#666" />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={(text) => setQuery(text)}
          placeholder="Search cached pages..."
          placeholderTextColor="#666"
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color="#666" />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Filters */}
      <View style={styles.filters}>
        {['all', 'local', 'mesh'].map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && styles.filterActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'all' ? '📋 All' : f === 'local' ? '📱 Local' : '🔗 Mesh'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Page List */}
      <FlatList
        data={pages}
        keyExtractor={(item) => item.hash}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6c63ff" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="archive-outline" size={48} color="#333" />
            <Text style={styles.emptyText}>No cached pages yet</Text>
            <Text style={styles.emptyHint}>Go to Browser tab to cache your first page!</Text>
          </View>
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
  headerCount: { fontSize: 14, color: '#6c63ff', fontWeight: '600' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    paddingHorizontal: 14,
    gap: 8,
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 14, paddingVertical: 10 },
  filters: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#1a1a2e',
  },
  filterActive: { backgroundColor: '#6c63ff' },
  filterText: { color: '#888', fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100 },
  pageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  pageIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#ffffff08',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageInfo: { flex: 1 },
  pageTitle: { fontSize: 14, fontWeight: '700', color: '#fff' },
  pageUrl: { fontSize: 11, color: '#666', marginTop: 2 },
  pageMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
  metaText: { fontSize: 11, color: '#888' },
  metaDot: { fontSize: 10, color: '#444' },
  deleteBtn: { padding: 8 },
  empty: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyText: { fontSize: 16, color: '#555', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#444' },
});
