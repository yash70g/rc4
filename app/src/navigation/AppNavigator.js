import React, { useState } from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

import HomeScreen from '../screens/HomeScreen';
import BrowserScreen from '../screens/BrowserScreen';
import CacheScreen from '../screens/CacheScreen';
import SearchScreen from '../screens/SearchScreen';
import MeshScreen from '../screens/MeshScreen';
import MeshMapScreen from '../screens/MeshMapScreen';
import ViewerScreen from '../screens/ViewerScreen';

const TABS = [
  { key: 'Home', icon: 'home', component: HomeScreen },
  { key: 'Browser', icon: 'globe', component: BrowserScreen },
  { key: 'Cache', icon: 'briefcase', component: CacheScreen },
  { key: 'Search', icon: 'search', component: SearchScreen },
  { key: 'Mesh', icon: 'share-alt', component: MeshScreen },
  { key: 'Map', icon: 'map', component: MeshMapScreen },
];

const NavigationContext = React.createContext();

export function useNavigation() {
  return React.useContext(NavigationContext);
}

export default function AppNavigator() {
  const { theme, isDark } = useTheme();
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
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <ActiveScreen navigation={navigation} />
        <View style={[styles.tabBar, { backgroundColor: theme.card, borderTopColor: theme.border }]}>
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
                <FontAwesome
                  name={tab.icon}
                  size={20}
                  color={active ? theme.primary : theme.textSecondary}
                />
                <Text style={[
                  styles.tabLabel, 
                  { color: active ? theme.primary : theme.textSecondary },
                  active && styles.tabLabelActive
                ]}>
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
  container: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    height: 85,
    paddingBottom: 28,
    paddingTop: 12,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 4,
  },
  tabLabelActive: {
    // any additional active styling
  },
});
