/**
 * API response helpers for consistent JSON response format.
 * All API responses follow the same structure for predictability.
 */

/**
 * Send a successful response.
 *
 * @param {Object} res - Express response object
 * @param {*} data - Response data
 * @param {string} [message] - Optional success message
 * @param {number} [statusCode=200] - HTTP status code
 *
 * @example
 * sendSuccess(res, { user }, 'User created', 201);
 */
const sendSuccess = (res, data = null, message = 'Success', statusCode = 200) => {
  const response = {
    success: true,
    message,
    ...(data !== null && { data }),
    timestamp: new Date().toISOString(),
  };

  return res.status(statusCode).json(response);
};

/**
 * Send a created (201) response.
 *
 * @param {Object} res - Express response object
 * @param {*} data - Created resource data
 * @param {string} [message='Created successfully'] - Success message
 */
const sendCreated = (res, data, message = 'Created successfully') => {
  return sendSuccess(res, data, message, 201);
};

/**
 * Send a no-content (204) response.
 *
 * @param {Object} res - Express response object
 */
const sendNoContent = (res) => {
  return res.status(204).send();
};

/**
 * Send a paginated list response.
 *
 * @param {Object} res - Express response object
 * @param {Array} items - Array of items
 * @param {Object} pagination - Pagination metadata
 * @param {number} pagination.page - Current page number
 * @param {number} pagination.limit - Items per page
 * @param {number} pagination.total - Total number of items
 * @param {string} [message='Success'] - Success message
 */
const sendPaginated = (res, items, pagination, message = 'Success') => {
  const { page, limit, total } = pagination;
  const totalPages = Math.ceil(total / limit);

  return res.status(200).json({
    success: true,
    message,
    data: items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
    timestamp: new Date().toISOString(),
  });
};

/**
 * Send an error response.
 *
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {number} [statusCode=500] - HTTP status code
 * @param {string} [errorCode='ERROR'] - Machine-readable error code
 * @param {*} [details] - Additional error details
 */
const sendError = (res, message, statusCode = 500, errorCode = 'ERROR', details = null) => {
  const response = {
    success: false,
    error: {
      code: errorCode,
      message,
      ...(details && { details }),
    },
    timestamp: new Date().toISOString(),
  };

  return res.status(statusCode).json(response);
};

module.exports = {
  sendSuccess,
  sendCreated,
  sendNoContent,
  sendPaginated,
  sendError,
};
