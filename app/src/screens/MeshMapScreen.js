import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  ScrollView,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as MeshManager from '../services/MeshManager';

const { width: SCREEN_W } = Dimensions.get('window');
const MAP_SIZE = SCREEN_W - 32;
const CENTER = MAP_SIZE / 2;
const RELAY_R = 28;
const PEER_R = 22;
const ORBIT_R = MAP_SIZE / 2 - 50;

// ── Animated Pulse Ring ──────────────────────────────────────────────
function PulseRing({ color, size, active }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 2000, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active]);

  if (!active) return null;

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: color,
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}

// ── Connection Line ──────────────────────────────────────────────────
function ConnectionLine({ x1, y1, x2, y2, active }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  return (
    <View
      style={{
        position: 'absolute',
        left: x1,
        top: y1,
        width: length,
        height: active ? 2 : 1,
        backgroundColor: active ? '#00ff8855' : '#ff444433',
        transform: [{ rotate: `${angle}deg` }],
        transformOrigin: 'left center',
      }}
    />
  );
}

// ── Device Node ──────────────────────────────────────────────────────
function DeviceNode({ x, y, name, active, index }) {
  const color = active ? '#00ff88' : '#ff4444';
  const bgColor = active ? '#00ff8820' : '#ff444420';
  const borderColor = active ? '#00ff8860' : '#ff444440';
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      delay: index * 100,
      useNativeDriver: false,
    }).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.nodeContainer,
        {
          left: x - PEER_R,
          top: y - PEER_R,
          opacity: fadeAnim,
          transform: [{
            scale: fadeAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.3, 1],
            }),
          }],
        },
      ]}
    >
      <PulseRing color={color} size={PEER_R * 2} active={active} />
      <View
        style={[
          styles.peerNode,
          {
            backgroundColor: bgColor,
            borderColor: borderColor,
            width: PEER_R * 2,
            height: PEER_R * 2,
            borderRadius: PEER_R,
          },
        ]}
      >
        <Ionicons
          name={active ? 'phone-portrait' : 'phone-portrait-outline'}
          size={18}
          color={color}
        />
      </View>
      <Text
        style={[styles.nodeName, { color: active ? '#ccc' : '#666' }]}
        numberOfLines={1}
      >
        {name}
      </Text>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
    </Animated.View>
  );
}

