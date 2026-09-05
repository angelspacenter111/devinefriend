const User = require('../models/User');
const Call = require('../models/Call');
const Transaction = require('../models/Transaction');
const callService = require('../services/callService');


// Helper to convert mm:ss to numerical minutes
const parseMins = (durationStr) => {
  if (!durationStr || !durationStr.includes(':')) return 0;
  const parts = durationStr.split(':');
  const minutes = parseInt(parts[0], 10) || 0;
  const seconds = parseInt(parts[1], 10) || 0;
  return minutes + (seconds / 60);
};

// Seed default admin account if not exists
const seedDefaultAdmin = async () => {
  try {
    const adminExists = await User.findOne({ email: 'admin@admin.com', role: 'admin' });
    if (!adminExists) {
      console.log('[Admin Setup] Seeding default admin account...');
      // Remove any duplicate placeholder admin mobile if needed
      await User.deleteOne({ mobile: '+91 00000 00000' });
      
      const defaultAdmin = new User({
        name: 'System Admin',
        email: 'admin@admin.com',
        mobile: '+91 00000 00000',
        password: 'Test@123', // Will be auto-hashed by mongoose pre-save hook
        role: 'admin',
        credits: 99999
      });
      await defaultAdmin.save();
      console.log('[Admin Setup] Default Admin account created successfully.');
      console.log('  Email: admin@admin.com');
      console.log('  Password: Test@123');
    }
  } catch (error) {
    console.error('[Admin Setup Error]', error);
  }
};
// Trigger check
seedDefaultAdmin();

exports.getLogin = async (req, res) => {
  // Double check admin seeded
  await seedDefaultAdmin();
  if (req.session && req.session.userId && req.session.role === 'admin') {
    return res.redirect('/admin/dashboard');
  }
  res.render('admin/login', {
    title: 'Admin Login - FriendControl',
    errorMessage: null
  });
};

// POST Admin Login
exports.postLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.render('admin/login', {
        title: 'Admin Login - FriendControl',
        errorMessage: 'Please enter all credentials.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const admin = await User.findOne({ email: cleanEmail, role: 'admin' });

    if (!admin) {
      return res.render('admin/login', {
        title: 'Admin Login - FriendControl',
        errorMessage: 'Unauthorized access or invalid credentials.'
      });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.render('admin/login', {
        title: 'Admin Login - FriendControl',
        errorMessage: 'Invalid email or password.'
      });
    }

    // Set Session
    req.session.userId = admin._id;
    req.session.role = admin.role;

    res.redirect('/admin/dashboard');
  } catch (error) {
    console.error('[Admin Login Error]', error);
    res.render('admin/login', {
      title: 'Admin Login - FriendControl',
      errorMessage: 'An error occurred. Please try again.'
    });
  }
};

exports.getDashboard = async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // 1. Today's stats
    const newUsersToday = await User.countDocuments({ role: 'user', joined: { $gte: startOfToday } });
    const callsToday = await Call.countDocuments({ date: { $gte: startOfToday } });
    
    const callsTodayList = await Call.find({ date: { $gte: startOfToday }, status: 'Completed' });
    const minsToday = callsTodayList.reduce((acc, c) => acc + parseMins(c.duration), 0);
    const minsTodayRounded = Math.round(minsToday);

    const txnsTodayList = await Transaction.find({ date: { $gte: startOfToday }, type: 'credit', status: 'Successful' });
    const creditsToday = txnsTodayList.reduce((acc, t) => acc + t.credits, 0);

    // 2. Cumulative Stats
    const totalUsers = await User.countDocuments({ role: 'user' });
    const totalCalls = await Call.countDocuments({});
    
    const completedCalls = await Call.find({ status: 'Completed' });
    const totalMins = completedCalls.reduce((acc, c) => acc + parseMins(c.duration), 0);
    const totalMinsRounded = Math.round(totalMins);

    const recharges = await Transaction.find({ type: 'credit', status: 'Successful' });
    const totalRevenue = recharges.reduce((acc, t) => {
      const val = parseInt(t.amount.replace(/[^0-9]/g, ''), 10) || 0;
      return acc + val;
    }, 0);

    // 3. Recent 5 users, recent 5 calls
    const recentUsers = await User.find({ role: 'user' }).sort({ joined: -1 }).limit(5);
    const recentCalls = await Call.find({}).populate('user').sort({ date: -1 }).limit(5);

    res.render('admin/dashboard', {
      title: 'Admin Dashboard - Friend Control',
      activeTab: 'dashboard',
      stats: {
        newUsersToday,
        callsToday,
        minsToday: minsTodayRounded,
        creditsToday,
        totalUsers,
        totalCalls,
        totalMins: totalMinsRounded,
        totalRevenue
      },
      recentUsers,
      recentCalls
    });
  } catch (error) {
    console.error('[Admin Dashboard Error]', error);
    res.status(500).send('Server Error');
  }
};

