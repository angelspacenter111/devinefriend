const crypto = require('crypto');
const mongoose = require('mongoose');
const Stripe = require('stripe');
const User = require('../models/User');
const PricingPlan = require('../models/PricingPlan');
const PaymentTransaction = require('../models/PaymentTransaction');
const Transaction = require('../models/Transaction');

/**
 * Get or initialize Stripe SDK client instance
 */
function getStripeInstance() {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey || secretKey.includes('placeholder')) {
    const error = new Error('Stripe credentials not configured in .env. Please set STRIPE_SECRET_KEY.');
    error.code = 'STRIPE_CONFIG_MISSING';
    error.status = 500;
    throw error;
  }

  return new Stripe(secretKey);
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
 * 1. Create a Stripe Checkout Session from trusted backend PricingPlan
 */
async function createOrder({ userId, packageId, returnBaseUrl = 'http://localhost:3000' }) {
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

  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
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
    const err = new Error('Invalid or inactive coin package selected');
    err.status = 404;
    throw err;
  }

  // Stripe accounts based in UAE (AE) require minimum 200 fils (~2.00 AED = ~₹53 INR)
  if (plan.price < 53) {
    const err = new Error(`Stripe account policy requires a minimum transaction value of 2.00 AED (~₹53 INR). This pack is ₹${plan.price}. Please select or update this pack to at least ₹55.`);
    err.status = 400;
    throw err;
  }

  const stripe = getStripeInstance();
  const amountPaise = Math.round(plan.price * 100);
  const receipt = generateReceipt();

  // Create Stripe Checkout Session
  const sessionConfig = {
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'inr',
          product_data: {
            name: plan.name,
            description: `${plan.credits} Coins - Talk With Ashu`
          },
          unit_amount: amountPaise
        },
        quantity: 1
      }
    ],
    metadata: {
      userId: userId.toString(),
      packageId: plan._id.toString(),
      planCode: plan.planId,
      packageName: plan.name,
      credits: plan.credits.toString()
    },
    client_reference_id: userId.toString(),
    success_url: `${returnBaseUrl}/user/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${returnBaseUrl}/user/buy-credits?cancelled=true`
  };

  if (user.email && user.email.includes('@')) {
    sessionConfig.customer_email = user.email;
  }

  const session = await stripe.checkout.sessions.create(sessionConfig);

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
    gateway: 'stripe',
    stripeSessionId: session.id,
    status: 'CREATED',
    receipt: receipt,
    notes: sessionConfig.metadata,
    source: 'frontend'
  });

  await paymentTxn.save();

  return {
    success: true,
    orderId: session.id,
    sessionId: session.id,
    checkoutUrl: session.url,
    amount: amountPaise,
    currency: 'INR',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    packageName: plan.name,
    credits: plan.credits,
    description: `${plan.credits} Coins - ${plan.name}`
  };
}

/**
 * 2. Idempotently fulfill payment and credit user account
 */
async function fulfillPaymentIdempotent({
  stripeSessionId,
  stripePaymentIntentId = null,
  userId = null,
  source = 'frontend'
}) {
  if (!stripeSessionId && !stripePaymentIntentId) {
    const err = new Error('stripeSessionId or stripePaymentIntentId is required');
    err.status = 400;
    throw err;
  }

  // Lookup payment transaction
  const query = {};
  if (stripeSessionId) {
    query.stripeSessionId = stripeSessionId;
  } else if (stripePaymentIntentId) {
    query.stripePaymentIntentId = stripePaymentIntentId;
  }

  let paymentTxn = await PaymentTransaction.findOne(query);

  // If not found and session ID provided, fallback to finding via notes/metadata
  if (!paymentTxn && stripeSessionId) {
    paymentTxn = await PaymentTransaction.findOne({
      $or: [
        { stripeSessionId },
        { 'notes.sessionId': stripeSessionId }
      ]
    });
  }

  if (!paymentTxn) {
    const err = new Error('Payment record not found for this Stripe transaction');
    err.status = 404;
    throw err;
  }

  // If userId provided, ensure the order belongs to this user
  if (userId && paymentTxn.user.toString() !== userId.toString()) {
    const err = new Error('Unauthorized: This payment does not belong to your account');
    err.status = 403;
    throw err;
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
      _id: paymentTxn._id,
      status: { $ne: 'CAPTURED' }
    },
    {
      $set: {
        status: 'CAPTURED',
        stripePaymentIntentId: stripePaymentIntentId || paymentTxn.stripePaymentIntentId,
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
    desc: `Coin Recharge (${lockedPayment.credits} Coins - ${lockedPayment.packageName})`,
    type: 'credit',
    credits: lockedPayment.credits,
    amount: `₹${lockedPayment.amount.toLocaleString('en-IN')}`,
    status: 'Successful',
    balanceBefore: balanceBefore,
    balanceAfter: balanceAfter,
    referenceType: 'PAYMENT',
    referenceId: stripePaymentIntentId || stripeSessionId || lockedPayment.stripeSessionId,
    paymentTransaction: lockedPayment._id
  });

  await txnDoc.save();

  return {
    success: true,
    alreadyProcessed: false,
    message: `Payment successful! Added ${lockedPayment.credits} coins to your account.`,
    credits: updatedUser.credits,
    paymentTransaction: lockedPayment
  };
}

