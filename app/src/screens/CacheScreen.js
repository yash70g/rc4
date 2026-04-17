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
import { FontAwesome } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import Card from '../components/Card';
import Button from '../components/Button';
import ListItem from '../components/ListItem';
import * as CacheManager from '../services/CacheManager';

export default function CacheScreen({ navigation }) {
  const { theme, spacing, typography, isDark } = useTheme();
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

  const renderItem = ({ item }) => {
    const displayUrl = item.url.length > 40 ? item.url.substring(0, 37) + '...' : item.url;
    return (
      <ListItem
        title={item.title}
        subtitle={`${displayUrl}\n${CacheManager.formatSize(item.size)} • ${item.accessCount} views`}
        icon={<FontAwesome name={item.source === 'mesh' ? 'share-alt' : 'file-text-o'} />}
        onPress={() => navigation.navigate('Viewer', { hash: item.hash })}
        rightElement={
          <TouchableOpacity style={styles.deleteBtn} onPress={() => deletePage(item.hash, item.title)}>
            <FontAwesome name="trash" size={20} color={theme.error} />
          </TouchableOpacity>
        }
      />
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Text style={[styles.headerTitle, { color: theme.textPrimary, fontSize: typography.headingL.fontSize }]}>
          Cache Library
        </Text>
        <View style={[styles.badge, { backgroundColor: `${theme.primary}15` }]}>
           <Text style={[styles.badgeText, { color: theme.primary }]}>{pages.length} pages</Text>
        </View>
      </View>

      {/* Search */}
      <View style={[styles.searchBar, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <FontAwesome name="search" size={16} color={theme.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: theme.textPrimary }]}
          value={query}
          onChangeText={setQuery}
          placeholder="Search your library..."
          placeholderTextColor={theme.textSecondary}
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')}>
            <FontAwesome name="times-circle" size={18} color={theme.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Filters */}
      <View style={[styles.filters, { paddingHorizontal: spacing.xl }]}>
        {['all', 'local', 'mesh'].map((f) => {
          const isActive = filter === f;
          return (
            <Button
              key={f}
              variant="secondary"
              title={f === 'all' ? 'All' : f === 'local' ? 'Local' : 'Mesh'}
              onPress={() => setFilter(f)}
              style={[
                styles.filterChip,
                isActive && { backgroundColor: `${theme.primary}15`, borderColor: theme.primary, borderWidth: 1 }
              ]}
              textStyle={[
                styles.filterText,
                isActive && { color: theme.primary }
              ]}
            />
          );
        })}
      </View>

      {/* Page List */}
      <FlatList
        data={pages}
        keyExtractor={(item) => item.hash}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, { paddingHorizontal: spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
        ListEmptyComponent={
          <Card style={styles.emptyCard}>
            <FontAwesome name="archive" size={48} color={theme.textSecondary} style={{ opacity: 0.5 }} />
            <Text style={[styles.emptyText, { color: theme.textPrimary, marginTop: 12 }]}>No pages found</Text>
            <Text style={[styles.emptyHint, { color: theme.textSecondary }]}>Your cached knowledge will appear here.</Text>
          </Card>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  headerTitle: { fontWeight: '800', letterSpacing: -0.5 },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    height: 48,
    marginBottom: 16,
  },
  searchInput: { flex: 1, fontSize: 14, marginLeft: 10 },
  filters: {
    flexDirection: 'row',
    marginBottom: 20,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    height: 36,
    borderRadius: 18,
  },
  filterText: {
    fontSize: 12,
    fontWeight: '600',
  },
  list: { paddingBottom: 100, paddingTop: 4 },
  deleteBtn: { padding: 4, marginLeft: 8 },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    marginTop: 40,
    borderStyle: 'dashed',
    borderWidth: 1.5,
  },
  emptyText: { fontSize: 16, fontWeight: '700' },
  emptyHint: { fontSize: 13, textAlign: 'center', marginTop: 4, lineHeight: 18 },
});
