import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import adminService from '../../services/adminService';

const STATUS_FILTERS = ['All', 'Completed', 'Missed', 'Rejected'];

export const AdminCallsScreen = () => {
  const [calls, setCalls] = useState([]);
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const fetchCalls = async (pageNum = 1, append = false) => {
    try {
      if (pageNum === 1) setIsLoading(true);

      const params = {
        page: pageNum,
        limit: 20,
        status: selectedFilter !== 'All' ? selectedFilter : undefined,
        q: searchQuery.trim() || undefined
      };

      const res = await adminService.getCalls(params);
      if (res && res.data && res.data.calls) {
        if (append) {
          setCalls((prev) => [...prev, ...res.data.calls]);
        } else {
          setCalls(res.data.calls);
        }
        const pagination = res.data.pagination;
        setHasMore(pagination.page < pagination.totalPages);
      }
    } catch (err) {
      console.warn('[AdminCalls] Fetch error:', err.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    setPage(1);
    fetchCalls(1, false);
  }, [selectedFilter, searchQuery]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setPage(1);
    fetchCalls(1, false);
  };

  const renderCallItem = ({ item }) => {
    const isCompleted = item.status === 'Completed';

    return (
      <View style={styles.callCard}>
        <View style={styles.cardHeader}>
          <View style={styles.leftRow}>
            <View
              style={[
                styles.iconBubble,
                {
                  backgroundColor: isCompleted
                    ? 'rgba(16, 185, 129, 0.15)'
                    : 'rgba(239, 68, 68, 0.15)'
                }
              ]}
            >
              <Ionicons
                name={isCompleted ? 'call' : 'call-outline'}
                size={18}
                color={isCompleted ? '#10b981' : COLORS.danger}
              />
            </View>

            <View>
              <Text style={styles.callerName}>{item.user?.name || item.userName || 'Web User'}</Text>
              <Text style={styles.callIdText}>ID: {item.callId}</Text>
            </View>
          </View>

          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: isCompleted
                  ? 'rgba(16, 185, 129, 0.15)'
                  : 'rgba(239, 68, 68, 0.15)'
              }
            ]}
          >
            <Text
              style={[
                styles.statusText,
                { color: isCompleted ? '#10b981' : COLORS.danger }
              ]}
            >
              {item.status}
            </Text>
          </View>
        </View>

        <View style={styles.cardDivider} />

        <View style={styles.cardFooter}>
          <View style={styles.footerItem}>
            <Ionicons name="time-outline" size={14} color={COLORS.textSecondary} />
            <Text style={styles.footerLabel}>Duration: </Text>
            <Text style={styles.footerValue}>{item.duration || '00:00'}</Text>
          </View>

          <View style={styles.footerItem}>
            <Ionicons name="sparkles" size={13} color="#fbbf24" />
            <Text style={styles.footerLabel}>Credits: </Text>
            <Text style={[styles.footerValue, { color: '#fbbf24' }]}>
              {item.credits || 0}
            </Text>
          </View>

          <View style={styles.footerItem}>
            <Ionicons name="calendar-outline" size={14} color={COLORS.textSecondary} />
            <Text style={styles.footerDate}>
              {item.date ? new Date(item.date).toLocaleDateString() : ''}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Search Input Bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={COLORS.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by Call ID or Caller..."
          placeholderTextColor={COLORS.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Filter Chips */}
      <View style={styles.filterRow}>
        {STATUS_FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, selectedFilter === f && styles.filterChipActive]}
            onPress={() => setSelectedFilter(f)}
          >
            <Text
              style={[
                styles.filterChipText,
                selectedFilter === f && styles.filterChipTextActive
              ]}
            >
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={calls}
          keyExtractor={(item) => item._id || item.callId}
          renderItem={renderCallItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.secondary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="call-outline" size={40} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>No call logs found</Text>
              <Text style={styles.emptySub}>No calls match the selected filter.</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 8,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    gap: 10
  },
  searchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: 14
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  filterChipActive: {
    backgroundColor: COLORS.secondary,
    borderColor: COLORS.secondary
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary
  },
  filterChipTextActive: {
    color: '#fff',
    fontWeight: '700'
  },
  listContent: {
    padding: 16,
    paddingBottom: 40
  },
  callCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  iconBubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center'
  },
  callerName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text
  },
  callIdText: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700'
  },
  cardDivider: {
    height: 1,
    backgroundColor: COLORS.surfaceLight,
    marginVertical: 12
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  footerLabel: {
    fontSize: 11,
    color: COLORS.textSecondary
  },
  footerValue: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text
  },
  footerDate: {
    fontSize: 11,
    color: COLORS.textSecondary
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 12
  },
  emptySub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4
  }
});

export default AdminCallsScreen;