exports.getUsers = async (req, res) => {
  try {
    // Get all users
    const users = await User.find({ role: 'user' }).sort({ joined: -1 });
    
    // We can also calculate total calls for each user to populate table
    const usersWithCalls = await Promise.all(users.map(async (user) => {
      const callCount = await Call.countDocuments({ user: user._id });
      return {
        ...user.toObject(),
        callCount
      };
    }));

    res.render('admin/users', {
      title: 'User Directory - Friend Control',
      activeTab: 'users',
      users: usersWithCalls
    });
  } catch (error) {
    console.error('[Admin Users Error]', error);
    res.status(500).send('Server Error');
  }
};

exports.getCalls = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 15;
    const skip = (page - 1) * limit;

    const { status, q } = req.query;
    const filter = {};

    if (status && status !== 'All' && status !== 'All Statuses') {
      filter.status = status;
    }

    if (q && q.trim() !== '') {
      const searchRegex = new RegExp(q.trim(), 'i');
      const matchingUsers = await User.find({
        $or: [{ name: searchRegex }, { mobile: searchRegex }]
      }).select('_id');
      const userIds = matchingUsers.map(u => u._id);

      filter.$or = [
        { callId: searchRegex },
        { user: { $in: userIds } }
      ];
    }

    const totalCalls = await Call.countDocuments(filter);
    const totalPages = Math.ceil(totalCalls / limit) || 1;

    const calls = await Call.find(filter)
      .populate('user')
      .populate('admin')
      .populate('transaction')
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.render('admin/calls', {
      title: 'Call History Database - Friend Control',
      activeTab: 'calls',
      calls,
      currentPage: page,
      totalPages,
      totalCalls,
      selectedStatus: status || 'All',
      searchQuery: q || ''
    });
  } catch (error) {
    console.error('[Admin Calls Error]', error);
    res.status(500).send('Server Error');
  }
};


exports.getTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({}).populate('user').sort({ date: -1 });
    res.render('admin/transactions', {
      title: 'Transaction Audits - Friend Control',
      activeTab: 'transactions',
      transactions
    });
  } catch (error) {
    console.error('[Admin Transactions Error]', error);
    res.status(500).send('Server Error');
  }
};

exports.getCredits = async (req, res) => {
  try {
    const transactions = await Transaction.find({ type: 'credit' }).populate('user').sort({ date: -1 });
    
    const allCreditTxns = await Transaction.find({ type: 'credit', status: 'Successful' });
    const totalCreditsSold = allCreditTxns.reduce((acc, t) => acc + t.credits, 0);
    
    const allDebitTxns = await Transaction.find({ type: 'debit', status: 'Completed' });
    const totalCreditsUsed = allDebitTxns.reduce((acc, t) => acc + t.credits, 0);
    
    const users = await User.find({ role: 'user' });
    const creditsInCirculation = users.reduce((acc, u) => acc + u.credits, 0);
    
    const totalRevenue = allCreditTxns.reduce((acc, t) => {
      const val = parseInt(t.amount.replace(/[^0-9]/g, ''), 10) || 0;
      return acc + val;
    }, 0);
    
    const completedCalls = await Call.find({ status: 'Completed' });
    const totalCallMins = completedCalls.reduce((acc, c) => acc + parseMins(c.duration), 0);
    const avgSessionLength = completedCalls.length > 0 ? (totalCallMins / completedCalls.length).toFixed(1) : 0;
    
    res.render('admin/credits', {
      title: 'Credit Audits - Friend Control',
      activeTab: 'credits',
      transactions,
      stats: {
        totalCreditsSold,
        totalCreditsUsed,
        creditsInCirculation,
        totalRevenue,
        avgSessionLength
      }
    });
  } catch (error) {
    console.error('[Admin Credits Error]', error);
    res.status(500).send('Server Error');
  }
};

