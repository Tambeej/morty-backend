/**
 * Analysis Service Tests
 * Tests for mortgage analysis business logic
 */

const {
  calculateMortgageMetrics,
  getMarketAverageRate,
  generateRecommendations,
} = require('../src/services/aiService');

describe('Mortgage Analysis Service', () => {
  describe('calculateMortgageMetrics', () => {
    const mockFinancial = {
      income: 20000,
      expenses: { housing: 0, loans: 1000, other: 2000 },
      assets: { savings: 200000, investments: 50000 },
    };

    it('should calculate monthly payment correctly', () => {
      const mortgageData = { amount: 1000000, rate: 4.0, term: 25 };
      const metrics = calculateMortgageMetrics(mortgageData, mockFinancial);

      expect(metrics.monthlyPayment).toBeGreaterThan(0);
      expect(metrics.monthlyPayment).toBeLessThan(mortgageData.amount);
      // Standard amortization: ~5278 for 1M at 4% over 25 years
      expect(metrics.monthlyPayment).toBeCloseTo(5278, -2);
    });

    it('should calculate total cost correctly', () => {
      const mortgageData = { amount: 1000000, rate: 4.0, term: 25 };
      const metrics = calculateMortgageMetrics(mortgageData, mockFinancial);

      expect(metrics.totalCost).toBe(metrics.monthlyPayment * 25 * 12);
      expect(metrics.totalInterest).toBe(metrics.totalCost - mortgageData.amount);
    });

    it('should identify above-market rates', () => {
      const marketRate = getMarketAverageRate();
      const aboveMarketData = { amount: 1000000, rate: marketRate + 1, term: 25 };
      const metrics = calculateMortgageMetrics(aboveMarketData, mockFinancial);

      expect(metrics.isAboveMarket).toBe(true);
      expect(metrics.rateVsMarket).toBeCloseTo(1, 1);
      expect(metrics.potentialSavings).toBeGreaterThan(0);
    });

    it('should identify below-market rates', () => {
      const marketRate = getMarketAverageRate();
      const belowMarketData = { amount: 1000000, rate: marketRate - 0.5, term: 25 };
      const metrics = calculateMortgageMetrics(belowMarketData, mockFinancial);

      expect(metrics.isAboveMarket).toBe(false);
      expect(metrics.potentialSavings).toBe(0);
    });

    it('should calculate debt-to-income ratio', () => {
      const mortgageData = { amount: 1000000, rate: 4.0, term: 25 };
      const metrics = calculateMortgageMetrics(mortgageData, mockFinancial);

      expect(metrics.debtToIncomeRatio).toBeGreaterThan(0);
      // DTI = (monthlyPayment + existing loans) / income * 100
      const expectedDTI = ((metrics.monthlyPayment + 1000) / 20000) * 100;
      expect(metrics.debtToIncomeRatio).toBeCloseTo(expectedDTI, 0);
    });

    it('should handle missing financial profile', () => {
      const mortgageData = { amount: 1000000, rate: 4.0, term: 25 };
      const metrics = calculateMortgageMetrics(mortgageData, null);

      expect(metrics.monthlyPayment).toBeGreaterThan(0);
      expect(metrics.debtToIncomeRatio).toBeNull();
      expect(metrics.affordabilityScore).toBeNull();
    });

    it('should handle zero interest rate', () => {
      const mortgageData = { amount: 1200000, rate: 0, term: 20 };
      const metrics = calculateMortgageMetrics(mortgageData, mockFinancial);

      expect(metrics.monthlyPayment).toBe(Math.round(1200000 / (20 * 12)));
    });
  });

  describe('generateRecommendations', () => {
    const mockFinancial = {
      income: 20000,
      expenses: { housing: 0, loans: 500, other: 2000 },
    };

    it('should recommend rate negotiation for above-market rates', () => {
      const marketRate = getMarketAverageRate();
      const mortgageData = { amount: 1000000, rate: marketRate + 1, term: 25 };
      const metrics = calculateMortgageMetrics(mortgageData, mockFinancial);
      const recommendations = generateRecommendations(mortgageData, mockFinancial, metrics);

      const rateRec = recommendations.find((r) => r.type === 'rate_negotiation');
      expect(rateRec).toBeDefined();
      expect(rateRec.priority).toBe(1);
    });

    it('should always include compare offers recommendation', () => {
      const mortgageData = { amount: 1000000, rate: 3.5, term: 25 };
      const metrics = calculateMortgageMetrics(mortgageData, mockFinancial);
      const recommendations = generateRecommendations(mortgageData, mockFinancial, metrics);

      const compareRec = recommendations.find((r) => r.type === 'compare_offers');
      expect(compareRec).toBeDefined();
    });

    it('should warn about high DTI ratio', () => {
      const lowIncomeFinancial = { income: 5000, expenses: { loans: 500 } };
      const mortgageData = { amount: 1000000, rate: 4.0, term: 25 };
      const metrics = calculateMortgageMetrics(mortgageData, lowIncomeFinancial);
      const recommendations = generateRecommendations(mortgageData, lowIncomeFinancial, metrics);

      if (metrics.debtToIncomeRatio > 43) {
        const warningRec = recommendations.find((r) => r.type === 'affordability_warning');
        expect(warningRec).toBeDefined();
      }
    });

    it('should return recommendations sorted by priority', () => {
      const mortgageData = { amount: 1000000, rate: 5.5, term: 25 };
      const metrics = calculateMortgageMetrics(mortgageData, mockFinancial);
      const recommendations = generateRecommendations(mortgageData, mockFinancial, metrics);

      for (let i = 1; i < recommendations.length; i++) {
        expect(recommendations[i].priority).toBeGreaterThanOrEqual(recommendations[i - 1].priority);
      }
    });
  });

  describe('getMarketAverageRate', () => {
    it('should return a valid rate', () => {
      const rate = getMarketAverageRate();
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThan(20);
    });

    it('should use MARKET_AVERAGE_RATE env var if set', () => {
      const originalRate = process.env.MARKET_AVERAGE_RATE;
      process.env.MARKET_AVERAGE_RATE = '5.0';
      const rate = getMarketAverageRate();
      expect(rate).toBe(5.0);
      process.env.MARKET_AVERAGE_RATE = originalRate;
    });
  });
});
