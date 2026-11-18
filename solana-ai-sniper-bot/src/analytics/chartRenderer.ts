import { ChartConfiguration } from 'chart.js';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { PnlSummary } from '../core/types';

export class PnlChartRenderer {
  private readonly renderer: ChartJSNodeCanvas;

  constructor(width = 1000, height = 520) {
    this.renderer = new ChartJSNodeCanvas({
      width,
      height,
      backgroundColour: '#0b0f17',
    });
  }

  public async renderBalanceChartPng(summary: PnlSummary): Promise<Buffer> {
    const points =
      summary.equityCurve.length > 0
        ? summary.equityCurve
        : [
            {
              timestamp: Date.now(),
              cumulativePnlSol: 0,
              balanceSol: summary.currentBalanceSol,
              symbol: 'START',
            },
          ];

    const labels = points.map((pt, idx) => {
      if (pt.symbol === 'START') return 'START';
      const d = new Date(pt.timestamp);
      const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `#${idx} ${pt.symbol} (${hhmm})`;
    });

    const dataValues = points.map((pt) => pt.balanceSol);
    const isPositive = summary.currentBalanceSol >= summary.startingBalanceSol;
    const strokeColor = isPositive ? '#10b981' : '#ef4444';
    const fillColor = isPositive ? 'rgba(16, 185, 129, 0.16)' : 'rgba(239, 68, 68, 0.16)';

    const configuration: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: `Account Balance (SOL) [${summary.mode}]`,
            data: dataValues,
            borderColor: strokeColor,
            backgroundColor: fillColor,
            borderWidth: 3,
            pointRadius: 4,
            pointBackgroundColor: strokeColor,
            fill: true,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: false,
        plugins: {
          legend: {
            labels: {
              color: '#e2e8f0',
              font: { size: 14, weight: 'bold' },
            },
          },
          title: {
            display: true,
            text: `Balance Curve | ${summary.startingBalanceSol} -> ${summary.currentBalanceSol} SOL (${
              summary.netReturnPct >= 0 ? '+' : ''
            }${summary.netReturnPct}%) | PF: ${summary.profitFactor} | Exp: ${
              summary.expectancySol >= 0 ? '+' : ''
            }${summary.expectancySol} SOL | WR: ${summary.winRatePct}%`,
            color: '#f8fafc',
            font: { size: 15, weight: 'bold' },
            padding: { top: 14, bottom: 20 },
          },
        },
        scales: {
          x: {
            ticks: { color: '#94a3b8', maxRotation: 25, font: { size: 11 } },
            grid: { color: 'rgba(148, 163, 184, 0.12)' },
          },
          y: {
            ticks: {
              color: '#94a3b8',
              font: { size: 12 },
              callback: (val: string | number) => `${Number(val).toFixed(3)} SOL`,
            },
            grid: { color: 'rgba(148, 163, 184, 0.15)' },
          },
        },
      },
    };

    return this.renderer.renderToBuffer(configuration);
  }

  public async renderStrategyComparisonPng(
    strategies: Array<{ strategy: string; netPnlSol: number; winRatePct: number; trades: number }>,
  ): Promise<Buffer> {
    const safeRows =
      strategies.length > 0
        ? strategies
        : [{ strategy: 'NO_DATA', netPnlSol: 0, winRatePct: 0, trades: 0 }];

    const labels = safeRows.map((s) => `${s.strategy} (${s.trades}t | WR ${s.winRatePct}%)`);
    const values = safeRows.map((s) => s.netPnlSol);
    const colors = values.map((v) =>
      v >= 0 ? 'rgba(16, 185, 129, 0.78)' : 'rgba(239, 68, 68, 0.78)',
    );

    const configuration: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Net PnL by Strategy (SOL)',
            data: values,
            backgroundColor: colors,
            borderColor: values.map((v) => (v >= 0 ? '#10b981' : '#ef4444')),
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: false,
        plugins: {
          legend: {
            labels: { color: '#e2e8f0', font: { size: 13, weight: 'bold' } },
          },
          title: {
            display: true,
            text: 'v7 Strategy Performance Breakdown (Net SOL After Fees)',
            color: '#f8fafc',
            font: { size: 16, weight: 'bold' },
          },
        },
        scales: {
          x: {
            ticks: { color: '#94a3b8', font: { size: 11 } },
            grid: { color: 'rgba(148, 163, 184, 0.12)' },
          },
          y: {
            ticks: {
              color: '#94a3b8',
              callback: (val: string | number) => `${Number(val).toFixed(3)} SOL`,
            },
            grid: { color: 'rgba(148, 163, 184, 0.15)' },
          },
        },
      },
    };

    return this.renderer.renderToBuffer(configuration);
  }
}