exports.getPricing = (req, res) => {
  res.render('admin/pricing', {
    title: 'Manage Pricing Plans - Friend Control',
    activeTab: 'pricing'
  });
};

exports.getReports = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: 'user' });
    const activeCalls = await Call.countDocuments({ status: 'Completed' });
    const missedCalls = await Call.countDocuments({ status: { $in: ['Missed', 'Failed'] } });
    
    const allCreditTxns = await Transaction.find({ type: 'credit', status: 'Successful' });
    const totalRevenue = allCreditTxns.reduce((acc, t) => {
      const val = parseInt(t.amount.replace(/[^0-9]/g, ''), 10) || 0;
      return acc + val;
    }, 0);
    
    // Group recharges by unique dates (YYYY-MM-DD)
    const uniqueRechargeDays = await Transaction.distinct('date', { type: 'credit', status: 'Successful' });
    const avgDailyRevenue = uniqueRechargeDays.length > 0 ? Math.round(totalRevenue / uniqueRechargeDays.length) : 0;
    
    const usersWithCalls = await Call.distinct('user');
    const activeCallersRatio = totalUsers > 0 ? ((usersWithCalls.length / totalUsers) * 100).toFixed(1) : 0;
    
    res.render('admin/reports', {
      title: 'Platform Reports & Analytics - Friend Control',
      activeTab: 'reports',
      metrics: {
        totalUsers,
        activeCalls,
        missedCalls,
        avgDailyRevenue,
        activeCallersRatio
      }
    });
  } catch (error) {
    console.error('[Admin Reports Error]', error);
    res.status(500).send('Server Error');
  }
};

exports.getSettings = (req, res) => {
  res.render('admin/settings', {
    title: 'Platform Settings - Friend Control',
    activeTab: 'settings'
  });
};

exports.getCall = async (req, res) => {
  const callId = req.query.callId;
  if (!callId) {
    return res.redirect('/admin/dashboard');
  }
  let callerName = 'Calling Client';
  try {
    const callRecord = await Call.findOne({ callId }).populate('user');
    if (callRecord && callRecord.user && callRecord.user.name) {
      callerName = callRecord.user.name;
    } else if (callRecord && callRecord.callerName) {
      callerName = callRecord.callerName;
    }
  } catch (err) {
    console.warn('[Admin Call] Error fetching caller name:', err);
  }

  res.render('admin/call', {
    title: 'Voice Call Console - Friend Control',
    activeTab: 'calls',
    callId: callId,
    callerName: callerName,
    user: req.user
  });
};

// AJAX endpoint for Admin to finalize call and deduct credits
exports.postEndCall = async (req, res) => {
  try {
    const { callId, status } = req.body;
    if (!callId) {
      return res.status(400).json({ success: false, message: 'callId is required.' });
    }

    const checkCall = await Call.findOne({ callId });
    if (!checkCall) {
      return res.status(404).json({ success: false, message: 'Call not found.' });
    }

    const result = await callService.finalizeCall(callId, { reason: status || 'Completed' });

    return res.json({
      status: true,
      success: true,
      message: 'Call finalized successfully.',
      data: {
        call_id: result.call.callId,
        duration: result.call.duration,
        durationSeconds: result.call.durationSeconds,
        credits_used: result.creditsDeducted,
        credit_status: result.call.creditStatus,
        status: result.call.status,
        remaining_credits: result.remainingCredits
      }
    });
  } catch (error) {
    console.error('[Admin End Call Error]', error);
    return res.status(500).json({ status: false, success: false, message: 'Server error saving call log.' });
  }
};

