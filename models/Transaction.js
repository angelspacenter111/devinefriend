const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  txnId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  date: {
    type: Date,
    default: Date.now,
    index: true
  },
  desc: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['credit', 'debit'],
    required: true,
    index: true
  },
  credits: {
    type: Number,
    required: true
  },
  amount: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['Successful', 'Completed', 'Failed'],
    required: true,
    index: true
  },
  callId: {
    type: String,
    index: true,
    default: null
  },
  call: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Call',
    default: null
  },
  balanceBefore: {
    type: Number,
    default: null
  },
  balanceAfter: {
    type: Number,
    default: null
  },
  referenceType: {
    type: String,
    enum: ['PAYMENT', 'CALL', 'ADMIN_ADJUSTMENT', 'BONUS', 'REFUND', null],
    default: null,
    index: true
  },
  referenceId: {
    type: String,
    default: null,
    index: true
  },
  paymentTransaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PaymentTransaction',
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Transaction', transactionSchema);

