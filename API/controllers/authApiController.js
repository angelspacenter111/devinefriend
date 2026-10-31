const crypto = require('crypto');
const EmailService = require('../../services/emailService');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const Transaction = require('../../models/Transaction');
const { JWT_SECRET } = require('../middleware/apiAuth');
const { parseUAEMobile, getUAEMobileVariants } = require('../../services/phoneValidator');

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      userId: user._id,
      role: user.role,
      mobile: user.mobile
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
};

// POST /api/auth/register
exports.register = async (req, res) => {
  try {
    const { name, mobile, email, password } = req.body;

    const cleanPassword = (password !== undefined && password !== null) ? password.toString().trim() : '';
    const cleanEmail = (email !== undefined && email !== null) ? email.toString().trim().toLowerCase() : '';

    if (!name || !mobile || !cleanEmail || !cleanPassword) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, contact number, and password are required.'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address.'
      });
    }

    const rawMobile = mobile.toString().trim();
    if (!/^\d+$/.test(rawMobile)) {
      return res.status(400).json({
        success: false,
        message: 'Contact number must contain only numeric digits.'
      });
    }

    if (rawMobile.length > 10) {
      return res.status(400).json({
        success: false,
        message: 'Contact number cannot exceed 10 digits.'
      });
    }

    const cleanMobile = rawMobile;

    if (cleanPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters.'
      });
    }

    // Check if account already exists
    const uaeInfo = parseUAEMobile(cleanMobile);
    const checkVariants = [cleanMobile];
    if (uaeInfo && uaeInfo.isValid && uaeInfo.allVariants) {
      checkVariants.push(...uaeInfo.allVariants);
    }
    const existingUser = await User.findOne({
      $or: [
        { mobile: cleanMobile },
        { mobile: { $in: checkVariants } },
        { email: cleanEmail }
      ]
    });
    if (existingUser) {
      const isEmailMatch = existingUser.email && existingUser.email.toLowerCase() === cleanEmail;
      return res.status(409).json({
        success: false,
        message: isEmailMatch
          ? 'An account with this email address already exists. Please log in.'
          : 'An account with this contact number already exists. Please log in.'
      });
    }

    const newUser = new User({
      name: name.trim(),
      mobile: cleanMobile,
      email: cleanEmail,
      password: cleanPassword
    });

    const savedUser = await newUser.save();

    // Welcome bonus transaction
    const welcomeTxn = new Transaction({
      txnId: "TXN-" + Math.floor(1000 + Math.random() * 9000) + Math.floor(10 + Math.random() * 90),
      user: savedUser._id,
      desc: "Welcome Bonus (5 Free Credits)",
      type: "credit",
      credits: 5,
      amount: "AED 0",
      status: "Successful"
    });
    await welcomeTxn.save();

    const token = generateToken(savedUser);

    return res.status(201).json({
      success: true,
      message: 'Registration successful! Welcome bonus of 5 credits credited.',
      token,
      user: {
        id: savedUser._id,
        name: savedUser.name,
        mobile: savedUser.mobile,
        role: savedUser.role,
        credits: savedUser.credits,
        createdAt: savedUser.createdAt
      }
    });
  } catch (error) {
    console.error('[API Register Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during registration. Please try again.'
    });
  }
};

// POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { mobile, password } = req.body;

    const cleanPassword = (password !== undefined && password !== null) ? password.toString().trim() : '';

    if (!mobile || !cleanPassword) {
      return res.status(400).json({
        success: false,
        message: 'Contact number and password are required.'
      });
    }

    const rawMobile = mobile.toString().trim();
    const cleanMobile = rawMobile.replace(/\D/g, '').slice(0, 10);

    if (!cleanMobile) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid numeric contact number.'
      });
    }

    if (rawMobile.replace(/\D/g, '').length > 10) {
      return res.status(400).json({
        success: false,
        message: 'Contact number cannot exceed 10 digits.'
      });
    }

    // Support clean numeric search as well as legacy formatted variants if previously registered
    const uaeInfo = parseUAEMobile(cleanMobile);
    const queryVariants = [cleanMobile, rawMobile];
    if (uaeInfo && uaeInfo.isValid && uaeInfo.allVariants) {
      queryVariants.push(...uaeInfo.allVariants);
    }

    const user = await User.findOne({
      $or: [
        { mobile: cleanMobile },
        { mobile: { $in: queryVariants } }
      ]
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid contact number or password.'
      });
    }

    let isMatch = await user.comparePassword(cleanPassword);
    if (!isMatch && password) {
      isMatch = await user.comparePassword(password);
    }

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid contact number or password.'
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Your account is suspended. Please contact customer support.'
      });
    }

    const token = generateToken(user);

    return res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        id: user._id,
        name: user.name,
        mobile: user.mobile,
        role: user.role,
        credits: user.credits,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('[API Login Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during login. Please try again.'
    });
  }
};

// GET /api/auth/me
exports.getMe = async (req, res) => {
  try {
    const user = req.user;
    return res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        mobile: user.mobile,
        role: user.role,
        credits: user.credits,
        isBlocked: user.isBlocked,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('[API Get Me Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile.'
    });
  }
};

// POST /api/auth/reset-password
exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    const cleanPassword = (password !== undefined && password !== null) ? password.toString().trim() : '';

    if (!token || !cleanPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required.'
      });
    }

    if (cleanPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters.'
      });
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Password reset link is invalid or has expired.'
      });
    }

    user.password = cleanPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return res.json({
      success: true,
      message: 'Password reset successfully. You can now log in.'
    });
  } catch (error) {
    console.error('[API Reset Password Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reset password.'
    });
  }
};

// POST /api/auth/forgot-password
exports.forgotPassword = async (req, res) => {
  try {
    const { email, mobile, newPassword } = req.body;

    // Email-based reset link request (Primary)
    if (email) {
      const cleanEmail = email.toString().trim().toLowerCase();
      const user = await User.findOne({ email: cleanEmail });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'No account found with this email address.'
        });
      }

      const token = crypto.randomBytes(32).toString('hex');
      user.resetPasswordToken = token;
      user.resetPasswordExpires = new Date(Date.now() + 3600000);
      await user.save();

      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const resetUrl = `${protocol}://${host}/reset-password/${token}`;

      try {
        await EmailService.sendPasswordResetEmail({
          name: user.name,
          email: user.email,
          resetUrl
        });
      } catch (err) {
        console.warn('[API Forgot Password] EmailJS dispatch error:', err.message);
      }

      return res.json({
        success: true,
        message: `A password reset link has been sent to ${user.email}.`,
        resetUrl // provided for API convenience in dev/testing
      });
    }
    const cleanNewPass = (newPassword !== undefined && newPassword !== null) ? newPassword.toString().trim() : '';

    if (!mobile || !cleanNewPass) {
      return res.status(400).json({
        success: false,
        message: 'Contact number and new password are required.'
      });
    }

    if (cleanNewPass.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters.'
      });
    }

    const cleanMobile = mobile.toString().trim();
    const uaeInfo = parseUAEMobile(cleanMobile);

    let query;
    if (uaeInfo.isValid) {
      query = {
        $or: [
          { mobile: cleanMobile },
          ...uaeInfo.allVariants.map(v => ({ mobile: v }))
        ]
      };
    } else {
      query = {
        $or: [
          { mobile: cleanMobile },
          { mobile: cleanMobile.replace(/[^0-9]/g, '') }
        ]
      };
    }

    const user = await User.findOne(query);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this contact number.'
      });
    }

    user.password = cleanNewPass;
    await user.save();

    return res.json({
      success: true,
      message: 'Password reset successfully. You can now log in.'
    });
  } catch (error) {
    console.error('[API Forgot Password Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reset password.'
    });
  }
};
