/**
 * Payment Service Tests
 *
 * Tests for Stripe integration including:
 *   - Checkout session creation
 *   - Webhook event handling
 *   - Payment status queries
 *   - Error handling
 */

'use strict';

// ── Mock Setup ────────────────────────────────────────────────────────────────

// Mock Stripe
const mockStripeCheckoutCreate = jest.fn();
const mockStripeWebhooksConstructEvent = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: mockStripeCheckoutCreate,
      },
    },
    webhooks: {
      constructEvent: mockStripeWebhooksConstructEvent,
    },
  }));
});

// Mock Firestore
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockUpdate = jest.fn();
const mockDoc = jest.fn().mockReturnValue({
  get: mockGet,
  set: mockSet,
  update: mockUpdate,
});
const mockWhere = jest.fn().mockReturnThis();
const mockOrderBy = jest.fn().mockReturnThis();
const mockLimit = jest.fn().mockReturnThis();
const mockCollection = jest.fn().mockReturnValue({
  doc: mockDoc,
  where: mockWhere,
  orderBy: mockOrderBy,
  limit: mockLimit,
  get: mockGet,
});

jest.mock('../src/config/firestore', () => ({
  collection: mockCollection,
}));

// Mock logger
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Set env vars before requiring the module
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock_secret';

