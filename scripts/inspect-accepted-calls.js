const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Call = require('../models/Call');
  const CallLog = require('../models/CallLog');

  const acceptedCalls = await Call.find({
    acceptedTime: { $ne: null }
  }).sort({ createdAt: -1 }).limit(10).lean();

  console.log('Accepted calls count:', acceptedCalls.length);
  for (const c of acceptedCalls) {
    console.log(`\n=== CALL: ${c.callId} | Status: ${c.status} | CreatedAt: ${c.createdAt} ===`);
    console.log(`  AcceptedTime: ${c.acceptedTime} | ConnectedTime: ${c.connectedTime} | Duration: ${c.duration} | FailureReason: ${c.failureReason}`);
    const logs = await CallLog.find({ callId: c.callId }).sort({ timestamp: 1 }).lean();
    logs.forEach(l => console.log(`    [${l.role}] ${l.eventType} (${l.stage}): ${l.errorMessage || l.errorName}`));
  }
  process.exit(0);
}

run().catch(console.error);
