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
      <ListItem
        title={item.deviceName}
        subtitle={`${item.pageCount || 0} pages shared`}
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

  function renderCatalogItem({ item }) {
    const loading = !!downloadingHashes[item.hash];
    const displayUrl = item.url.length > 35 ? item.url.substring(0, 32) + '...' : item.url;
    return (
      <ListItem
        title={item.title}
        subtitle={`${displayUrl}\nPeer ${item.deviceId.slice(0, 8)}`}
        icon={<FontAwesome name="file-text-o" />}
        rightElement={
          <Button
            variant="ghost"
            title=""
            icon={loading ? <ActivityIndicator size="small" color={theme.primary} /> : <FontAwesome name="download" size={20} color={theme.primary} />}
            onPress={() => handleDownload(item)}
            disabled={loading}
          />
        }
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingHorizontal: spacing.xl, marginBottom: spacing.l }]}>
        <Text style={[styles.title, { color: theme.textPrimary, fontSize: typography.headingL.fontSize }]}>
          Nearby Devices
        </Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary, fontSize: typography.bodySmall.fontSize }]}>
          {nearbyDevices.length} nearby • {connectedPeers.length} connected
        </Text>
      </View>

      <View style={[styles.controlsWrap, { marginHorizontal: spacing.xl, gap: spacing.s }]}>
        <Button
          variant="secondary"
          title={radioState.scanning ? 'Scanning...' : 'Start Scan'}
          style={[styles.controlBtn, radioState.scanning && { backgroundColor: `${theme.success}15`, borderColor: theme.success, borderWidth: 1 }]}
          textStyle={radioState.scanning ? { color: theme.success } : null}
          onPress={() => MeshManager.setScanning(!radioState.scanning)}
        />
        <Button
          variant="secondary"
          title={radioState.advertising ? 'Advertising' : 'Start Adv'}
          style={[styles.controlBtn, radioState.advertising && { backgroundColor: `${theme.accent}15`, borderColor: theme.accent, borderWidth: 1 }]}
          textStyle={radioState.advertising ? { color: theme.accent } : null}
          onPress={() => MeshManager.setAdvertising(!radioState.advertising)}
        />
      </View>

      {meshWarning ? (
        <View style={[styles.warningBox, { marginHorizontal: spacing.xl, backgroundColor: isDark ? '#2D2A1E' : '#FFF9E6', borderColor: isDark ? '#5E5431' : '#FFEAB3' }]}>
           <FontAwesome name="warning" size={16} color={isDark ? '#E6B800' : '#856404'} />
           <Text style={[styles.warningText, { color: isDark ? '#E6B800' : '#856404' }]}>{meshWarning}</Text>
        </View>
      ) : null}

      <FlatList
        data={nearbyDevices}
        renderItem={renderDevice}
        keyExtractor={(item) => item.deviceId}
        ListEmptyComponent={<Text style={[styles.emptyText, { color: theme.textSecondary, marginTop: 40 }]}>Looking for nearby devices...</Text>}
        contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: 20 }}
      />

      <View style={[styles.catalogHeader, { paddingHorizontal: spacing.xl }]}>
        <Text style={[styles.catalogHeaderText, { color: theme.textPrimary, fontSize: typography.headingM.fontSize }]}>
          Peer Catalog
        </Text>
      </View>

      <FlatList
        data={catalogRows}
        renderItem={renderCatalogItem}
        keyExtractor={(item) => item.key}
        ListEmptyComponent={
          <Card style={styles.emptyCard}>
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>Connect to a device to see their available pages.</Text>
          </Card>
        }
        contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingTop: spacing.m, paddingBottom: 40 }}
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
    fontWeight: '500',
  },
});
