import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import Card from '../components/Card';
import ListItem from '../components/ListItem';
import * as CacheManager from '../services/CacheManager';
import MeshManager from '../services/MeshManager';

export default function SearchScreen({ navigation }) {
  const { theme, spacing, typography, isDark } = useTheme();
  const [query, setQuery] = useState('');
  const [localResults, setLocalResults] = useState([]);
  const [meshResults, setMeshResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [requestingHash, setRequestingHash] = useState(null);

  useEffect(() => {
    const onPageReceived = ({ hash }) => {
      if (hash && hash === requestingHash) {
        setRequestingHash(null);
        navigation.navigate('Viewer', { hash });
      }
      if (query.trim()) {
        runSearch(query);
      }
    };

    MeshManager.on('page-received', onPageReceived);
    return () => MeshManager.off('page-received', onPageReceived);
  }, [requestingHash, query]);

  useEffect(() => {
    const timer = setTimeout(() => {
      runSearch(query);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  async function runSearch(text) {
    if (!text.trim()) {
      setLocalResults([]);
      setMeshResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    try {
      const [local, mesh] = await Promise.all([
        CacheManager.search(text),
        Promise.resolve(MeshManager.searchPeers(text)),
      ]);

      setLocalResults(local.map((item) => ({ ...item, source: 'local' })));
      setMeshResults(mesh.map((item) => ({ ...item, source: 'mesh' })));
    } catch (e) {
      console.log('Search error:', e);
    } finally {
      setSearching(false);
    }
  }

  const allResults = useMemo(() => {
    const dedup = new Map();
    localResults.forEach((item) => dedup.set(item.hash, item));
    meshResults.forEach((item) => {
      if (!dedup.has(item.hash)) dedup.set(item.hash, item);
    });
    return Array.from(dedup.values());
  }, [localResults, meshResults]);

  async function viewResult(item) {
    if (item.source === 'local') {
      navigation.navigate('Viewer', { hash: item.hash });
      return;
    }

    setRequestingHash(item.hash);
    const ok = MeshManager.requestPage(item.deviceId, item.hash);
    if (!ok) {
      setRequestingHash(null);
      Alert.alert('Request Failed', 'Could not request page from peer. Please reconnect and try again.');
      return;
    }

    Alert.alert('Request Sent', `Fetching "${item.title}" from nearby peer.`);
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingHorizontal: spacing.xl }]}>
        <Text style={[styles.title, { color: theme.textPrimary, fontSize: typography.headingL.fontSize }]}>
          Search Mesh
        </Text>
      </View>

      <View style={[styles.searchBar, { backgroundColor: theme.card, borderColor: theme.border, marginHorizontal: spacing.xl }]}>
        <FontAwesome name="search" size={18} color={theme.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={[styles.input, { color: theme.textPrimary }]}
          placeholder="Search local and nearby peers..."
          placeholderTextColor={theme.textSecondary}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoCorrect={false}
        />
        {searching && <ActivityIndicator color={theme.primary} />}
      </View>

      <FlatList
        data={allResults}
        keyExtractor={(item) => item.hash}
        contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: 40 }}
        renderItem={({ item }) => (
          <ListItem
            title={item.title}
            subtitle={item.source === 'mesh' ? `Peer: ${item.deviceId?.slice(0, 8) || 'unknown'}` : (item.url.length > 40 ? item.url.substring(0, 37) + '...' : item.url)}
            icon={<FontAwesome name={item.source === 'mesh' ? 'share-alt' : 'file-text-o'} />}
            onPress={() => viewResult(item)}
            rightElement={
              requestingHash === item.hash ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <View style={[styles.sourceBadge, { backgroundColor: item.source === 'mesh' ? `${theme.accent}15` : `${theme.primary}15` }]}>
                  <Text style={[styles.sourceText, { color: item.source === 'mesh' ? theme.accent : theme.primary }]}>
                    {item.source === 'mesh' ? 'MESH' : 'LOCAL'}
                  </Text>
                </View>
              )
            }
          />
        )}
        ListEmptyComponent={
          !searching && query.trim().length > 0 ? (
            <Card style={styles.emptyCard}>
              <FontAwesome name="search" size={48} color={theme.textSecondary} style={{ opacity: 0.5 }} />
              <Text style={[styles.emptyText, { color: theme.textPrimary, marginTop: 12 }]}>No results found</Text>
              <Text style={[styles.emptyHint, { color: theme.textSecondary }]}>We couldn't find matches for "{query}" in the mesh area.</Text>
            </Card>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    height: 52,
    marginBottom: 24,
  },
  searchIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 50,
    fontSize: 15,
  },
  sourceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  sourceText: {
    fontSize: 10,
    fontWeight: '800',
  },
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
