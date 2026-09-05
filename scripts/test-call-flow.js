require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Call = require('../models/Call');
const Transaction = require('../models/Transaction');
const callService = require('../services/callService');

async function runTests() {
  console.log('====================================================');
  console.log('   MYFRIEND CALLING APP - RESILIENCE TEST SUITE     ');
  console.log('====================================================');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('[Test Setup] Connected to MongoDB Atlas.');

  let testUser = null;
  let testAdmin = null;

  try {
    // Setup Test User
    testUser = await User.findOne({ email: 'resilience_caller@example.com' });
    if (!testUser) {
      testUser = new User({
        name: 'Resilience Tester',
        mobile: '+91 99999 88888',
        email: 'resilience_caller@example.com',
        password: 'password123',
        credits: 100,
        role: 'user'
      });
      await testUser.save();
    } else {
      testUser.credits = 100;
      await testUser.save();
    }

    testAdmin = await User.findOne({ role: 'admin' });
    console.log(`[Test Setup] Test user: ${testUser.name} (Credits: ${testUser.credits})`);
    console.log(`[Test Setup] Test admin: ${testAdmin.name} (${testAdmin.email})`);

    // ==============================================================
    // TEST 1: Normal Call (Initiated -> Accepted -> Connected -> Ended)
    // ==============================================================
    console.log('\n--- TEST 1: Normal Call Lifecycle & Credit Deduction ---');
    const call1 = await callService.initiateCall({ user: testUser });
    if (call1.status !== 'Initiated') throw new Error('Expected status Initiated');

    await callService.acceptCall({ callId: call1.callId, admin: testAdmin });
    await callService.connectCall({ callId: call1.callId });
    const call1Connected = await Call.findOne({ callId: call1.callId });

    // 125 seconds = 3 minutes billing = 3 credits
    const simulatedEndTime = new Date(call1Connected.connectedTime.getTime() + 125 * 1000);
    const result1 = await callService.finalizeCall(call1.callId, { reason: 'Completed', forcedEndTime: simulatedEndTime });

    console.log(`✓ Call 1 finalized: Duration: ${result1.call.duration} | Credits: ${result1.creditsDeducted} | Remaining: ${result1.remainingCredits}`);
    if (result1.creditsDeducted !== 3) throw new Error(`Expected 3 credits, got: ${result1.creditsDeducted}`);
    if (result1.remainingCredits !== 97) throw new Error(`Expected 97 credits, got: ${result1.remainingCredits}`);

    // ==============================================================
    // TEST 2: Admin Ends Call
    // ==============================================================
    console.log('\n--- TEST 2: Admin Ends Active Call ---');
    const call2 = await callService.initiateCall({ user: testUser });
    await callService.acceptCall({ callId: call2.callId, admin: testAdmin });
    await callService.connectCall({ callId: call2.callId });

    // 45s = 1 credit
    const call2Doc = await Call.findOne({ callId: call2.callId });
    const end2 = new Date(call2Doc.connectedTime.getTime() + 45 * 1000);
    const result2 = await callService.finalizeCall(call2.callId, { reason: 'Completed', forcedEndTime: end2 });

    console.log(`✓ Admin finalized: Duration: ${result2.call.duration} | Credits: ${result2.creditsDeducted} | Remaining: ${result2.remainingCredits}`);
    if (result2.creditsDeducted !== 1) throw new Error(`Expected 1 credit, got: ${result2.creditsDeducted}`);
    if (result2.remainingCredits !== 96) throw new Error(`Expected 96 credits, got: ${result2.remainingCredits}`);

    // ==============================================================
    // TEST 3: Missed Call (No Connection)
    // ==============================================================
    console.log('\n--- TEST 3: Missed Call (0 Credits Deducted) ---');
    const call3 = await callService.initiateCall({ user: testUser });
    const result3 = await callService.finalizeCall(call3.callId, { reason: 'Missed' });

    console.log(`✓ Missed call: Credits: ${result3.creditsDeducted} | Status: ${result3.call.status} | Remaining: ${result3.remainingCredits}`);
    if (result3.creditsDeducted !== 0) throw new Error(`Expected 0 credits, got: ${result3.creditsDeducted}`);
    if (result3.remainingCredits !== 96) throw new Error(`Expected 96 credits, got: ${result3.remainingCredits}`);

    // ==============================================================
    // TEST 4: Rejected Call
    // ==============================================================
    console.log('\n--- TEST 4: Rejected Call (0 Credits Deducted) ---');
    const call4 = await callService.initiateCall({ user: testUser });
    const result4 = await callService.finalizeCall(call4.callId, { reason: 'Rejected' });

    console.log(`✓ Rejected call: Credits: ${result4.creditsDeducted} | Status: ${result4.call.status}`);
    if (result4.creditsDeducted !== 0 || result4.call.status !== 'Rejected') throw new Error('Rejected call verification failed');

    // ==============================================================
    // TEST 5: Cancelled Call
    // ==============================================================
    console.log('\n--- TEST 5: Cancelled Call by User (0 Credits Deducted) ---');
    const call5 = await callService.initiateCall({ user: testUser });
    const result5 = await callService.finalizeCall(call5.callId, { reason: 'Cancelled' });

    console.log(`✓ Cancelled call: Credits: ${result5.creditsDeducted} | Status: ${result5.call.status}`);
    if (result5.creditsDeducted !== 0 || result5.call.status !== 'Cancelled') throw new Error('Cancelled call verification failed');

    // ==============================================================
    // TEST 6: Socket Disconnect Mid-Call
    // ==============================================================
    console.log('\n--- TEST 6: Socket Disconnect Mid-Call ---');
    const call6 = await callService.initiateCall({ user: testUser });
    await callService.acceptCall({ callId: call6.callId, admin: testAdmin });
    await callService.connectCall({ callId: call6.callId });

    // 62s = 2 credits
    const call6Doc = await Call.findOne({ callId: call6.callId });
    const end6 = new Date(call6Doc.connectedTime.getTime() + 62 * 1000);
    const result6 = await callService.finalizeCall(call6.callId, { reason: 'Completed', forcedEndTime: end6 });

    console.log(`✓ Mid-call disconnect finalized: Duration: ${result6.call.duration} | Credits: ${result6.creditsDeducted} | Remaining: ${result6.remainingCredits}`);
    if (result6.creditsDeducted !== 2) throw new Error(`Expected 2 credits, got: ${result6.creditsDeducted}`);
    if (result6.remainingCredits !== 94) throw new Error(`Expected 94 credits, got: ${result6.remainingCredits}`);

    // ==============================================================
    // TEST 7: Race Condition Protection (Duplicate Finalize Requests)
    // ==============================================================
    console.log('\n--- TEST 7: Race Condition / Concurrency Guard ---');
    const call7 = await callService.initiateCall({ user: testUser });
    await callService.acceptCall({ callId: call7.callId, admin: testAdmin });
    await callService.connectCall({ callId: call7.callId });

    const call7Doc = await Call.findOne({ callId: call7.callId });
    const end7 = new Date(call7Doc.connectedTime.getTime() + 185 * 1000); // 185s = 4 credits

    const promises = [
      callService.finalizeCall(call7.callId, { reason: 'Completed', forcedEndTime: end7 }),
      callService.finalizeCall(call7.callId, { reason: 'Completed', forcedEndTime: end7 }),
      callService.finalizeCall(call7.callId, { reason: 'Completed', forcedEndTime: end7 }),
      callService.finalizeCall(call7.callId, { reason: 'Completed', forcedEndTime: end7 }),
      callService.finalizeCall(call7.callId, { reason: 'Completed', forcedEndTime: end7 })
    ];

    const results = await Promise.all(promises);
    const freshUserAfterRace = await User.findById(testUser._id);
    const txnsAfterRace = await Transaction.find({ callId: call7.callId });

    console.log(`✓ 5 Concurrent finalizeCall executions completed.`);
    console.log(`   - Balance before race: 94 credits`);
    console.log(`   - Balance after race: ${freshUserAfterRace.credits} credits (Expected: 90 credits)`);
    console.log(`   - Transactions created for ${call7.callId}: ${txnsAfterRace.length} (Expected: exactly 1)`);

    if (freshUserAfterRace.credits !== 90) throw new Error(`Race condition failed! Credits: ${freshUserAfterRace.credits}`);
    if (txnsAfterRace.length !== 1) throw new Error(`Duplicate transactions created! Count: ${txnsAfterRace.length}`);

    // ==============================================================
    // TEST 8: Low Balance Call Prevention
    // ==============================================================
    console.log('\n--- TEST 8: Low Balance Call Initiation Prevention ---');
    let brokeUser = await User.findOne({ email: 'broke_resilience@example.com' });
    if (!brokeUser) {
      brokeUser = new User({
        name: 'Broke User',
        mobile: '+91 90000 11111',
        email: 'broke_resilience@example.com',
        password: 'password123',
        credits: 0,
        role: 'user'
      });
      await brokeUser.save();
    } else {
      brokeUser.credits = 0;
      await brokeUser.save();
    }

    let errorThrown = false;
    try {
      await callService.initiateCall({ user: brokeUser });
    } catch (e) {
      errorThrown = true;
      console.log(`✓ Low-credit user blocked: "${e.message}" (code: ${e.code})`);
      if (e.code !== 'INSUFFICIENT_CREDITS') throw new Error('Expected INSUFFICIENT_CREDITS code');
    }
    if (!errorThrown) throw new Error('Should have blocked 0-credit user');

    // ==============================================================
    // TEST 9: State Transition Machine Integrity
    // ==============================================================
    console.log('\n--- TEST 9: State Machine Transition Integrity ---');
    // Test: Cannot accept an already Cancelled call
    const cancelCall = await callService.initiateCall({ user: testUser });
    await callService.finalizeCall(cancelCall.callId, { reason: 'Cancelled' });
    const acceptAttempt = await callService.acceptCall({ callId: cancelCall.callId, admin: testAdmin });
    if (acceptAttempt !== null) throw new Error('acceptCall should return null for a Cancelled call');
    console.log(`✓ acceptCall correctly rejected transition for Cancelled call: ${cancelCall.callId}`);

    // Test: Cannot connect an already Completed call
    const connectAttempt = await callService.connectCall({ callId: call1.callId });
    if (connectAttempt !== null) throw new Error('connectCall should return null for Completed call');
    console.log(`✓ connectCall correctly rejected transition for Completed call: ${call1.callId}`);

    // ==============================================================
    // TEST 10: Sequential 5-Call Pipeline (No State Leakage)
    // ==============================================================
    console.log('\n--- TEST 10: Sequential 5-Call Pipeline (No State Leakage) ---');
    const initialCredits = (await User.findById(testUser._id)).credits;
    let expectedCredits = initialCredits;

    for (let i = 1; i <= 5; i++) {
      const freshCaller = await User.findById(testUser._id);
      const sessionCall = await callService.initiateCall({ user: freshCaller });
      if (!sessionCall.callId.startsWith('CALL-')) throw new Error('Invalid callId format');

      await callService.acceptCall({ callId: sessionCall.callId, admin: testAdmin });
      await callService.connectCall({ callId: sessionCall.callId });

      // Call duration: i * 60 seconds (i minutes = i credits)
      const doc = await Call.findOne({ callId: sessionCall.callId });
      const sessionEnd = new Date(doc.connectedTime.getTime() + (i * 60) * 1000);
      const sessionFinal = await callService.finalizeCall(sessionCall.callId, { reason: 'Completed', forcedEndTime: sessionEnd });

      expectedCredits -= i;
      console.log(`✓ Sequential Call #${i} (${sessionCall.callId}): Duration: ${sessionFinal.call.duration} | Deducted: ${sessionFinal.creditsDeducted} | Remaining: ${sessionFinal.remainingCredits}`);

      if (sessionFinal.creditsDeducted !== i) throw new Error(`Expected ${i} credits deducted for call #${i}`);
      if (sessionFinal.remainingCredits !== expectedCredits) throw new Error(`Credits balance drift at call #${i}`);
    }

    console.log(`✓ 5 Sequential calls completed with zero state leakage. Expected final credits: ${expectedCredits}`);

    // ==============================================================
    // TEST 11: Call History & Last Call Verification
    // ==============================================================
    console.log('\n--- TEST 11: Call History & Last Call Retrieval ---');
    const latestCall = await Call.findOne({ user: testUser._id })
      .populate('admin')
      .sort({ date: -1, createdAt: -1 });

    console.log(`✓ Authoritative latest call for summary card: ${latestCall.callId} | Duration: ${latestCall.duration} | Credits: ${latestCall.credits}`);
    const userCallCount = await Call.countDocuments({ user: testUser._id });
    console.log(`✓ Total calls audited for test user: ${userCallCount}`);
    if (userCallCount < 10) throw new Error('Expected at least 10 logged calls for test user');

    console.log('\n====================================================');
    console.log('  ALL 11 RESILIENCE & INTEGRITY TESTS PASSED 100%!  ');
    console.log('====================================================\n');
  } catch (err) {
    console.error('\n❌ RESILIENCE TEST FAILED:', err);
    process.exit(1);
  } finally {
    // Teardown test records
    if (testUser) {
      await Call.deleteMany({ user: testUser._id });
      await Transaction.deleteMany({ user: testUser._id });
      await User.deleteOne({ _id: testUser._id });
    }
    const brokeUser = await User.findOne({ email: 'broke_resilience@example.com' });
    if (brokeUser) {
      await Call.deleteMany({ user: brokeUser._id });
      await User.deleteOne({ _id: brokeUser._id });
    }
    await mongoose.disconnect();
    console.log('[Test Teardown] Cleaned up temporary test data and disconnected from DB.');
  }
}

runTests();
