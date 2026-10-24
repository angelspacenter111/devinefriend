/*
 * Public Views Router
 * Friend Routes
 */

const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');

router.get('/', publicController.getHome);
router.get('/how-it-works', publicController.getHowItWorks);
router.get('/support', publicController.getSupport);
router.get('/pricing', publicController.getPricing);
router.get('/faq', publicController.getFaq);

// Customer Ratings & Reviews Endpoints
router.get('/api/reviews', publicController.getReviews);
router.post('/api/reviews', publicController.submitReview);

module.exports = router;
