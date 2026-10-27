const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { parseUAEMobile, getUAEMobileVariants } = require('../services/phoneValidator');

exports.getLogin = (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect(req.session.role === 'admin' ? '/admin/dashboard' : '/user/dashboard');
  }
  res.render('login', {
    title: 'Login - Talk With Ashu',
    errorMessage: null,
    formData: null
  });
};

exports.getRegister = (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect(req.session.role === 'admin' ? '/admin/dashboard' : '/user/dashboard');
  }
  res.render('register', {
    title: 'Create Account - Talk With Ashu',
    errorMessage: null,
    formData: null
  });
};

exports.getForgotPassword = (req, res) => {
  res.render('forgot-password', {
    title: 'Recover Password - Talk With Ashu',
    errorMessage: null,
    formData: null
  });
};

// POST User login verification
exports.postLogin = async (req, res) => {
  try {
    const { mobile, password } = req.body;
    
    if (!mobile || !password) {
      return res.render('login', {
        title: 'Login - Talk With Ashu',
        errorMessage: 'Please enter all required fields.',
        formData: { mobile }
      });
    }

    const cleanMobile = mobile.trim();
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
      return res.render('login', {
        title: 'Login - Talk With Ashu',
        errorMessage: 'Invalid mobile number or password.',
        formData: { mobile }
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.render('login', {
        title: 'Login - Talk With Ashu',
        errorMessage: 'Invalid mobile number or password.',
        formData: { mobile }
      });
    }

    if (user.isBlocked) {
      return res.render('login', {
        title: 'Login - Talk With Ashu',
        errorMessage: 'Your account is suspended. Please contact customer support.',
        formData: { mobile }
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
      errorMessage: 'An error occurred during login. Please try again.',
      formData: { mobile: req.body.mobile }
    });
  }
};

// POST User registration
exports.postRegister = async (req, res) => {
  try {
    const { name, mobile, password, confirmPassword } = req.body;

    if (!name || !mobile || !password) {
      return res.render('register', {
        title: 'Create Account - Talk With Ashu',
        errorMessage: 'Please fill all required fields.',
        formData: { name, mobile }
      });
    }

    // Dubai / UAE Mobile Number Validation
    const uaeInfo = parseUAEMobile(mobile);
    if (!uaeInfo.isValid) {
      return res.render('register', {
        title: 'Create Account - Talk With Ashu',
        errorMessage: uaeInfo.message,
        formData: { name, mobile }
      });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.render('register', {
        title: 'Create Account - Talk With Ashu',
        errorMessage: 'Passwords do not match.',
        formData: { name, mobile }
      });
    }

    if (password.length < 6) {
      return res.render('register', {
        title: 'Create Account - Talk With Ashu',
        errorMessage: 'Password must be at least 6 characters long.',
        formData: { name, mobile }
      });
    }

    // Check if user already exists across any variant of this UAE number
    const userExists = await User.findOne({
      mobile: { $in: uaeInfo.allVariants }
    });
    if (userExists) {
      return res.render('register', {
        title: 'Create Account - Talk With Ashu',
        errorMessage: 'This UAE mobile number is already registered. Please log in.',
        formData: { name, mobile }
      });
    }

    // Create and save new user (credits defaults to 5) with formatted UAE mobile number
    const newUser = new User({
      name: name.trim(),
      mobile: uaeInfo.internationalFormatted,
      password: password // pre-save hook handles hashing
    });

    const savedUser = await newUser.save();

    // Log the welcome credits transaction
    const welcomeTxn = new Transaction({
      txnId: "TXN-" + Math.floor(1000 + Math.random() * 9000) + Math.floor(10 + Math.random() * 90),
      user: savedUser._id,
      desc: "Welcome Bonus (5 Free Coins)",
      type: "credit",
      credits: 5,
      amount: "AED 0",
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
      errorMessage: 'An error occurred during registration. Please try again.',
      formData: { name: req.body.name, mobile: req.body.mobile }
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
