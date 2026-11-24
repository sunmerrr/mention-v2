import { type RefObject, useEffect, useRef, useState } from 'react';

export const chartNumber = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 1,
});
export const chartPercent = (share: number) => `${chartNumber.format(100 * share)}%`;

export function useChartSelection(defaultId?: string) {
  const [selectedId, setSelectedId] = useState<string>();
  const [preview, setPreview] = useState<string>();
  const selected = selectedId ?? defaultId;
  return {
    active: preview ?? selected,
    selected,
    setPreview(id?: string) {
      setPreview(id);
    },
    select(id: string | undefined) {
      setSelectedId(id);
      setPreview(undefined);
    },
  };
}

export type ChartSelection = ReturnType<typeof useChartSelection>;

export function useChartMotion(ref: RefObject<HTMLElement>) {
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(preference.matches);
    update();
    preference.addEventListener('change', update);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { threshold: 0.2 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      preference.removeEventListener('change', update);
    };
  }, [ref]);
  return visible && !reduced;
}

export function useChartSize(initialWidth: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initialWidth);
  const [ready, setReady] = useState(false);
  const animate = useChartMotion(ref);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const measured = Math.floor(element.getBoundingClientRect().width);
      if (measured > 0) setWidth(measured);
    };
    measure();
    setReady(true);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return {
    ref,
    width,
    ready,
    motionKey: animate ? 'animated' : 'static',
    motion: {
      isAnimationActive: animate,
      animationBegin: 0,
      animationDuration: 550,
      animationEasing: 'ease-out' as const,
    },
  };
}
