import React, { useMemo, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import { Button } from '@/components/ui/button';

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

    const timeframeDuration =
      timeframeDays[currentTimeframe as keyof typeof timeframeDays];
    const idealStartDate = new Date(now);
    idealStartDate.setDate(idealStartDate.getDate() - timeframeDuration);

    const timeframeStartDate =
      firstActive < idealStartDate ? firstActive : idealStartDate;
    const timeframeEndDate = new Date(now);

    const dataPoints = [];

    let stepDays = 30;
    if (currentTimeframe === '12M') stepDays = 20;
    else if (currentTimeframe === '3Y') stepDays = 160;
    else if (currentTimeframe === '5Y') stepDays = 365;
    else if (currentTimeframe === '10Y') stepDays = 365 * 2;

    const actualDuration = Math.ceil(
      (timeframeEndDate.getTime() - timeframeStartDate.getTime()) /
        (1000 * 60 * 60 * 24)
    );
    const totalSteps = Math.ceil(actualDuration / stepDays);

    for (let i = 0; i <= totalSteps; i++) {
      const pointDate = new Date(timeframeStartDate);
      pointDate.setDate(pointDate.getDate() + i * stepDays);

      if (pointDate > timeframeEndDate) {
        pointDate.setTime(timeframeEndDate.getTime());
      }

      const isInActivePeriod =
        pointDate >= firstActive && pointDate <= lastActive;

      let dateLabel = '';
      if (currentTimeframe === '12M') {
        dateLabel = pointDate.toLocaleDateString('en-US', {
          month: 'short',
          year: '2-digit',
        });
      } else if (currentTimeframe === '3Y') {
        dateLabel = pointDate.toLocaleDateString('en-US', {
          month: 'short',
          year: '2-digit',
        });
      } else {
        dateLabel = pointDate.toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
        });
      }

      dataPoints.push({
        date: dateLabel,
        fullDate: pointDate.toISOString().split('T')[0],
        activity: isInActivePeriod ? 8 : null,
        timestamp: pointDate.getTime(),
      });

      if (pointDate.getTime() >= timeframeEndDate.getTime()) {
        break;
      }
    }

    const uniqueDataPoints = dataPoints
      .filter(
        (point, index, arr) =>
          index === arr.findIndex((p) => p.fullDate === point.fullDate)
      )
      .sort((a, b) => a.timestamp - b.timestamp);

    let minWidthPerPoint = 50;
    if (currentTimeframe === '12M') minWidthPerPoint = 80;
    else if (currentTimeframe === '3Y') minWidthPerPoint = 60;
    else if (currentTimeframe === '5Y') minWidthPerPoint = 50;
    else if (currentTimeframe === '10Y') minWidthPerPoint = 40;

    const calculatedWidth = Math.max(
      600,
      uniqueDataPoints.length * minWidthPerPoint
    );

    return {
      availableTimeframes,
      data: uniqueDataPoints,
      chartWidth: calculatedWidth,
    };
  }, [firstActive, lastActive, selectedTimeframe]);
  return (
    <div className='w-full rounded-lg bg-foreground'>
      <div className='mb-4 flex items-center justify-start gap-4 sm:gap-16'>
        <h2 className='text-base font-normal text-primary'>Activity</h2>

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
