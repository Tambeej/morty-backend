const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const wizardInputController = require('../controllers/wizardInputController');

router.post('/save-input', protect, wizardInputController.saveInput);

module.exports = router;