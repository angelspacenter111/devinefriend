const User = require('../models/User');

const requireAuth = async (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login');
  }
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {
        res.redirect('/login');
      });
      return;
    }
    if (user.isBlocked) {
      req.session.destroy(() => {
        res.render('login', {
          title: 'Login - Friend',
          errorMessage: 'Your account has been suspended. Please contact support.'
        });
      });
      return;
    }
    req.user = user;
    res.locals.user = user;
    next();
  } catch (error) {
    console.error('[Auth Middleware] Error:', error);
    res.redirect('/login');
  }
};

const requireAdmin = async (req, res, next) => {
  if (!req.session || !req.session.userId || req.session.role !== 'admin') {
    return res.redirect('/admin/login');
  }
  try {
    const user = await User.findById(req.session.userId);
    if (!user || user.role !== 'admin') {
      req.session.destroy(() => {
        res.redirect('/admin/login');
      });
      return;
    }
    req.user = user;
    res.locals.user = user;
    next();
  } catch (error) {
    console.error('[Admin Auth Middleware] Error:', error);
    res.redirect('/admin/login');
  }
};

module.exports = {
  requireAuth,
  requireAdmin
};
