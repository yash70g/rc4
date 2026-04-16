import React, { useState } from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import HomeScreen from '../screens/HomeScreen';
import BrowserScreen from '../screens/BrowserScreen';
import CacheScreen from '../screens/CacheScreen';
import SearchScreen from '../screens/SearchScreen';
import MeshScreen from '../screens/MeshScreen';
import MeshMapScreen from '../screens/MeshMapScreen';
import ViewerScreen from '../screens/ViewerScreen';

const TABS = [
  { key: 'Home', icon: 'home', iconOutline: 'home-outline', component: HomeScreen },
  { key: 'Browser', icon: 'globe', iconOutline: 'globe-outline', component: BrowserScreen },
  { key: 'Cache', icon: 'archive', iconOutline: 'archive-outline', component: CacheScreen },
  { key: 'Search', icon: 'search', iconOutline: 'search-outline', component: SearchScreen },
  { key: 'Mesh', icon: 'git-network', iconOutline: 'git-network-outline', component: MeshScreen },
  { key: 'Map', icon: 'map', iconOutline: 'map-outline', component: MeshMapScreen },
];

// Simple custom navigation context — no react-navigation needed
const NavigationContext = React.createContext();

export function useNavigation() {
  return React.useContext(NavigationContext);
}

export default function AppNavigator() {
  const [activeTab, setActiveTab] = useState('Home');
  const [viewerHash, setViewerHash] = useState(null);

  const navigation = {
    navigate: (screen, params) => {
      if (screen === 'Viewer' && params?.hash) {
        setViewerHash(params.hash);
      } else {
        setViewerHash(null);
        setActiveTab(screen);
      }
    },
    goBack: () => {
      setViewerHash(null);
    },
  };

  // If viewing a cached page, show ViewerScreen fullscreen
  if (viewerHash) {
    return (
      <NavigationContext.Provider value={navigation}>
        <ViewerScreen route={{ params: { hash: viewerHash } }} navigation={navigation} />
      </NavigationContext.Provider>
    );
  }

  const ActiveScreen = TABS.find((t) => t.key === activeTab)?.component || HomeScreen;

  return (
    <NavigationContext.Provider value={navigation}>
      <View style={styles.container}>
        <ActiveScreen navigation={navigation} />
        <View style={styles.tabBar}>
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={styles.tab}
                onPress={() => {
                  setActiveTab(tab.key);
                  setViewerHash(null);
                }}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={active ? tab.icon : tab.iconOutline}
                  size={22}
                  color={active ? '#6c63ff' : '#666'}
                />
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                  {tab.key}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </NavigationContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d1a' },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1a1a2e',
    borderTopWidth: 1,
    borderTopColor: '#ffffff10',
    height: 60,
    paddingBottom: 8,
    paddingTop: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#666',
    marginTop: 2,
  },
  tabLabelActive: {
    color: '#6c63ff',
  },
});
