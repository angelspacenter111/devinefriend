const User = require('../models/User');
const Call = require('../models/Call');
const Transaction = require('../models/Transaction');

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
    const calls = await Call.find({}).populate('user').sort({ date: -1 });
    res.render('admin/calls', {
      title: 'Call History Database - Friend Control',
      activeTab: 'calls',
      calls
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

exports.getCall = (req, res) => {
  res.render('admin/call', {
    title: 'Voice Call Console - Friend Control',
    activeTab: 'calls'
  });
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
