import { type HTMLAttributes } from 'react';

const BASE_ACTION_CLASSES =
  'flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4';

export default function FormActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const merged = className ? `${BASE_ACTION_CLASSES} ${className}` : BASE_ACTION_CLASSES;
  return <div className={merged} {...props} />;
}
