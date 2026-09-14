const mongoose = require('mongoose');
const User = require('../models/User');
const Call = require('../models/Call');
const Transaction = require('../models/Transaction');
const PricingPlan = require('../models/PricingPlan');
const callService = require('../services/callService');

// Helper to safely escape regex characters
const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Default pricing plans seed configuration
const defaultPlans = [
  { planId: 'PLAN-5501', name: 'Starter Pack', badge: 'Starter', credits: 5, price: 149, description: 'Quick initial check-in or brief conversation.', order: 1, isPopular: false, isActive: true },
  { planId: 'PLAN-5502', name: 'Bridge Pack', badge: 'Bridge', credits: 10, price: 299, description: 'Talk through an immediate worry or stressor.', order: 2, isPopular: false, isActive: true },
  { planId: 'PLAN-5503', name: 'Comfort Pack', badge: 'Comfort', credits: 25, price: 599, description: 'Ample time to speak calmly, reflect and breathe.', order: 3, isPopular: true, isActive: true },
  { planId: 'PLAN-5504', name: 'Deep Listen', badge: 'Deep Listen', credits: 50, price: 1199, description: 'Ideal for multiple in-depth conversation sessions.', order: 4, isPopular: false, isActive: true },
  { planId: 'PLAN-5505', name: 'Best Value', badge: 'Best Value', credits: 100, price: 2199, description: 'Maximum savings for regular check-in support.', order: 5, isPopular: false, isActive: true }
];

