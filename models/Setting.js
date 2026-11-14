/*
 * System Setting Model
 * Used for dynamic platform feature toggles and administrative settings (e.g. Video Calling enable/disable)
 */

const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  updatedBy: {
    type: String,
    default: 'Ashu'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Setting', settingSchema);
