import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary caught error]', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleRestart = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <ScrollView contentContainerStyle={styles.scroll}>
            <Text style={styles.title}>⚠️ Application Error</Text>
            <Text style={styles.subtitle}>
              Something went wrong while loading the app. Please see details below:
            </Text>
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>
                {this.state.error ? this.state.error.toString() : 'Unknown Error'}
              </Text>
              {this.state.errorInfo?.componentStack && (
                <Text style={styles.stackText}>
                  {this.state.errorInfo.componentStack}
                </Text>
              )}
            </View>
            <TouchableOpacity style={styles.button} onPress={this.handleRestart}>
              <Text style={styles.buttonText}>Try Again</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0a17',
    padding: 24,
    justifyContent: 'center'
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ec4899',
    marginBottom: 8,
    textAlign: 'center'
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 16,
    textAlign: 'center'
  },
  errorBox: {
    backgroundColor: '#1e1b2e',
    borderColor: '#3730a3',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    width: '100%',
    marginBottom: 20
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    fontFamily: 'monospace',
    marginBottom: 8
  },
  stackText: {
    color: '#64748b',
    fontSize: 11,
    fontFamily: 'monospace'
  },
  button: {
    backgroundColor: '#8b5cf6',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 8
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14
  }
});

export default ErrorBoundary;