const getOrSeedPricingPlans = async () => {
  try {
    const count = await PricingPlan.countDocuments({});
    if (count === 0) {
      console.log('[Pricing Setup] Seeding default pricing plans...');
      await PricingPlan.insertMany(defaultPlans);
    }
    return await PricingPlan.find({}).sort({ order: 1, credits: 1 });
  } catch (err) {
    console.error('[Pricing Setup Error]', err);
    return defaultPlans;
  }
};
exports.getOrSeedPricingPlans = getOrSeedPricingPlans;


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
    req.session.save((err) => {
      if (err) console.error('[Admin Login Session Save Error]', err);
      res.redirect('/admin/dashboard');
    });
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
    const newUsersToday = (await User.countDocuments({ role: 'user', joined: { $gte: startOfToday } })) || 0;
    const callsToday = (await Call.countDocuments({ date: { $gte: startOfToday } })) || 0;
    
    const callsTodayList = (await Call.find({ date: { $gte: startOfToday }, status: 'Completed' }).populate('user')) || [];
    const minsToday = callsTodayList.reduce((acc, c) => acc + parseMins(c.duration), 0);
    const minsTodayRounded = Math.round(minsToday) || 0;
    const creditsUsedToday = callsTodayList.reduce((acc, c) => acc + (c.credits || 0), 0);

    const txnsTodayList = (await Transaction.find({ date: { $gte: startOfToday }, type: 'credit', status: { $in: ['Successful', 'Completed'] } })) || [];
    const creditsBoughtToday = txnsTodayList.reduce((acc, t) => acc + ((t && t.credits) || 0), 0);
    const todayRevenue = txnsTodayList.reduce((acc, t) => {
      const val = parseInt(((t && t.amount) || '').replace(/[^0-9]/g, ''), 10) || 0;
      return acc + val;
    }, 0);

    // User-wise credit usage today (konsa user ne kitne credits use kiye)
    const userUsageMap = {};
    callsTodayList.forEach(call => {
      const u = call.user;
      const uid = u ? (u._id ? u._id.toString() : u.toString()) : (call.callerName || 'Unknown');
      const uName = u && u.name ? u.name : (call.callerName || 'Client');
      const uMobile = u && u.mobile ? u.mobile : '';
      if (!userUsageMap[uid]) {
        userUsageMap[uid] = {
          userId: uid,
          name: uName,
          mobile: uMobile,
          creditsUsed: 0,
          callsCount: 0,
          totalDurationMins: 0
        };
      }
      userUsageMap[uid].creditsUsed += (call.credits || 0);
      userUsageMap[uid].callsCount += 1;
      userUsageMap[uid].totalDurationMins += Math.round(parseMins(call.duration));
    });
    const todayUserUsageList = Object.values(userUsageMap).sort((a, b) => b.creditsUsed - a.creditsUsed);

    // 2. Cumulative Stats
    const totalUsers = (await User.countDocuments({ role: 'user' })) || 0;
    const totalCalls = (await Call.countDocuments({})) || 0;
    
    const completedCalls = (await Call.find({ status: 'Completed' })) || [];
    const totalMins = completedCalls.reduce((acc, c) => acc + parseMins(c.duration), 0);
    const totalMinsRounded = Math.round(totalMins) || 0;
    const totalCreditsUsed = completedCalls.reduce((acc, c) => acc + (c.credits || 0), 0);

    const recharges = (await Transaction.find({ type: 'credit', status: { $in: ['Successful', 'Completed'] } })) || [];
    const totalRevenue = recharges.reduce((acc, t) => {
      const val = parseInt(((t && t.amount) || '').replace(/[^0-9]/g, ''), 10) || 0;
      return acc + val;
    }, 0);

    // 3. Recent 5 users, recent 5 calls
    const recentUsers = (await User.find({ role: 'user' }).sort({ joined: -1 }).limit(5)) || [];
    const recentCalls = (await Call.find({}).populate('user').sort({ date: -1 }).limit(5)) || [];

    res.render('admin/dashboard', {
      title: 'Life Advisor Console - Friend Control',
      activeTab: 'dashboard',
      stats: {
        newUsersToday,
        callsToday,
        minsToday: minsTodayRounded,
        creditsToday: creditsBoughtToday,
        creditsUsedToday,
        todayRevenue,
        todayRechargesCount: txnsTodayList.length || 0,
        totalUsers,
        totalCalls,
        totalMins: totalMinsRounded,
        totalRevenue,
        totalCreditsUsed
      },
      todayUserUsageList,
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
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 15;
    const skip = (page - 1) * limit;

    const { q, status, sortBy } = req.query;
    const conditions = [{ role: 'user' }];

    // 1. Search Query (Name, Mobile, or User ID)
    const searchQuery = (q || '').trim();
    if (searchQuery !== '') {
      const safeSearch = escapeRegex(searchQuery);
      const searchRegex = new RegExp(safeSearch, 'i');
      
      const searchOr = [
        { name: searchRegex },
        { mobile: searchRegex }
      ];

      if (mongoose.Types.ObjectId.isValid(searchQuery)) {
        searchOr.push({ _id: new mongoose.Types.ObjectId(searchQuery) });
      }

      conditions.push({ $or: searchOr });
    }

    // 2. Status Filter
    if (status === 'active') {
      conditions.push({ isBlocked: false });
    } else if (status === 'suspended' || status === 'blocked') {
      conditions.push({ isBlocked: true });
    }

    const filter = conditions.length > 0 ? { $and: conditions } : { role: 'user' };

    // 3. Sorting
    let sortOption = { joined: -1 };
    if (sortBy === 'oldest') {
      sortOption = { joined: 1 };
    } else if (sortBy === 'credits_high') {
      sortOption = { credits: -1 };
    } else if (sortBy === 'credits_low') {
      sortOption = { credits: 1 };
    }

    const totalUsers = await User.countDocuments(filter);
    const totalPages = Math.ceil(totalUsers / limit) || 1;

    const users = await User.find(filter)
      .sort(sortOption)
      .skip(skip)
      .limit(limit);

    // Calculate total calls and total credits consumed by each user on current page
    const usersWithCalls = await Promise.all(users.map(async (user) => {
      const callCount = await Call.countDocuments({ user: user._id });
      const completedUserCalls = await Call.find({ user: user._id, status: 'Completed' });
      const creditsUsed = completedUserCalls.reduce((sum, c) => sum + (c.credits || 0), 0);
      return {
        ...user.toObject(),
        callCount,
        creditsUsed
      };
    }));

    const queryParams = 
      (searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : '') +
      (status && status !== 'all' ? `&status=${encodeURIComponent(status)}` : '') +
      (sortBy && sortBy !== 'newest' ? `&sortBy=${encodeURIComponent(sortBy)}` : '');

    res.render('admin/users', {
      title: 'User Directory - Friend Control',
      activeTab: 'users',
      users: usersWithCalls,
      currentPage: page,
      totalPages,
      totalUsers,
      searchQuery,
      selectedStatus: status || 'all',
      selectedSort: sortBy || 'newest',
      queryParams
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

    const { status, q, userName, date, creditStatus } = req.query;
    const conditions = [];

    // 1. Status Filter
    if (status && status !== 'All' && status !== 'All Statuses' && status !== 'all') {
      conditions.push({ status: status });
    }

    // 2. Credit Status Filter
    if (creditStatus && creditStatus !== 'All' && creditStatus !== 'All Statuses' && creditStatus !== 'all') {
      conditions.push({ creditStatus: creditStatus.toLowerCase() });
    }

    // 3. Date Filter (YYYY-MM-DD)
    if (date && date.trim() !== '') {
      const parts = date.trim().split('-');
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        
        const localStart = new Date(year, month, day, 0, 0, 0, 0);
        const localEnd = new Date(year, month, day, 23, 59, 59, 999);
        const utcStart = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
        const utcEnd = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
        
        const minStart = localStart < utcStart ? localStart : utcStart;
        const maxEnd = localEnd > utcEnd ? localEnd : utcEnd;

        conditions.push({
          $or: [
            { date: { $gte: minStart, $lte: maxEnd } },
            { startTime: { $gte: minStart, $lte: maxEnd } },
            { createdAt: { $gte: minStart, $lte: maxEnd } }
          ]
        });
      }
    }

    // 4. User Name / Phone / Call ID Filter
    const nameSearch = (userName || q || '').trim();
    if (nameSearch !== '') {
      const safeSearch = escapeRegex(nameSearch);
      const searchRegex = new RegExp(safeSearch, 'i');
      const matchingUsers = await User.find({
        $or: [{ name: searchRegex }, { mobile: searchRegex }]
      }).select('_id');
      const userIds = matchingUsers.map(u => u._id);

      conditions.push({
        $or: [
          { callId: searchRegex },
          { callerName: searchRegex },
          { receiverName: searchRegex },
          { user: { $in: userIds } }
        ]
      });
    }

    const filter = conditions.length > 0 ? { $and: conditions } : {};

    const totalCalls = await Call.countDocuments(filter);
    const totalPages = Math.ceil(totalCalls / limit) || 1;

    const calls = await Call.find(filter)
      .populate('user')
      .populate('admin')
      .populate('transaction')
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const queryParams = 
      (nameSearch ? `&userName=${encodeURIComponent(nameSearch)}` : '') +
      (date ? `&date=${encodeURIComponent(date)}` : '') +
      (status && status !== 'All' && status !== 'all' ? `&status=${encodeURIComponent(status)}` : '') +
      (creditStatus && creditStatus !== 'All' && creditStatus !== 'all' ? `&creditStatus=${encodeURIComponent(creditStatus)}` : '');

    res.render('admin/calls', {
      title: 'Call History Database - Friend Control',
      activeTab: 'calls',
      calls,
      currentPage: page,
      totalPages,
      totalCalls,
      selectedStatus: status || 'All',
      selectedCreditStatus: creditStatus || 'All',
      userNameQuery: nameSearch,
      selectedDate: date || '',
      searchQuery: nameSearch,
      queryParams
    });
  } catch (error) {
    console.error('[Admin Calls Error]', error);
    res.status(500).send('Server Error');
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 15;
    const skip = (page - 1) * limit;

    const { q, type, status, date } = req.query;
    const conditions = [];

    // 1. Search Query (txnId, desc, user name/mobile)
    const searchQuery = (q || '').trim();
    if (searchQuery !== '') {
      const safeSearch = escapeRegex(searchQuery);
      const searchRegex = new RegExp(safeSearch, 'i');
      
      const matchingUsers = await User.find({
        $or: [{ name: searchRegex }, { mobile: searchRegex }]
      }).select('_id');
      const userIds = matchingUsers.map(u => u._id);

      conditions.push({
        $or: [
          { txnId: searchRegex },
          { desc: searchRegex },
          { user: { $in: userIds } }
        ]
      });
    }

    // 2. Type Filter (credit, debit)
    if (type && type !== 'all' && type !== 'All') {
      conditions.push({ type: type.toLowerCase() });
    }

    // 3. Status Filter (Successful, Completed, Failed)
    if (status && status !== 'all' && status !== 'All') {
      conditions.push({ status: status });
    }

    // 4. Date Filter (YYYY-MM-DD)
    if (date && date.trim() !== '') {
      const parts = date.trim().split('-');
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        
        const localStart = new Date(year, month, day, 0, 0, 0, 0);
        const localEnd = new Date(year, month, day, 23, 59, 59, 999);
        const utcStart = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
        const utcEnd = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
        
        const minStart = localStart < utcStart ? localStart : utcStart;
        const maxEnd = localEnd > utcEnd ? localEnd : utcEnd;

        conditions.push({
          date: { $gte: minStart, $lte: maxEnd }
        });
      }
    }

    const filter = conditions.length > 0 ? { $and: conditions } : {};

    const totalTransactions = await Transaction.countDocuments(filter);
    const totalPages = Math.ceil(totalTransactions / limit) || 1;

    const transactions = await Transaction.find(filter)
      .populate('user')
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const queryParams = 
      (searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : '') +
      (type && type !== 'all' ? `&type=${encodeURIComponent(type)}` : '') +
      (status && status !== 'all' ? `&status=${encodeURIComponent(status)}` : '') +
      (date ? `&date=${encodeURIComponent(date)}` : '');

    res.render('admin/transactions', {
      title: 'Transaction Audits - Friend Control',
      activeTab: 'transactions',
      transactions,
      currentPage: page,
      totalPages,
      totalTransactions,
      searchQuery,
      selectedType: type || 'all',
      selectedStatus: status || 'all',
      selectedDate: date || '',
      queryParams
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

exports.getPricing = async (req, res) => {
  try {
    await getOrSeedPricingPlans();

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 10;
    const skip = (page - 1) * limit;

    const { q, status } = req.query;
    const conditions = [];

    const searchQuery = (q || '').trim();
    if (searchQuery !== '') {
      const safeSearch = escapeRegex(searchQuery);
      const searchRegex = new RegExp(safeSearch, 'i');
      conditions.push({
        $or: [
          { planId: searchRegex },
          { name: searchRegex },
          { badge: searchRegex },
          { description: searchRegex }
        ]
      });
    }

    if (status === 'active') {
      conditions.push({ isActive: true });
    } else if (status === 'disabled') {
      conditions.push({ isActive: false });
    }

    const filter = conditions.length > 0 ? { $and: conditions } : {};

    const totalPlans = await PricingPlan.countDocuments(filter);
    const totalPages = Math.ceil(totalPlans / limit) || 1;

    const plans = await PricingPlan.find(filter)
      .sort({ order: 1, credits: 1 })
      .skip(skip)
      .limit(limit);

    const queryParams = 
      (searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : '') +
      (status && status !== 'all' ? `&status=${encodeURIComponent(status)}` : '');

    res.render('admin/pricing', {
      title: 'Manage Pricing Plans - Friend Control',
      activeTab: 'pricing',
      plans,
      currentPage: page,
      totalPages,
      totalPlans,
      searchQuery,
      selectedStatus: status || 'all',
      queryParams
    });
  } catch (error) {
    console.error('[Admin Pricing Error]', error);
    res.status(500).send('Server Error');
  }
};

exports.postUpdatePricing = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, credits, price, description, badge, isPopular, isActive } = req.body;

    let plan = await PricingPlan.findById(id);
    if (!plan) {
      plan = await PricingPlan.findOne({ planId: id });
    }
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Pricing plan not found.' });
    }

    if (name) plan.name = name.trim();
    if (credits) plan.credits = parseInt(credits, 10);
    if (price) plan.price = parseInt(price, 10);
    if (typeof description !== 'undefined') plan.description = description.trim();
    if (badge) plan.badge = badge.trim();
    if (typeof isPopular !== 'undefined') plan.isPopular = (isPopular === true || isPopular === 'true');
    if (typeof isActive !== 'undefined') plan.isActive = (isActive === true || isActive === 'true');

    await plan.save();
    return res.json({ success: true, message: 'Credit pack charges updated successfully!', plan });
  } catch (error) {
    console.error('[Update Pricing Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to update pricing plan.' });
  }
};

