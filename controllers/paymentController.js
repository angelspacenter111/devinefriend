const paymentService = require('../services/paymentService');
const callService = require('../services/callService');
const User = require('../models/User');

/**
 * POST /api/payments/create-order
 * Initiates Razorpay Order from trusted backend PricingPlan
 */
exports.createOrder = async (req, res) => {
  try {
    const { packageId } = req.body;
    const userId = req.user._id;

    // Reject order creation if Ashu (admin) is not online
    if (!callService.isAdvisorOnline()) {
      return res.status(403).json({
        success: false,
        code: 'ADVISOR_OFFLINE',
        message: 'Ashu is currently offline. Points can only be purchased when Ashu is online.'
      });
    }

    if (!packageId) {
      return res.status(400).json({
        success: false,
        message: 'packageId is required'
      });
    }

    const orderData = await paymentService.createOrder({ userId, packageId });

    return res.status(200).json(orderData);
  } catch (error) {
    const errorMsg = error.error?.description || error.description || error.message || 'Failed to create payment order';
    console.error('[PaymentController] createOrder Error:', errorMsg);
    const status = error.status || error.statusCode || (error.code === 'RAZORPAY_CONFIG_MISSING' ? 500 : 400);
    return res.status(status).json({
      success: false,
      message: errorMsg
    });
  }
};

/**
 * POST /api/payments/verify
 * Securely verifies Razorpay payment signature and idempotently credits user account
 */
exports.verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    const userId = req.user._id;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'razorpay_order_id, razorpay_payment_id, and razorpay_signature are required'
      });
    }

    const result = await paymentService.fulfillPaymentIdempotent({
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      userId,
      source: 'frontend'
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      alreadyProcessed: result.alreadyProcessed || false,
      credits: result.credits
    });
  } catch (error) {
    const errorMsg = error.error?.description || error.description || error.message || 'Payment verification failed';
    console.error('[PaymentController] verifyPayment Error:', errorMsg);
    const status = error.status || error.statusCode || 400;
    return res.status(status).json({
      success: false,
      message: errorMsg
    });
  }
};

/**
 * POST /api/payments/webhook
 * Handles incoming Razorpay webhooks with raw body HMAC signature verification
 */
exports.handleWebhook = async (req, res) => {
  try {
    const webhookSignature = req.headers['x-razorpay-signature'];
    const rawBody = req.rawBody;

    if (!rawBody || !webhookSignature) {
      return res.status(400).json({
        error: 'Missing raw body or X-Razorpay-Signature header'
      });
    }

    const result = await paymentService.processWebhook({
      rawBody,
      webhookSignature
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('[PaymentController] handleWebhook Error:', error.message);
    const status = error.status || 400;
    return res.status(status).json({
      error: error.message || 'Webhook processing failed'
    });
  }
};

/**
 * GET /api/payments/history
 * Returns user's payment transaction history
 */
exports.getPaymentHistory = async (req, res) => {
  try {
    const payments = await paymentService.getUserPaymentHistory(req.user._id);
    return res.status(200).json({
      success: true,
      payments
    });
  } catch (error) {
    console.error('[PaymentController] getPaymentHistory Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve payment history'
    });
  }
};

/**
 * GET /api/credits/balance
 * Returns real-time user credit balance
 */
exports.getCreditBalance = async (req, res) => {
  try {
    const freshUser = await User.findById(req.user._id).select('credits');
    return res.status(200).json({
      success: true,
      credits: freshUser ? freshUser.credits : 0
    });
  } catch (error) {
    console.error('[PaymentController] getCreditBalance Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch credit balance'
    });
  }
};

/**
 * GET /api/credits/transactions
 * Returns user's credit ledger transactions
 */
exports.getCreditTransactions = async (req, res) => {
  try {
    const transactions = await paymentService.getUserCreditTransactions(req.user._id);
    return res.status(200).json({
      success: true,
      transactions
    });
  } catch (error) {
    console.error('[PaymentController] getCreditTransactions Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch credit transactions'
    });
  }
};

/**
 * GET /api/calls/check-access
 * Verifies if user has sufficient credits to initiate a call
 */
exports.checkCallAccess = async (req, res) => {
  try {
    const callType = (req.query.type === 'video' || req.query.callType === 'Video') ? 'Video' : 'Voice';
    const requiredCredits = callType === 'Video' ? 2 : 1;
    const result = await callService.checkCallAccess(req.user._id, requiredCredits, callType);
    if (!result.allowed) {
      return res.status(403).json({
        success: false,
        code: result.code || 'INSUFFICIENT_CREDITS',
        message: result.message || `You need at least ${requiredCredits} points to start a ${callType.toLowerCase()} call. Please purchase points to continue.`,
        credits: result.credits || 0,
        requiredCredits: result.requiredCredits || requiredCredits,
        callType
      });
    }

    return res.status(200).json({
      success: true,
      canCall: true,
      credits: result.credits,
      callType
    });
  } catch (error) {
    console.error('[PaymentController] checkCallAccess Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error verifying call access'
    });
  }
};
