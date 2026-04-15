/**
 * Analysis Validator Tests
 *
 * Tests for the Joi validation schemas used by the enhanced analysis endpoint.
 */

'use strict';

const { enhancedAnalysisSchema } = require('../src/validators/analysisValidator');

const validBody = {
  portfolio: {
    id: 'market_standard',
    name: 'Market Standard',
    nameHe: 'תיק שוק סטנדרטי',
    termYears: 30,
    tracks: [
      { type: 'fixed', percentage: 34, rate: 4.75 },
      { type: 'prime', percentage: 33, rate: 5.9 },
      { type: 'cpi', percentage: 33, rate: 3.2 },
    ],
    monthlyRepayment: 5200,
    totalCost: 1872000,
    totalInterest: 672000,
  },
};

describe('enhancedAnalysisSchema', () => {
  it('should accept a valid request body', () => {
    const { error } = enhancedAnalysisSchema.validate(validBody);
    expect(error).toBeUndefined();
  });

  it('should reject missing portfolio', () => {
    const { error } = enhancedAnalysisSchema.validate({});
    expect(error).toBeDefined();
    expect(error.details[0].path).toContain('portfolio');
  });

  it('should reject portfolio without id', () => {
    const body = {
      portfolio: { ...validBody.portfolio, id: '' },
    };
    const { error } = enhancedAnalysisSchema.validate(body);
    expect(error).toBeDefined();
  });

  it('should reject portfolio without name', () => {
    const body = {
      portfolio: { ...validBody.portfolio, name: '' },
    };
    const { error } = enhancedAnalysisSchema.validate(body);
    expect(error).toBeDefined();
  });

  it('should reject portfolio with invalid termYears', () => {
    const body = {
      portfolio: { ...validBody.portfolio, termYears: 0 },
    };
    const { error } = enhancedAnalysisSchema.validate(body);
    expect(error).toBeDefined();
  });

  it('should reject portfolio with termYears > 40', () => {
    const body = {
      portfolio: { ...validBody.portfolio, termYears: 50 },
    };
    const { error } = enhancedAnalysisSchema.validate(body);
    expect(error).toBeDefined();
  });

  it('should reject portfolio without tracks', () => {
    const body = {
      portfolio: { ...validBody.portfolio, tracks: [] },
    };
    const { error } = enhancedAnalysisSchema.validate(body);
    expect(error).toBeDefined();
  });

  it('should reject track with invalid type', () => {
    const body = {
      portfolio: {
        ...validBody.portfolio,
        tracks: [{ type: 'invalid', percentage: 100, rate: 4.5 }],
      },
    };
    const { error } = enhancedAnalysisSchema.validate(body);
    expect(error).toBeDefined();
  });

  it('should reject track with percentage > 100', () => {
    const body = {
      portfolio: {
        ...validBody.portfolio,
        tracks: [{ type: 'fixed', percentage: 150, rate: 4.5 }],
      },
    };
    const { error } = enhancedAnalysisSchema.validate(body);
    expect(error).toBeDefined();
  });

  it('should reject track with negative rate', () => {
    const body = {
      portfolio: {
        ...validBody.portfolio,
        tracks: [{ type: 'fixed', percentage: 100, rate: -1 }],
      },
    };
    const { error } = enhancedAnalysisSchema.validate(body);
    expect(error).toBeDefined();
  });

  it('should reject portfolio with negative monthlyRepayment', () => {
    const body = {
      portfolio: { ...validBody.portfolio, monthlyRepayment: -100 },
    };
    const { error } = enhancedAnalysisSchema.validate(body);
    expect(error).toBeDefined();
  });

  it('should reject portfolio with negative totalInterest', () => {
    const body = {
      portfolio: { ...validBody.portfolio, totalInterest: -1 },
    };
    const { error } = enhancedAnalysisSchema.validate(body);
    expect(error).toBeDefined();
  });

  it('should accept portfolio with optional fields', () => {
    const body = {
      portfolio: {
        ...validBody.portfolio,
        description: 'A test portfolio',
        interestSavings: 50000,
        fitnessScore: 85,
        recommended: true,
      },
    };
    const { error } = enhancedAnalysisSchema.validate(body);
    expect(error).toBeUndefined();
  });

  it('should accept optional portfolioId field', () => {
    const body = {
      ...validBody,
      portfolioId: 'market_standard',
    };
    const { error } = enhancedAnalysisSchema.validate(body);
    expect(error).toBeUndefined();
  });
});
