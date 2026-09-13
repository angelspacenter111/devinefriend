const User = require('../models/User');

const requireAuth = async (req, res, next) => {
  const isApi = req.originalUrl?.startsWith('/api/') || req.baseUrl?.startsWith('/api/') || req.path?.startsWith('/api/') || req.xhr || (req.headers['x-requested-with'] === 'XMLHttpRequest') || (req.headers.accept && req.headers.accept.includes('application/json'));

  if (!req.session || !req.session.userId) {
    if (isApi) {
      return res.status(401).json({ success: false, message: 'Authentication required. Please log in.' });
    }
    return res.redirect('/login');
  }
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {
        if (isApi) {
          return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
        }
        res.redirect('/login');
      });
      return;
    }
    if (user.isBlocked) {
      req.session.destroy(() => {
        if (isApi) {
          return res.status(403).json({ success: false, message: 'Your account has been suspended. Please contact support.' });
        }
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
    if (isApi) {
      return res.status(500).json({ success: false, message: 'Authentication error.' });
    }
    res.redirect('/login');
  }
};

const requireAdmin = async (req, res, next) => {
  const isAjax = req.xhr || (req.headers['x-requested-with'] === 'XMLHttpRequest') || (req.headers.accept && req.headers.accept.includes('application/json'));

  if (!req.session || !req.session.userId || req.session.role !== 'admin') {
    if (isAjax) {
      return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    }
    return res.redirect('/admin/login');
  }
  try {
    const user = await User.findById(req.session.userId);
    if (!user || user.role !== 'admin') {
      req.session.destroy(() => {
        if (isAjax) {
          return res.status(401).json({ success: false, message: 'Unauthorized. Admin access required.' });
        }
        res.redirect('/admin/login');
      });
      return;
    }
    req.user = user;
    res.locals.user = user;
    next();
  } catch (error) {
    console.error('[Admin Auth Middleware] Error:', error);
    if (isAjax) {
      return res.status(500).json({ success: false, message: 'Authentication error.' });
    }
    res.redirect('/admin/login');
  }
};

module.exports = {
  requireAuth,
  requireAdmin
};
