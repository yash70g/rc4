import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

const Button = ({
  onPress,
  title,
  variant = 'primary',
  style,
  textStyle,
  loading = false,
  disabled = false,
  icon,
}) => {
  const { theme, spacing, typography, isDark } = useTheme();

  const getVariantStyles = () => {
    switch (variant) {
      case 'secondary':
        return {
          backgroundColor: isDark ? '#2A2D3A' : '#F3F4F6',
          textColor: theme.textPrimary,
        };
      case 'ghost':
        return {
          backgroundColor: 'transparent',
          textColor: theme.primary,
          borderWidth: 0,
        };
      case 'primary':
      default:
        return {
          backgroundColor: theme.primary,
          textColor: '#FFFFFF',
        };
    }
  };

  const { backgroundColor, textColor, borderWidth = 0 } = getVariantStyles();

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      style={[
        styles.button,
        {
          backgroundColor,
          borderWidth,
          borderColor: theme.border,
          paddingVertical: spacing.m,
          paddingHorizontal: spacing.xl,
        },
        style,
        (disabled || loading) && { opacity: 0.5 }
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <>
          {icon}
          <Text style={[
            {
              color: textColor,
              fontSize: typography.bodySmall.fontSize,
              fontWeight: '600',
              marginLeft: icon ? spacing.s : 0,
            },
            textStyle
          ]}>
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default Button;
