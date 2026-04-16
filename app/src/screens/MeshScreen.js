import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as MeshManager from '../services/MeshManager';
import * as CacheManager from '../services/CacheManager';

const NAME_FILE = FileSystem.documentDirectory + 'device-name.txt';

export default function MeshScreen({ navigation }) {
  const [relayUrl, setRelayUrl] = useState('http://192.168.1.100:3001');
  const [deviceName, setDeviceName] = useState('');
  const [connectedRelays, setConnectedRelays] = useState([]);
  const [peers, setPeers] = useState([]);
  const [meshCatalog, setMeshCatalog] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [downloading, setDownloading] = useState({});

  // Load persisted device name on mount
  useEffect(() => {
    (async () => {
      try {
        const info = await FileSystem.getInfoAsync(NAME_FILE);
        if (info.exists) {
          const saved = await FileSystem.readAsStringAsync(NAME_FILE);
          setDeviceName(saved.trim());
        } else {
          // Generate a friendly default name and save it
          const defaultName = `Phone-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
          await FileSystem.writeAsStringAsync(NAME_FILE, defaultName);
          setDeviceName(defaultName);
        }
      } catch (e) {
        setDeviceName(`Phone-${Math.random().toString(36).substring(2, 6).toUpperCase()}`);
      }
    })();
  }, []);

  const saveDeviceName = async (name) => {
    setDeviceName(name);
    try {
      await FileSystem.writeAsStringAsync(NAME_FILE, name);
    } catch (e) {}
  };

  useEffect(() => {
    refreshState();

    const onConnected = () => refreshState();
    const onDisconnected = () => refreshState();
    const onPeerJoined = () => refreshState();
    const onPeerLeft = () => refreshState();
    const onCatalogUpdate = () => refreshState();
    const onMeshState = () => refreshState();
    const onContentReceived = ({ hash }) => {
      setDownloading((prev) => { const n = { ...prev }; delete n[hash]; return n; });
      refreshState();
    };
    const onDownloadProgress = ({ hash, progress }) => {
      setDownloading((prev) => ({ ...prev, [hash]: Math.round(progress * 100) }));
    };
    const onSyncProgress = ({ current, total }) => {
      setSyncProgress(`${current}/${total}`);
    };
    const onError = ({ message }) => Alert.alert('Connection Error', message);

    MeshManager.on('connected', onConnected);
    MeshManager.on('disconnected', onDisconnected);
    MeshManager.on('peer-joined', onPeerJoined);
    MeshManager.on('peer-left', onPeerLeft);
    MeshManager.on('catalog-update', onCatalogUpdate);
    MeshManager.on('mesh-state', onMeshState);
    MeshManager.on('content-received', onContentReceived);
    MeshManager.on('download-progress', onDownloadProgress);
    MeshManager.on('sync-progress', onSyncProgress);
    MeshManager.on('error', onError);

    return () => {
      MeshManager.off('connected', onConnected);
      MeshManager.off('disconnected', onDisconnected);
      MeshManager.off('peer-joined', onPeerJoined);
      MeshManager.off('peer-left', onPeerLeft);
      MeshManager.off('catalog-update', onCatalogUpdate);
      MeshManager.off('mesh-state', onMeshState);
      MeshManager.off('content-received', onContentReceived);
      MeshManager.off('download-progress', onDownloadProgress);
      MeshManager.off('sync-progress', onSyncProgress);
      MeshManager.off('error', onError);
    };
  }, []);

  const refreshState = () => {
    setConnectedRelays(MeshManager.getConnectedRelays());
    const mp = MeshManager.getMeshPeers();
    setPeers(Object.entries(mp).map(([id, d]) => ({ peerId: id, ...d })));

    const seen = new Set();
    const catalog = [];
    for (const peer of Object.values(mp)) {
      for (const item of peer.catalog) {
        if (!seen.has(item.hash)) {
          seen.add(item.hash);
          let holderCount = 0;
          for (const p of Object.values(mp)) {
            if (p.catalog.find((c) => c.hash === item.hash)) holderCount++;
          }
          catalog.push({ ...item, holderCount, peerId: peer.peerId || Object.keys(mp).find(k => mp[k] === peer) });
        }
      }
    }
    catalog.sort((a, b) => (b.holderCount * (b.accessCount || 1)) - (a.holderCount * (a.accessCount || 1)));
    setMeshCatalog(catalog);
  };

  const addRelay = () => {
    if (!relayUrl.trim()) {
      Alert.alert('Enter URL', 'Enter a relay node URL');
      return;
    }
    const name = deviceName.trim() || `Phone-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    MeshManager.connect(relayUrl.trim(), name);
    setRelayUrl('');
  };

  const removeRelay = (url) => {
    MeshManager.disconnectRelay(url);
  };

  const handleAutoSync = async () => {
    setSyncing(true);
    setSyncProgress('');
    try {
      const count = await MeshManager.autoSync();
      if (count === 0) {
        Alert.alert('All Synced!', 'You already have all available content.');
      }
    } catch (e) {
      Alert.alert('Sync Error', e.message);
    } finally {
      setSyncing(false);
    }
  };

  const downloadContent = (item) => {
    const mp = MeshManager.getMeshPeers();
    let targetPeerId = null;
    for (const [peerId, peer] of Object.entries(mp)) {
      if (peer.catalog.find((c) => c.hash === item.hash)) { targetPeerId = peerId; break; }
    }
    if (!targetPeerId) { Alert.alert('Error', 'No peer holds this content'); return; }
    setDownloading((prev) => ({ ...prev, [item.hash]: 0 }));
    MeshManager.requestContent(targetPeerId, item.hash);
  };

  const isConnected = connectedRelays.length > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🔗 Distributed Mesh</Text>
        <Text style={styles.headerSub}>Multi-relay • No single point of failure</Text>
      </View>

      {/* ── Device Name ─────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>YOUR DEVICE NAME</Text>
        <Text style={styles.cardHint}>This name identifies you across the mesh. Persisted across sessions.</Text>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={deviceName}
            onChangeText={saveDeviceName}
            placeholder="Enter your device name..."
            placeholderTextColor="#555"
          />
          <View style={styles.nameIcon}>
            <Ionicons name="phone-portrait-outline" size={20} color="#6c63ff" />
          </View>
        </View>
      </View>

      {/* ── Add Relay ──────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>ADD RELAY NODE</Text>
        <Text style={styles.cardHint}>Any laptop on the network can run a relay. Add as many as you want.</Text>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={relayUrl}
            onChangeText={setRelayUrl}
            placeholder="http://192.168.1.100:3001"
            placeholderTextColor="#555"
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.addBtn} onPress={addRelay}>
            <Ionicons name="add-circle" size={20} color="#fff" />
            <Text style={styles.addBtnText}>Join</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Connected Relays ───────────────────────────────── */}
      {connectedRelays.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>CONNECTED RELAYS ({connectedRelays.length})</Text>
          {connectedRelays.map((url) => (
            <View key={url} style={styles.relayRow}>
              <View style={styles.relayDot} />
              <Text style={styles.relayUrl} numberOfLines={1}>{url}</Text>
              <TouchableOpacity onPress={() => removeRelay(url)} style={styles.removeBtn}>
                <Ionicons name="close-circle" size={20} color="#ff4444" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* ── Mesh Stats ─────────────────────────────────────── */}
      {isConnected && (
        <View style={styles.statsRow}>
          <View style={styles.statChip}>
            <Ionicons name="radio-outline" size={16} color="#00ff88" />
            <Text style={styles.statText}>{connectedRelays.length} relay{connectedRelays.length > 1 ? 's' : ''}</Text>
          </View>
          <View style={styles.statChip}>
            <Ionicons name="phone-portrait-outline" size={16} color="#6c63ff" />
            <Text style={styles.statText}>{peers.length} peer{peers.length !== 1 ? 's' : ''}</Text>
          </View>
          <View style={styles.statChip}>
            <Ionicons name="document-outline" size={16} color="#00d2ff" />
            <Text style={styles.statText}>{meshCatalog.length} pages</Text>
          </View>
        </View>
      )}

      {/* ── Auto Sync ──────────────────────────────────────── */}
      {isConnected && meshCatalog.length > 0 && (
        <TouchableOpacity
          style={[styles.syncBtn, syncing && styles.syncBtnOff]}
          onPress={handleAutoSync}
          disabled={syncing}
        >
          {syncing ? (
            <><ActivityIndicator color="#fff" size="small" /><Text style={styles.syncText}>Syncing... {syncProgress}</Text></>
          ) : (
            <><Ionicons name="sync-outline" size={20} color="#fff" /><Text style={styles.syncText}>Auto Sync All ({meshCatalog.length} pages)</Text></>
          )}
        </TouchableOpacity>
      )}

      {/* ── Peers ──────────────────────────────────────────── */}
      {peers.length > 0 && (
        <>
          <Text style={styles.section}>Connected Devices</Text>
          {peers.map((p) => (
            <View key={p.peerId} style={styles.peerCard}>
              <View style={styles.peerAvatar}>
                <Ionicons name="phone-portrait-outline" size={20} color="#6c63ff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.peerName}>{p.deviceName}</Text>
                <Text style={styles.peerMeta}>{p.catalog?.length || 0} pages • via {p.relayUrl?.replace(/https?:\/\//, '').replace(':3001', '')}</Text>
              </View>
              <View style={[styles.dot, { backgroundColor: '#00ff88' }]} />
            </View>
          ))}
        </>
      )}

      {/* ── Catalog ────────────────────────────────────────── */}
      {meshCatalog.length > 0 && (
        <>
          <Text style={styles.section}>Available Content</Text>
          {meshCatalog.map((item) => {
            const dl = downloading[item.hash];
            return (
              <View key={item.hash} style={styles.catalogCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.catTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.catUrl} numberOfLines={1}>{item.url}</Text>
                  <View style={styles.catMeta}>
                    <Text style={styles.metaBadge}>
                      {item.holderCount > 1 ? `🔥 ${item.holderCount} devices` : '1 device'}
                    </Text>
                    <Text style={styles.metaSize}>{CacheManager.formatSize(item.size)}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.dlBtn, dl !== undefined && styles.dlBtnActive]}
                  onPress={() => downloadContent(item)}
                  disabled={dl !== undefined}
                >
                  {dl !== undefined ? (
                    <Text style={styles.dlProgress}>{dl}%</Text>
                  ) : (
                    <Ionicons name="cloud-download-outline" size={20} color="#fff" />
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
        </>
      )}

      {/* ── Empty States ───────────────────────────────────── */}
      {isConnected && meshCatalog.length === 0 && (
        <View style={styles.empty}>
          <Ionicons name="radio-outline" size={48} color="#333" />
          <Text style={styles.emptyTitle}>Waiting for peers...</Text>
          <Text style={styles.emptyHint}>Other devices need to connect to any relay node</Text>
        </View>
      )}
      {!isConnected && (
        <View style={styles.empty}>
          <Ionicons name="git-network-outline" size={48} color="#333" />
          <Text style={styles.emptyTitle}>No relays connected</Text>
          <Text style={styles.emptyHint}>Add a relay node URL above to join the mesh.{'\n'}Any laptop can run: node server/index.js</Text>
        </View>
      )}

      {/* ── Architecture Note ──────────────────────────────── */}
      <View style={styles.archCard}>
        <Text style={styles.archTitle}>⚡ Distributed Architecture</Text>
        <Text style={styles.archText}>
          • Connect to multiple relay nodes — no single point of failure{'\n'}
          • Catalogs propagate via gossip across all relays{'\n'}
          • Content routes to any available holder automatically{'\n'}
          • Any laptop running the relay extends the mesh
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d1a' },
  content: { paddingBottom: 100 },
  header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: '#1a1a2e' },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 12, color: '#6c63ff', marginTop: 2, fontWeight: '500' },
  card: { margin: 16, marginBottom: 8, backgroundColor: '#1a1a2e', borderRadius: 16, padding: 16 },
  cardLabel: { fontSize: 11, color: '#888', fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  cardHint: { fontSize: 12, color: '#555', marginBottom: 10 },
  row: { flexDirection: 'row', gap: 10 },
  input: { flex: 1, backgroundColor: '#0d0d1a', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: '#fff', fontSize: 14 },
  addBtn: { backgroundColor: '#6c63ff', borderRadius: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  nameIcon: { backgroundColor: '#6c63ff20', borderRadius: 10, width: 44, justifyContent: 'center', alignItems: 'center' },
  relayRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  relayDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#00ff88' },
  relayUrl: { flex: 1, color: '#ccc', fontSize: 13 },
  removeBtn: { padding: 4 },
  statsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  statChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, gap: 6 },
  statText: { color: '#ccc', fontSize: 12, fontWeight: '600' },
  syncBtn: { marginHorizontal: 16, backgroundColor: '#6c63ff', borderRadius: 12, padding: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 8 },
  syncBtnOff: { backgroundColor: '#444' },
  syncText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  section: { fontSize: 16, fontWeight: '700', color: '#fff', marginHorizontal: 16, marginTop: 16, marginBottom: 10 },
  peerCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', marginHorizontal: 16, borderRadius: 12, padding: 12, marginBottom: 8, gap: 12 },
  peerAvatar: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#6c63ff15', justifyContent: 'center', alignItems: 'center' },
  peerName: { fontSize: 14, fontWeight: '700', color: '#fff' },
  peerMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  catalogCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', marginHorizontal: 16, borderRadius: 12, padding: 12, marginBottom: 8, gap: 12 },
  catTitle: { fontSize: 13, fontWeight: '700', color: '#fff' },
  catUrl: { fontSize: 11, color: '#666', marginTop: 2 },
  catMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 },
  metaBadge: { fontSize: 11, color: '#ffa726', fontWeight: '600' },
  metaSize: { fontSize: 11, color: '#888' },
  dlBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#6c63ff', justifyContent: 'center', alignItems: 'center' },
  dlBtnActive: { backgroundColor: '#444' },
  dlProgress: { color: '#fff', fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', paddingTop: 50, gap: 8, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 16, color: '#555', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#444', textAlign: 'center' },
  archCard: { margin: 16, backgroundColor: '#1a1a2e', borderRadius: 16, padding: 16, borderLeftWidth: 3, borderLeftColor: '#6c63ff' },
  archTitle: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 8 },
  archText: { fontSize: 12, color: '#888', lineHeight: 20 },
});
