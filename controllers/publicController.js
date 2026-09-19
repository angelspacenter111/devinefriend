/*
 * Public Views Controller
 * Friend MVC
 */

exports.getHome = (req, res) => {
  res.render('index', {
    title: 'Talk With Ashu - Private Voice Companion & Listening Space',
    activeTab: 'home'
  });
};

exports.getHowItWorks = (req, res) => {
  res.render('how-it-works', {
    title: 'How It Works - Talk With Ashu',
    activeTab: 'how-it-works'
  });
};

exports.getSupport = (req, res) => {
  res.render('support', {
    title: 'How I Support You - Talk With Ashu',
    activeTab: 'support'
  });
};

exports.getPricing = (req, res) => {
  res.render('pricing', {
    title: 'Pricing & Wallet Points - Talk With Ashu',
    activeTab: 'pricing'
  });
};

exports.getFaq = (req, res) => {
  res.render('faq', {
    title: 'Frequently Asked Questions - Talk With Ashu',
    activeTab: 'faq'
  });
};