// ── Main Map Screen ──────────────────────────────────────────────────
export default function MeshMapScreen() {
  const [allPeers, setAllPeers] = useState([]);
  const [relays, setRelays] = useState([]);
  const relayPulse = useRef(new Animated.Value(0)).current;

  const refresh = async () => {
    const connectedRelays = MeshManager.getConnectedRelays();
    setRelays(connectedRelays);

    if (connectedRelays.length === 0) {
      setAllPeers([]);
      return;
    }

    // Fetch from the SERVER (single source of truth) so all devices see the same map
    try {
      const baseUrl = connectedRelays[0]; // use first connected relay
      const res = await fetch(`${baseUrl}/api/peers/all`);
      const serverPeers = await res.json();
      setAllPeers(serverPeers);
    } catch (e) {
      // Fallback to local state if server fetch fails
      const history = MeshManager.getAllPeersWithStatus();
      const list = Object.entries(history).map(([peerId, data]) => ({
        peerId,
        ...data,
      }));
      setAllPeers(list);
    }
  };

  useEffect(() => {
    refresh();

    // Relay pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(relayPulse, { toValue: 1, duration: 2500, useNativeDriver: false }),
        Animated.timing(relayPulse, { toValue: 0, duration: 0, useNativeDriver: false }),
      ])
    ).start();

    // Poll server every 5 seconds for consistent state across devices
    const interval = setInterval(refresh, 5000);

    const events = [
      'connected', 'disconnected', 'peer-joined', 'peer-left',
      'catalog-update', 'mesh-state', 'peer-history',
    ];
    events.forEach((e) => MeshManager.on(e, refresh));
    return () => {
      clearInterval(interval);
      events.forEach((e) => MeshManager.off(e, refresh));
    };
  }, []);

  const activePeers = allPeers.filter((p) => p.active);
  const inactivePeers = allPeers.filter((p) => !p.active);
  const isConnected = relays.length > 0;

  // Position peers in a circle around the center
  const positions = allPeers.map((peer, i) => {
    const angle = (2 * Math.PI * i) / Math.max(allPeers.length, 1) - Math.PI / 2;
    return {
      x: CENTER + ORBIT_R * Math.cos(angle),
      y: CENTER + ORBIT_R * Math.sin(angle),
    };
  });

  const relayPulseScale = relayPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 2.5],
  });
  const relayPulseOpacity = relayPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0],
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🗺️ Mesh Map</Text>
        <Text style={styles.headerSub}>
          {activePeers.length} active • {inactivePeers.length} inactive
        </Text>
      </View>

      {/* ── Network Graph ───────────────────────────────────── */}
      <View style={styles.mapCard}>
        <View style={[styles.mapArea, { width: MAP_SIZE, height: MAP_SIZE }]}>
          {/* Connection lines */}
          {allPeers.map((peer, i) => (
            <ConnectionLine
              key={`line-${peer.peerId}`}
              x1={CENTER}
              y1={CENTER}
              x2={positions[i].x}
              y2={positions[i].y}
              active={peer.active}
            />
          ))}

          {/* Relay node (center) */}
          <View
            style={[
              styles.relayContainer,
              { left: CENTER - RELAY_R, top: CENTER - RELAY_R },
            ]}
          >
            <Animated.View
              style={{
                position: 'absolute',
                width: RELAY_R * 2,
                height: RELAY_R * 2,
                borderRadius: RELAY_R,
                borderWidth: 2,
                borderColor: '#6c63ff',
                opacity: isConnected ? relayPulseOpacity : 0,
                transform: [{ scale: relayPulseScale }],
              }}
            />
            <View style={styles.relayNode}>
              <Ionicons name="server" size={22} color="#fff" />
            </View>
            <Text style={styles.relayLabel}>Relay</Text>
          </View>

          {/* Peer nodes */}
          {allPeers.map((peer, i) => (
            <DeviceNode
              key={peer.peerId}
              x={positions[i].x}
              y={positions[i].y}
              name={peer.deviceName}
              active={peer.active}
              index={i}
            />
          ))}

          {/* Empty state */}
          {allPeers.length === 0 && (
            <View style={styles.emptyMap}>
              <Ionicons name="radio-outline" size={40} color="#333" />
              <Text style={styles.emptyMapText}>
                {isConnected ? 'Waiting for peers...' : 'Connect to a relay first'}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Legend ───────────────────────────────────────────── */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#00ff88' }]} />
          <Text style={styles.legendText}>Active ({activePeers.length})</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#ff4444' }]} />
          <Text style={styles.legendText}>Inactive ({inactivePeers.length})</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#6c63ff' }]} />
          <Text style={styles.legendText}>Relay ({relays.length})</Text>
        </View>
      </View>

      {/* ── Peer List ───────────────────────────────────────── */}
      {allPeers.length > 0 && (
        <View style={styles.listCard}>
          <Text style={styles.listTitle}>ALL DEVICES</Text>
          {allPeers.map((peer) => {
            const isActive = peer.active;
            return (
              <View key={peer.peerId} style={styles.listRow}>
                <View
                  style={[
                    styles.listAvatar,
                    { backgroundColor: isActive ? '#00ff8815' : '#ff444415' },
                  ]}
                >
                  <Ionicons
                    name="phone-portrait-outline"
                    size={16}
                    color={isActive ? '#00ff88' : '#ff4444'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listName}>{peer.deviceName}</Text>
                  <Text style={styles.listMeta}>
                    {isActive ? 'Connected now' : `Last seen ${formatAgo(peer.lastSeen)}`}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusPill,
                    { backgroundColor: isActive ? '#00ff8820' : '#ff444420' },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusPillText,
                      { color: isActive ? '#00ff88' : '#ff4444' },
                    ]}
                  >
                    {isActive ? 'LIVE' : 'OFFLINE'}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────
function formatAgo(ts) {
  if (!ts) return 'unknown';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ── Styles ───────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d1a' },
  content: { paddingBottom: 100 },
  header: {
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: '#1a1a2e',
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 12, color: '#6c63ff', marginTop: 2, fontWeight: '500' },

  // Map
  mapCard: {
    margin: 16,
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ffffff08',
  },
  mapArea: {
    position: 'relative',
    overflow: 'hidden',
  },

  // Relay
  relayContainer: {
    position: 'absolute',
    alignItems: 'center',
    zIndex: 10,
  },
  relayNode: {
    width: RELAY_R * 2,
    height: RELAY_R * 2,
    borderRadius: RELAY_R,
    backgroundColor: '#6c63ff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#6c63ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 8,
  },
  relayLabel: {
    fontSize: 10,
    color: '#6c63ff',
    fontWeight: '700',
    marginTop: 4,
    letterSpacing: 1,
  },

  // Peer nodes
  nodeContainer: {
    position: 'absolute',
    alignItems: 'center',
    zIndex: 5,
  },
  peerNode: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  nodeName: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 4,
    maxWidth: 70,
    textAlign: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 2,
  },

  // Legend
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
  },

  // Peer list
  listCard: {
    marginHorizontal: 16,
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
  },
  listTitle: {
    fontSize: 11,
    color: '#888',
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 12,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff08',
    gap: 12,
  },
  listAvatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listName: { fontSize: 13, fontWeight: '700', color: '#fff' },
  listMeta: { fontSize: 11, color: '#666', marginTop: 2 },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // Empty
  emptyMap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  emptyMapText: {
    fontSize: 13,
    color: '#444',
    textAlign: 'center',
  },
});
