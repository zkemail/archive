'use client';

import { motion, MotionValue, useSpring, useTransform } from 'motion/react';
import { useEffect } from 'react';

interface AnimatedNumberProps {
  value: number;
  mass?: number;
  stiffness?: number;
  damping?: number;
  precision?: number;
  format?: (value: number) => string;
  onAnimationStart?: () => void;
  onAnimationComplete?: () => void;
}

export function AnimatedNumber({
  value,
  mass = 0.8,
  stiffness = 75,
  damping = 15,
  precision = 0,
  format = (num) => num.toLocaleString(),
  onAnimationStart,
  onAnimationComplete,
}: AnimatedNumberProps) {
  const spring = useSpring(value, { mass, stiffness, damping });
  const display: MotionValue<string> = useTransform(spring, (current) =>
    format(parseFloat(current.toFixed(precision)))
  );

  useEffect(() => {
    spring.set(value);
    if (onAnimationStart) onAnimationStart();
    let hasCompleted = false;
    const unsubscribe = spring.on('change', () => {
      if (!hasCompleted && Math.abs(spring.get() - value) < 1e-3) {
        hasCompleted = true;
        if (onAnimationComplete) onAnimationComplete();
      }
    });
    return () => unsubscribe();
  }, [spring, value, onAnimationStart, onAnimationComplete]);

  return <motion.span>{display}</motion.span>;
}
