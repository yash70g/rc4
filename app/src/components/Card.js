import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

const Card = ({ children, style, noPadding = false }) => {
  const { theme, spacing } = useTheme();

  return (
    <View style={[
      styles.card,
      {
        backgroundColor: theme.card,
        borderColor: theme.border,
        padding: noPadding ? 0 : spacing.l,
        shadowColor: theme.shadow,
      },
      style
    ]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 3, // for android
  },
});

export default Card;
