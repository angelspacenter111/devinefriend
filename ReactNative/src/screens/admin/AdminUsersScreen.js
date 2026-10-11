import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import adminService from '../../services/adminService';

const STATUS_FILTERS = ['All', 'Active', 'Blocked'];

export const AdminUsersScreen = () => {
  const [users, setUsers] = useState([]);
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // Credit adjustment modal
  const [selectedUser, setSelectedUser] = useState(null);
  const [creditAmount, setCreditAmount] = useState('10');
  const [creditReason, setCreditReason] = useState('Support bonus');
  const [isUpdatingCredit, setIsUpdatingCredit] = useState(false);

  const fetchUsers = async (pageNum = 1, append = false) => {
    try {
      if (pageNum === 1) setIsLoading(true);

      const params = {
        page: pageNum,
        limit: 20,
        q: searchQuery.trim() || undefined,
        status: selectedFilter === 'Active' ? 'active' : selectedFilter === 'Blocked' ? 'blocked' : undefined
      };

      const res = await adminService.getUsers(params);
      if (res && res.data && res.data.users) {
        if (append) {
          setUsers((prev) => [...prev, ...res.data.users]);
        } else {
          setUsers(res.data.users);
        }
        const pagination = res.data.pagination;
        setHasMore(pagination.page < pagination.totalPages);
      }
    } catch (err) {
      console.warn('[AdminUsers] Fetch error:', err.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    setPage(1);
    fetchUsers(1, false);
  }, [selectedFilter, searchQuery]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setPage(1);
    fetchUsers(1, false);
  };

  const handleToggleBlock = async (user) => {
    const action = user.isBlocked ? 'Unblock' : 'Block';
    Alert.alert(
      `${action} User`,
      `Are you sure you want to ${action.toLowerCase()} ${user.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action,
          style: user.isBlocked ? 'default' : 'destructive',
          onPress: async () => {
            try {
              const res = await adminService.toggleUserBlock(user._id);
              Alert.alert('Success', res.message);
              setUsers((prev) =>
                prev.map((u) => (u._id === user._id ? { ...u, isBlocked: res.isBlocked } : u))
              );
            } catch (err) {
              Alert.alert('Error', err.message || 'Action failed.');
            }
          }
        }
      ]
    );
  };

  const handleSaveCredits = async () => {
    const amount = parseInt(creditAmount, 10);
    if (isNaN(amount) || amount === 0) {
      Alert.alert('Validation Error', 'Please enter a valid amount.');
      return;
    }

    try {
      setIsUpdatingCredit(true);
      const res = await adminService.updateUserCredits(selectedUser._id, amount, creditReason);
      Alert.alert('Success', `Updated balance: ${res.newBalance} credits.`);
      setUsers((prev) =>
        prev.map((u) => (u._id === selectedUser._id ? { ...u, credits: res.newBalance } : u))
      );
      setSelectedUser(null);
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to update credits.');
    } finally {
      setIsUpdatingCredit(false);
    }
  };

  const renderUserItem = ({ item }) => (
    <View style={styles.userCard}>
      <View style={styles.cardTop}>
        <View style={styles.userInfo}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitials}>
              {item.name ? item.name.charAt(0).toUpperCase() : 'U'}
            </Text>
          </View>
          <View>
            <Text style={styles.userName}>{item.name}</Text>
            <Text style={styles.userMobile}>+91 {item.mobile}</Text>
          </View>
        </View>

        <View
          style={[
            styles.statusPill,
            { backgroundColor: item.isBlocked ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)' }
          ]}
        >
          <Text
            style={[
              styles.statusPillText,
              { color: item.isBlocked ? COLORS.danger : COLORS.success }
            ]}
          >
            {item.isBlocked ? 'Blocked' : 'Active'}
          </Text>
        </View>
      </View>

      <View style={styles.cardDivider} />

      <View style={styles.cardBottom}>
        <View style={styles.creditInfo}>
          <Ionicons name="sparkles" size={15} color="#fbbf24" />
          <Text style={styles.creditsVal}>{item.credits ?? 0}</Text>
          <Text style={styles.creditsLabel}>Credits</Text>
        </View>

        <View style={styles.actionButtonsRow}>
          {/* Add Credits Button */}
          <TouchableOpacity
            style={styles.creditAdjustBtn}
            onPress={() => {
              setSelectedUser(item);
              setCreditAmount('10');
            }}
          >
            <Ionicons name="add" size={14} color="#fff" />
            <Text style={styles.btnActionText}>Credits</Text>
          </TouchableOpacity>

          {/* Block / Unblock Button */}
          <TouchableOpacity
            style={[
              styles.blockBtn,
              item.isBlocked ? styles.unblockBtnStyle : styles.blockBtnStyle
            ]}
            onPress={() => handleToggleBlock(item)}
          >
            <Ionicons
              name={item.isBlocked ? 'lock-open-outline' : 'lock-closed-outline'}
              size={13}
              color={item.isBlocked ? '#10b981' : COLORS.danger}
            />
            <Text
              style={[
                styles.blockBtnText,
                { color: item.isBlocked ? '#10b981' : COLORS.danger }
              ]}
            >
              {item.isBlocked ? 'Unblock' : 'Block'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Search Input Bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={COLORS.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search users by name or mobile..."
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
          data={users}
          keyExtractor={(item) => item._id}
          renderItem={renderUserItem}
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
              <Ionicons name="people-outline" size={40} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>No users found</Text>
              <Text style={styles.emptySub}>Try searching for a different name or number.</Text>
            </View>
          }
        />
      )}

      {/* Credit Adjustment Modal */}
      <Modal visible={!!selectedUser} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Adjust User Credits</Text>
            <Text style={styles.modalSub}>
              User: {selectedUser?.name} (+91 {selectedUser?.mobile})
            </Text>

            <Text style={styles.inputLabel}>Credit Amount (+ to add, - to deduct):</Text>
            <TextInput
              style={styles.modalInput}
              value={creditAmount}
              onChangeText={setCreditAmount}
              keyboardType="numbers-and-punctuation"
              placeholder="+25 or -10"
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={[styles.inputLabel, { marginTop: 12 }]}>Reason / Note:</Text>
            <TextInput
              style={styles.modalInput}
              value={creditReason}
              onChangeText={setCreditReason}
              placeholder="e.g. Compensation, promotional credit"
              placeholderTextColor={COLORS.textMuted}
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setSelectedUser(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveCredits}
                disabled={isUpdatingCredit}
              >
                {isUpdatingCredit ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalSaveText}>Update Balance</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  userCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.secondary
  },
  avatarInitials: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff'
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text
  },
  userMobile: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700'
  },
  cardDivider: {
    height: 1,
    backgroundColor: COLORS.surfaceLight,
    marginVertical: 12
  },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  creditInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  creditsVal: {
    fontSize: 15,
    fontWeight: '800',
    color: '#fbbf24'
  },
  creditsLabel: {
    fontSize: 12,
    color: COLORS.textSecondary
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 8
  },
  creditAdjustBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4
  },
  btnActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700'
  },
  blockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4
  },
  blockBtnStyle: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)'
  },
  unblockBtnStyle: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.3)'
  },
  blockBtnText: {
    fontSize: 12,
    fontWeight: '700'
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
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  modalCard: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 22,
    padding: 22,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4
  },
  modalSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 16
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6
  },
  modalInput: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 46,
    color: COLORS.text,
    fontSize: 14
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  modalCancelText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '600'
  },
  modalSaveBtn: {
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12
  },
  modalSaveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700'
  }
});

export default AdminUsersScreen;
