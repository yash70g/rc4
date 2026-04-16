import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as CacheManager from '../services/CacheManager';
import MeshManager from '../services/MeshManager';

export default function SearchScreen({ navigation }) {
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
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Search Network</Text>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color="#888" style={styles.searchIcon} />
        <TextInput
          style={styles.input}
          placeholder="Search local cache and connected peers..."
          placeholderTextColor="#888"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoCorrect={false}
        />
        {searching && <ActivityIndicator color="#6c63ff" />}
      </View>

      <FlatList
        data={allResults}
        keyExtractor={(item) => item.hash}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.resultCard} onPress={() => viewResult(item)} activeOpacity={0.7}>
            <View style={styles.resultIcon}>
              <Ionicons
                name={item.source === 'mesh' ? 'cloud-outline' : 'phone-portrait-outline'}
                size={24}
                color={item.source === 'mesh' ? '#3498db' : '#6c63ff'}
              />
            </View>
            <View style={styles.resultText}>
              <Text style={styles.resultTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.resultUrl} numberOfLines={1}>
                {item.source === 'mesh' ? `On peer: ${item.deviceId?.slice(0, 8) || 'unknown'}` : item.url}
              </Text>
            </View>
            {requestingHash === item.hash ? (
              <ActivityIndicator size="small" color="#6c63ff" />
            ) : (
              <Ionicons name="chevron-forward" size={20} color="#444" />
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !searching && query.length > 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No results found for "{query}"</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d1a',
    paddingTop: 50,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 15,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    marginHorizontal: 20,
    paddingHorizontal: 15,
    marginBottom: 20,
  },
  searchIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 50,
    color: '#fff',
    fontSize: 16,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 10,
    padding: 15,
  },
  resultIcon: {
    marginRight: 15,
  },
  resultText: {
    flex: 1,
  },
  resultTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  resultUrl: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  emptyState: {
    marginTop: 50,
    alignItems: 'center',
  },
  emptyText: {
    color: '#888',
    fontSize: 16,
  },
});
