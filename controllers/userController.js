const User = require('../models/User');
const Call = require('../models/Call');
const Transaction = require('../models/Transaction');
const PricingPlan = require('../models/PricingPlan');
const bcrypt = require('bcryptjs');

// Helper to safely escape regex characters
const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Helper to convert mm:ss to numerical minutes
const parseMins = (durationStr) => {
  if (!durationStr || !durationStr.includes(':')) return 0;
  const parts = durationStr.split(':');
  const minutes = parseInt(parts[0], 10) || 0;
  const seconds = parseInt(parts[1], 10) || 0;
  return minutes + (seconds / 60);
};

exports.getDashboard = async (req, res) => {
  try {
    const user = req.user;
    
    // Fetch recent 5 calls
    const calls = await Call.find({ user: user._id })
      .sort({ date: -1 })
      .limit(5);

    // Cumulative stats
    const totalCalls = await Call.countDocuments({ user: user._id });
    
    const completedCalls = await Call.find({ user: user._id, status: 'Completed' });
    const totalMins = completedCalls.reduce((acc, c) => acc + parseMins(c.duration), 0);
    const totalMinsRounded = Math.round(totalMins);

    res.render('user/dashboard', {
      title: 'User Dashboard - Friend',
      activeTab: 'dashboard',
      user,
      calls,
      totalCalls,
      totalMins: totalMinsRounded
    });
  } catch (error) {
    console.error('[Dashboard Error]', error);
    res.status(500).send('Server Error');
  }
};

exports.getWallet = async (req, res) => {
  try {
    const user = req.user;

    // Fetch recent 5 transactions
    const transactions = await Transaction.find({ user: user._id })
      .sort({ date: -1 })
      .limit(5);

    // Sum transactions
    const allTxns = await Transaction.find({ user: user._id, status: { $in: ['Successful', 'Completed'] } });
    
    let totalPurchased = 0;
    let totalUsed = 0;

    allTxns.forEach(txn => {
      if (txn.type === 'credit') {
        totalPurchased += txn.credits;
      } else if (txn.type === 'debit') {
        totalUsed += txn.credits;
      }
    });

    res.render('user/wallet', {
      title: 'My Wallet - Friend',
      activeTab: 'wallet',
      user,
      transactions,
      totalPurchased,
      totalUsed
    });
  } catch (error) {
    console.error('[Wallet Error]', error);
    res.status(500).send('Server Error');
  }
};

exports.getBuyCredits = async (req, res) => {
  try {
    let plans = await PricingPlan.find({ isActive: true }).sort({ order: 1, credits: 1 });
    if (!plans || plans.length === 0) {
      const defaultPlans = [
        { planId: 'PLAN-5501', name: 'Starter Pack', badge: 'Starter', credits: 5, price: 149, description: 'Quick initial check-in or brief conversation.', isPopular: false, isActive: true, order: 1 },
        { planId: 'PLAN-5502', name: 'Bridge Pack', badge: 'Bridge', credits: 10, price: 299, description: 'Talk through an immediate worry or stressor.', isPopular: false, isActive: true, order: 2 },
        { planId: 'PLAN-5503', name: 'Comfort Pack', badge: 'Comfort', credits: 25, price: 599, description: 'Ample time to speak calmly, reflect and breathe.', isPopular: true, isActive: true, order: 3 },
        { planId: 'PLAN-5504', name: 'Deep Listen Pack', badge: 'Deep Listen', credits: 50, price: 1199, description: 'Ideal for multiple in-depth conversation sessions.', isPopular: false, isActive: true, order: 4 },
        { planId: 'PLAN-5505', name: 'Best Value Pack', badge: 'Best Value', credits: 100, price: 2199, description: 'Maximum savings for regular check-in support.', isPopular: false, isActive: true, order: 5 }
      ];
      try {
        await PricingPlan.insertMany(defaultPlans);
        plans = await PricingPlan.find({ isActive: true }).sort({ order: 1, credits: 1 });
      } catch (err) {
        plans = defaultPlans;
      }
    }

    res.render('user/buy-credits', {
      title: 'Buy Credits - Friend',
      activeTab: 'buy-credits',
      user: req.user,
      plans
    });
  } catch (error) {
    console.error('[User Buy Credits Error]', error);
    res.status(500).send('Server Error');
  }
};

