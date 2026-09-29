const jwt = require('jsonwebtoken');
const User = require('../../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'friend_jwt_secure_super_secret_2026';

/**
 * Mobile API Authentication Middleware
 * Supports:
 * 1. Bearer Token in Authorization header (Standard for React Native / Expo)
 * 2. Session userId fallback (for web compatibility)
 */
const requireApiAuth = async (req, res, next) => {
  try {
    let token = null;

    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.headers['x-access-token']) {
      token = req.headers['x-access-token'];
    }

    let userId = null;

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.id || decoded.userId;
      } catch (err) {
        return res.status(401).json({
          success: false,
          code: 'TOKEN_INVALID',
          message: 'Invalid or expired authentication token. Please log in again.'
        });
      }
    } else if (req.session && req.session.userId) {
      // Fallback for session
      userId = req.session.userId;
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication token missing. Please provide Authorization: Bearer <token>.'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'Account not found or session has been revoked.'
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account is suspended. Please contact customer support.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('[API Auth Middleware Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication server error.'
    });
  }
};

const requireApiAdmin = async (req, res, next) => {
  await requireApiAuth(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        code: 'ADMIN_ACCESS_REQUIRED',
        message: 'Admin authorization required for this resource.'
      });
    }
    next();
  });
};

module.exports = {
  requireApiAuth,
  requireApiAdmin,
  JWT_SECRET
};

