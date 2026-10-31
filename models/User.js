const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  mobile: {
    type: String,
    required: [true, 'Mobile number is required'],
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Password is required']
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: ''
  },
  credits: {
    type: Number,
    default: 5
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  joined: {
    type: Date,
    default: Date.now
  },
  pushToken: {
    type: String,
    default: null
  },
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpires: {
    type: Date,
    default: null
  }
});

// Hash password before saving
userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  if (this.password && typeof this.password === 'string') {
    this.password = this.password.trim();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(String(this.password), salt);
});

// Match password safely with whitespace and type tolerance
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (candidatePassword === undefined || candidatePassword === null) return false;
  const rawCandidate = String(candidatePassword);
  const trimmedCandidate = rawCandidate.trim();

  try {
    // 1. Try trimmed candidate first
    if (await bcrypt.compare(trimmedCandidate, this.password)) {
      return true;
    }
    // 2. Fallback to raw candidate if candidate contained untrimmed whitespace
    if (trimmedCandidate !== rawCandidate && await bcrypt.compare(rawCandidate, this.password)) {
      return true;
    }
  } catch (err) {
    console.error('[User comparePassword error]', err.message);
  }
  return false;
};

module.exports = mongoose.model('User', userSchema);
