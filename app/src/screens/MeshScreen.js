import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MeshManager from '../services/MeshManager';

export default function MeshScreen() {
  const [nearbyDevices, setNearbyDevices] = useState([]);
  const [connectedPeers, setConnectedPeers] = useState([]);
  const [catalogRows, setCatalogRows] = useState([]);
  const [downloadingHashes, setDownloadingHashes] = useState({});
  const [radioState, setRadioState] = useState({ scanning: false, advertising: false });
  const [meshWarning, setMeshWarning] = useState('');

  const connectedDeviceSet = useMemo(() => {
    return new Set(connectedPeers.map((peer) => peer.deviceId));
  }, [connectedPeers]);

  const refreshState = useCallback(() => {
    const nearby = MeshManager.getNearbyDevices();
    const connected = MeshManager.getConnectedPeers();
    const catalogs = MeshManager.getPeerCatalogs();

    setNearbyDevices(nearby);
    setConnectedPeers(connected);

    const rows = [];
    Object.entries(catalogs).forEach(([deviceId, pages]) => {
      pages.forEach((page) => {
        rows.push({
          key: `${deviceId}:${page.hash}`,
          deviceId,
          hash: page.hash,
          title: page.title,
          url: page.url,
        });
      });
    });

    setCatalogRows(rows);
    setRadioState(MeshManager.getRadioState());
  }, []);

  useEffect(() => {
    const onNearby = () => refreshState();
    const onConnected = () => refreshState();
    const onCatalog = () => refreshState();
    const onPageReceived = ({ hash, title }) => {
      setDownloadingHashes((prev) => {
        const next = { ...prev };
        delete next[hash];
        return next;
      });
      Alert.alert('Page Received', `Downloaded "${title}" into local cache.`);
    };
    const onError = ({ message }) => {
      Alert.alert('Mesh Error', message);
    };
    const onWarning = ({ message }) => {
      setMeshWarning(message);
    };
    const onRadioState = (nextState) => {
      setRadioState(nextState);
    };

    MeshManager.on('nearby-devices-update', onNearby);
    MeshManager.on('connected-peers-update', onConnected);
    MeshManager.on('catalog-update', onCatalog);
    MeshManager.on('page-received', onPageReceived);
    MeshManager.on('error', onError);
    MeshManager.on('warning', onWarning);
    MeshManager.on('mesh-radio-state', onRadioState);

    refreshState();

    return () => {
      MeshManager.off('nearby-devices-update', onNearby);
      MeshManager.off('connected-peers-update', onConnected);
      MeshManager.off('catalog-update', onCatalog);
      MeshManager.off('page-received', onPageReceived);
      MeshManager.off('error', onError);
      MeshManager.off('warning', onWarning);
      MeshManager.off('mesh-radio-state', onRadioState);
    };
  }, [refreshState]);

  async function handleConnect(deviceId) {
    await MeshManager.connectToDevice(deviceId);
    MeshManager.requestCatalog(deviceId);
  }

  function handleDownload(item) {
    setDownloadingHashes((prev) => ({ ...prev, [item.hash]: true }));
    const ok = MeshManager.requestPage(item.deviceId, item.hash);
    if (!ok) {
      setDownloadingHashes((prev) => {
        const next = { ...prev };
        delete next[item.hash];
        return next;
      });
      Alert.alert('Request Failed', 'Could not request page from the selected peer.');
    }
  }

  function renderDevice({ item }) {
    const isConnected = connectedDeviceSet.has(item.deviceId);
    return (
      <View style={styles.deviceCard}>
        <Ionicons name="phone-portrait-outline" size={30} color="#fff" />
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName}>{item.deviceName}</Text>
          <Text style={styles.deviceMeta}>{item.pageCount || 0} pages shared</Text>
        </View>

        {isConnected ? (
          <TouchableOpacity style={[styles.actionBtn, styles.secondaryBtn]} onPress={() => MeshManager.requestCatalog(item.deviceId)}>
            <Text style={styles.actionText}>View Catalog</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.actionBtn} onPress={() => handleConnect(item.deviceId)}>
            <Text style={styles.actionText}>Connect</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  async function toggleScanning() {
    await MeshManager.setScanning(!radioState.scanning);
  }

  async function toggleAdvertising() {
    await MeshManager.setAdvertising(!radioState.advertising);
  }

  async function restartMesh() {
    await MeshManager.restartMesh();
  }

  function renderCatalogItem({ item }) {
    const loading = !!downloadingHashes[item.hash];
    return (
      <View style={styles.catalogItem}>
        <View style={{ flex: 1 }}>
          <Text style={styles.catalogTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.catalogSub} numberOfLines={1}>{item.url}</Text>
          <Text style={styles.catalogSub}>Peer {item.deviceId.slice(0, 8)}</Text>
        </View>
        <TouchableOpacity style={styles.downloadBtn} onPress={() => handleDownload(item)} disabled={loading}>
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="cloud-download-outline" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Nearby Devices</Text>
        <Text style={styles.subtitle}>{nearbyDevices.length} nearby • {connectedPeers.length} connected</Text>
      </View>

      <View style={styles.controlsWrap}>
        <TouchableOpacity
          style={[styles.controlBtn, radioState.scanning ? styles.controlBtnOn : styles.controlBtnOff]}
          onPress={toggleScanning}
        >
          <Text style={styles.controlBtnText}>{radioState.scanning ? 'Stop Scan' : 'Start Scan'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlBtn, radioState.advertising ? styles.controlBtnOn : styles.controlBtnOff]}
          onPress={toggleAdvertising}
        >
          <Text style={styles.controlBtnText}>{radioState.advertising ? 'Stop Advertise' : 'Start Advertise'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.controlBtn, styles.controlBtnNeutral]} onPress={restartMesh}>
          <Text style={styles.controlBtnText}>Restart Mesh</Text>
        </TouchableOpacity>
      </View>

      {meshWarning ? <Text style={styles.warningText}>{meshWarning}</Text> : null}

      <FlatList
        data={nearbyDevices}
        renderItem={renderDevice}
        keyExtractor={(item) => item.deviceId}
        ListEmptyComponent={<Text style={styles.emptyText}>No nearby devices detected yet.</Text>}
        contentContainerStyle={{ paddingBottom: 10 }}
      />

      <View style={styles.catalogHeader}>
        <Text style={styles.catalogHeaderText}>Peer Catalog</Text>
      </View>

      <FlatList
        data={catalogRows}
        renderItem={renderCatalogItem}
        keyExtractor={(item) => item.key}
        ListEmptyComponent={<Text style={styles.emptyText}>Connect to a device and request catalog.</Text>}
        contentContainerStyle={{ paddingBottom: 18 }}
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
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    color: '#8b8b9d',
    marginTop: 4,
  },
  controlsWrap: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 10,
    gap: 8,
  },
  controlBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  controlBtnOn: {
    backgroundColor: '#00a86b',
  },
  controlBtnOff: {
    backgroundColor: '#4d4d5f',
  },
  controlBtnNeutral: {
    backgroundColor: '#6c63ff',
  },
  controlBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  warningText: {
    marginHorizontal: 20,
    marginBottom: 10,
    color: '#ffd166',
    fontSize: 12,
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 10,
    padding: 14,
  },
  deviceInfo: {
    flex: 1,
    marginLeft: 12,
  },
  deviceName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  deviceMeta: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  actionBtn: {
    backgroundColor: '#6c63ff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  secondaryBtn: {
    backgroundColor: '#00a8cc',
  },
  actionText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  catalogHeader: {
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 8,
  },
  catalogHeaderText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  catalogItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  catalogTitle: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  catalogSub: {
    color: '#888',
    fontSize: 11,
    marginTop: 2,
  },
  downloadBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#6c63ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#888',
    textAlign: 'center',
    marginVertical: 20,
  },
});
