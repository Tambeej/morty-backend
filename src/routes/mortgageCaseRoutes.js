'use strict';

const express = require('express');
const router = express.Router();
const mortgageCaseController = require('../controllers/mortgageCaseController');

const { protect } = require('../middleware/auth');

router.post('/mortgage-case/create', protect, mortgageCaseController.createMortgageCase);
router.put('/mortgage-case/update', protect, mortgageCaseController.updateMortgageCase);
router.get('/mortgage-case', protect, mortgageCaseController.getMortgageCase);
router.get('/dashboard', protect, mortgageCaseController.getDashboard);

module.exports = router;