/**
 * 3. Verify Stripe Checkout Session and fulfill
 */
async function verifySession({ sessionId, userId = null, source = 'redirect' }) {
  if (!sessionId) {
    const err = new Error('sessionId is required');
    err.status = 400;
    throw err;
  }

  const stripe = getStripeInstance();
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (!session) {
    const err = new Error('Stripe session not found');
    err.status = 404;
    throw err;
  }

  if (session.payment_status !== 'paid') {
    const err = new Error(`Payment is not paid (status: ${session.payment_status})`);
    err.status = 400;
    throw err;
  }

  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;

  return await fulfillPaymentIdempotent({
    stripeSessionId: session.id,
    stripePaymentIntentId: paymentIntentId,
    userId,
    source
  });
}

/**
 * 4. Process Stripe Webhook Event
 */
async function processWebhook({ rawBody, webhookSignature }) {
  if (!rawBody) {
    const err = new Error('Missing raw request body');
    err.status = 400;
    throw err;
  }

  const stripe = getStripeInstance();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  if (webhookSecret && webhookSignature) {
    try {
      event = stripe.webhooks.constructEvent(rawBody, webhookSignature, webhookSecret);
    } catch (err) {
      console.error('[Stripe Webhook Signature Verification Error]:', err.message);
      const error = new Error(`Webhook signature verification failed: ${err.message}`);
      error.status = 400;
      throw error;
    }
  } else {
    // In local dev without configured STRIPE_WEBHOOK_SECRET, parse JSON
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch (e) {
      const err = new Error('Invalid webhook JSON payload');
      err.status = 400;
      throw err;
    }
  }

  const eventType = event.type;
  console.log('[Stripe Webhook Received]:', eventType);

  if (eventType === 'checkout.session.completed' || eventType === 'checkout.session.async_payment_succeeded') {
    const session = event.data?.object;
    if (session && session.payment_status === 'paid') {
      const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

      const result = await fulfillPaymentIdempotent({
        stripeSessionId: session.id,
        stripePaymentIntentId: paymentIntentId,
        source: 'webhook'
      });
      return { status: 'ok', event: eventType, result };
    }
  } else if (eventType === 'payment_intent.succeeded') {
    const paymentIntent = event.data?.object;
    if (paymentIntent) {
      const result = await fulfillPaymentIdempotent({
        stripePaymentIntentId: paymentIntent.id,
        source: 'webhook'
      });
      return { status: 'ok', event: eventType, result };
    }
  } else if (eventType === 'payment_intent.payment_failed') {
    const paymentIntent = event.data?.object;
    if (paymentIntent) {
      await PaymentTransaction.findOneAndUpdate(
        { stripePaymentIntentId: paymentIntent.id, status: { $ne: 'CAPTURED' } },
        {
          $set: {
            status: 'FAILED',
            failureReason: paymentIntent.last_payment_error?.message || 'Payment failed'
          }
        }
      );
    }
    return { status: 'ok', event: eventType, message: 'Payment failure recorded' };
  }

  return { status: 'ok', event: eventType, ignored: true };
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
  getStripeInstance,
  createOrder,
  verifySession,
  fulfillPaymentIdempotent,
  processWebhook,
  getUserPaymentHistory,
  getUserCreditTransactions
};
