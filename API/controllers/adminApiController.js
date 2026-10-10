const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const Call = require('../../models/Call');
const Transaction = require('../../models/Transaction');
const PaymentTransaction = require('../../models/PaymentTransaction');
const PricingPlan = require('../../models/PricingPlan');
const callService = require('../../services/callService');
const { JWT_SECRET } = require('../middleware/apiAuth');

const parseMins = (durationStr) => {
  if (!durationStr || !durationStr.includes(':')) return 0;
  const parts = durationStr.split(':');
  const minutes = parseInt(parts[0], 10) || 0;
  const seconds = parseInt(parts[1], 10) || 0;
  return minutes + (seconds / 60);
};

// POST /api/admin/login
exports.login = async (req, res) => {
  try {
    const { mobile, password } = req.body;

    if (!mobile || !password) {
      return res.status(400).json({
        success: false,
        message: 'Admin mobile/identifier and password are required.'
      });
    }

    const identifier = mobile.toString().trim();
    const user = await User.findOne({
      $or: [
        { mobile: identifier },
        { email: identifier.toLowerCase() },
        { mobile: '+91 ' + identifier },
        { mobile: identifier.replace(/[^0-9]/g, '') }
      ]
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. No admin account found.'
      });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Account is not registered as an administrator.'
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. Password does not match.'
      });
    }

    const token = jwt.sign(
      { id: user._id, userId: user._id, role: 'admin', mobile: user.mobile },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.json({
      success: true,
      message: 'Admin login successful.',
      token,
      admin: {
        id: user._id,
        name: user.name,
        mobile: user.mobile,
        role: user.role
      }
    });
  } catch (error) {
    console.error('[Admin API Login Error]', error);
    return res.status(500).json({ success: false, message: 'Server error during admin login.' });
  }
};

// GET /api/admin/dashboard
exports.getDashboard = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: { $ne: 'admin' } });
    const totalCalls = await Call.countDocuments();
    const completedCalls = await Call.find({ status: 'Completed' });
    const missedCalls = await Call.countDocuments({ status: { $in: ['Missed', 'Rejected', 'Cancelled'] } });

    const totalMinutes = Math.round(completedCalls.reduce((acc, c) => acc + parseMins(c.duration), 0));

    // Revenue calculation from completed payment transactions
    const successfulPayments = await PaymentTransaction.find({ status: { $in: ['captured', 'authorized', 'Successful'] } });
    const totalRevenue = successfulPayments.reduce((acc, p) => acc + (p.amount || 0), 0);

    const recentCalls = await Call.find()
      .populate('user', 'name mobile')
      .sort({ createdAt: -1 })
      .limit(6);

    const presenceInfo = callService.getAdvisorPresenceInfo();

    return res.json({
      success: true,
      data: {
        stats: {
          totalUsers,
          totalCalls,
          completedCallsCount: completedCalls.length,
          missedCallsCount: missedCalls,
          totalMinutes,
          totalRevenue: Math.round(totalRevenue)
        },
        presence: presenceInfo,
        recentCalls
      }
    });
  } catch (error) {
    console.error('[Admin API Dashboard Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch admin dashboard.' });
  }
};

// GET /api/admin/users
exports.getUsers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { q, status } = req.query;
    const filter = { role: { $ne: 'admin' } };

    if (q && q.trim()) {
      const regex = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: regex }, { mobile: regex }];
    }

    if (status === 'blocked') filter.isBlocked = true;
    else if (status === 'active') filter.isBlocked = false;

    const [users, totalCount] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter)
    ]);

    return res.json({
      success: true,
      data: {
        users,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit) || 1
        }
      }
    });
  } catch (error) {
    console.error('[Admin API Users Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
};

// POST /api/admin/users/:id/block
exports.toggleUserBlock = async (req, res) => {
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
      message: user.isBlocked ? 'User blocked successfully.' : 'User unblocked successfully.',
      isBlocked: user.isBlocked
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to toggle block status.' });
  }
};

// POST /api/admin/users/:id/credits
exports.updateUserCredits = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason } = req.body;

    const numAmount = parseInt(amount, 10);
    if (isNaN(numAmount) || numAmount === 0) {
      return res.status(400).json({ success: false, message: 'Valid positive or negative amount required.' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    user.credits = Math.max(0, (user.credits || 0) + numAmount);
    await user.save();

    const txn = new Transaction({
      txnId: "ADMIN-" + Math.floor(100000 + Math.random() * 900000),
      user: user._id,
      desc: reason || `Manual Admin Credit Adjustment (${numAmount > 0 ? '+' : ''}${numAmount})`,
      type: numAmount > 0 ? 'credit' : 'debit',
      credits: Math.abs(numAmount),
      amount: "AED 0",
      status: "Successful"
    });
    await txn.save();

    return res.json({
      success: true,
      message: 'Credits updated successfully.',
      newBalance: user.credits
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update credits.' });
  }
};

// GET /api/admin/calls
exports.getCalls = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { status, q } = req.query;
    const filter = {};

    if (status && status !== 'All') {
      filter.status = status;
    }

    if (q && q.trim()) {
      const regex = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ callId: regex }, { receiverName: regex }];
    }

    const [calls, totalCount] = await Promise.all([
      Call.find(filter).populate('user', 'name mobile').sort({ createdAt: -1 }).skip(skip).limit(limit),
      Call.countDocuments(filter)
    ]);

    return res.json({
      success: true,
      data: {
        calls,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit) || 1
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch call logs.' });
  }
};

// GET /api/admin/transactions
exports.getTransactions = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [transactions, totalCount] = await Promise.all([
      Transaction.find().populate('user', 'name mobile').sort({ createdAt: -1 }).skip(skip).limit(limit),
      Transaction.countDocuments()
    ]);

    return res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit) || 1
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch transactions.' });
  }
};

// GET /api/admin/pricing
exports.getPricing = async (req, res) => {
  try {
    const plans = await PricingPlan.find().sort({ order: 1, credits: 1 });
    return res.json({ success: true, plans });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch pricing plans.' });
  }
};

// POST /api/admin/pricing/add
exports.addPricing = async (req, res) => {
  try {
    const { name, badge, credits, price, description, isPopular } = req.body;

    if (!name || !credits || !price) {
      return res.status(400).json({ success: false, message: 'Name, credits, and price are required.' });
    }

    const planId = 'PLAN-' + Math.floor(1000 + Math.random() * 9000);
    const newPlan = new PricingPlan({
      planId,
      name: name.trim(),
      badge: badge || '',
      credits: parseInt(credits, 10),
      price: parseInt(price, 10),
      description: description || '',
      isPopular: !!isPopular,
      isActive: true,
      order: 10
    });

    await newPlan.save();
    return res.status(201).json({ success: true, message: 'Pricing plan created.', plan: newPlan });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to add pricing plan.' });
  }
};

// POST /api/admin/pricing/:id/toggle
exports.togglePricing = async (req, res) => {
  try {
    const { id } = req.params;
    const plan = await PricingPlan.findById(id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found.' });

    plan.isActive = !plan.isActive;
    await plan.save();

    return res.json({ success: true, message: 'Plan status updated.', isActive: plan.isActive });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to toggle plan.' });
  }
};
