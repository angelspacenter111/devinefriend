const mongoose = require('mongoose');

const callLogSchema = new mongoose.Schema({
  callId: {
    type: String,
    required: true,
    index: true
  },
  call: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Call',
    default: null,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'system'],
    default: 'user'
  },
  eventType: {
    type: String,
    required: true,
    index: true
  },
  severity: {
    type: String,
    enum: ['error', 'warn', 'info'],
    default: 'info',
    index: true
  },
  stage: {
    type: String,
    default: 'general'
  },
  errorName: {
    type: String,
    default: ''
  },
  errorMessage: {
    type: String,
    default: ''
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('CallLog', callLogSchema);
