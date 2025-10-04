import { type HTMLAttributes } from 'react';

export function FormActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const base = 'flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3';
  const merged = className ? `${base} ${className}` : base;
  return <div className={merged} {...props} />;
}
