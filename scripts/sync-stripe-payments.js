require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const PaymentTransaction = require('../models/PaymentTransaction');
const User = require('../models/User');
const paymentService = require('../services/paymentService');

async function syncAllPendingPayments() {
  console.log('========================================================');
  console.log('SYNCING PENDING STRIPE PAYMENTS WITH STRIPE SERVERS');
  console.log('========================================================\n');

  try {
    await connectDB();
    const stripe = paymentService.getStripeInstance();

    const pendingTxns = await PaymentTransaction.find({
      status: { $ne: 'CAPTURED' },
      stripeSessionId: { $exists: true, $ne: null }
    }).sort({ createdAt: -1 });

    console.log(`Found ${pendingTxns.length} non-captured transactions in MongoDB.\n`);

    let fulfilledCount = 0;
    let unpaidCount = 0;
    let errorCount = 0;

    for (const txn of pendingTxns) {
      console.log(`--------------------------------------------------------`);
      console.log(`Checking Txn ID: ${txn._id}`);
      console.log(`Stripe Session : ${txn.stripeSessionId}`);
      console.log(`Package Name   : ${txn.packageName} (${txn.credits} Coins for AED ${txn.amount})`);
      console.log(`User ID        : ${txn.user}`);

      try {
        const session = await stripe.checkout.sessions.retrieve(txn.stripeSessionId);
        console.log(`Stripe Status  : payment_status = "${session.payment_status}", status = "${session.status}"`);

        if (session.payment_status === 'paid') {
          const paymentIntentId = typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id;

          const fulfillRes = await paymentService.fulfillPaymentIdempotent({
            stripeSessionId: session.id,
            stripePaymentIntentId: paymentIntentId,
            userId: txn.user,
            source: 'sync_script'
          });

          console.log(`>>> [SUCCESS] FULFILLED! Added ${txn.credits} coins. User balance: ${fulfillRes.credits} coins.`);
          fulfilledCount++;
        } else {
          console.log(`>>> [UNPAID] User has not completed checkout or payment was cancelled.`);
          unpaidCount++;
        }
      } catch (err) {
        console.error(`>>> [ERROR] Checking Stripe session: ${err.message}`);
        errorCount++;
      }
    }

    console.log('\n========================================================');
    console.log(`SYNC COMPLETE: ${fulfilledCount} Fulfilled, ${unpaidCount} Unpaid/Abandoned, ${errorCount} Errors.`);
    console.log('========================================================');
  } catch (fatalErr) {
    console.error('Fatal sync error:', fatalErr);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

syncAllPendingPayments();
