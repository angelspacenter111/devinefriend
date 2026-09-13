const crypto = require('crypto');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const User = require('../models/User');
const PricingPlan = require('../models/PricingPlan');
const PaymentTransaction = require('../models/PaymentTransaction');
const Transaction = require('../models/Transaction');

/**
 * Get or initialize Razorpay SDK client instance
 */
function getRazorpayInstance() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret || key_id.includes('placeholder') || key_secret.includes('placeholder')) {
    const error = new Error('Razorpay TEST credentials not configured in .env. Please set your real RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
    error.code = 'RAZORPAY_CONFIG_MISSING';
    error.status = 500;
    throw error;
  }

  return new Razorpay({
    key_id,
    key_secret
  });
}

/**
 * Generate a unique Receipt string
 */
function generateReceipt() {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(1000 + Math.random() * 9000);
  return `rcpt_${timestamp}_${random}`;
}

/**
 * Generate a unique Transaction ID for the ledger
 */
function generateTxnId() {
  const timestamp = Date.now().toString().slice(-4);
  const random1 = Math.floor(1000 + Math.random() * 9000);
  const random2 = Math.floor(10 + Math.random() * 90);
  return `TXN-${timestamp}${random1}${random2}`;
}

/**
 * 1. Create a Razorpay Order from trusted backend PricingPlan
 */
async function createOrder({ userId, packageId }) {
  if (!userId) {
    const err = new Error('User ID is required');
    err.status = 401;
    throw err;
  }

  if (!packageId) {
    const err = new Error('Package ID is required');
    err.status = 400;
    throw err;
  }

  // Find plan by _id or planId
  const isObjectId = mongoose.isValidObjectId(packageId);
  const planQuery = {
    $or: [
      ...(isObjectId ? [{ _id: packageId }] : []),
      { planId: packageId }
    ],
    isActive: true
  };

  const plan = await PricingPlan.findOne(planQuery);
  if (!plan) {
    const err = new Error('Invalid or inactive credit package selected');
    err.status = 404;
    throw err;
  }

  const razorpay = getRazorpayInstance();
  const amountPaise = Math.round(plan.price * 100);
  const receipt = generateReceipt();

  const options = {
    amount: amountPaise,
    currency: 'INR',
    receipt: receipt,
    notes: {
      userId: userId.toString(),
      packageId: plan._id.toString(),
      planCode: plan.planId,
      packageName: plan.name,
      credits: plan.credits.toString()
    }
  };

  const razorpayOrder = await razorpay.orders.create(options);

  // Record initial PaymentTransaction in DB
  const paymentTxn = new PaymentTransaction({
    user: userId,
    plan: plan._id,
    planId: plan.planId,
    packageName: plan.name,
    credits: plan.credits,
    amount: plan.price,
    amountPaise: amountPaise,
    currency: 'INR',
    razorpayOrderId: razorpayOrder.id,
    status: 'CREATED',
    receipt: receipt,
    notes: options.notes,
    source: 'frontend'
  });

  await paymentTxn.save();

  return {
    success: true,
    orderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
    packageName: plan.name,
    credits: plan.credits,
    description: `${plan.credits} Credits - ${plan.name}`
  };
}

/**
 * 2. Cryptographically verify Razorpay Payment Signature
 */
function verifySignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return false;
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    throw new Error('Razorpay Key Secret is not configured');
  }

  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(body)
    .digest('hex');

  return expectedSignature === razorpaySignature;
}

/**
 * 3. Idempotently fulfill payment and credit user account
 */