// GET Call Details by Call ID for Admin Inspection Modal
exports.getCallDetails = async (req, res) => {
  try {
    const { callId } = req.params;
    const call = await Call.findOne({ callId })
      .populate('user')
      .populate('admin')
      .populate('transaction');

    if (!call) {
      return res.status(404).json({ success: false, message: 'Call not found.' });
    }

    return res.json({
      success: true,
      data: {
        callId: call.callId,
        user: {
          name: call.user ? call.user.name : 'N/A',
          mobile: call.user ? call.user.mobile : 'N/A',
          id: call.user ? call.user._id : 'N/A'
        },
        admin: {
          name: call.admin ? call.admin.name : (call.receiverName || 'System Admin'),
          id: call.admin ? call.admin._id : 'N/A'
        },
        callType: call.callType || 'Voice',
        status: call.status,
        date: call.date ? call.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
        time: call.time,
        startTime: call.startTime ? new Date(call.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : (call.time || 'N/A'),
        connectedTime: call.connectedTime ? new Date(call.connectedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Not Connected',
        endTime: call.endTime ? new Date(call.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'N/A',
        duration: call.duration || '00:00',
        durationSeconds: call.durationSeconds || 0,
        creditRate: call.creditRate || 1,
        credits: call.credits || 0,
        creditStatus: call.creditStatus || 'none',
        transactionId: call.transaction ? call.transaction.txnId : 'None'
      }
    });
  } catch (error) {
    console.error('[Admin Call Details Error]', error);
    return res.status(500).json({ success: false, message: 'Server error loading call details.' });
  }
};

// POST End Call from Admin side
exports.postEndCall = async (req, res) => {
  try {
    const { callId, status } = req.body;
    if (!callId) {
      return res.status(400).json({ success: false, message: 'callId is required.' });
    }
    const result = await callService.finalizeCall(callId, { reason: status || 'Completed' });
    return res.json({
      status: true,
      success: true,
      message: 'Call finalized successfully by admin.',
      data: result
    });
  } catch (error) {
    console.error('[Admin End Call Error]', error);
    return res.status(500).json({ success: false, message: 'Server error ending call.' });
  }
};


// POST Block / Unblock User
exports.postToggleBlock = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    user.isBlocked = !user.isBlocked;
    await user.save();

    return res.json({
      success: true,
      message: `User is now ${user.isBlocked ? 'Blocked' : 'Active'}.`,
      isBlocked: user.isBlocked
    });
  } catch (error) {
    console.error('[Admin User Block Error]', error);
    return res.status(500).json({ success: false, message: 'Server error toggle block.' });
  }
};

// POST Update User Credits
exports.postUpdateCredits = async (req, res) => {
  try {
    const { id } = req.params;
    const { credits } = req.body;

    if (credits === undefined || isNaN(credits)) {
      return res.status(400).json({ success: false, message: 'Invalid credits amount.' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const oldCredits = user.credits;
    const cleanCredits = parseInt(credits, 10);
    
    // Set credits directly
    user.credits = cleanCredits;
    await user.save();

    // Log admin adjustment transaction
    const diff = cleanCredits - oldCredits;
    if (diff !== 0) {
      const adjustmentTxn = new Transaction({
        txnId: "TXN-" + Math.floor(1000 + Math.random() * 9000) + Math.floor(10 + Math.random() * 90),
        user: user._id,
        desc: `Admin Adjustment (${diff > 0 ? '+' : ''}${diff} Credits)`,
        type: diff > 0 ? 'credit' : 'debit',
        credits: Math.abs(diff),
        amount: "₹0",
        status: 'Successful'
      });
      await adjustmentTxn.save();
    }

    return res.json({
      success: true,
      message: `User credits balance updated to ${cleanCredits}.`,
      credits: user.credits
    });
  } catch (error) {
    console.error('[Admin User Credits Update Error]', error);
    return res.status(500).json({ success: false, message: 'Server error updating credits.' });
  }
};

// GET Admin session logout
exports.logout = (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        console.error('[Admin Logout Session Destruction Error]', err);
      }
      res.redirect('/admin/login');
    });
  } else {
    res.redirect('/admin/login');
  }
};
