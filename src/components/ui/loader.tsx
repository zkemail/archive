import { useEffect, useRef, useCallback } from 'react';

export default function Loader() {
  const animationContainer = useRef(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const animationInstance = useRef<any>(null);
  const isInitialized = useRef(false);

  const getLottie = useCallback(async () => {
    const lottie = await import('lottie-web');

    if (!animationContainer.current || isInitialized.current) {
      return;
    }

    animationInstance.current = lottie.default.loadAnimation({
      container: animationContainer.current,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      path: '/assets/loader.json',
    });

    isInitialized.current = true;
  }, []);

  useEffect(() => {
    getLottie();

    return () => {
      if (animationInstance.current) {
        animationInstance.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={animationContainer} className="h-16 w-16"></div>;
}
