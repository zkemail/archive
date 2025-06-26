import React, { useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import { Button } from '@/components/ui/button';

const generateSampleData = (timeframe: string) => {
  const dataPoints = {
    '12M': 12,
    '3Y': 36,
    '5Y': 60,
    '10Y': 120,
  };

  const points = dataPoints[timeframe as keyof typeof dataPoints] || 12;
  const data = [];

  // Fill 80% of the x-axis with data points
  for (let i = 0; i < points; i++) {
    const date = new Date();
    date.setMonth(date.getMonth() - (points - i - 1));

    data.push({
      date: date.toLocaleDateString('en-US', {
        month: 'short',
        year: timeframe === '12M' ? undefined : '2-digit',
      }),
      activity: 20,
    });
  }

  // Add empty data points to fill the remaining 20% of x-axis
  const emptyPoints = Math.ceil(points * 0.25); // 25% more points to make data occupy 80%
  for (let i = 0; i < emptyPoints; i++) {
    const date = new Date();
    date.setMonth(date.getMonth() + i + 1);

    data.push({
      date: date.toLocaleDateString('en-US', {
        month: 'short',
        year: timeframe === '12M' ? undefined : '2-digit',
      }),
      activity: null, // null values won't be rendered
    });
  }

  return data;
};

const ActivityChart = () => {
  const [selectedTimeframe, setSelectedTimeframe] = useState('12M');
  const timeframes = ['12M', '3Y', '5Y', '10Y'];

  const data = generateSampleData(selectedTimeframe);

  return (
    <div className='bg-foreground w-full rounded-lg'>
      {/* Header with title and timeframe buttons */}
      <div className='mb-4 flex items-center justify-start gap-4 sm:gap-16'>
        <h2 className='text-primary text-base font-normal'>Activity</h2>

        <div className='flex flex-row gap-3'>
          {timeframes.map((timeframe) => (
            <Button
              key={timeframe}
              variant={selectedTimeframe === timeframe ? 'default' : 'outline'}
              size='sm'
              onClick={() => setSelectedTimeframe(timeframe)}
              className={'h-auto border px-3 py-1 text-xs'}
            >
              {timeframe}
            </Button>
          ))}
        </div>
      </div>

      <div className='h-28 w-full'>
        <ResponsiveContainer width='100%' height='100%'>
          <AreaChart
            data={data}
            margin={{
              top: 10,
              right: 0,
              left: 0,
              bottom: 20,
            }}
          >
            <defs>
              <linearGradient
                id='activityGradient1'
                x1='0'
                y1='0'
                x2='0'
                y2='1'
              >
                <stop offset='0%' stopColor='#22c55e' stopOpacity={0.3} />
                <stop offset='100%' stopColor='#22c55e' stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <defs>
              <linearGradient
                id='greenToTransparent'
                x1='0'
                y1='0'
                x2='0'
                y2='1'
              >
                <stop offset='0%' stopColor='#22c55e' stopOpacity='1' />
                <stop offset='100%' stopColor='#22c55e' stopOpacity='0' />
              </linearGradient>
              <pattern
                id='activityGradient'
                patternUnits='userSpaceOnUse'
                width='10'
                height='10'
              >
                <path
                  d='M0,0 l20,20 M-10,10 l20,20 M10,-10 l20,20'
                  stroke='#22c55e'
                  strokeWidth='1'
                />
              </pattern>
              <mask id='gradientMask'>
                <rect
                  width='100%'
                  height='100%'
                  fill='url(#greenToTransparent)'
                />
              </mask>
            </defs>
            <XAxis
              dataKey='date'
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: '#6b7280' }}
              dy={10}
            />
            <YAxis
              hide
              domain={[0, 25]} // Set domain so that value 20 appears at 80% height (20/25 = 0.8)
            />
            <Area
              type='monotone'
              dataKey='activity'
              stroke='#22c55e'
              strokeWidth={2}
              fill='url(#activityGradient)'
              mask='url(#gradientMask)'
              dot={false}
              connectNulls={false} // Don't connect null values
            />

            {/* Top horizontal line */}
            <line
              x1='0%'
              y1='19%'
              x2='79%'
              y2='19%'
              stroke='#22c55e'
              strokeWidth={2}
            />

            {/* Right vertical line */}
            <line
              x1='79%'
              y1='19%'
              x2='79%'
              y2='60%'
              stroke='#22c55e'
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ActivityChart;
