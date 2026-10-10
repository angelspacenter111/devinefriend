require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const PricingPlan = require('../models/PricingPlan');
const PaymentTransaction = require('../models/PaymentTransaction');
const Transaction = require('../models/Transaction');
const paymentService = require('../services/paymentService');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('STARTING STRIPE INTEGRATION TEST SUITE');
  console.log('====================================================\n');

  try {
    await connectDB();

    // 1. Verify Stripe Client Init
    console.log('TEST 1: Stripe Client Initialization');
    const stripe = paymentService.getStripeInstance();
    assert(stripe != null, 'Stripe SDK initialized successfully with STRIPE_SECRET_KEY');

    // 2. Setup Test User and Test Plan
    console.log('\nTEST 2: Setup Test User & Pricing Plan');
    const testMobile = `999${Date.now().toString().slice(-7)}`;
    let testUser = await User.create({
      name: 'Stripe Test User',
      email: 'stripetest@example.com',
      mobile: testMobile,
      password: 'testPassword123',
      credits: 10,
      role: 'user'
    });
    assert(testUser && testUser._id, `Test user created with ID ${testUser._id} and credits: ${testUser.credits}`);

    let testPlan = await PricingPlan.findOne({ planId: 'PLAN-TEST-STRIPE' });
    if (!testPlan) {
      testPlan = await PricingPlan.create({
        planId: 'PLAN-TEST-STRIPE',
        name: 'Stripe Test Pack',
        badge: 'Test',
        category: 'Voice',
        credits: 15,
        price: 199,
        description: 'Test pack for Stripe automated verification',
        isActive: true,
        order: 99
      });
    }
    assert(testPlan && testPlan.planId, `Test pricing plan ready: ${testPlan.name} (₹${testPlan.price})`);

    // 3. Create Stripe Checkout Order
    console.log('\nTEST 3: Create Stripe Checkout Session (Order)');
    const orderResult = await paymentService.createOrder({
      userId: testUser._id,
      packageId: testPlan.planId,
      returnBaseUrl: 'http://localhost:3000'
    });

    assert(orderResult.success === true, 'Order created successfully');
    assert(typeof orderResult.sessionId === 'string' && orderResult.sessionId.startsWith('cs_'), `Valid Stripe session ID returned: ${orderResult.sessionId}`);
    assert(typeof orderResult.checkoutUrl === 'string' && orderResult.checkoutUrl.includes('stripe.com'), `Valid Stripe checkout URL generated: ${orderResult.checkoutUrl.slice(0, 50)}...`);
    assert(orderResult.amount === 19900, 'Amount correctly calculated in paise (₹199 = 19900 paise)');
    assert(orderResult.credits === 15, 'Correct credits recorded');

    // Verify DB record for PaymentTransaction
    const dbTxn = await PaymentTransaction.findOne({ stripeSessionId: orderResult.sessionId });
    assert(dbTxn != null, 'PaymentTransaction record created in MongoDB');
    assert(dbTxn.status === 'CREATED', 'Initial transaction status is CREATED');
    assert(dbTxn.gateway === 'stripe', 'Gateway set to stripe');

    // 4. Test Idempotent Fulfillment
    console.log('\nTEST 4: Idempotent Payment Fulfillment & Wallet Crediting');
    const fakePaymentIntentId = `pi_test_${Date.now()}`;
    const fulfillResult = await paymentService.fulfillPaymentIdempotent({
      stripeSessionId: orderResult.sessionId,
      stripePaymentIntentId: fakePaymentIntentId,
      userId: testUser._id,
      source: 'frontend'
    });

    assert(fulfillResult.success === true, 'Payment fulfilled successfully');
    assert(fulfillResult.alreadyProcessed === false, 'First fulfillment marked alreadyProcessed: false');
    assert(fulfillResult.credits === 25, `User credits incremented from 10 to 25 (received: ${fulfillResult.credits})`);

    const updatedDbTxn = await PaymentTransaction.findOne({ stripeSessionId: orderResult.sessionId });
    assert(updatedDbTxn.status === 'CAPTURED', 'Transaction status updated to CAPTURED');
    assert(updatedDbTxn.stripePaymentIntentId === fakePaymentIntentId, 'stripePaymentIntentId saved');
    assert(updatedDbTxn.paidAt != null, 'paidAt timestamp set');

    // Check financial Ledger transaction record
    const ledgerTxn = await Transaction.findOne({ paymentTransaction: updatedDbTxn._id });
    assert(ledgerTxn != null, 'Financial ledger Transaction document created');
    assert(ledgerTxn.type === 'credit', 'Ledger transaction type is credit');
    assert(ledgerTxn.credits === 15, 'Ledger transaction credited 15 credits');
    assert(ledgerTxn.balanceBefore === 10, 'balanceBefore correctly tracked as 10');
    assert(ledgerTxn.balanceAfter === 25, 'balanceAfter correctly tracked as 25');

    // 5. Test Double-Credit Prevention (Idempotency)
    console.log('\nTEST 5: Idempotency Protection (Prevent Double Credit)');
    const secondFulfill = await paymentService.fulfillPaymentIdempotent({
      stripeSessionId: orderResult.sessionId,
      stripePaymentIntentId: fakePaymentIntentId,
      userId: testUser._id,
      source: 'webhook'
    });

    assert(secondFulfill.success === true, 'Second call returns success response');
    assert(secondFulfill.alreadyProcessed === true, 'Second call recognized alreadyProcessed: true');

    const freshUser = await User.findById(testUser._id);
    assert(freshUser.credits === 25, `User credits remained strictly 25 without double addition (credits: ${freshUser.credits})`);

    // 6. Test Webhook Processing with checkout.session.completed
    console.log('\nTEST 6: Webhook Processing for checkout.session.completed');
    const webhookOrderResult = await paymentService.createOrder({
      userId: testUser._id,
      packageId: testPlan.planId,
      returnBaseUrl: 'http://localhost:3000'
    });

    const mockWebhookPayload = JSON.stringify({
      id: `evt_test_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: webhookOrderResult.sessionId,
          payment_status: 'paid',
          payment_intent: `pi_webhook_${Date.now()}`
        }
      }
    });

    const webhookResult = await paymentService.processWebhook({
      rawBody: Buffer.from(mockWebhookPayload)
    });

    assert(webhookResult.status === 'ok', 'Webhook returned status: ok');
    assert(webhookResult.event === 'checkout.session.completed', 'Webhook event handled');

    const userAfterWebhook = await User.findById(testUser._id);
    assert(userAfterWebhook.credits === 40, `User credits incremented to 40 via webhook (current: ${userAfterWebhook.credits})`);

    // Clean up test data
    await PaymentTransaction.deleteMany({ user: testUser._id });
    await Transaction.deleteMany({ user: testUser._id });
    await User.findByIdAndDelete(testUser._id);
    await PricingPlan.findByIdAndDelete(testPlan._id);
    console.log('\nCleaned up temporary test records.');

    console.log('\n====================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Unhandled error during testing:', err);
    process.exit(1);
  }
}

runTests();
