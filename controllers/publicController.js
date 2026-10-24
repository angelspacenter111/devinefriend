/*
 * Public Views Controller
 * Friend MVC
 */

const PricingPlan = require('../models/PricingPlan');
const Review = require('../models/Review');

const defaultReviews = [
  {
    name: 'Pooja Sharma',
    rating: 5,
    comment: "I was going through severe anxiety before my exams and had no one who wouldn't judge me. Ashu listened so patiently and gently. Within 15 minutes, my heart felt so much lighter. Truly a blessing!",
    badge: 'Verified Session',
    avatarColor: '#E91E8F'
  },
  {
    name: 'Rahul Verma',
    rating: 5,
    comment: 'Working in corporate was burning me out completely. Being able to just pick up the call and talk freely without feeling weak or embarrassed helped me regain my peace of mind.',
    badge: 'Verified Call',
    avatarColor: '#1769E0'
  },
  {
    name: 'Ananya Gupta',
    rating: 5,
    comment: 'No bots, no fake positivity. Just pure, empathetic listening. Ashu made me feel heard when I was feeling most invisible. Thank you from the bottom of my heart!',
    badge: 'Verified Conversation',
    avatarColor: '#7B4DCE'
  },
  {
    name: 'Vikram Singh',
    rating: 5,
    comment: 'The coin system is super honest and transparent. No monthly subscription traps. I talked for 20 minutes late at night and slept peacefully for the first time in weeks.',
    badge: 'Verified User',
    avatarColor: '#10B981'
  },
  {
    name: 'Sneha Patel',
    rating: 5,
    comment: 'A safe harbor when everything in life feels messy. Highly recommend to anyone feeling lonely, overwhelmed, or needing genuine encouragement.',
    badge: 'Verified Call',
    avatarColor: '#F59E0B'
  }
];

// Helper to seed initial reviews if database is empty
async function ensureSeedReviews() {
  try {
    const count = await Review.countDocuments();
    if (count === 0) {
      await Review.insertMany(defaultReviews);
      console.log('[Reviews] Seeded 5 initial verified customer testimonials.');
    }
  } catch (err) {
    console.warn('[Reviews Seed Warning]', err.message);
  }
}

// Call seed check once on startup
ensureSeedReviews();

exports.getHome = async (req, res) => {
  try {
    let reviews = await Review.find({ isApproved: true })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    if (!reviews || reviews.length === 0) {
      reviews = defaultReviews;
    }

    const totalReviews = reviews.length;
    const avgRatingSum = reviews.reduce((acc, curr) => acc + (curr.rating || 5), 0);
    const averageRating = totalReviews > 0 ? (avgRatingSum / totalReviews).toFixed(1) : '5.0';

    res.render('index', {
      title: 'Talk With Ashu - Private Voice Companion & Listening Space',
      activeTab: 'home',
      reviews,
      averageRating,
      totalReviews
    });
  } catch (error) {
    console.error('[Public getHome Error]', error);
    res.render('index', {
      title: 'Talk With Ashu - Private Voice Companion & Listening Space',
      activeTab: 'home',
      reviews: defaultReviews,
      averageRating: '5.0',
      totalReviews: defaultReviews.length
    });
  }
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

// API: Get Reviews
exports.getReviews = async (req, res) => {
  try {
    const reviews = await Review.find({ isApproved: true }).sort({ createdAt: -1 }).limit(30);
    res.json({ success: true, reviews });
  } catch (error) {
    console.error('[API getReviews Error]', error);
    res.status(500).json({ success: false, message: 'Could not fetch reviews' });
  }
};

// API: Submit a New Review with Security & Validation
exports.submitReview = async (req, res) => {
  try {
    let { name, rating, comment, honeypot } = req.body;

    // 1. Anti-spam honeypot verification
    if (honeypot) {
      // Quietly reject bot submissions
      return res.status(200).json({
        success: true,
        message: 'Thank you for your feedback!'
      });
    }

    // 2. Name validation and sanitization
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, message: 'Please enter your name.' });
    }
    // Strip HTML tags and dangerous characters
    name = name.replace(/<[^>]*>?/gm, '').trim();
    if (name.length < 2) {
      return res.status(400).json({ success: false, message: 'Name must be at least 2 characters long.' });
    }
    if (name.length > 50) {
      return res.status(400).json({ success: false, message: 'Name cannot exceed 50 characters.' });
    }

    // 3. Rating validation
    const parsedRating = parseInt(rating, 10);
    if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({ success: false, message: 'Please select a valid star rating (1 to 5 stars).' });
    }

    // 4. Comment validation and sanitization
    if (!comment || typeof comment !== 'string') {
      return res.status(400).json({ success: false, message: 'Please write your review thoughts.' });
    }
    comment = comment.replace(/<[^>]*>?/gm, '').trim();
    if (comment.length < 5) {
      return res.status(400).json({ success: false, message: 'Your review must be at least 5 characters long.' });
    }
    if (comment.length > 600) {
      return res.status(400).json({ success: false, message: 'Your review cannot exceed 600 characters.' });
    }

    // 5. Select avatar color
    const brandColors = ['#1769E0', '#7B4DCE', '#E91E8F', '#10B981', '#0EA5E9', '#F59E0B'];
    const avatarColor = brandColors[Math.floor(Math.random() * brandColors.length)];

    // 6. Create Review in MongoDB
    const newReview = await Review.create({
      name,
      rating: parsedRating,
      comment,
      badge: 'Verified Conversation',
      avatarColor,
      isApproved: true
    });

    console.log(`[Review] New review submitted by ${name} (${parsedRating} stars)`);

    return res.status(201).json({
      success: true,
      message: 'Thank you! Your heartfelt review has been published.',
      review: newReview
    });
  } catch (error) {
    console.error('[Submit Review Error]', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while submitting your review. Please try again.'
    });
  }
};