// AJAX endpoint to purchase credits
exports.postBuyCredits = async (req, res) => {
  try {
    const { credits, price, planId } = req.body;
    const user = req.user;

    if (!credits || isNaN(credits)) {
      return res.status(400).json({ success: false, message: 'Invalid credits value.' });
    }

    const creditVal = parseInt(credits, 10);
    let chargedPrice = price || "₹0";

    // Validate price with configured active pricing plan
    if (planId) {
      const plan = await PricingPlan.findById(planId);
      if (plan) {
        chargedPrice = `₹${plan.price.toLocaleString('en-IN')}`;
      }
    } else {
      const plan = await PricingPlan.findOne({ credits: creditVal, isActive: true });
      if (plan) {
        chargedPrice = `₹${plan.price.toLocaleString('en-IN')}`;
      }
    }

    // Increment user credits in DB
    user.credits += creditVal;
    await user.save();

    // Create credit transaction ledger entry
    const newTxn = new Transaction({
      txnId: "TXN-" + Math.floor(1000 + Math.random() * 9000) + Math.floor(10 + Math.random() * 90),
      user: user._id,
      desc: `Credit Purchase (${creditVal} Credits)`,
      type: 'credit',
      credits: creditVal,
      amount: chargedPrice,
      status: 'Successful'
    });
    await newTxn.save();

    return res.json({
      success: true,
      message: `Successfully purchased ${creditVal} credits!`,
      credits: user.credits
    });
  } catch (error) {
    console.error('[Buy Credits Error]', error);
    return res.status(500).json({ success: false, message: 'Server error processing transaction.' });
  }
};

const callService = require('../services/callService');

exports.getCall = async (req, res) => {
  try {
    const user = req.user;
    if (user.credits < 1) {
      return res.redirect('/user/buy-credits?lowCredits=true');
    }

    const call = await callService.initiateCall({ user, callType: 'Voice' });

    res.render('user/call', {
      title: 'Voice Call - Friend',
      activeTab: 'call',
      user,
      call
    });
  } catch (error) {
    console.error('[User Call Initiation Error]', error);
    if (error.code === 'INSUFFICIENT_CREDITS') {
      return res.redirect('/user/buy-credits?lowCredits=true');
    }
    res.status(500).send('Server Error initiating call');
  }
};

// AJAX endpoint to securely finalize call and deduct credits
exports.postEndCall = async (req, res) => {
  try {
    const { callId, status } = req.body;
    const user = req.user;

    if (!callId) {
      return res.status(400).json({ success: false, message: 'callId is required.' });
    }

    // Verify call belongs to the logged-in user
    const checkCall = await Call.findOne({ callId });
    if (!checkCall) {
      return res.status(404).json({ success: false, message: 'Call not found.' });
    }
    if (checkCall.user.toString() !== user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized to finalize this call.' });
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
    console.error('[End Call Error]', error);
    return res.status(500).json({ status: false, success: false, message: 'Server error saving call log.' });
  }
};

exports.getCallHistory = async (req, res) => {
  try {
    const user = req.user;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 10;
    const skip = (page - 1) * limit;

    const { status, date, q } = req.query;
    const conditions = [{ user: user._id }];

    // 1. Status Filter
    if (status && status !== 'All' && status !== 'All Statuses' && status !== 'all') {
      conditions.push({ status: status });
    }

    // 2. Date Filter (YYYY-MM-DD)
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

    // 3. Search Query (Call ID, receiverName)
    const searchQuery = (q || '').trim();
    if (searchQuery !== '') {
      const safeSearch = escapeRegex(searchQuery);
      const searchRegex = new RegExp(safeSearch, 'i');
      conditions.push({
        $or: [
          { callId: searchRegex },
          { receiverName: searchRegex }
        ]
      });
    }

    const filter = conditions.length > 0 ? { $and: conditions } : { user: user._id };

    // Fetch latest call overall for the top card (or latest matching)
    const latestCall = await Call.findOne({ user: user._id })
      .populate('admin')
      .sort({ date: -1, createdAt: -1 });

    const totalCalls = await Call.countDocuments(filter);
    const totalPages = Math.ceil(totalCalls / limit) || 1;

    const calls = await Call.find(filter)
      .populate('admin')
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const queryParams = 
      (searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : '') +
      (date ? `&date=${encodeURIComponent(date)}` : '') +
      (status && status !== 'All' && status !== 'all' ? `&status=${encodeURIComponent(status)}` : '');

    res.render('user/call-history', {
      title: 'Call History - Friend',
      activeTab: 'call-history',
      user,
      latestCall,
      calls,
      currentPage: page,
      totalPages,
      totalCalls,
      selectedStatus: status || 'All',
      selectedDate: date || '',
      searchQuery,
      queryParams
    });
  } catch (error) {
    console.error('[Call History Error]', error);
    res.status(500).send('Server Error');
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const user = req.user;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 10;
    const skip = (page - 1) * limit;

    const { q, type, date } = req.query;
    const conditions = [{ user: user._id }];

    // 1. Search Query (txnId, desc)
    const searchQuery = (q || '').trim();
    if (searchQuery !== '') {
      const safeSearch = escapeRegex(searchQuery);
      const searchRegex = new RegExp(safeSearch, 'i');
      conditions.push({
        $or: [
          { txnId: searchRegex },
          { desc: searchRegex }
        ]
      });
    }

    // 2. Type Filter (credit, debit)
    if (type && type !== 'all' && type !== 'All') {
      conditions.push({ type: type.toLowerCase() });
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
          date: { $gte: minStart, $lte: maxEnd }
        });
      }
    }

    const filter = { $and: conditions };

    const totalTransactions = await Transaction.countDocuments(filter);
    const totalPages = Math.ceil(totalTransactions / limit) || 1;

    const transactions = await Transaction.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const queryParams = 
      (searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : '') +
      (type && type !== 'all' ? `&type=${encodeURIComponent(type)}` : '') +
      (date ? `&date=${encodeURIComponent(date)}` : '');

    res.render('user/transactions', {
      title: 'Transactions - Friend',
      activeTab: 'wallet',
      user,
      transactions,
      currentPage: page,
      totalPages,
      totalTransactions,
      searchQuery,
      selectedType: type || 'all',
      selectedDate: date || '',
      queryParams
    });
  } catch (error) {
    console.error('[User Transactions Error]', error);
    res.status(500).send('Server Error');
  }
};

