const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  callId: {
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
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    default: null
  },
  callerName: {
    type: String,
    default: ''
  },
  receiverName: {
    type: String,
    default: 'Support Partner'
  },
  callType: {
    type: String,
    enum: ['Voice', 'Video'],
    default: 'Voice'
  },
  date: {
    type: Date,
    default: Date.now,
    index: true
  },
  time: {
    type: String,
    default: () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  },
  startTime: {
    type: Date,
    default: Date.now
  },
  acceptedTime: {
    type: Date,
    default: null
  },
  connectedTime: {
    type: Date,
    default: null
  },
  endTime: {
    type: Date,
    default: null
  },
  duration: {
    type: String,
    default: '00:00'
  },
  durationSeconds: {
    type: Number,
    default: 0
  },
  durationMinutes: {
    type: Number,
    default: 0
  },
  creditRate: {
    type: Number,
    default: 1
  },
  credits: {
    type: Number,
    default: 0
  },
  creditStatus: {
    type: String,
    enum: ['deducted', 'pending', 'waived', 'failed', 'none'],
    default: 'none'
  },
  status: {
    type: String,
    enum: ['Initiated', 'Ringing', 'In Progress', 'Completed', 'Cancelled', 'Missed', 'Rejected', 'Failed', 'Auto-Disconnected (No Credits)'],
    default: 'Initiated',
    index: true
  },
  finalized: {
    type: Boolean,
    default: false,
    index: true
  },
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Call', callSchema);

