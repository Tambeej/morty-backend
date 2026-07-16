'use strict';

/**
 * Send a standardised success response.
 *
 * Accepts either argument order:
 *   sendSuccess(res, data, statusCode, message)   – documented form
 *   sendSuccess(res, data, message, statusCode)   – widely used in this codebase
 *
 * The 3rd arg's type disambiguates the two.
 *
 * @param {import('express').Response} res
 * @param {*} data - Payload to include under `data`.
 * @param {number|string} [arg3=200] - statusCode (number) or message (string).
 * @param {string|number} [arg4='Success'] - message or statusCode (the other one).
 */
function sendSuccess(res, data, arg3 = 200, arg4 = 'Success') {
  let statusCode = 200;
  let message = 'Success';
  if (typeof arg3 === 'number') {
    statusCode = arg3;
    message = typeof arg4 === 'string' ? arg4 : message;
  } else if (typeof arg3 === 'string') {
    message = arg3;
    statusCode = typeof arg4 === 'number' ? arg4 : statusCode;
  }
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
