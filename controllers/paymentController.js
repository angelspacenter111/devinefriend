const paymentService = require('../services/paymentService');
const callService = require('../services/callService');
const User = require('../models/User');

/**
 * POST /api/payments/create-order
 * Initiates Stripe Checkout Session from trusted backend PricingPlan
 */
exports.createOrder = async (req, res) => {
  try {
    const { packageId, returnBaseUrl } = req.body;
    const userId = req.user._id;

    // Reject order creation if Ashu (admin) is not online
    if (!callService.isAdvisorOnline()) {
      return res.status(403).json({
        success: false,
        code: 'ADVISOR_OFFLINE',
        message: 'Ashu is currently offline. Coins can only be purchased when Ashu is online.'
      });
    }

    if (!packageId) {
      return res.status(400).json({
        success: false,
        message: 'packageId is required'
      });
    }

    // Determine host base URL for redirect if not provided
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.get('host') || 'localhost:3000';
    const baseUrl = returnBaseUrl || `${protocol}://${host}`;

    const orderData = await paymentService.createOrder({
      userId,
      packageId,
      returnBaseUrl: baseUrl
    });

    return res.status(200).json(orderData);
  } catch (error) {
    const errorMsg = error.message || 'Failed to create payment session';
    console.error('[PaymentController] createOrder Error:', errorMsg);
    const status = error.status || (error.code === 'STRIPE_CONFIG_MISSING' ? 500 : 400);
    return res.status(status).json({
      success: false,
      message: errorMsg
    });
  }
};

/**
 * POST /api/payments/verify
 * Securely verifies Stripe Checkout Session / payment and idempotently credits user account
 */
exports.verifyPayment = async (req, res) => {
  try {
    const {
      sessionId,
      stripe_session_id,
      stripePaymentIntentId,
      razorpay_order_id // handled gracefully if legacy client
    } = req.body;

    const userId = req.user._id;
    const targetSessionId = sessionId || stripe_session_id || razorpay_order_id;

    if (!targetSessionId && !stripePaymentIntentId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId or stripePaymentIntentId is required for verification'
      });
    }

    let result;
    if (targetSessionId && targetSessionId.startsWith('cs_')) {
      // Stripe checkout session verification
      result = await paymentService.verifySession({
        sessionId: targetSessionId,
        userId,
        source: 'frontend'
      });
    } else {
      // Fallback fulfillment via session or payment intent id
      result = await paymentService.fulfillPaymentIdempotent({
        stripeSessionId: targetSessionId,
        stripePaymentIntentId,
        userId,
        source: 'frontend'
      });
    }

    return res.status(200).json({
      success: true,
      message: result.message,
      alreadyProcessed: result.alreadyProcessed || false,
      credits: result.credits
    });
  } catch (error) {
    const errorMsg = error.message || 'Payment verification failed';
    console.error('[PaymentController] verifyPayment Error:', errorMsg);
    const status = error.status || 400;
    return res.status(status).json({
      success: false,
      message: errorMsg
    });
  }
};

/**
 * POST /api/payments/webhook
 * Handles incoming Stripe webhooks with raw body cryptographic signature verification
 */
exports.handleWebhook = async (req, res) => {
  try {
    const webhookSignature = req.headers['stripe-signature'] || req.headers['x-stripe-signature'];
    const rawBody = req.rawBody;

    if (!rawBody) {
      return res.status(400).json({
        error: 'Missing raw request body for webhook verification'
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
        message: result.message || `You need at least ${requiredCredits} coins to start a ${callType.toLowerCase()} call. Please purchase coins to continue.`,
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
