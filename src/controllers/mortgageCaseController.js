'use strict';

const mortgageCaseService = require('../services/mortgageCaseService');
const { sendSuccess, sendError } = require('../utils/response');
const logger = require('../utils/logger');

exports.createMortgageCase = async (req, res) => {
    try {
        const userId = req.user.id;
        const { inputs } = req.body;

        const result = await mortgageCaseService.createMortgageCase(userId, inputs);

        return sendSuccess(res, result, 'Mortgage case saved successfully');
    } catch (err) {
        logger.error(`mortgageCaseController.createMortgageCase: ${err.message}`);
        return sendError(res, 'Failed to save mortgage case', 500, 'MORTGAGE_CASE_CREATE_ERROR');
    }
};

exports.updateMortgageCase = async (req, res) => {
    try {
        const userId = req.user.id;
        const { inputs } = req.body;

        const result = await mortgageCaseService.updateMortgageCase(userId, inputs);

        return sendSuccess(res, result, 'Mortgage case updated successfully');
    } catch (err) {
        logger.error(`mortgageCaseController.updateMortgageCase: ${err.message}`);
        return sendError(res, 'Failed to update mortgage case', 500, 'MORTGAGE_CASE_UPDATE_ERROR');
    }
};

exports.getMortgageCase = async (req, res) => {
    try {
        const userId = req.user.id;

        const result = await mortgageCaseService.getMortgageCase(userId);

        return sendSuccess(res, result, 'Mortgage case fetched successfully');
    } catch (err) {
        logger.error(`mortgageCaseController.getMortgageCase: ${err.message}`);
        return sendError(res, 'Failed to fetch mortgage case', 500, 'MORTGAGE_CASE_FETCH_ERROR');
    }
};

exports.getDashboard = async (req, res) => {
    try {
        const userId = req.user.id;

        const dashboard = await mortgageCaseService.buildLiveDashboard(userId);

        return sendSuccess(res, dashboard, 'Dashboard generated successfully');
    } catch (err) {
        logger.error(`mortgageCaseController.getDashboard: ${err.message}`);
        return sendError(res, 'Failed to generate dashboard', 500, 'DASHBOARD_ERROR');
    }
};