const paymentService = require('../src/services/paymentService');

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('paymentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── createCheckoutSession ─────────────────────────────────────────────────

  describe('createCheckoutSession', () => {
    const validParams = {
      userId: 'user-123',
      userEmail: 'test@example.com',
      portfolioId: 'portfolio-abc',
      successUrl: 'https://morty.app/success',
      cancelUrl: 'https://morty.app/cancel',
    };

    it('should create a checkout session successfully', async () => {
      // User does not have paid access
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ paidAnalyses: false }),
      });

      // Stripe session creation
      mockStripeCheckoutCreate.mockResolvedValueOnce({
        id: 'cs_test_session_123',
        url: 'https://checkout.stripe.com/pay/cs_test_session_123',
      });

      // storePendingPayment – doc set
      mockGet.mockResolvedValueOnce({ exists: false });
      mockSet.mockResolvedValueOnce();

      const result = await paymentService.createCheckoutSession(validParams);

      expect(result).toHaveProperty('sessionId', 'cs_test_session_123');
      expect(result).toHaveProperty('url');
      expect(result.url).toContain('checkout.stripe.com');
      expect(mockStripeCheckoutCreate).toHaveBeenCalledTimes(1);

      // Verify session params
      const sessionParams = mockStripeCheckoutCreate.mock.calls[0][0];
      expect(sessionParams.mode).toBe('payment');
      expect(sessionParams.client_reference_id).toBe('user-123');
      expect(sessionParams.metadata.userId).toBe('user-123');
      expect(sessionParams.metadata.portfolioId).toBe('portfolio-abc');
      expect(sessionParams.metadata.product).toBe('expert_analysis');
      expect(sessionParams.success_url).toBe('https://morty.app/success');
      expect(sessionParams.cancel_url).toBe('https://morty.app/cancel');
      expect(sessionParams.locale).toBe('he');
    });

    it('should throw 409 if user already has paid access', async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ paidAnalyses: true }),
      });

      await expect(
        paymentService.createCheckoutSession(validParams)
      ).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'ALREADY_PAID',
      });

      expect(mockStripeCheckoutCreate).not.toHaveBeenCalled();
    });

    it('should throw 400 if userId is missing', async () => {
      await expect(
        paymentService.createCheckoutSession({ ...validParams, userId: '' })
      ).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('should throw 400 if successUrl is missing', async () => {
      await expect(
        paymentService.createCheckoutSession({ ...validParams, successUrl: '' })
      ).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('should use ad-hoc price when STRIPE_PRICE_ID is not set', async () => {
      delete process.env.STRIPE_PRICE_ID;

      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ paidAnalyses: false }),
      });

      mockStripeCheckoutCreate.mockResolvedValueOnce({
        id: 'cs_test_adhoc',
        url: 'https://checkout.stripe.com/pay/cs_test_adhoc',
      });

      mockSet.mockResolvedValueOnce();

      await paymentService.createCheckoutSession(validParams);

      const sessionParams = mockStripeCheckoutCreate.mock.calls[0][0];
      expect(sessionParams.line_items[0]).toHaveProperty('price_data');
      expect(sessionParams.line_items[0].price_data.unit_amount).toBe(14900);
      expect(sessionParams.line_items[0].price_data.currency).toBe('ils');
    });

    it('should use STRIPE_PRICE_ID when configured', async () => {
      process.env.STRIPE_PRICE_ID = 'price_test_123';

      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ paidAnalyses: false }),
      });

      mockStripeCheckoutCreate.mockResolvedValueOnce({
        id: 'cs_test_price_id',
        url: 'https://checkout.stripe.com/pay/cs_test_price_id',
      });

      mockSet.mockResolvedValueOnce();

      await paymentService.createCheckoutSession(validParams);

      const sessionParams = mockStripeCheckoutCreate.mock.calls[0][0];
      expect(sessionParams.line_items[0]).toHaveProperty('price', 'price_test_123');
      expect(sessionParams.line_items[0]).not.toHaveProperty('price_data');

      delete process.env.STRIPE_PRICE_ID;
    });
  });

  // ── constructWebhookEvent ─────────────────────────────────────────────────

  describe('constructWebhookEvent', () => {
    it('should construct event from valid signature', () => {
      const mockEvent = { id: 'evt_123', type: 'checkout.session.completed' };
      mockStripeWebhooksConstructEvent.mockReturnValueOnce(mockEvent);

      const result = paymentService.constructWebhookEvent('raw-body', 'sig-header');

      expect(result).toEqual(mockEvent);
      expect(mockStripeWebhooksConstructEvent).toHaveBeenCalledWith(
        'raw-body',
        'sig-header',
        'whsec_mock_secret'
      );
    });

    it('should throw 400 on invalid signature', () => {
      mockStripeWebhooksConstructEvent.mockImplementationOnce(() => {
        throw new Error('Invalid signature');
      });

      expect(() => {
        paymentService.constructWebhookEvent('raw-body', 'bad-sig');
      }).toThrow();
    });
  });

  // ── handleWebhookEvent ────────────────────────────────────────────────────

  describe('handleWebhookEvent', () => {
    it('should handle checkout.session.completed and unlock paid access', async () => {
      const event = {
        id: 'evt_completed_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_completed',
            metadata: { userId: 'user-456', portfolioId: 'port-789' },
            client_reference_id: 'user-456',
            payment_intent: 'pi_test_123',
            amount_total: 14900,
            currency: 'ils',
            customer_details: { email: 'user@example.com' },
          },
        },
      };

      // User exists
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ id: 'user-456', email: 'user@example.com' }),
      });

      // User update
      mockUpdate.mockResolvedValueOnce();

      // Payment record update – doc exists
      mockGet.mockResolvedValueOnce({ exists: true });
      mockUpdate.mockResolvedValueOnce();

      const result = await paymentService.handleWebhookEvent(event);

      expect(result.handled).toBe(true);
      expect(result.type).toBe('checkout.session.completed');
      expect(result.message).toContain('user-456');

      // Verify user was updated with paidAnalyses: true
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          paidAnalyses: true,
          stripeSessionId: 'cs_test_completed',
          stripePaymentIntentId: 'pi_test_123',
        })
      );
    });

    it('should handle checkout.session.expired', async () => {
      const event = {
        id: 'evt_expired_123',
        type: 'checkout.session.expired',
        data: {
          object: {
            id: 'cs_test_expired',
            metadata: { userId: 'user-789' },
          },
        },
      };

      // Payment record update
      mockGet.mockResolvedValueOnce({ exists: true });
      mockUpdate.mockResolvedValueOnce();

      const result = await paymentService.handleWebhookEvent(event);

      expect(result.handled).toBe(true);
      expect(result.type).toBe('checkout.session.expired');
    });

    it('should acknowledge unhandled event types', async () => {
      const event = {
        id: 'evt_unknown_123',
        type: 'payment_intent.created',
        data: { object: {} },
      };

      const result = await paymentService.handleWebhookEvent(event);

      expect(result.handled).toBe(false);
      expect(result.type).toBe('payment_intent.created');
    });

    it('should return handled=false when userId is missing from session', async () => {
      const event = {
        id: 'evt_no_user',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_no_user',
            metadata: {},
            client_reference_id: null,
          },
        },
      };

      const result = await paymentService.handleWebhookEvent(event);

      expect(result.handled).toBe(false);
      expect(result.message).toContain('Missing userId');
    });

    it('should return handled=false when user not found in Firestore', async () => {
      const event = {
        id: 'evt_no_user_doc',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_no_user_doc',
            metadata: { userId: 'nonexistent-user' },
            client_reference_id: 'nonexistent-user',
          },
        },
      };

      // User does not exist
      mockGet.mockResolvedValueOnce({ exists: false });

      const result = await paymentService.handleWebhookEvent(event);

      expect(result.handled).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  // ── hasUserPaid ───────────────────────────────────────────────────────────

  describe('hasUserPaid', () => {
    it('should return true when user has paidAnalyses flag', async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ paidAnalyses: true }),
      });

      const result = await paymentService.hasUserPaid('user-paid');
      expect(result).toBe(true);
    });

    it('should return false when user does not have paidAnalyses flag', async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ paidAnalyses: false }),
      });

      const result = await paymentService.hasUserPaid('user-unpaid');
      expect(result).toBe(false);
    });

    it('should return false when user does not exist', async () => {
      mockGet.mockResolvedValueOnce({ exists: false });

      const result = await paymentService.hasUserPaid('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false when userId is empty', async () => {
      const result = await paymentService.hasUserPaid('');
      expect(result).toBe(false);
    });

    it('should return false on Firestore error', async () => {
      mockGet.mockRejectedValueOnce(new Error('Firestore error'));

      const result = await paymentService.hasUserPaid('user-error');
      expect(result).toBe(false);
    });
  });

  // ── buildLineItems ────────────────────────────────────────────────────────

  describe('buildLineItems', () => {
    it('should return ad-hoc price when STRIPE_PRICE_ID is not set', () => {
      delete process.env.STRIPE_PRICE_ID;

      const items = paymentService.buildLineItems();

      expect(items).toHaveLength(1);
      expect(items[0]).toHaveProperty('price_data');
      expect(items[0].price_data.unit_amount).toBe(14900);
      expect(items[0].price_data.currency).toBe('ils');
      expect(items[0].price_data.product_data.name).toContain('Morty');
      expect(items[0].quantity).toBe(1);
    });

    it('should return configured price when STRIPE_PRICE_ID is set', () => {
      process.env.STRIPE_PRICE_ID = 'price_configured_123';

      const items = paymentService.buildLineItems();

      expect(items).toHaveLength(1);
      expect(items[0]).toHaveProperty('price', 'price_configured_123');
      expect(items[0]).not.toHaveProperty('price_data');
      expect(items[0].quantity).toBe(1);

      delete process.env.STRIPE_PRICE_ID;
    });
  });

  // ── Constants ─────────────────────────────────────────────────────────────

  describe('constants', () => {
    it('should export correct default price amount (₪149 in agorot)', () => {
      expect(paymentService.DEFAULT_PRICE_AMOUNT).toBe(14900);
    });

    it('should export ILS currency', () => {
      expect(paymentService.CURRENCY).toBe('ils');
    });

    it('should export collection names', () => {
      expect(paymentService.PAYMENTS_COLLECTION).toBe('payments');
      expect(paymentService.USERS_COLLECTION).toBe('users');
    });
  });
});
