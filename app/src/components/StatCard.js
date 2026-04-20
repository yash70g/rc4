import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import Card from './Card';

const StatCard = ({ icon, value, label, color }) => {
  const { theme, spacing, typography } = useTheme();

  return (
    <Card style={styles.container}>
      <View style={[styles.iconContainer, { backgroundColor: `${color || theme.primary}15` }]}>
        {React.cloneElement(icon, { color: color || theme.primary, size: 20 })}
      </View>
      <Text style={[styles.value, { color: theme.textPrimary, fontSize: typography.headingM.fontSize }]}>
        {value}
      </Text>
      <Text style={[styles.label, { color: theme.textSecondary, fontSize: typography.caption.fontSize }]}>
        {label}
      </Text>
    </Card>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 110,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  value: {
    fontWeight: '700',
    marginBottom: 2,
  },
  label: {
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default StatCard;
