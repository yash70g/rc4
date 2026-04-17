import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import ListItem from '../components/ListItem';
import Card from '../components/Card';
import MeshManager from '../services/MeshManager';

export default function MeshMapScreen() {
  const { theme, spacing, typography, isDark } = useTheme();
  const [nearby, setNearby] = useState([]);
  const [connected, setConnected] = useState([]);

  useEffect(() => {
    const refresh = () => {
      setNearby(MeshManager.getNearbyDevices());
      setConnected(MeshManager.getConnectedPeers());
    };

    MeshManager.on('nearby-devices-update', refresh);
    MeshManager.on('connected-peers-update', refresh);
    MeshManager.on('catalog-update', refresh);
    refresh();

    return () => {
      MeshManager.off('nearby-devices-update', refresh);
      MeshManager.off('connected-peers-update', refresh);
      MeshManager.off('catalog-update', refresh);
    };
  }, []);

  const connectedSet = useMemo(() => new Set(connected.map((d) => d.deviceId)), [connected]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingHorizontal: spacing.xl }]}>
        <Text style={[styles.title, { color: theme.textPrimary, fontSize: typography.headingL.fontSize }]}>
          Mesh Topology
        </Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary, fontSize: typography.bodySmall.fontSize }]}>
          {nearby.length} nearby • {connected.length} connected
        </Text>
      </View>

      <Card style={[styles.radarCard, { marginHorizontal: spacing.xl }]}>
        <View style={[styles.ringOuter, { borderColor: theme.border }]}>
          <View style={[styles.ringMiddle, { borderColor: theme.border }]}>
            <View style={[styles.ringInner, { borderColor: theme.border }]}>
              <View style={[styles.localNode, { backgroundColor: theme.primary }]}>
                <FontAwesome name="mobile" size={24} color="#fff" />
              </View>
            </View>
          </View>
        </View>
        <Text style={[styles.radarLabel, { color: theme.textSecondary }]}>LOCAL NODE</Text>
      </Card>

      <FlatList
        data={nearby}
        keyExtractor={(item) => item.deviceId}
        contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: 40 }}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.textSecondary }]}>
            No nearby nodes detected in range.
          </Text>
        }
        renderItem={({ item }) => {
          const isConnected = connectedSet.has(item.deviceId);
          return (
            <ListItem
              title={item.deviceName}
              subtitle={`ID ${item.deviceId.slice(0, 8)} • ${item.pageCount || 0} pages`}
              icon={<FontAwesome name="wifi" />}
              rightElement={
                <View style={styles.statusRow}>
                   <View style={[styles.dot, { backgroundColor: isConnected ? theme.success : theme.textSecondary }]} />
                   <Text style={[styles.state, { color: isConnected ? theme.success : theme.textSecondary }]}>
                    {isConnected ? 'CONNECTED' : 'NEARBY'}
                  </Text>
                </View>
              }
            />
          );
        }}
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
  subtitle: {
    marginTop: 4,
    fontWeight: '500',
  },
  radarCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    marginBottom: 24,
  },
  ringOuter: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
  },
  ringMiddle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  localNode: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  radarLabel: {
    marginTop: 16,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  state: {
    fontSize: 10,
    fontWeight: '800',
  },
  empty: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 40,
  },
});
