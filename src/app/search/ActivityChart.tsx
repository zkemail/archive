import { InfoIcon } from '@phosphor-icons/react';
import React, { useMemo, useState } from 'react';
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

  const { availableTimeframes, data, chartWidth } = useMemo(() => {
    const now = new Date();
    const totalDays = Math.ceil(
      (now.getTime() - firstActive.getTime()) / (1000 * 60 * 60 * 24)
    );

    const timeframeDays = {
      '12M': 365,
      '3Y': 365 * 3,
      '5Y': 365 * 5,
      '10Y': 365 * 10,
    };

    const availableTimeframes = Object.keys(timeframeDays).filter(
      (tf) => totalDays >= timeframeDays[tf as keyof typeof timeframeDays] * 0.5
    );

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
    const idealStartDate = new Date(now);
    idealStartDate.setDate(idealStartDate.getDate() - timeframeDuration);

    // Snap to the first of the month, with at least 1 month buffer before active period
    const startDate =
      firstActive < idealStartDate ? firstActive : idealStartDate;
    const timeframeStartDate = new Date(
      startDate.getFullYear(),
      startDate.getMonth() - 1,
      1
    );

    const dataPoints = [];
    const current = new Date(timeframeStartDate);

    while (current <= now) {
      // Compare by month to avoid off-by-days issues with 1st-of-month snapping
      const currentMonth = current.getFullYear() * 12 + current.getMonth();
      const firstMonth =
        firstActive.getFullYear() * 12 + firstActive.getMonth();
      const lastMonth = lastActive.getFullYear() * 12 + lastActive.getMonth();
      const isInActivePeriod =
        currentMonth >= firstMonth && currentMonth <= lastMonth;

      const dateLabel =
        currentTimeframe === '5Y' || currentTimeframe === '10Y'
          ? current.toLocaleDateString('en-US', {
              month: 'short',
              year: 'numeric',
            })
          : current.toLocaleDateString('en-US', {
              month: 'short',
              year: '2-digit',
            });

      dataPoints.push({
        date: dateLabel,
        fullDate: current.toISOString().split('T')[0],
        activity: isInActivePeriod ? 8 : null,
        timestamp: current.getTime(),
      });

      current.setMonth(current.getMonth() + stepMonths);
    }

    let minWidthPerPoint = 50;
    if (currentTimeframe === '12M') minWidthPerPoint = 70;
    else if (currentTimeframe === '3Y') minWidthPerPoint = 60;
    else if (currentTimeframe === '5Y') minWidthPerPoint = 50;
    else if (currentTimeframe === '10Y') minWidthPerPoint = 45;

    const calculatedWidth = Math.max(600, dataPoints.length * minWidthPerPoint);

    return {
      availableTimeframes,
      data: dataPoints,
      chartWidth: calculatedWidth,
    };
  }, [firstActive, lastActive, selectedTimeframe]);

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
      <div className='w-full overflow-x-auto'>
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
              />
              <YAxis hide domain={[0, 10]} />
              <Area
                type='monotone'
                dataKey='activity'
                stroke='#22c55e'
                strokeWidth={1}
                fill='url(#activityGradient)'
                dot={false}
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
