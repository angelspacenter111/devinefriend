const mongoose = require('mongoose');

const paymentTransactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  plan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PricingPlan',
    default: null
  },
  planId: {
    type: String,
    default: ''
  },
  packageName: {
    type: String,
    required: true,
    trim: true
  },
  credits: {
    type: Number,
    required: true,
    min: 1
  },
  amount: {
    type: Number,
    required: true,
    min: 1
  },
  amountPaise: {
    type: Number,
    required: true,
    min: 100
  },
  currency: {
    type: String,
    default: 'INR',
    uppercase: true,
    trim: true
  },
  razorpayOrderId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  razorpayPaymentId: {
    type: String,
    default: null,
    index: true,
    sparse: true,
    trim: true
  },
  razorpaySignature: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['CREATED', 'PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'REFUNDED'],
    default: 'CREATED',
    index: true
  },
  failureReason: {
    type: String,
    default: null
  },
  receipt: {
    type: String,
    default: null
  },
  notes: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  source: {
    type: String,
    enum: ['frontend', 'webhook', 'system'],
    default: 'frontend'
  },
  paidAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('PaymentTransaction', paymentTransactionSchema);