exports.postTogglePricing = async (req, res) => {
  try {
    const { id } = req.params;
    let plan = await PricingPlan.findById(id);
    if (!plan) {
      plan = await PricingPlan.findOne({ planId: id });
    }
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Pricing plan not found.' });
    }

    plan.isActive = !plan.isActive;
    await plan.save();
    return res.json({ success: true, message: `Plan ${plan.isActive ? 'activated' : 'deactivated'} successfully!`, isActive: plan.isActive });
  } catch (error) {
    console.error('[Toggle Pricing Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to toggle plan status.' });
  }
};

exports.postAddPricing = async (req, res) => {
  try {
    const { name, credits, price, description, badge, isPopular } = req.body;
    if (!name || !credits || !price) {
      return res.status(400).json({ success: false, message: 'Plan name, credits, and price are required.' });
    }

    const numCredits = parseInt(credits, 10);
    const numPrice = parseInt(price, 10);

    if (isNaN(numCredits) || numCredits <= 0) {
      return res.status(400).json({ success: false, message: 'Credits must be a positive number.' });
    }
    if (isNaN(numPrice) || numPrice < 0) {
      return res.status(400).json({ success: false, message: 'Price must be a valid positive amount.' });
    }

    // Generate guaranteed unique planId
    let nextNum = 5501;
    const allExistingPlans = await PricingPlan.find({}).select('planId order');
    const existingIds = new Set(allExistingPlans.map(p => p.planId));
    while (existingIds.has('PLAN-' + nextNum)) {
      nextNum++;
    }
    const planId = 'PLAN-' + nextNum;

    // Determine max order
    const maxOrder = allExistingPlans.reduce((max, p) => Math.max(max, p.order || 0), 0);

    const newPlan = new PricingPlan({
      planId,
      name: name.trim(),
      badge: badge && badge.trim() ? badge.trim() : 'Special',
      credits: numCredits,
      price: numPrice,
      description: description ? description.trim() : '',
      isPopular: (isPopular === true || isPopular === 'true' || isPopular === 'on'),
      order: maxOrder + 1,
      isActive: true
    });

    await newPlan.save();
    return res.json({ success: true, message: 'New recharge pack added successfully!', plan: newPlan });
  } catch (error) {
    console.error('[Add Pricing Error]', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to create pricing plan.' });
  }
};

exports.postDeletePricing = async (req, res) => {
  try {
    const { id } = req.params;
    let plan = await PricingPlan.findById(id);
    if (!plan) {
      plan = await PricingPlan.findOne({ planId: id });
    }
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Pricing plan not found.' });
    }

    await PricingPlan.deleteOne({ _id: plan._id });
    return res.json({ success: true, message: `Recharge pack '${plan.name}' deleted successfully!` });
  } catch (error) {
    console.error('[Delete Pricing Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to delete recharge pack.' });
  }
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
