import { InfoIcon } from '@phosphor-icons/react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const ActivityChart = ({
  firstActive,
  lastActive,
}: {
  firstActive: Date;
  lastActive: Date;
}) => {
  const [selectedTimeframe, setSelectedTimeframe] = useState('12M');

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { availableTimeframes, data, chartWidth, isolatedBarWidth } =
    useMemo(() => {
      const timeframeDays = {
        '12M': 365,
        '3Y': 365 * 3,
        '5Y': 365 * 5,
        '10Y': 365 * 10,
      };

      // All timeframes are always selectable. Younger selectors still get
      // a useful chart: the window is anchored to lastActive, so 10Y on a
      // 2-year-old selector just shows 8 years of empty months followed by
      // the active span at the right edge.
      const availableTimeframes = Object.keys(timeframeDays);

      const currentTimeframe = availableTimeframes.includes(selectedTimeframe)
        ? selectedTimeframe
        : availableTimeframes[0] || '12M';

      // Use month-based stepping to avoid duplicate labels
      let stepMonths = 1;
      if (currentTimeframe === '12M') stepMonths = 1;
      else if (currentTimeframe === '3Y') stepMonths = 2;
      else if (currentTimeframe === '5Y') stepMonths = 3;
      else if (currentTimeframe === '10Y') stepMonths = 6;

      const timeframeDuration =
        timeframeDays[currentTimeframe as keyof typeof timeframeDays];

      // Anchor the chart end to lastActive so expired selectors render
      // their activity at the right edge instead of being squashed against
      // the y-axis. For active selectors lastActive is ~now, so behavior
      // is effectively unchanged.
      const endDate = new Date(lastActive);
      const idealStartDate = new Date(endDate);
      idealStartDate.setDate(idealStartDate.getDate() - timeframeDuration);

      // Snap to the first of the month so labels line up with month
      // boundaries instead of falling mid-month.
      const timeframeStartDate = new Date(
        idealStartDate.getFullYear(),
        idealStartDate.getMonth(),
        1
      );

      const dataPoints = [];
      const current = new Date(timeframeStartDate);

      while (current <= endDate) {
        // Each x-axis label is a bucket of `stepMonths` months. Mark the
        // bucket active if it overlaps [firstActive, lastActive] so a
        // sub-step active window (e.g. only May 2015 with a 6-month step)
        // still surfaces a marker.
        const currentMonth = current.getFullYear() * 12 + current.getMonth();
        const bucketEndMonth = currentMonth + stepMonths - 1;
        const firstMonth =
          firstActive.getFullYear() * 12 + firstActive.getMonth();
        const lastMonth = lastActive.getFullYear() * 12 + lastActive.getMonth();
        const isInActivePeriod =
          bucketEndMonth >= firstMonth && currentMonth <= lastMonth;

        const dateLabel = current.toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
        });

        dataPoints.push({
          date: dateLabel,
          fullDate: current.toISOString().split('T')[0],
          activity: isInActivePeriod ? 8 : null,
          timestamp: current.getTime(),
        });

        current.setMonth(current.getMonth() + stepMonths);
      }

      // Pixels per label slot. "MMM YYYY" ("Nov 2025") is ~55px wide at
      // 12px font, so 75 gives breathing room between adjacent labels even
      // when every tick is rendered (no auto-skipping below).
      const minWidthPerPoint = 75;

      const calculatedWidth = Math.max(
        600,
        dataPoints.length * minWidthPerPoint
      );

      // Visual width of the isolated-bucket marker (when only one bucket
      // is active in the chart, e.g. an expired key whose first/last seen
      // are in the same month). Sized as ~40% of one bucket so a single
      // month reads as a narrow block instead of filling its whole slot,
      // with a min so very dense timeframes still show something.
      const perPointWidth = calculatedWidth / Math.max(dataPoints.length, 1);
      const isolatedBarWidth = Math.max(6, Math.floor(perPointWidth * 0.2));

      return {
        availableTimeframes,
        data: dataPoints,
        chartWidth: calculatedWidth,
        isolatedBarWidth,
      };
    }, [firstActive, lastActive, selectedTimeframe]);

  // The chart window ends at lastActive, so activity always lives at
  // the right edge of the scrollable area. Scroll there on mount and
  // when the timeframe changes so the user sees the active region
  // immediately instead of an empty left side.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
    });
    return () => cancelAnimationFrame(id);
  }, [chartWidth, selectedTimeframe]);

  return (
    <div className='w-full rounded-lg bg-foreground'>
      <div className='mb-4 flex items-center justify-start gap-4 sm:gap-16'>
        <div className='flex items-center gap-1.5'>
          <h2 className='text-base font-normal text-primary'>Activity</h2>
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <InfoIcon
                  size={14}
                  className='cursor-help text-ring'
                  weight='regular'
                />
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  Green area shows the period this key was active, from first
                  seen to last seen.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className='flex flex-row gap-3'>
          {['12M', '3Y', '5Y', '10Y'].map((timeframe) => (
            <Button
              key={timeframe}
              variant={selectedTimeframe === timeframe ? 'default' : 'outline'}
              size='sm'
              onClick={() => setSelectedTimeframe(timeframe)}
              disabled={!availableTimeframes.includes(timeframe)}
              className={`h-auto border px-3 py-1 text-xs ${
                !availableTimeframes.includes(timeframe)
                  ? 'cursor-not-allowed opacity-50'
                  : ''
              }`}
            >
              {timeframe}
            </Button>
          ))}
        </div>
      </div>
      <div ref={scrollRef} className='w-full overflow-x-auto'>
        <div className={`h-16 min-w-full`} style={{ width: `${chartWidth}px` }}>
          <ResponsiveContainer width='100%' height='100%'>
            <AreaChart
              data={data}
              margin={{
                top: 0,
                right: 0,
                left: 0,
                bottom: 0,
              }}
            >
              <defs>
                <pattern
                  id='activityGradient'
                  patternUnits='userSpaceOnUse'
                  width='6'
                  height='48'
                  patternTransform='rotate(-45)'
                >
                  <line
                    x1='0'
                    y1='0'
                    x2='0'
                    y2='48'
                    stroke='#22c55e'
                    strokeWidth='1'
                  />
                </pattern>
              </defs>
              <XAxis
                dataKey='date'
                axisLine={{ stroke: '#E8E8E8', width: '4px' }}
                tickLine={false}
                tick={{ fontSize: 12, fill: '#6b7280' }}
                dy={3}
                // Render every label — minWidthPerPoint above is sized
                // so MMM YYYY labels don't overlap, and per-product
                // direction is "scrolling can be longer".
                interval={0}
                // Give the first and last labels half a label-width of
                // breathing room inside the plot area so they don't
                // clip against the scroll container edges.
                padding={{ left: 30, right: 30 }}
              />
              <YAxis hide domain={[0, 10]} />
              <Area
                type='monotone'
                dataKey='activity'
                stroke='#22c55e'
                strokeWidth={1}
                fill='url(#activityGradient)'
                // Recharts <Area> can't render an isolated single
                // active data point (with null neighbours): the area
                // path between two null points has zero width. For
                // selectors whose activity window fits inside a single
                // bucket on the current timeframe (e.g. first and last
                // seen in the same month on the 12M view) draw an
                // explicit bucket-wide block so they remain visible.
                //
                // Geometry note: data value is fixed at 8 with a [0,10]
                // y-domain, so cy sits at 20% of the plot height from
                // the top. The plot bottom is therefore at 5*cy and
                // the bar height from cy down to the bottom is 4*cy.
                dot={(dotProps: {
                  cx?: number;
                  cy?: number;
                  index?: number;
                  payload?: { activity: number | null };
                  key?: React.Key | null;
                }) => {
                  const { cx, cy, payload, index, key } = dotProps;
                  if (
                    cx === undefined ||
                    cy === undefined ||
                    index === undefined ||
                    !payload ||
                    payload.activity === null
                  ) {
                    return <g key={key} />;
                  }
                  const prev = data[index - 1];
                  const next = data[index + 1];
                  const isIsolated =
                    (!prev || prev.activity === null) &&
                    (!next || next.activity === null);
                  if (!isIsolated) return <g key={key} />;
                  const halfBar = isolatedBarWidth / 2;
                  const barHeight = Math.max(0, cy * 4);
                  return (
                    <g key={key}>
                      <rect
                        x={cx - halfBar}
                        y={cy}
                        width={isolatedBarWidth}
                        height={barHeight}
                        fill='url(#activityGradient)'
                      />
                      <line
                        x1={cx - halfBar}
                        y1={cy}
                        x2={cx + halfBar}
                        y2={cy}
                        stroke='#22c55e'
                        strokeWidth={1}
                      />
                    </g>
                  );
                }}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default ActivityChart;
