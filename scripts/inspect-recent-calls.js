const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Call = require('../models/Call');
  const CallLog = require('../models/CallLog');

  const latestCalls = await Call.find().sort({ createdAt: -1 }).limit(5).lean();
  for (const c of latestCalls) {
    console.log(`=== CALL: ${c.callId} | Status: ${c.status} | CreatedAt: ${c.createdAt} ===`);
    console.log(`  Caller: ${c.callerName} | Receiver: ${c.receiverName} | AcceptedTime: ${c.acceptedTime} | ConnectedTime: ${c.connectedTime}`);
    console.log(`  FailureReason: ${c.failureReason} | Stage: ${c.failedAtStage} | Code: ${c.errorCode}`);
    const logs = await CallLog.find({ callId: c.callId }).lean();
    console.log(`  Logs count: ${logs.length}`);
    logs.forEach(l => {
      console.log(`    [${l.eventType}] [${l.stage}] msg: ${l.errorMessage} | details: ${JSON.stringify(l.details || '')}`);
    });
  }
  process.exit(0);
}

run().catch(console.error);
