const mockWizardPortfolioResponse = {
    success: true,
    data: {
        portfolios: [
            {
                portfolioName: "Conservative Income",
                riskLevel: "Low",
                expectedReturn: "4%-6%",
                description: "A stable portfolio focused on bonds, dividend stocks, and low volatility ETFs.",
                allocation: [
                    { asset: "US Bonds ETF", percentage: 40 },
                    { asset: "Dividend Stocks", percentage: 30 },
                    { asset: "S&P500 ETF", percentage: 20 },
                    { asset: "Cash", percentage: 10 }
                ]
            },
            {
                portfolioName: "Balanced Growth",
                riskLevel: "Medium",
                expectedReturn: "7%-10%",
                description: "A balanced portfolio mixing equities and fixed income for moderate growth.",
                allocation: [
                    { asset: "S&P500 ETF", percentage: 35 },
                    { asset: "NASDAQ ETF", percentage: 20 },
                    { asset: "International ETF", percentage: 20 },
                    { asset: "Bonds ETF", percentage: 15 },
                    { asset: "REIT", percentage: 10 }
                ]
            },
            {
                portfolioName: "Aggressive Wealth Builder",
                riskLevel: "High",
                expectedReturn: "10%-15%",
                description: "Growth-oriented portfolio with emphasis on tech and emerging markets.",
                allocation: [
                    { asset: "NASDAQ ETF", percentage: 35 },
                    { asset: "AI/Tech Stocks", percentage: 25 },
                    { asset: "Emerging Markets ETF", percentage: 20 },
                    { asset: "Crypto Exposure", percentage: 10 },
                    { asset: "Cash", percentage: 10 }
                ]
            }
        ]
    }
};

module.exports = { mockWizardPortfolioResponse };