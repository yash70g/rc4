import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import Card from './Card';

const ListItem = ({ title, subtitle, icon, rightElement, onPress }) => {
  const { theme, spacing, typography } = useTheme();

  const Content = (
    <View style={styles.content}>
      {icon && (
        <View style={[styles.iconContainer, { backgroundColor: `${theme.primary}10` }]}>
          {React.cloneElement(icon, { color: theme.primary, size: 20 })}
        </View>
      )}
      <View style={styles.textContainer}>
        <Text style={[styles.title, { color: theme.textPrimary, fontSize: typography.body.fontSize }]}>
          {title}
        </Text>
        {subtitle && (
          <Text style={[styles.subtitle, { color: theme.textSecondary, fontSize: typography.bodySmall.fontSize }]}>
            {subtitle}
          </Text>
        )}
      </View>
      {rightElement}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.wrapper}>
        <Card noPadding style={styles.card}>
          {Content}
        </Card>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.wrapper}>
      <Card noPadding style={styles.card}>
        {Content}
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 12,
  },
  card: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontWeight: '600',
  },
  subtitle: {
    marginTop: 2,
  },
});

export default ListItem;
