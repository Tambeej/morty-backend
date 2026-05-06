'use strict';

const { db } = require('../config/firebase');
const ratesService = require('./ratesService');
const wizardService = require('./wizardService');
const logger = require('../utils/logger');

/**
 * Save a user's mortgage case (wizard inputs only)
 */
async function createMortgageCase(userId, inputs) {
    try {
        const ref = db.collection('users').doc(userId).collection('mortgageCase').doc('main');

        await ref.set({
            ...inputs,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        return { saved: true };
    } catch (err) {
        logger.error(`mortgageCaseService.createMortgageCase: ${err.message}`);
        throw err;
    }
}

/**
 * Update existing mortgage case
 */
async function updateMortgageCase(userId, inputs) {
    try {
        const ref = db.collection('users').doc(userId).collection('mortgageCase').doc('main');

        await ref.set(
            {
                ...inputs,
                updatedAt: new Date().toISOString(),
            },
            { merge: true }
        );

        return { updated: true };
    } catch (err) {
        logger.error(`mortgageCaseService.updateMortgageCase: ${err.message}`);
        throw err;
    }
}

/**
 * Get mortgage case raw data
 */
async function getMortgageCase(userId) {
    const doc = await db.collection('users').doc(userId).collection('mortgageCase').doc('main').get();

    if (!doc.exists) return null;

    return doc.data();
}

/**
 * Build live dashboard each request
 */
async function buildLiveDashboard(userId) {
    const mortgageCase = await getMortgageCase(userId);

    if (!mortgageCase) {
        throw new Error('MORTGAGE_CASE_NOT_FOUND');
    }

    const currentRates = await ratesService.getCurrentAverages();

    const portfolioResult = await wizardService.generatePortfolios(mortgageCase, true);

    return {
        mortgageCase,
        currentRates,
        portfolios: portfolioResult.portfolios,
        metadata: portfolioResult.metadata,
        generatedAt: new Date().toISOString(),
    };
}

module.exports = {
    createMortgageCase,
    updateMortgageCase,
    getMortgageCase,
    buildLiveDashboard,
};