import { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import {
  ActiveSnipePosition,
  buildSparklineSeries,
  SparklinePoint,
} from '../lib/sniperTerminal';

interface PositionSparklineProps {
  position: ActiveSnipePosition;
  isWin: boolean;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: SparklinePoint }>;
}

function SparklineTooltip({ active, payload }: CustomTooltipProps) {
  const point = active && payload && payload.length > 0 ? payload[0]?.payload : undefined;
  if (!point) return null;

  const isUp = point.deltaPct >= 0;
  return (
    <div className="rounded-lg bg-slate-950/95 backdrop-blur-md border border-white/15 px-2 py-1 shadow-xl font-mono tabular-nums text-[10px] leading-tight whitespace-nowrap">
      <div className="text-slate-400">{point.label}</div>
      <div className="text-white font-semibold">${point.price.toFixed(5)}</div>
      <div className={isUp ? 'text-[#00FFA3] font-bold' : 'text-[#FF3B6B] font-bold'}>
        {isUp ? '+' : ''}
        {point.deltaPct.toFixed(1)}%
      </div>
    </div>
  );
}

export function PositionSparkline({ position, isWin }: PositionSparklineProps) {
  const data = useMemo(() => buildSparklineSeries(position), [position]);

  const { minDomain, maxDomain } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const d of data) {
      if (d.price < min) min = d.price;
      if (d.price > max) max = d.price;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { minDomain: 0, maxDomain: 1 };
    }
    const span = max - min;
    const pad = span > 0 ? span * 0.14 : Math.max(min * 0.02, 1e-6);
    return {
      minDomain: Math.max(0, min - pad),
      maxDomain: max + pad,
    };
  }, [data]);

  const strokeColor = isWin ? '#00FFA3' : '#FF3B6B';
  const safeId = position.id.replace(/[^a-zA-Z0-9_-]/g, '');
  const gradientId = `spark-grad-${safeId}`;
  const lastPoint = data[data.length - 1];

  return (
    <div
      role="img"
      aria-label={`10-tick momentum trend for ${position.symbol}, latest $${(
        lastPoint?.price ?? position.currentPriceUsd
      ).toFixed(5)}`}
      data-testid={`sparkline-${position.id}`}
      data-sparkline-ticks={data.length}
      className="w-full sm:w-[126px] h-[42px] shrink-0 rounded-lg bg-slate-950/55 border border-white/10 px-1 py-0.5 flex items-center"
    >
      <ResponsiveContainer width="100%" height={36} minWidth={80}>
        <AreaChart data={data} margin={{ top: 4, right: 3, bottom: 2, left: 3 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity={0.34} />
              <stop offset="100%" stopColor={strokeColor} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[minDomain, maxDomain]} />
          <Tooltip
            content={<SparklineTooltip />}
            cursor={{ stroke: 'rgba(255,255,255,0.28)', strokeWidth: 1, strokeDasharray: '2 2' }}
            isAnimationActive={false}
            allowEscapeViewBox={{ x: true, y: true }}
            wrapperStyle={{ zIndex: 40, pointerEvents: 'none' }}
          />
          <Area
            type="monotone"
            dataKey="price"
            stroke={strokeColor}
            strokeWidth={1.75}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            activeDot={{
              r: 3,
              fill: strokeColor,
              stroke: '#07090E',
              strokeWidth: 1.5,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
