import type { ReactNode } from 'react';

interface ServicesPlaceholderProps {
  title: string;
  description: ReactNode;
}

export default function ServicesPlaceholder({ title, description }: ServicesPlaceholderProps) {
  return (
    <section className="flex flex-col gap-6">
      <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 text-left shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">{description}</div>
      </div>
    </section>
  );
}
