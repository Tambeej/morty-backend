const wizardInputService = require('../services/wizardInputService');

exports.saveInput = async (req, res) => {
    try {
        const userId = req.user.id;
        const { inputs } = req.body;

        if (!inputs) {
            return res.status(400).json({ success: false, message: 'Missing inputs' });
        }

        const docId = await wizardInputService.saveWizardInput(userId, inputs);

        return res.json({
            success: true,
            data: { id: docId },
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};