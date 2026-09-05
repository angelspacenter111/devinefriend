const User = require('../models/User');
const Call = require('../models/Call');
const Transaction = require('../models/Transaction');
const bcrypt = require('bcryptjs');

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

exports.getBuyCredits = (req, res) => {
  res.render('user/buy-credits', {
    title: 'Buy Credits - Friend',
    activeTab: 'buy-credits',
    user: req.user
  });
};

// AJAX endpoint to purchase credits
exports.postBuyCredits = async (req, res) => {
  try {
    const { credits, price } = req.body;
    const user = req.user;

    if (!credits || isNaN(credits)) {
      return res.status(400).json({ success: false, message: 'Invalid credits value.' });
    }

    const creditVal = parseInt(credits, 10);

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
      amount: price || "₹0",
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

    // Fetch the most recent call for the dedicated Last Call Summary card at the top
    const latestCall = await Call.findOne({ user: user._id })
      .populate('admin')
      .sort({ date: -1, createdAt: -1 });

    // Total calls count for pagination
    const totalCalls = await Call.countDocuments({ user: user._id });
    const totalPages = Math.ceil(totalCalls / limit) || 1;

    // Paginated list of all calls
    const calls = await Call.find({ user: user._id })
      .populate('admin')
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.render('user/call-history', {
      title: 'Call History - Friend',
      activeTab: 'call-history',
      user,
      latestCall,
      calls,
      currentPage: page,
      totalPages,
      totalCalls
    });
  } catch (error) {
    console.error('[Call History Error]', error);
    res.status(500).send('Server Error');
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const user = req.user;
    const transactions = await Transaction.find({ user: user._id }).sort({ date: -1 });

    res.render('user/transactions', {
      title: 'Transaction History - Friend',
      activeTab: 'transactions',
      user,
      transactions
    });
  } catch (error) {
    console.error('[Transactions Error]', error);
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