exports.getProfile = (req, res) => {
  res.render('user/profile', {
    title: 'Profile Settings - Friend',
    activeTab: 'profile',
    user: req.user,
    successMessage: null,
    errorMessage: null
  });
};

// POST modify profile details
exports.postProfile = async (req, res) => {
  try {
    const { name, email, mobile } = req.body;
    const user = req.user;

    if (!name || !mobile) {
      return res.render('user/profile', {
        title: 'Profile Settings - Friend',
        activeTab: 'profile',
        user,
        successMessage: null,
        errorMessage: 'Name and mobile number are required.'
      });
    }

    const cleanMobile = mobile.trim();

    // Check mobile availability if modified
    if (cleanMobile !== user.mobile) {
      const mobileExists = await User.findOne({ mobile: cleanMobile });
      if (mobileExists) {
        return res.render('user/profile', {
          title: 'Profile Settings - Friend',
          activeTab: 'profile',
          user,
          successMessage: null,
          errorMessage: 'Mobile number is already in use by another account.'
        });
      }
    }

    user.name = name.trim();
    user.email = (email || '').trim();
    user.mobile = cleanMobile;
    
    await user.save();

    res.render('user/profile', {
      title: 'Profile Settings - Friend',
      activeTab: 'profile',
      user,
      successMessage: 'Profile details updated successfully!',
      errorMessage: null
    });
  } catch (error) {
    console.error('[Profile Update Error]', error);
    res.status(500).send('Server Error');
  }
};

// POST password modification
exports.postChangePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const user = req.user;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.render('user/profile', {
        title: 'Profile Settings - Friend',
        activeTab: 'profile',
        user,
        successMessage: null,
        errorMessage: 'All password fields are required.'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.render('user/profile', {
        title: 'Profile Settings - Friend',
        activeTab: 'profile',
        user,
        successMessage: null,
        errorMessage: 'New passwords do not match.'
      });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.render('user/profile', {
        title: 'Profile Settings - Friend',
        activeTab: 'profile',
        user,
        successMessage: null,
        errorMessage: 'Incorrect current password.'
      });
    }

    // Set new password (pre-save handles hash)
    user.password = newPassword;
    await user.save();

    res.render('user/profile', {
      title: 'Profile Settings - Friend',
      activeTab: 'profile',
      user,
      successMessage: 'Password updated successfully!',
      errorMessage: null
    });
  } catch (error) {
    console.error('[Change Password Error]', error);
    res.status(500).send('Server Error');
  }
};
