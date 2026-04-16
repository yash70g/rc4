import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MeshManager from '../services/MeshManager';

function Dot({ color }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

export default function MeshMapScreen() {
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
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Mesh Map</Text>
        <Text style={styles.subtitle}>{nearby.length} nearby • {connected.length} connected</Text>
      </View>

      <View style={styles.radarCard}>
        <View style={styles.ringOuter}>
          <View style={styles.ringMiddle}>
            <View style={styles.ringInner}>
              <View style={styles.localNode}>
                <Ionicons name="phone-portrait" size={20} color="#fff" />
              </View>
            </View>
          </View>
        </View>
      </View>

      <FlatList
        data={nearby}
        keyExtractor={(item) => item.deviceId}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}
        ListEmptyComponent={<Text style={styles.empty}>No nearby peers yet.</Text>}
        renderItem={({ item }) => {
          const isConnected = connectedSet.has(item.deviceId);
          return (
            <View style={styles.row}>
              <Dot color={isConnected ? '#00d084' : '#999'} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.deviceName}</Text>
                <Text style={styles.meta}>ID {item.deviceId.slice(0, 8)} • {item.pageCount || 0} pages</Text>
              </View>
              <Text style={[styles.state, { color: isConnected ? '#00d084' : '#999' }]}>
                {isConnected ? 'Connected' : 'Nearby'}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d1a',
    paddingTop: 48,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 4,
    color: '#888',
  },
  radarCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 14,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  ringOuter: {
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 1,
    borderColor: '#ffffff22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringMiddle: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 1,
    borderColor: '#ffffff22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: '#ffffff22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  localNode: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#6c63ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  name: {
    color: '#fff',
    fontWeight: '600',
  },
  meta: {
    color: '#888',
    fontSize: 11,
    marginTop: 1,
  },
  state: {
    fontSize: 11,
    fontWeight: '700',
  },
  empty: {
    textAlign: 'center',
    color: '#888',
    marginTop: 12,
  },
});
