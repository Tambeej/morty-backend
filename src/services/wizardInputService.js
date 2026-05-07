// wizardInputService.js
const { db } = require('../config/firebase');

const COLLECTION = 'wizardInputs';

exports.saveWizardInput = async (userId, inputs) => {
    await db.collection(COLLECTION).doc(userId).set(
        {
            userId,
            inputs,
            updatedAt: new Date(),
        },
        { merge: true } // keeps flexibility if you add fields later
    );

    return userId;
};

exports.getUserInput = async (userId) => {
    const doc = await db.collection(COLLECTION).doc(userId).get();

    if (!doc.exists) return null;

    return doc.data();
};