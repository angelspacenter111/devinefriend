/*
 * Dynamic Credit Pack Pricing Plan Model
 * Allows Admin to configure and update credit pack charges in real-time.
 */

const mongoose = require('mongoose');

const pricingPlanSchema = new mongoose.Schema({
  planId: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  badge: {
    type: String,
    default: 'Standard'
  },
  credits: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
    required: true,
    min: 1
  },
  description: {
    type: String,
    default: ''
  },
  isPopular: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 1
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('PricingPlan', pricingPlanSchema);
