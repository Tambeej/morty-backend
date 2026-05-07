'use strict';

/**
 * Send a standardised success response.
 *
 * @param {import('express').Response} res
 * @param {*} data - Payload to include under `data`.
 * @param {number} [statusCode=200]
 * @param {string} [message='Success']
 */
function sendSuccess(res, data, statusCode = 200, message = 'Success') {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

/**
 * Send a standardised error response.
 *
 * @param {import('express').Response} res
 * @param {string} message
 * @param {number} [statusCode=500]
 * @param {string} [code='INTERNAL_ERROR']
 * @param {*} [details=null]
 */
function sendError(res, message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
  const body = {
    success: false,
    error: {
      code,
      message,
    },
  };
  if (details) {
    body.error.details = details;
  }
  return res.status(statusCode).json(body);
}

module.exports = { sendSuccess, sendError };
