/**
 * Payment Controller Tests
 *
 * Tests for the Stripe payment HTTP handlers:
 *   - POST /api/v1/stripe/checkout
 *   - POST /api/v1/stripe/webhook
 *   - GET  /api/v1/stripe/status
 */

'use strict';

const httpMocks = require('node-mocks-http');

// ── Mock Setup ────────────────────────────────────────────────────────────────

const mockCreateCheckoutSession = jest.fn();
const mockConstructWebhookEvent = jest.fn();
const mockHandleWebhookEvent = jest.fn();
const mockHasUserPaid = jest.fn();
const mockGetPaymentHistory = jest.fn();

jest.mock('../src/services/paymentService', () => ({
  createCheckoutSession: mockCreateCheckoutSession,
  constructWebhookEvent: mockConstructWebhookEvent,
  handleWebhookEvent: mockHandleWebhookEvent,
  hasUserPaid: mockHasUserPaid,
  getPaymentHistory: mockGetPaymentHistory,
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const paymentController = require('../src/controllers/paymentController');

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('paymentController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── createCheckout ────────────────────────────────────────────────────────

  describe('createCheckout', () => {
    it('should create checkout session and return 200', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/api/v1/stripe/checkout',
        body: {
          portfolioId: 'port-123',
          successUrl: 'https://morty.app/success',
          cancelUrl: 'https://morty.app/cancel',
        },
        user: { id: 'user-123', email: 'test@example.com' },
      });
      const res = httpMocks.createResponse();

      mockCreateCheckoutSession.mockResolvedValueOnce({
        sessionId: 'cs_test_123',
        url: 'https://checkout.stripe.com/pay/cs_test_123',
      });

      await paymentController.createCheckout(req, res);

      expect(res.statusCode).toBe(200);
      const data = res._getJSONData();
      expect(data.success).toBe(true);
      expect(data.data.sessionId).toBe('cs_test_123');
      expect(data.data.url).toContain('checkout.stripe.com');
    });

    it('should return error status code from service errors', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/api/v1/stripe/checkout',
        body: { successUrl: 'https://morty.app/success' },
        user: { id: 'user-paid', email: 'paid@example.com' },
      });
      const res = httpMocks.createResponse();

      const err = new Error('User already has paid access');
      err.statusCode = 409;
      err.errorCode = 'ALREADY_PAID';
      mockCreateCheckoutSession.mockRejectedValueOnce(err);

      await paymentController.createCheckout(req, res);

      expect(res.statusCode).toBe(409);
      const data = res._getJSONData();
      expect(data.success).toBe(false);
    });

    it('should return 500 on unexpected errors', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/api/v1/stripe/checkout',
        body: { successUrl: 'https://morty.app/success' },
        user: { id: 'user-123', email: 'test@example.com' },
      });
      const res = httpMocks.createResponse();

      mockCreateCheckoutSession.mockRejectedValueOnce(new Error('Unexpected'));

      await paymentController.createCheckout(req, res);

      expect(res.statusCode).toBe(500);
    });
  });

  // ── handleWebhook ─────────────────────────────────────────────────────────

  describe('handleWebhook', () => {
    it('should process valid webhook event and return 200', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/api/v1/stripe/webhook',
        headers: { 'stripe-signature': 'sig_valid' },
        body: Buffer.from('{"type":"checkout.session.completed"}'),
      });
      const res = httpMocks.createResponse();

      const mockEvent = { id: 'evt_123', type: 'checkout.session.completed' };
      mockConstructWebhookEvent.mockReturnValueOnce(mockEvent);
      mockHandleWebhookEvent.mockResolvedValueOnce({
        handled: true,
        type: 'checkout.session.completed',
        message: 'Paid access unlocked',
      });

      await paymentController.handleWebhook(req, res);

      expect(res.statusCode).toBe(200);
      const data = res._getJSONData();
      expect(data.received).toBe(true);
      expect(data.handled).toBe(true);
    });

    it('should return 400 when Stripe-Signature header is missing', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/api/v1/stripe/webhook',
        headers: {},
        body: Buffer.from('{}'),
      });
      const res = httpMocks.createResponse();

      await paymentController.handleWebhook(req, res);

      expect(res.statusCode).toBe(400);
      const data = res._getJSONData();
      expect(data.success).toBe(false);
      expect(data.message).toContain('Stripe-Signature');
    });

    it('should return error when signature verification fails', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/api/v1/stripe/webhook',
        headers: { 'stripe-signature': 'sig_invalid' },
        body: Buffer.from('{}'),
      });
      const res = httpMocks.createResponse();

      const err = new Error('Webhook signature verification failed');
      err.statusCode = 400;
      mockConstructWebhookEvent.mockImplementationOnce(() => { throw err; });

      await paymentController.handleWebhook(req, res);

      expect(res.statusCode).toBe(400);
    });

    it('should return 500 when event processing fails', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/api/v1/stripe/webhook',
        headers: { 'stripe-signature': 'sig_valid' },
        body: Buffer.from('{}'),
      });
      const res = httpMocks.createResponse();

      const mockEvent = { id: 'evt_fail', type: 'checkout.session.completed' };
      mockConstructWebhookEvent.mockReturnValueOnce(mockEvent);
      mockHandleWebhookEvent.mockRejectedValueOnce(new Error('Processing failed'));

      await paymentController.handleWebhook(req, res);

      expect(res.statusCode).toBe(500);
    });
  });

  // ── getPaymentStatus ──────────────────────────────────────────────────────

  describe('getPaymentStatus', () => {
    it('should return payment status for authenticated user', async () => {
      const req = httpMocks.createRequest({
        method: 'GET',
        url: '/api/v1/stripe/status',
        user: { id: 'user-123' },
      });
      const res = httpMocks.createResponse();

      mockHasUserPaid.mockResolvedValueOnce(true);
      mockGetPaymentHistory.mockResolvedValueOnce([
        { id: 'cs_123', status: 'completed', createdAt: '2025-01-01' },
      ]);

      await paymentController.getPaymentStatus(req, res);

      expect(res.statusCode).toBe(200);
      const data = res._getJSONData();
      expect(data.success).toBe(true);
      expect(data.data.hasPaid).toBe(true);
      expect(data.data.payments).toHaveLength(1);
    });

    it('should return hasPaid=false for unpaid user', async () => {
      const req = httpMocks.createRequest({
        method: 'GET',
        url: '/api/v1/stripe/status',
        user: { id: 'user-unpaid' },
      });
      const res = httpMocks.createResponse();

      mockHasUserPaid.mockResolvedValueOnce(false);
      mockGetPaymentHistory.mockResolvedValueOnce([]);

      await paymentController.getPaymentStatus(req, res);

      expect(res.statusCode).toBe(200);
      const data = res._getJSONData();
      expect(data.data.hasPaid).toBe(false);
      expect(data.data.payments).toHaveLength(0);
    });

    it('should return 500 on error', async () => {
      const req = httpMocks.createRequest({
        method: 'GET',
        url: '/api/v1/stripe/status',
        user: { id: 'user-error' },
      });
      const res = httpMocks.createResponse();

      mockHasUserPaid.mockRejectedValueOnce(new Error('DB error'));

      await paymentController.getPaymentStatus(req, res);

      expect(res.statusCode).toBe(500);
    });
  });
});
