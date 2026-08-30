const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  callId: {
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
  time: {
    type: String,
    required: true
  },
  duration: {
    type: String,
    required: true
  },
  credits: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['Completed', 'Cancelled', 'Missed', 'Failed', 'Auto-Disconnected (No Credits)'],
    required: true
  }
});

module.exports = mongoose.model('Call', callSchema);
