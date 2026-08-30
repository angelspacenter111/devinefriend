/*
 * Public Views Controller
 * Friend MVC
 */

exports.getHome = (req, res) => {
  res.render('index', {
    title: 'Friend - Private Voice Companion & Listening Space',
    activeTab: 'home'
  });
};

exports.getHowItWorks = (req, res) => {
  res.render('how-it-works', {
    title: 'How It Works - Friend',
    activeTab: 'how-it-works'
  });
};

exports.getSupport = (req, res) => {
  res.render('support', {
    title: 'How I Support You - Friend',
    activeTab: 'support'
  });
};

exports.getPricing = (req, res) => {
  res.render('pricing', {
    title: 'Pricing & Wallet Credits - Friend',
    activeTab: 'pricing'
  });
};

exports.getFaq = (req, res) => {
  res.render('faq', {
    title: 'Frequently Asked Questions - Friend',
    activeTab: 'faq'
  });
};
