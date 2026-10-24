/*
 * Customer Rating & Review Model
 * Stores user testimonials, ratings (1-5 stars), and feedback in MongoDB.
 */

const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide your name.'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters long.'],
      maxlength: [50, 'Name cannot exceed 50 characters.']
    },
    rating: {
      type: Number,
      required: [true, 'Please select a rating between 1 and 5.'],
      min: [1, 'Rating must be at least 1 star.'],
      max: [5, 'Rating cannot exceed 5 stars.'],
      validate: {
        validator: Number.isInteger,
        message: 'Rating must be a whole number.'
      }
    },
    comment: {
      type: String,
      required: [true, 'Please share your review thoughts.'],
      trim: true,
      minlength: [5, 'Review must be at least 5 characters long.'],
      maxlength: [600, 'Review cannot exceed 600 characters.']
    },
    badge: {
      type: String,
      default: 'Verified Conversation'
    },
    avatarColor: {
      type: String,
      default: '#1769E0'
    },
    isApproved: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

// Index for high-performance sorting by newest reviews
reviewSchema.index({ isApproved: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
