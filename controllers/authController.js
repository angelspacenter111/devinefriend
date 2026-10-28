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
    
    const cleanPassword = (password !== undefined && password !== null) ? password.toString().trim() : '';

    if (!mobile || !cleanPassword) {
      return res.render('login', {
        title: 'Login - Talk With Ashu',
        errorMessage: 'Please enter all required fields.',
        formData: { mobile }
      });
    }

    const rawMobile = mobile.toString().trim();
    const cleanMobile = rawMobile.replace(/\D/g, '').slice(0, 10);

    if (!cleanMobile) {
      return res.render('login', {
        title: 'Login - Talk With Ashu',
        errorMessage: 'Please enter a valid numeric contact number.',
        formData: { mobile }
      });
    }

    if (rawMobile.replace(/\D/g, '').length > 10) {
      return res.render('login', {
        title: 'Login - Talk With Ashu',
        errorMessage: 'Contact number cannot exceed 10 digits.',
        formData: { mobile }
      });
    }

    // Support clean number lookup as well as existing legacy UAE formats in DB
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
      return res.render('login', {
        title: 'Login - Talk With Ashu',
        errorMessage: 'Invalid contact number or password.',
        formData: { mobile }
      });
    }

    let isMatch = await user.comparePassword(cleanPassword);
    if (!isMatch && password) {
      isMatch = await user.comparePassword(password);
    }

    if (!isMatch) {
      return res.render('login', {
        title: 'Login - Talk With Ashu',
        errorMessage: 'Invalid contact number or password.',
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
    const { name, mobile, email, password, confirmPassword } = req.body;

    const cleanPassword = (password !== undefined && password !== null) ? password.toString().trim() : '';
    const cleanConfirm = (confirmPassword !== undefined && confirmPassword !== null) ? confirmPassword.toString().trim() : '';
    const cleanEmail = (email !== undefined && email !== null) ? email.toString().trim().toLowerCase() : '';

    if (!name || !mobile || !cleanEmail || !cleanPassword) {
      return res.render('register', {
        title: 'Create Account - Talk With Ashu',
        errorMessage: 'Please fill all required fields.',
        formData: { name, mobile, email: cleanEmail }
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.render('register', {
        title: 'Create Account - Talk With Ashu',
        errorMessage: 'Please enter a valid email address.',
        formData: { name, mobile, email: cleanEmail }
      });
    }

    // Only numeric value validation, maximum 10 digits
    const rawMobile = mobile.toString().trim();
    if (!/^\d+$/.test(rawMobile)) {
      return res.render('register', {
        title: 'Create Account - Talk With Ashu',
        errorMessage: 'Contact number must contain only numeric digits.',
        formData: { name, mobile, email: cleanEmail }
      });
    }

    if (rawMobile.length > 10) {
      return res.render('register', {
        title: 'Create Account - Talk With Ashu',
        errorMessage: 'Contact number cannot exceed 10 digits.',
        formData: { name, mobile, email: cleanEmail }
      });
    }

    const cleanMobile = rawMobile;

    if (cleanPassword.length < 6) {
      return res.render('register', {
        title: 'Create Account - Talk With Ashu',
        errorMessage: 'Password must be at least 6 characters long.',
        formData: { name, mobile, email: cleanEmail }
      });
    }

    if (confirmPassword && cleanPassword !== cleanConfirm) {
      return res.render('register', {
        title: 'Create Account - Talk With Ashu',
        errorMessage: 'Passwords do not match.',
        formData: { name, mobile, email: cleanEmail }
      });
    }

    // Check if user already exists
    const uaeInfo = parseUAEMobile(cleanMobile);
    const checkVariants = [cleanMobile];
    if (uaeInfo && uaeInfo.isValid && uaeInfo.allVariants) {
      checkVariants.push(...uaeInfo.allVariants);
    }
    const userExists = await User.findOne({
      $or: [
        { mobile: cleanMobile },
        { mobile: { $in: checkVariants } },
        { email: cleanEmail }
      ]
    });
    if (userExists) {
      const isEmailDuplicate = userExists.email && userExists.email.toLowerCase() === cleanEmail;
      return res.render('register', {
        title: 'Create Account - Talk With Ashu',
        errorMessage: isEmailDuplicate
          ? 'This email address is already registered. Please log in.'
          : 'This contact number is already registered. Please log in.',
        formData: { name, mobile, email: cleanEmail }
      });
    }

    // Create and save new user (credits defaults to 5) with clean numeric contact number & trimmed password
    const newUser = new User({
      name: name.trim(),
      mobile: cleanMobile,
      email: cleanEmail,
      password: cleanPassword
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
      formData: { name: req.body.name, mobile: req.body.mobile, email: req.body.email }
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
