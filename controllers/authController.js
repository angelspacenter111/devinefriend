const User = require('../models/User');
const Transaction = require('../models/Transaction');

exports.getLogin = (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect(req.session.role === 'admin' ? '/admin/dashboard' : '/user/dashboard');
  }
  res.render('login', {
    title: 'Login - Talk With Ashu',
    errorMessage: null
  });
};

exports.getRegister = (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect(req.session.role === 'admin' ? '/admin/dashboard' : '/user/dashboard');
  }
  res.render('register', {
    title: 'Create Account - Talk With Ashu',
    errorMessage: null
  });
};

exports.getForgotPassword = (req, res) => {
  res.render('forgot-password', {
    title: 'Recover Password - Talk With Ashu'
  });
};

// POST User login verification
exports.postLogin = async (req, res) => {
  try {
    const { mobile, password } = req.body;
    
    if (!mobile || !password) {
      return res.render('login', {
        title: 'Login - Talk With Ashu',
        errorMessage: 'Please enter all required fields.'
      });
    }

    const cleanMobile = mobile.trim();
    const user = await User.findOne({ mobile: cleanMobile });

    if (!user) {
      return res.render('login', {
        title: 'Login - Talk With Ashu',
        errorMessage: 'Invalid mobile number or password.'
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.render('login', {
        title: 'Login - Talk With Ashu',
        errorMessage: 'Invalid mobile number or password.'
      });
    }

    if (user.isBlocked) {
      return res.render('login', {
        title: 'Login - Talk With Ashu',
        errorMessage: 'Your account is suspended. Please contact customer support.'
      });
    }

    // Set Session variables
    req.session.userId = user._id;
    req.session.role = user.role;

    if (user.role === 'admin') {
      return res.redirect('/admin/dashboard');
    }
    res.redirect('/user/dashboard');
  } catch (error) {
    console.error('[Login Error]', error);
    res.render('login', {
      title: 'Login - Talk With Ashu',
      errorMessage: 'An error occurred during login. Please try again.'
    });
  }
};

// POST User registration
exports.postRegister = async (req, res) => {
  try {
    const { name, mobile, password } = req.body;

    if (!name || !mobile || !password) {
      return res.render('register', {
        title: 'Create Account - Talk With Ashu',
        errorMessage: 'Please fill all required fields.'
      });
    }

    const cleanMobile = mobile.trim();
    
    // Check if user already exists
    const userExists = await User.findOne({ mobile: cleanMobile });
    if (userExists) {
      return res.render('register', {
        title: 'Create Account - Talk With Ashu',
        errorMessage: 'Mobile number is already registered.'
      });
    }

    // Create and save new user (credits defaults to 25)
    const newUser = new User({
      name: name.trim(),
      mobile: cleanMobile,
      password: password // pre-save hook handles hashing
    });

    const savedUser = await newUser.save();

    // Log the welcome credits transaction
    const welcomeTxn = new Transaction({
      txnId: "TXN-" + Math.floor(1000 + Math.random() * 9000) + Math.floor(10 + Math.random() * 90),
      user: savedUser._id,
      desc: "Welcome Bonus (25 Free Coins)",
      type: "credit",
      credits: 25,
      amount: "₹0",
      status: "Successful"
    });
    await welcomeTxn.save();

    // Establish Session
    req.session.userId = savedUser._id;
    req.session.role = savedUser.role;

    res.redirect('/user/dashboard');
  } catch (error) {
    console.error('[Registration Error]', error);
    res.render('register', {
      title: 'Create Account - Talk With Ashu',
      errorMessage: 'An error occurred during registration. Please try again.'
    });
  }
};

// GET User session logout
exports.logout = (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        console.error('[Logout Session Destruction Error]', err);
      }
      res.redirect('/');
    });
  } else {
    res.redirect('/');
  }
};
