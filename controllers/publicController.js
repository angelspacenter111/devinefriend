/*
 * Public Views Controller
 * Friend MVC
 */

const PricingPlan = require('../models/PricingPlan');

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

exports.getPricing = async (req, res) => {
  try {
    const plans = await PricingPlan.find({ isActive: true }).sort({ order: 1, credits: 1 });
    res.render('pricing', {
      title: 'Pricing & Wallet Coins - Talk With Ashu',
      activeTab: 'pricing',
      plans
    });
  } catch (error) {
    console.error('[Public Pricing Error]', error);
    res.render('pricing', {
      title: 'Pricing & Wallet Coins - Talk With Ashu',
      activeTab: 'pricing',
      plans: []
    });
  }
};

exports.getFaq = (req, res) => {
  res.render('faq', {
    title: 'Frequently Asked Questions - Talk With Ashu',
    activeTab: 'faq'
  });
};
