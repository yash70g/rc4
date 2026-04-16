import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import * as CacheManager from '../services/CacheManager';
import MeshManager from '../services/MeshManager';

export default function HomeScreen({ navigation }) {
  const [stats, setStats] = useState({ count: 0, totalSize: 0 });
  const [meshStats, setMeshStats] = useState({ nearbyDevices: 0, connectedPeers: 0, peerPages: 0 });
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pulseAnim = useState(new Animated.Value(1))[0];

  const loadData = useCallback(async () => {
    try {
      const s = await CacheManager.getStats();
      setStats(s);
      setMeshStats(MeshManager.getNetworkStats());
      setConnected(MeshManager.isConnected());
    } catch (e) {
      console.log('Error loading stats:', e);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000); // Refresh stats every 5 seconds
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    const onStatsUpdate = () => setMeshStats(MeshManager.getNetworkStats());
    const onConnectionUpdate = () => setConnected(MeshManager.isConnected());
    const onPageReceived = () => loadData();

    MeshManager.on('nearby-devices-update', onStatsUpdate);
    MeshManager.on('connected-peers-update', onConnectionUpdate);
    MeshManager.on('catalog-update', onStatsUpdate);
    MeshManager.on('page-received', onPageReceived);

    // Pulse animation for connection indicator
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    ).start();

    return () => {
      MeshManager.off('nearby-devices-update', onStatsUpdate);
      MeshManager.off('connected-peers-update', onConnectionUpdate);
      MeshManager.off('catalog-update', onStatsUpdate);
      MeshManager.off('page-received', onPageReceived);
    };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6c63ff" />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logo}>⚡ Reality Cache</Text>
        <Text style={styles.subtitle}>P2P Mesh</Text>
      </View>

      {/* Knowledge Radius Card */}
      <View style={styles.radiusCard}>
        <View style={styles.radiusGlow} />
        <Ionicons name="globe-outline" size={40} color="#6c63ff" />
        <Text style={styles.radiusTitle}>Knowledge Radius</Text>
        <Text style={styles.radiusCount}>
          {stats.count + meshStats.peerPages}
        </Text>
        <Text style={styles.radiusLabel}>
          pages accessible
        </Text>
        <View style={styles.radiusRow}>
          <View style={styles.radiusChip}>
            <Ionicons name="phone-portrait-outline" size={14} color="#e0e0e0" />
            <Text style={styles.radiusChipText}>
              {meshStats.nearbyDevices} nearby • {meshStats.connectedPeers} connected
            </Text>
          </View>
          <View style={styles.radiusChip}>
            <Ionicons name="document-outline" size={14} color="#e0e0e0" />
            <Text style={styles.radiusChipText}>
              {stats.count} local • {meshStats.peerPages} peers
            </Text>
          </View>
        </View>
      </View>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Ionicons name="archive-outline" size={24} color="#6c63ff" />
          <Text style={styles.statNumber}>{stats.count}</Text>
          <Text style={styles.statLabel}>Cached Pages</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="server-outline" size={24} color="#00d2ff" />
          <Text style={styles.statNumber}>
            {CacheManager.formatSize(stats.totalSize)}
          </Text>
          <Text style={styles.statLabel}>Cache Size</Text>
        </View>
        <View style={styles.statCard}>
          <View style={styles.connectionDot}>
            <Animated.View
              style={[
                styles.dot,
                { backgroundColor: connected ? '#00ff88' : '#ff4444', opacity: connected ? pulseAnim : 1 },
              ]}
            />
          </View>
          <Text style={styles.statNumber}>
            {connected ? 'Online' : 'Offline'}
          </Text>
          <Text style={styles.statLabel}>Mesh</Text>
        </View>
      </View>

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: '#6c63ff' }]}
          onPress={() => navigation.navigate('Browser')}
        >
          <Ionicons name="globe-outline" size={24} color="#fff" />
          <Text style={styles.actionText}>Browse & Cache</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: '#00d2ff' }]}
          onPress={() => navigation.navigate('Search')}
        >
          <Ionicons name="search-outline" size={24} color="#fff" />
          <Text style={styles.actionText}>Search</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: '#ff6b9d' }]}
          onPress={() => navigation.navigate('Mesh')}
        >
          <Ionicons name="git-network-outline" size={24} color="#fff" />
          <Text style={styles.actionText}>Join Mesh</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: '#ffa726' }]}
          onPress={() => navigation.navigate('Cache')}
        >
          <Ionicons name="archive-outline" size={24} color="#fff" />
          <Text style={styles.actionText}>View Cache</Text>
        </TouchableOpacity>
      </View>

      {/* Pitch line */}
      <View style={styles.pitchCard}>
        <Text style={styles.pitchText}>
          "A peer-to-peer offline web layer where knowledge spreads physically between devices."
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d1a' },
  content: { padding: 20, paddingTop: 60 },
  header: { alignItems: 'center', marginBottom: 24 },
  logo: { fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  subtitle: { fontSize: 14, color: '#6c63ff', fontWeight: '600', marginTop: 2 },
  radiusCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#6c63ff33',
    overflow: 'hidden',
  },
  radiusGlow: {
    position: 'absolute',
    top: -50,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#6c63ff15',
  },
  radiusTitle: { fontSize: 14, color: '#888', marginTop: 8, fontWeight: '600', letterSpacing: 1 },
  radiusCount: { fontSize: 56, fontWeight: '900', color: '#fff', marginTop: 4 },
  radiusLabel: { fontSize: 16, color: '#aaa', marginTop: -4 },
  radiusRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  radiusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff10',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  radiusChipText: { color: '#e0e0e0', fontSize: 12, fontWeight: '500' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statCard: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  statNumber: { fontSize: 16, fontWeight: '700', color: '#fff' },
  statLabel: { fontSize: 11, color: '#888', fontWeight: '500' },
  connectionDot: { width: 24, height: 24, justifyContent: 'center', alignItems: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 12 },
  actionsRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  actionBtn: {
    flex: 1,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  actionText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  pitchCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    marginTop: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#6c63ff',
  },
  pitchText: { color: '#aaa', fontSize: 13, fontStyle: 'italic', lineHeight: 20 },
});
