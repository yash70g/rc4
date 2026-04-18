import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import Card from '../components/Card';
import Button from '../components/Button';
import ListItem from '../components/ListItem';
import MeshManager from '../services/MeshManager';

export default function MeshScreen() {
  const { theme, spacing, typography, isDark } = useTheme();
  const [nearbyDevices, setNearbyDevices] = useState([]);
  const [connectedPeers, setConnectedPeers] = useState([]);
  const [catalogRows, setCatalogRows] = useState([]);
  const [downloadingHashes, setDownloadingHashes] = useState({});
  const [transferProgress, setTransferProgress] = useState({}); // hash -> { received, total }
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
    Object.entries(catalogs).forEach(([deviceId, entry]) => {
      const { deviceName, pages } = entry;
      const peerName = deviceName || `Peer-${deviceId.slice(0, 8)}`;

      pages.forEach((page) => {
        rows.push({
          key: `${deviceId}:${page.hash}`,
          deviceId,
          peerName,
          hash: page.hash,
          title: page.title,
          url: page.url,
          isPrivate: !!page.isPrivate,
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
      setTransferProgress((prev) => {
        const next = { ...prev };
        delete next[hash];
        return next;
      });
      Alert.alert('Page Received', `Downloaded "${title}" into local cache.`);
    };
    const onError = ({ message, hash }) => {
      if (hash) {
        setDownloadingHashes((prev) => {
          const next = { ...prev };
          delete next[hash];
          return next;
        });
        setTransferProgress((prev) => {
          const next = { ...prev };
          delete next[hash];
          return next;
        });
      }
      Alert.alert('Mesh Error', message);
    };
    const onWarning = ({ message }) => {
      setMeshWarning(message);
    };
    const onRadioState = (nextState) => {
      setRadioState(nextState);
    };
    const onPermissionPending = ({ hash }) => {
      setDownloadingHashes((prev) => ({ ...prev, [hash]: 'pending' }));
    };
    const onTransferProgress = ({ hash, received, total }) => {
      if (!hash) return;
      setTransferProgress((prev) => ({
        ...prev,
        [hash]: { received, total: total || prev[hash]?.total || 0 }
      }));
    };

    MeshManager.on('nearby-devices-update', onNearby);
    MeshManager.on('connected-peers-update', onConnected);
    MeshManager.on('catalog-update', onCatalog);
    MeshManager.on('page-received', onPageReceived);
    MeshManager.on('permission-pending', onPermissionPending);
    MeshManager.on('transfer-progress', onTransferProgress);
    MeshManager.on('error', onError);
    MeshManager.on('warning', onWarning);
    MeshManager.on('mesh-radio-state', onRadioState);

    refreshState();

    return () => {
      MeshManager.off('nearby-devices-update', onNearby);
      MeshManager.off('connected-peers-update', onConnected);
      MeshManager.off('catalog-update', onCatalog);
      MeshManager.off('page-received', onPageReceived);
      MeshManager.off('permission-pending', onPermissionPending);
      MeshManager.off('transfer-progress', onTransferProgress);
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
    const shortId = item.deviceId.replace('rc-node-', '').replace('ble-', '').slice(0, 8).toUpperCase();

    return (
      <ListItem
        title={item.deviceName}
        subtitle={`ID: ${shortId}`} // Removed page count subtitle
        icon={<FontAwesome name="mobile" />}
        rightElement={
          <Button
            variant={isConnected ? 'secondary' : 'primary'}
            title={isConnected ? 'Refresh' : 'Connect'}
            onPress={() => isConnected ? MeshManager.requestCatalog(item.deviceId) : handleConnect(item.deviceId)}
            style={styles.deviceButton}
            textStyle={styles.deviceButtonText}
          />
        }
      />
    );
  }

  const downloadState = downloadingHashes[item.hash];
  const progress = transferProgress[item.hash];
  const loading = downloadState === true;
  const pending = downloadState === 'pending';
  const displayUrl = item.url.length > 35 ? item.url.substring(0, 32) + '...' : item.url;

  let progressText = "";
  if (loading && progress && progress.total > 0) {
    const percent = Math.round((progress.received / progress.total) * 100);
    progressText = `${Math.min(percent, 99)}%`;
  }

  return (
    <ListItem
      title={item.title}
      subtitle={`${displayUrl}\nOwner: ${item.peerName}`} // Added Peer Name
      icon={<FontAwesome name={item.isPrivate ? "lock" : "file-text-o"} color={item.isPrivate ? theme.accent : null} />}
      rightElement={
        <View style={styles.downloadAction}>
          {loading && <Text style={[styles.progressText, { color: theme.primary }]}>{progressText}</Text>}
          <Button
            variant="ghost"
            title={pending ? "Waiting..." : ""}
            icon={loading ? <ActivityIndicator size="small" color={theme.primary} /> : (pending ? null : <FontAwesome name="download" size={20} color={theme.primary} />)}
            onPress={() => handleDownload(item)}
            disabled={loading || pending}
            textStyle={{ fontSize: 10, color: theme.textSecondary }}
            style={styles.downloadBtn}
          />
        </View>
      }
    />
  );
}

return (
  <View style={[styles.container, { backgroundColor: theme.background }]}>
    <View style={[styles.header, { paddingHorizontal: spacing.xl, marginBottom: spacing.m }]}>
      <Text style={[styles.title, { color: theme.textPrimary, fontSize: typography.headingL.fontSize }]}>
        Mesh Catalog
      </Text>
      <View style={styles.statusRow}>
        <View style={[styles.statusBadge, { backgroundColor: radioState.scanning ? `${theme.success}15` : theme.card }]}>
          <View style={[styles.statusDot, { backgroundColor: radioState.scanning ? theme.success : theme.textSecondary }]} />
          <Text style={[styles.statusText, { color: radioState.scanning ? theme.success : theme.textSecondary }]}>
            {radioState.scanning ? 'Scanning Radius' : 'Scanner Idle'}
          </Text>
        </View>
        <Text style={[styles.peerStats, { color: theme.textSecondary }]}>
          {nearbyDevices.length} Peers in Range
        </Text>
      </View>
    </View>

    <View style={[styles.controlsWrap, { marginHorizontal: spacing.xl, gap: spacing.s, marginBottom: spacing.l }]}>
      <Button
        variant="secondary"
        title={radioState.scanning ? 'Stop Scanning' : 'Start Scanning'}
        style={[styles.controlBtn, radioState.scanning && { borderColor: theme.success }]}
        onPress={() => MeshManager.setScanning(!radioState.scanning)}
      />
      <Button
        variant="secondary"
        title={radioState.advertising ? 'Broadcasting' : 'Start Broadcast'}
        style={[styles.controlBtn, radioState.advertising && { borderColor: theme.accent }]}
        onPress={() => MeshManager.setAdvertising(!radioState.advertising)}
      />
    </View>

    {meshWarning ? (
      <View style={[styles.warningBox, { marginHorizontal: spacing.xl, backgroundColor: isDark ? '#2D2A1E' : '#FFF9E6', borderColor: isDark ? '#5E5431' : '#FFEAB3', marginBottom: spacing.m }]}>
        <FontAwesome name="warning" size={16} color={isDark ? '#E6B800' : '#856404'} />
        <Text style={[styles.warningText, { color: isDark ? '#E6B800' : '#856404' }]}>{meshWarning}</Text>
      </View>
    ) : null}

    <FlatList
      data={catalogRows}
      renderItem={renderCatalogItem}
      keyExtractor={(item) => item.key}
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          {radioState.scanning ? (
            <>
              <ActivityIndicator size="large" color={theme.primary} style={{ marginBottom: spacing.m }} />
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                Seeking nearby websites...
              </Text>
            </>
          ) : (
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
              Start scanning to discover content
            </Text>
          )}
          <Text style={[styles.emptySubtext, { color: theme.textSecondary, marginTop: spacing.xs }]}>
            Websites shared by people within 10-20 meters will appear here.
          </Text>
        </View>
      }
      contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: 60 }}
    />
  </View>
);


const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
  },
  header: {
    marginBottom: 8,
  },
  title: {
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontWeight: '500',
    marginTop: 4,
  },
  controlsWrap: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  controlBtn: {
    flex: 1,
    height: 44,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
    gap: 8,
  },
  warningText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  deviceButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    height: 36,
  },
  deviceButtonText: {
    fontSize: 12,
  },
  catalogHeader: {
    marginTop: 16,
    marginBottom: 4,
  },
  catalogHeaderText: {
    fontWeight: '700',
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    borderStyle: 'dashed',
    borderWidth: 1.5,
  },
  emptyText: {
    textAlign: 'center',
    fontWeight: '600',
    fontSize: 16,
  },
  emptySubtext: {
    textAlign: 'center',
    fontSize: 12,
    opacity: 0.7,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  peerStats: {
    fontSize: 12,
    fontWeight: '500',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
    paddingHorizontal: 40,
  },
  downloadAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  downloadBtn: {
    minWidth: 40,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
});
