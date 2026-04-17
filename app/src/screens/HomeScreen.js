import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import Card from '../components/Card';
import Button from '../components/Button';
import StatCard from '../components/StatCard';
import * as CacheManager from '../services/CacheManager';
import MeshManager from '../services/MeshManager';

export default function HomeScreen({ navigation }) {
  const { theme, spacing, typography, isDark, toggleTheme } = useTheme();
  // ... rest of state and effects remain same
  const [stats, setStats] = useState({ count: 0, totalSize: 0 });
  const [meshStats, setMeshStats] = useState({ nearbyDevices: 0, connectedPeers: 0, peerPages: 0 });
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
    const interval = setInterval(loadData, 5000);
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
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { padding: spacing.xl, paddingTop: spacing.xxxl + 20 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
    >
      {/* Header with Toggle */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={{ width: 40 }} /> 
          <FontAwesome name="bolt" size={40} color={theme.primary} />
          <TouchableOpacity onPress={toggleTheme} style={styles.themeToggle}>
             <FontAwesome name={isDark ? "sun-o" : "moon-o"} size={20} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
        
        <Text style={[styles.logo, { color: theme.textPrimary, fontSize: typography.headingL.fontSize, marginTop: 12 }]}>
          Reality Cache
        </Text>
        <Text style={[styles.subtitle, { color: theme.primary, fontSize: typography.caption.fontSize }]}>
          PEER-TO-PEER KNOWLEDGE MESH
        </Text>
      </View>

      {/* Knowledge Radius - Clean & Typography Focused */}
      <View style={styles.radiusContainer}>
        <Text style={[styles.radiusTitle, { color: theme.textSecondary, fontSize: typography.caption.fontSize }]}>
          KNOWLEDGE RADIUS
        </Text>
        <Text style={[styles.radiusCount, { color: theme.textPrimary, fontSize: 64 }]}>
          {stats.count + meshStats.peerPages}
        </Text>
        <Text style={[styles.radiusLabel, { color: theme.textSecondary, fontSize: typography.body.fontSize }]}>
          pages accessible locally
        </Text>
        
        <View style={styles.chipRow}>
           <View style={[styles.chip, { backgroundColor: theme.card, borderColor: theme.border }]}>
             <Text style={[styles.chipText, { color: theme.textSecondary }]}>
               {meshStats.connectedPeers} peers connected
             </Text>
           </View>
        </View>
      </View>

      {/* Stats Cards */}
      <View style={styles.statsRow}>
        <StatCard 
          icon={<FontAwesome name="folder-open" />} 
          value={stats.count} 
          label="Local Pages" 
          color={theme.primary}
        />
        <StatCard 
          icon={<FontAwesome name="database" />} 
          value={CacheManager.formatSize(stats.totalSize)} 
          label="Storage" 
          color={theme.accent}
        />
        <StatCard 
          icon={<FontAwesome name="rss" />} 
          value={connected ? 'Active' : 'Idle'} 
          label="Mesh Status" 
          color={connected ? theme.success : theme.textSecondary}
        />
      </View>

      {/* Quick Actions */}
      <Text style={[styles.sectionTitle, { color: theme.textPrimary, fontSize: typography.headingM.fontSize, marginBottom: spacing.m }]}>
        Quick Actions
      </Text>
      
      <View style={styles.actionsGrid}>
        <Button 
          variant="secondary"
          title="Browse & Cache"
          icon={<FontAwesome name="globe" size={16} color={theme.textPrimary} />}
          onPress={() => navigation.navigate('Browser')}
          style={styles.actionButton}
        />
        <Button 
          variant="secondary"
          title="Search Mesh"
          icon={<FontAwesome name="search" size={16} color={theme.textPrimary} />}
          onPress={() => navigation.navigate('Search')}
          style={styles.actionButton}
        />
      </View>
      
      <View style={styles.actionsGrid}>
        <Button 
          variant="primary"
          title="Join Mesh"
          icon={<FontAwesome name="share-alt" size={16} color="#fff" />}
          onPress={() => navigation.navigate('Mesh')}
          style={styles.actionButton}
        />
        <Button 
          variant="secondary"
          title="View Cache"
          icon={<FontAwesome name="briefcase" size={16} color={theme.textPrimary} />}
          onPress={() => navigation.navigate('Cache')}
          style={styles.actionButton}
        />
      </View>

      {/* Quote */}
      <Card style={styles.quoteCard}>
        <Text style={[styles.quoteText, { color: theme.textSecondary, fontSize: typography.bodySmall.fontSize }]}>
          "A peer-to-peer web layer where knowledge spreads physically between devices."
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: 'center', marginBottom: 40 },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  themeToggle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontWeight: '700', marginTop: 4, letterSpacing: 1.5 },
  radiusContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  radiusTitle: { fontWeight: '700', letterSpacing: 2, marginBottom: 8 },
  radiusCount: { fontWeight: '900', letterSpacing: -2 },
  radiusLabel: { fontWeight: '500', marginTop: -4 },
  chipRow: { flexDirection: 'row', marginTop: 20 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 32 },
  sectionTitle: { fontWeight: '700' },
  actionsGrid: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  actionButton: { flex: 1, height: 56 },
  quoteCard: {
    marginTop: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#7C8CFF',
  },
  quoteText: { fontStyle: 'italic', lineHeight: 22 },
});
