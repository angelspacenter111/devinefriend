const User = require('../../models/User');
const Call = require('../../models/Call');
const callService = require('../../services/callService');

const parseMins = (durationStr) => {
  if (!durationStr || !durationStr.includes(':')) return 0;
  const parts = durationStr.split(':');
  const minutes = parseInt(parts[0], 10) || 0;
  const seconds = parseInt(parts[1], 10) || 0;
  return minutes + (seconds / 60);
};

// GET /api/user/dashboard
exports.getDashboard = async (req, res) => {
  try {
    const user = req.user;

    const recentCalls = await Call.find({ user: user._id })
      .sort({ date: -1, createdAt: -1 })
      .limit(5);

    const totalCalls = await Call.countDocuments({ user: user._id });
    const completedCalls = await Call.find({ user: user._id, status: 'Completed' });
    const totalMins = completedCalls.reduce((acc, c) => acc + parseMins(c.duration), 0);

    const advisorPresence = callService.getAdvisorPresenceInfo();

    return res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          mobile: user.mobile,
          credits: user.credits,
          role: user.role
        },
        stats: {
          totalCalls,
          totalMinutes: Math.round(totalMins)
        },
        advisorStatus: advisorPresence,
        recentCalls
      }
    });
  } catch (error) {
    console.error('[API User Dashboard Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data.'
    });
  }
};

// GET /api/user/profile
exports.getProfile = async (req, res) => {
  try {
    const user = req.user;
    return res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        mobile: user.mobile,
        credits: user.credits,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch profile.' });
  }
};

// PUT /api/user/profile
exports.updateProfile = async (req, res) => {
  try {
    const user = req.user;
    const { name } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, message: 'Name cannot be empty.' });
    }

    user.name = name.trim();
    await user.save();

    return res.json({
      success: true,
      message: 'Profile updated successfully.',
      user: {
        id: user._id,
        name: user.name,
        mobile: user.mobile,
        credits: user.credits
      }
    });
  } catch (error) {
    console.error('[API Update Profile Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
};

// POST /api/user/change-password
exports.changePassword = async (req, res) => {
  try {
    const user = req.user;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required.'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters.'
      });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password does not match.'
      });
    }

    user.password = newPassword;
    await user.save();

    return res.json({
      success: true,
      message: 'Password changed successfully.'
    });
  } catch (error) {
    console.error('[API Change Password Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to change password.' });
  }
};
