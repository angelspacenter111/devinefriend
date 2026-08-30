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

exports.getCall = (req, res) => {
  res.render('user/call', {
    title: 'Voice Call - Friend',
    activeTab: 'call',
    user: req.user
  });
};

// AJAX endpoint to log call details and deduct credits
exports.postEndCall = async (req, res) => {
  try {
    const { duration, status, creditsUsed } = req.body;
    const user = req.user;

    const billingCredits = parseInt(creditsUsed, 10) || 0;

    // Deduct user credits
    user.credits = Math.max(0, user.credits - billingCredits);
    await user.save();

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = new Date().toISOString().split('T')[0];

    // Log the Call in DB
    const newCall = new Call({
      callId: "CALL-" + Math.floor(1000 + Math.random() * 9000),
      user: user._id,
      time: timeStr,
      duration: duration || "00:00",
      credits: billingCredits,
      status: status || 'Completed'
    });
    const savedCall = await newCall.save();

    // Log call charges transaction in DB if credits were spent
    if (billingCredits > 0) {
      const newTxn = new Transaction({
        txnId: "TXN-" + Math.floor(1000 + Math.random() * 9000) + Math.floor(10 + Math.random() * 90),
        user: user._id,
        desc: `Call Charges (${savedCall.callId})`,
        type: 'debit',
        credits: billingCredits,
        amount: '₹0',
        status: 'Completed'
      });
      await newTxn.save();
    }

    return res.json({
      success: true,
      message: 'Call logged and billing computed successfully.',
      credits: user.credits
    });
  } catch (error) {
    console.error('[End Call Error]', error);
    return res.status(500).json({ success: false, message: 'Server error saving call log.' });
  }
};

exports.getCallHistory = async (req, res) => {
  try {
    const user = req.user;
    const calls = await Call.find({ user: user._id }).sort({ date: -1 });

    res.render('user/call-history', {
      title: 'Call History - Friend',
      activeTab: 'call-history',
      user,
      calls
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
