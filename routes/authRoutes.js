/*
 * Authentication Views Router
 * Friend Routes
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.get('/login', authController.getLogin);
router.post('/login', authController.postLogin);

router.get('/register', authController.getRegister);
router.post('/register', authController.postRegister);

router.get('/logout', authController.logout);

router.get('/forgot-password', authController.getForgotPassword);

module.exports = router;
