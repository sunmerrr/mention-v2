import { create } from 'zustand';

/** 샘플 zustand store(전역 UI 상태). 서버 데이터는 여기 두지 않는다. → frontend/query-state-patterns.md */
export interface Toast {
  id: string;
  text: string;
  variant: 'success' | 'error' | 'info';
}

interface ToastState {
  toasts: Toast[];
  show: (text: string, variant?: Toast['variant']) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (text, variant = 'info') => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, text, variant }] }));
    setTimeout(() => get().dismiss(id), 3000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
