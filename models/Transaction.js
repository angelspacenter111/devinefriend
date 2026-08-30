const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  txnId: {
    type: String,
    required: true,
    unique: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  desc: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['credit', 'debit'],
    required: true
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
    required: true
  }
});

module.exports = mongoose.model('Transaction', transactionSchema);
