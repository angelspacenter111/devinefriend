const User = require('../../models/User');
const Transaction = require('../../models/Transaction');
const PricingPlan = require('../../models/PricingPlan');
const PaymentTransaction = require('../../models/PaymentTransaction');
const paymentService = require('../../services/paymentService');

// GET /api/wallet/balance
exports.getBalance = async (req, res) => {
  try {
    const user = req.user;

    const allTxns = await Transaction.find({
      user: user._id,
      status: { $in: ['Successful', 'Completed'] }
    });

    let totalPurchased = 0;
    let totalUsed = 0;

    allTxns.forEach(txn => {
      if (txn.type === 'credit') {
        totalPurchased += (txn.credits || 0);
      } else if (txn.type === 'debit') {
        totalUsed += (txn.credits || 0);
      }
    });

    return res.json({
      success: true,
      data: {
        credits: user.credits,
        totalPurchased,
        totalUsed
      }
    });
  } catch (error) {
    console.error('[API Wallet Balance Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve balance.' });
  }
};

// GET /api/wallet/plans
exports.getPlans = async (req, res) => {
  try {
    let plans = await PricingPlan.find({ isActive: true }).sort({ order: 1, credits: 1 });
    if (!plans || plans.length === 0) {
      const defaultPlans = [
        { planId: 'PLAN-5501', name: 'Starter Pack', badge: 'Starter', credits: 5, price: 149, description: 'Quick initial check-in or brief conversation.', isPopular: false, isActive: true, order: 1 },
        { planId: 'PLAN-5502', name: 'Bridge Pack', badge: 'Bridge', credits: 10, price: 299, description: 'Talk through an immediate worry or stressor.', isPopular: false, isActive: true, order: 2 },
        { planId: 'PLAN-5503', name: 'Comfort Pack', badge: 'Comfort', credits: 25, price: 599, description: 'Ample time to speak calmly, reflect and breathe.', isPopular: true, isActive: true, order: 3 },
        { planId: 'PLAN-5504', name: 'Deep Listen Pack', badge: 'Deep Listen', credits: 50, price: 1199, description: 'Ideal for multiple in-depth conversation sessions.', isPopular: false, isActive: true, order: 4 },
        { planId: 'PLAN-5505', name: 'Best Value Pack', badge: 'Best Value', credits: 2199, description: 'Maximum savings for regular check-in support.', isPopular: false, isActive: true, order: 5 }
      ];
      try {
        await PricingPlan.insertMany(defaultPlans);
        plans = await PricingPlan.find({ isActive: true }).sort({ order: 1, credits: 1 });
      } catch (err) {
        plans = defaultPlans;
      }
    }

    return res.json({
      success: true,
      plans
    });
  } catch (error) {
    console.error('[API Get Plans Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch pricing plans.' });
  }
};

// GET /api/wallet/transactions
exports.getTransactions = async (req, res) => {
  try {
    const user = req.user;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const skip = (page - 1) * limit;

    const { type } = req.query;
    const filter = { user: user._id };
    if (type && ['credit', 'debit'].includes(type.toLowerCase())) {
      filter.type = type.toLowerCase();
    }

    const [transactions, totalCount] = await Promise.all([
      Transaction.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit),
      Transaction.countDocuments(filter)
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
    console.error('[API Transactions Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch transactions.' });
  }
};

// POST /api/wallet/create-order
exports.createOrder = async (req, res) => {
  try {
    const user = req.user;
    const { planId, returnBaseUrl } = req.body;

    if (!planId) {
      return res.status(400).json({ success: false, message: 'planId is required.' });
    }

    const plan = await PricingPlan.findOne({ planId, isActive: true });
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Selected plan not found or inactive.' });
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.get('host') || 'localhost:3000';
    const baseUrl = returnBaseUrl || `${protocol}://${host}`;

    const result = await paymentService.createOrder({
      userId: user._id,
      packageId: plan.planId,
      returnBaseUrl: baseUrl
    });

    return res.json({
      success: true,
      order: {
        id: result.orderId,
        sessionId: result.sessionId,
        url: result.checkoutUrl,
        amount: result.amount,
        currency: result.currency
      },
      sessionId: result.sessionId,
      checkoutUrl: result.checkoutUrl,
      keyId: result.publishableKey,
      publishableKey: result.publishableKey,
      plan: {
        planId: plan.planId,
        name: plan.name,
        price: plan.price,
        credits: plan.credits
      }
    });
  } catch (error) {
    console.error('[API Create Order Error]', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create payment order.'
    });
  }
};

// POST /api/wallet/verify-payment
exports.verifyPayment = async (req, res) => {
  try {
    const user = req.user;
    const { sessionId, stripe_session_id, razorpay_order_id, razorpay_payment_id } = req.body;

    const targetSessionId = sessionId || stripe_session_id || razorpay_order_id;

    if (!targetSessionId) {
      return res.status(400).json({
        success: false,
        message: 'Missing payment session ID for verification.'
      });
    }

    let verificationResult;
    if (targetSessionId.startsWith('cs_')) {
      verificationResult = await paymentService.verifySession({
        sessionId: targetSessionId,
        userId: user._id
      });
    } else {
      verificationResult = await paymentService.fulfillPaymentIdempotent({
        stripeSessionId: targetSessionId,
        stripePaymentIntentId: razorpay_payment_id || null,
        userId: user._id
      });
    }

    const updatedUser = await User.findById(user._id);

    return res.json({
      success: true,
      message: 'Payment verified successfully. Credits added to your account.',
      creditsAdded: verificationResult.paymentTransaction?.credits || 0,
      newBalance: updatedUser.credits
    });
  } catch (error) {
    console.error('[API Verify Payment Error]', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Payment verification failed.'
    });
  }
};