async function fulfillPaymentIdempotent({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature = null,
  userId = null,
  source = 'frontend'
}) {
  if (!razorpayOrderId) {
    const err = new Error('razorpay_order_id is required');
    err.status = 400;
    throw err;
  }

  if (!razorpayPaymentId) {
    const err = new Error('razorpay_payment_id is required');
    err.status = 400;
    throw err;
  }

  // Lookup payment transaction
  const paymentTxn = await PaymentTransaction.findOne({ razorpayOrderId });
  if (!paymentTxn) {
    const err = new Error('Payment order record not found');
    err.status = 404;
    throw err;
  }

  // If userId provided, ensure the order belongs to this user
  if (userId && paymentTxn.user.toString() !== userId.toString()) {
    const err = new Error('Unauthorized: This payment order does not belong to your account');
    err.status = 403;
    throw err;
  }

  // Signature check if signature provided (frontend verify flow)
  if (razorpaySignature) {
    const isSignatureValid = verifySignature({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature
    });

    if (!isSignatureValid) {
      await PaymentTransaction.findOneAndUpdate(
        { razorpayOrderId },
        {
          $set: {
            status: 'FAILED',
            failureReason: 'Signature verification mismatch',
            razorpayPaymentId
          }
        }
      );
      const err = new Error('Invalid Razorpay signature verification failed');
      err.status = 400;
      throw err;
    }
  }

  // Idempotency: check if already fulfilled
  if (paymentTxn.status === 'CAPTURED') {
    const freshUser = await User.findById(paymentTxn.user);
    return {
      success: true,
      alreadyProcessed: true,
      message: 'Payment has already been verified and processed.',
      credits: freshUser ? freshUser.credits : 0,
      paymentTransaction: paymentTxn
    };
  }

  // Atomic state lock: Transition from !CAPTURED to CAPTURED
  const lockedPayment = await PaymentTransaction.findOneAndUpdate(
    {
      razorpayOrderId: razorpayOrderId,
      status: { $ne: 'CAPTURED' }
    },
    {
      $set: {
        status: 'CAPTURED',
        razorpayPaymentId: razorpayPaymentId,
        razorpaySignature: razorpaySignature || paymentTxn.razorpaySignature,
        source: source,
        paidAt: new Date()
      }
    },
    { returnDocument: 'after' }
  );

  if (!lockedPayment) {
    // Concurrently captured by webhook or simultaneous client request
    const freshUser = await User.findById(paymentTxn.user);
    return {
      success: true,
      alreadyProcessed: true,
      message: 'Payment has already been processed.',
      credits: freshUser ? freshUser.credits : 0,
      paymentTransaction: paymentTxn
    };
  }

  // Retrieve current user balance before crediting
  const beforeUser = await User.findById(lockedPayment.user);
  const balanceBefore = beforeUser ? beforeUser.credits : 0;

  // Atomically increment credits
  const updatedUser = await User.findByIdAndUpdate(
    lockedPayment.user,
    { $inc: { credits: lockedPayment.credits } },
    { returnDocument: 'after' }
  );

  const balanceAfter = updatedUser ? updatedUser.credits : balanceBefore + lockedPayment.credits;

  // Record traceable Ledger entry in Transaction collection
  const txnDoc = new Transaction({
    txnId: generateTxnId(),
    user: lockedPayment.user,
    desc: `Credit Recharge (${lockedPayment.credits} Credits - ${lockedPayment.packageName})`,
    type: 'credit',
    credits: lockedPayment.credits,
    amount: `₹${lockedPayment.amount.toLocaleString('en-IN')}`,
    status: 'Successful',
    balanceBefore: balanceBefore,
    balanceAfter: balanceAfter,
    referenceType: 'PAYMENT',
    referenceId: razorpayPaymentId,
    paymentTransaction: lockedPayment._id
  });

  await txnDoc.save();

  return {
    success: true,
    alreadyProcessed: false,
    message: `Payment successful! Added ${lockedPayment.credits} credits to your account.`,
    credits: updatedUser.credits,
    paymentTransaction: lockedPayment
  };
}

/**
 * 4. Process Razorpay Webhook Event
 */
async function processWebhook({ rawBody, webhookSignature }) {
  if (!rawBody || !webhookSignature) {
    const err = new Error('Missing raw body or webhook signature header');
    err.status = 400;
    throw err;
  }

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    const err = new Error('RAZORPAY_WEBHOOK_SECRET is not configured');
    err.status = 500;
    throw err;
  }

  // Validate webhook cryptographic signature
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  if (expectedSignature !== webhookSignature) {
    const err = new Error('Webhook signature mismatch');
    err.status = 400;
    throw err;
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    const err = new Error('Invalid webhook JSON payload');
    err.status = 400;
    throw err;
  }

  const eventName = event.event;

  if (eventName === 'payment.captured' || eventName === 'order.paid') {
    const paymentEntity = event.payload?.payment?.entity;
    const razorpayOrderId = paymentEntity?.order_id || event.payload?.order?.entity?.id;
    const razorpayPaymentId = paymentEntity?.id;

    if (razorpayOrderId && razorpayPaymentId) {
      const result = await fulfillPaymentIdempotent({
        razorpayOrderId,
        razorpayPaymentId,
        source: 'webhook'
      });
      return { status: 'ok', event: eventName, result };
    }
  } else if (eventName === 'payment.failed') {
    const paymentEntity = event.payload?.payment?.entity;
    const razorpayOrderId = paymentEntity?.order_id;
    const razorpayPaymentId = paymentEntity?.id;
    const failureReason = paymentEntity?.error_description || 'Payment failed';

    if (razorpayOrderId) {
      await PaymentTransaction.findOneAndUpdate(
        { razorpayOrderId, status: { $ne: 'CAPTURED' } },
        {
          $set: {
            status: 'FAILED',
            razorpayPaymentId,
            failureReason
          }
        }
      );
    }
    return { status: 'ok', event: eventName, message: 'Payment failure recorded' };
  }

  return { status: 'ok', event: eventName, ignored: true };
}

/**
 * 5. Fetch payment history for a user
 */
async function getUserPaymentHistory(userId, limit = 20) {
  return await PaymentTransaction.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(limit);
}

/**
 * 6. Fetch credit ledger transactions for a user
 */
async function getUserCreditTransactions(userId, limit = 30) {
  return await Transaction.find({ user: userId })
    .sort({ date: -1, createdAt: -1 })
    .limit(limit);
}

module.exports = {
  createOrder,
  verifySignature,
  fulfillPaymentIdempotent,
  processWebhook,
  getUserPaymentHistory,
  getUserCreditTransactions,
  getRazorpayInstance
};
