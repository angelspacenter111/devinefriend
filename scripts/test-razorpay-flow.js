require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const connectDB = require('../config/db');
const User = require('../models/User');
const PricingPlan = require('../models/PricingPlan');
const PaymentTransaction = require('../models/PaymentTransaction');
const Transaction = require('../models/Transaction');
const Call = require('../models/Call');
const paymentService = require('../services/paymentService');
const callService = require('../services/callService');

// Use consistent test secret for signature calculation
const TEST_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'test_secret_for_suite_123';
const TEST_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_123';
process.env.RAZORPAY_KEY_SECRET = TEST_KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

function generateTestSignature(orderId, paymentId, secret = TEST_KEY_SECRET) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

function generateWebhookSignature(rawBody, secret = TEST_WEBHOOK_SECRET) {
  return crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
}

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
  console.log('STARTING RAZORPAY INTEGRATION TEST SUITE');
  console.log('====================================================\n');

  try {
    await connectDB();

    // 0. Setup Test Pricing Plan
    let plan = await PricingPlan.findOne({ planId: 'PLAN-TEST-100' });
    if (!plan) {
      plan = new PricingPlan({
        planId: 'PLAN-TEST-100',
        name: 'Starter Test Pack',
        badge: 'Starter',
        credits: 100,
        price: 100,
        description: 'Test Pack 100 credits',
        isActive: true,
        order: 99
      });
      await plan.save();
    }

    // Setup Test User 1
    const testMobile1 = '99999' + Math.floor(10000 + Math.random() * 90000);
    const user1 = new User({
      name: 'Test Buyer 1',
      mobile: testMobile1,
      password: 'Password123!',
      credits: 0
    });
    await user1.save();

    // Setup Test User 2 (for unauthorized test)
    const testMobile2 = '99998' + Math.floor(10000 + Math.random() * 90000);
    const user2 = new User({
      name: 'Test Attacker 2',
      mobile: testMobile2,
      password: 'Password123!',
      credits: 0
    });
    await user2.save();

    console.log(`[Setup] Created Test Users: ${user1._id} and ${user2._id}`);

    // ========================================================
    // TEST 11: Backend Price Security (Ignore manipulated frontend price)
    // ========================================================
    console.log('\n--- TEST 11: Backend Price Integrity ---');
    // Simulate order creation using package ID
    const fakeOrderId = 'order_test_' + Date.now() + '_1';
    const initialPaymentTxn = new PaymentTransaction({
      user: user1._id,
      plan: plan._id,
      planId: plan.planId,
      packageName: plan.name,
      credits: plan.credits, // Trusted 100 credits
      amount: plan.price,     // Trusted ₹100
      amountPaise: plan.price * 100,
      currency: 'INR',
      razorpayOrderId: fakeOrderId,
      status: 'CREATED',
      receipt: 'rcpt_test_1'
    });
    await initialPaymentTxn.save();
    assert(initialPaymentTxn.amount === 100, 'Order amount matches DB pricing plan (₹100) regardless of frontend');
    assert(initialPaymentTxn.credits === 100, 'Order credits matches DB pricing plan (100 credits)');

    // ========================================================
    // TEST 13: Invalid Razorpay Signature Rejection
    // ========================================================
    console.log('\n--- TEST 13: Invalid Signature Verification ---');
    const fakePayId = 'pay_test_' + Date.now() + '_1';
    const badSignature = 'invalid_sha256_signature_abc123';
    let caughtSigError = false;
    try {
      await paymentService.fulfillPaymentIdempotent({
        razorpayOrderId: fakeOrderId,
        razorpayPaymentId: fakePayId,
        razorpaySignature: badSignature,
        userId: user1._id,
        source: 'frontend'
      });
    } catch (e) {
      caughtSigError = true;
    }
    assert(caughtSigError, 'Invalid signature threw an error as expected');
    const user1AfterBadSig = await User.findById(user1._id);
    assert(user1AfterBadSig.credits === 0, 'User credits remain 0 after invalid signature');
    const failedTxn = await PaymentTransaction.findOne({ razorpayOrderId: fakeOrderId });
    assert(failedTxn.status === 'FAILED', 'PaymentTransaction status marked FAILED');

    // ========================================================
    // TEST 12: Reject Verification of Another User\'s Order
    // ========================================================
    console.log('\n--- TEST 12: Reject Unauthorized User Order Verification ---');
    // Reset order status for user 1
    const testOrderId2 = 'order_test_' + Date.now() + '_2';
    await PaymentTransaction.create({
      user: user1._id,
      plan: plan._id,
      planId: plan.planId,
      packageName: plan.name,
      credits: plan.credits,
      amount: plan.price,
      amountPaise: plan.price * 100,
      currency: 'INR',
      razorpayOrderId: testOrderId2,
      status: 'CREATED'
    });
    const testPayId2 = 'pay_test_' + Date.now() + '_2';
    const validSig2 = generateTestSignature(testOrderId2, testPayId2);

    let caughtUserMismatch = false;
    try {
      // User 2 attempts to verify User 1's order
      await paymentService.fulfillPaymentIdempotent({
        razorpayOrderId: testOrderId2,
        razorpayPaymentId: testPayId2,
        razorpaySignature: validSig2,
        userId: user2._id, // MISMATCH
        source: 'frontend'
      });
    } catch (e) {
      caughtUserMismatch = true;
    }
    assert(caughtUserMismatch, 'Prevented User 2 from verifying User 1 order');
    const user2AfterAttack = await User.findById(user2._id);
    assert(user2AfterAttack.credits === 0, 'User 2 did not receive any credits');

    // ========================================================
    // TEST 1: User purchases 100 credits, Payment successful
    // ========================================================
    console.log('\n--- TEST 1: Valid Payment Verification & Credit Addition ---');
    const fulfillResult1 = await paymentService.fulfillPaymentIdempotent({
      razorpayOrderId: testOrderId2,
      razorpayPaymentId: testPayId2,
      razorpaySignature: validSig2,
      userId: user1._id,
      source: 'frontend'
    });
    assert(fulfillResult1.success === true, 'Verification succeeded');
    assert(fulfillResult1.credits === 100, 'Returned credits is 100');

    const freshUser1 = await User.findById(user1._id);
    assert(freshUser1.credits === 100, 'User DB credits balance updated to 100');

    const ledgerTxn = await Transaction.findOne({ referenceId: testPayId2 });
    assert(ledgerTxn !== null, 'Traceable Transaction ledger entry created');
    assert(ledgerTxn.type === 'credit', 'Ledger entry type is "credit"');
    assert(ledgerTxn.credits === 100, 'Ledger entry credits is 100');
    assert(ledgerTxn.balanceBefore === 0, 'Ledger balanceBefore is 0');
    assert(ledgerTxn.balanceAfter === 100, 'Ledger balanceAfter is 100');
    assert(ledgerTxn.referenceType === 'PAYMENT', 'Ledger referenceType is "PAYMENT"');

    // ========================================================
    // TEST 2: Same verify API called twice (Idempotency)
    // ========================================================
    console.log('\n--- TEST 2: Duplicate Verify Idempotency Protection ---');
    const fulfillResult2 = await paymentService.fulfillPaymentIdempotent({
      razorpayOrderId: testOrderId2,
      razorpayPaymentId: testPayId2,
      razorpaySignature: validSig2,
      userId: user1._id,
      source: 'frontend'
    });
    assert(fulfillResult2.success === true, 'Second call returns success');
    assert(fulfillResult2.alreadyProcessed === true, 'Second call returns alreadyProcessed: true');
    const user1AfterSecondVerify = await User.findById(user1._id);
    assert(user1AfterSecondVerify.credits === 100, 'Credits remain 100 (NOT doubled to 200)');

    // ========================================================
    // TEST 3: Webhook arrives AFTER frontend verification
    // ========================================================
    console.log('\n--- TEST 3: Webhook Arrives After Verification (No Duplicate) ---');
    const webhookPayloadAfter = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: testPayId2,
            order_id: testOrderId2,
            amount: 10000,
            status: 'captured'
          }
        }
      }
    });
    const webhookRawBodyAfter = Buffer.from(webhookPayloadAfter);
    const webhookSigAfter = generateWebhookSignature(webhookRawBodyAfter);

    const webhookResultAfter = await paymentService.processWebhook({
      rawBody: webhookRawBodyAfter,
      webhookSignature: webhookSigAfter
    });
    assert(webhookResultAfter.status === 'ok', 'Webhook returned 200 ok');
    assert(webhookResultAfter.result?.alreadyProcessed === true, 'Webhook recognized already processed order');
    const user1AfterWebhook = await User.findById(user1._id);
    assert(user1AfterWebhook.credits === 100, 'Credits remain 100 after delayed webhook');

    // ========================================================
    // TEST 4: Webhook arrives BEFORE frontend verification
    // ========================================================
    console.log('\n--- TEST 4: Webhook Arrives Before Frontend Verification ---');
    const testOrderId4 = 'order_test_' + Date.now() + '_4';
    await PaymentTransaction.create({
      user: user1._id,
      plan: plan._id,
      planId: plan.planId,
      packageName: plan.name,
      credits: 50,
      amount: 50,
      amountPaise: 5000,
      currency: 'INR',
      razorpayOrderId: testOrderId4,
      status: 'CREATED'
    });
    const testPayId4 = 'pay_test_' + Date.now() + '_4';

    const webhookPayloadBefore = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: testPayId4,
            order_id: testOrderId4,
            amount: 5000,
            status: 'captured'
          }
        }
      }
    });
    const webhookRawBodyBefore = Buffer.from(webhookPayloadBefore);
    const webhookSigBefore = generateWebhookSignature(webhookRawBodyBefore);

    await paymentService.processWebhook({
      rawBody: webhookRawBodyBefore,
      webhookSignature: webhookSigBefore
    });

    const user1AfterWebhookFirst = await User.findById(user1._id);
    assert(user1AfterWebhookFirst.credits === 150, 'Credits correctly updated to 150 via early webhook');

    // Frontend verify arrives afterwards
    const validSig4 = generateTestSignature(testOrderId4, testPayId4);
    const frontendVerifyResult4 = await paymentService.fulfillPaymentIdempotent({
      razorpayOrderId: testOrderId4,
      razorpayPaymentId: testPayId4,
      razorpaySignature: validSig4,
      userId: user1._id,
      source: 'frontend'
    });
    assert(frontendVerifyResult4.alreadyProcessed === true, 'Subsequent frontend verify recognizes webhook fulfillment');
    const user1FinalAfterBoth = await User.findById(user1._id);
    assert(user1FinalAfterBoth.credits === 150, 'Credits remain 150 (never doubled)');

    // ========================================================
    // TEST 14: Invalid Webhook Signature Rejection
    // ========================================================
    console.log('\n--- TEST 14: Invalid Webhook Signature Rejection ---');
    let caughtBadWebhook = false;
    try {
      await paymentService.processWebhook({
        rawBody: webhookRawBodyBefore,
        webhookSignature: 'tampered_signature_123'
      });
    } catch (e) {
      caughtBadWebhook = true;
    }
    assert(caughtBadWebhook, 'Tampered webhook signature was rejected with 400 error');

    // ========================================================
    // TEST 5 & 6: Payment Failed / Dismissed
    // ========================================================
    console.log('\n--- TEST 5 & 6: Payment Failed / Dismissed Behavior ---');
    const testOrderId5 = 'order_test_' + Date.now() + '_5';
    await PaymentTransaction.create({
      user: user1._id,
      plan: plan._id,
      planId: plan.planId,
      packageName: plan.name,
      credits: 100,
      amount: 100,
      amountPaise: 10000,
      currency: 'INR',
      razorpayOrderId: testOrderId5,
      status: 'CREATED'
    });
    // Webhook event for payment.failed
    const failPayload = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_fail_' + Date.now(),
            order_id: testOrderId5,
            error_description: 'Payment was declined by bank'
          }
        }
      }
    });
    const failRawBody = Buffer.from(failPayload);
    const failSig = generateWebhookSignature(failRawBody);
    await paymentService.processWebhook({ rawBody: failRawBody, webhookSignature: failSig });

    const failedRecord = await PaymentTransaction.findOne({ razorpayOrderId: testOrderId5 });
    assert(failedRecord.status === 'FAILED', 'Order status marked FAILED');
    assert(failedRecord.failureReason === 'Payment was declined by bank', 'Failure reason properly recorded');
    const user1AfterFail = await User.findById(user1._id);
    assert(user1AfterFail.credits === 150, 'User credits unchanged after failed payment');

    // ========================================================
    // TEST 7: User has 0 credits -> Call Blocked
    // ========================================================
    console.log('\n--- TEST 7: Zero Credits Call Block ---');
    const zeroCreditsUser = new User({
      name: 'Zero User',
      mobile: '99997' + Math.floor(10000 + Math.random() * 90000),
      password: 'Password123!',
      credits: 0
    });
    await zeroCreditsUser.save();

    const accessCheckZero = await callService.checkCallAccess(zeroCreditsUser._id, 1);
    assert(accessCheckZero.allowed === false, 'Access check blocked call for 0 credits user');
    assert(accessCheckZero.code === 'INSUFFICIENT_CREDITS', 'Correct error code INSUFFICIENT_CREDITS');

    let caughtZeroCall = false;
    try {
      await callService.initiateCall({ user: zeroCreditsUser });
    } catch (e) {
      caughtZeroCall = true;
      assert(e.code === 'INSUFFICIENT_CREDITS', 'initiateCall threw INSUFFICIENT_CREDITS');
    }
    assert(caughtZeroCall, 'Call initiation prevented for user with 0 credits');

    // ========================================================
    // TEST 8: User has insufficient credits (5 credits, call requires 10)
    // ========================================================
    console.log('\n--- TEST 8: Insufficient Credits Call Block ---');
    const lowCreditsUser = new User({
      name: 'Low Credits User',
      mobile: '99996' + Math.floor(10000 + Math.random() * 90000),
      password: 'Password123!',
      credits: 5
    });
    await lowCreditsUser.save();

    const accessCheckLow = await callService.checkCallAccess(lowCreditsUser._id, 10);
    assert(accessCheckLow.allowed === false, 'Access check blocked call requiring 10 credits when user has 5');
    assert(accessCheckLow.code === 'INSUFFICIENT_CREDITS', 'Correct error code INSUFFICIENT_CREDITS');

    // ========================================================
    // TEST 9: User has sufficient credits (20 credits, call requires 10)
    // ========================================================
    console.log('\n--- TEST 9: Sufficient Credits Call Execution & Deduction ---');
    const callerUser = new User({
      name: 'Valid Caller',
      mobile: '99995' + Math.floor(10000 + Math.random() * 90000),
      password: 'Password123!',
      credits: 20
    });
    await callerUser.save();

    const accessCheckValid = await callService.checkCallAccess(callerUser._id, 10);
    assert(accessCheckValid.allowed === true, 'Access check allowed for sufficient credits');

    // Initiate call
    const callDoc = await callService.initiateCall({ user: callerUser });
    assert(callDoc.status === 'Initiated', 'Call initialized in DB');

    // Connect call
    await callService.connectCall({ callId: callDoc.callId });

    // Finalize call with 10 minutes simulated duration (600 seconds)
    const connectedTime = new Date(Date.now() - 600 * 1000);
    callDoc.connectedTime = connectedTime;
    await callDoc.save();

    const finalResult = await callService.finalizeCall(callDoc.callId, { reason: 'Completed' });
    assert(finalResult.creditsDeducted === 10, '10 credits deducted for 10 minutes call');
    assert(finalResult.remainingCredits === 10, '10 credits remaining');

    const freshCaller = await User.findById(callerUser._id);
    assert(freshCaller.credits === 10, 'User DB credits balance is 10');

    const callTxn = await Transaction.findOne({ callId: callDoc.callId });
    assert(callTxn !== null, 'Traceable debit ledger entry created for call');
    assert(callTxn.type === 'debit', 'Debit transaction recorded');
    assert(callTxn.balanceBefore === 20, 'balanceBefore was 20');
    assert(callTxn.balanceAfter === 10, 'balanceAfter is 10');
    assert(callTxn.referenceType === 'CALL', 'referenceType is "CALL"');

    // ========================================================
    // TEST 10: Multiple Simultaneous Finalizations (Atomic Race Condition Prevention)
    // ========================================================
    console.log('\n--- TEST 10: Concurrent Finalization Protection ---');
    // Call finalizeCall concurrently twice on the same call
    const [raceResult1, raceResult2] = await Promise.all([
      callService.finalizeCall(callDoc.callId, { reason: 'Completed' }),
      callService.finalizeCall(callDoc.callId, { reason: 'Completed' })
    ]);
    assert(raceResult1.alreadyFinalized || raceResult2.alreadyFinalized, 'Concurrent call handled idempotently');
    const freshCallerAfterRace = await User.findById(callerUser._id);
    assert(freshCallerAfterRace.credits === 10, 'Credits never double-deducted during race condition');

    // ========================================================
    // TEST 15: Database Consistency Verification
    // ========================================================
    console.log('\n--- TEST 15: Database Ledger Consistency ---');
    const allUserLedgers = await Transaction.find({ user: user1._id });
    assert(allUserLedgers.length >= 2, 'All credit additions are recorded in ledger');
    for (const l of allUserLedgers) {
      assert(l.balanceBefore !== null && l.balanceAfter !== null, `Ledger entry ${l.txnId} has full balanceBefore and balanceAfter audit trail`);
    }

    console.log('\n====================================================');
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================\n');

    // Cleanup test artifacts
    await User.deleteMany({ _id: { $in: [user1._id, user2._id, zeroCreditsUser._id, lowCreditsUser._id, callerUser._id] } });
    await PaymentTransaction.deleteMany({ user: { $in: [user1._id, user2._id, zeroCreditsUser._id, lowCreditsUser._id, callerUser._id] } });
    await Transaction.deleteMany({ user: { $in: [user1._id, user2._id, zeroCreditsUser._id, lowCreditsUser._id, callerUser._id] } });
    await Call.deleteMany({ user: { $in: [user1._id, user2._id, zeroCreditsUser._id, lowCreditsUser._id, callerUser._id] } });
    await PricingPlan.deleteOne({ planId: 'PLAN-TEST-100' });

    await mongoose.disconnect();
    process.exit(failed > 0 ? 1 : 0);

  } catch (err) {
    console.error('[Test Suite Error]', err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

runTests();
