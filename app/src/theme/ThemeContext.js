import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { light, dark } from './colors';
import { spacing } from './spacing';
import { typography } from './typography';

const ThemeContext = createContext({
  theme: light,
  spacing,
  typography,
  isDark: false,
  toggleTheme: () => {},
});

export const ThemeProvider = ({ children }) => {
  const colorScheme = useColorScheme();
  const [overrideMode, setOverrideMode] = useState(null); // 'light' or 'dark'
  const [isDark, setIsDark] = useState(colorScheme === 'dark');

  useEffect(() => {
    if (overrideMode) {
      setIsDark(overrideMode === 'dark');
    } else {
      setIsDark(colorScheme === 'dark');
    }
  }, [colorScheme, overrideMode]);

  const toggleTheme = () => {
    setOverrideMode((prev) => (prev === 'dark' || (prev === null && isDark)) ? 'light' : 'dark');
  };

  const theme = isDark ? dark : light;

  const value = {
    theme,
    spacing,
    typography,
    isDark,
    toggleTheme,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
