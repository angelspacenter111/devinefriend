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

module.exports = router;
