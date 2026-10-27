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
    const { name, mobile, password } = req.body;

    if (!name || !mobile || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, mobile number, and password are required.'
      });
    }

    // Dubai / UAE Mobile Number Validation
    const uaeInfo = parseUAEMobile(mobile);
    if (!uaeInfo.isValid) {
      return res.status(400).json({
        success: false,
        message: uaeInfo.message
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters.'
      });
    }

    // Check if account already exists with any variant of this UAE number
    const existingUser = await User.findOne({
      mobile: { $in: uaeInfo.allVariants }
    });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'An account with this UAE mobile number already exists. Please log in.'
      });
    }

    const newUser = new User({
      name: name.trim(),
      mobile: uaeInfo.internationalFormatted,
      password: password
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

    if (!mobile || !password) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number and password are required.'
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
      return res.status(401).json({
        success: false,
        message: 'Invalid mobile number or password.'
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid mobile number or password.'
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

// POST /api/auth/forgot-password
exports.forgotPassword = async (req, res) => {
  try {
    const { mobile, newPassword } = req.body;
    if (!mobile || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number and new password are required.'
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
        message: 'No account found with this mobile number.'
      });
    }

    user.password = newPassword;
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
