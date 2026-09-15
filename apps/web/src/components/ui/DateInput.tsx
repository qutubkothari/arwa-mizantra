'use client';

import { ChangeEvent, InputHTMLAttributes, useState } from 'react';

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
};

export default function DateInput({ value, onChange, ...props }: DateInputProps) {
  const [rangeError, setRangeError] = useState('');

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    if (typeof props.min === 'string' && props.min && nextValue < props.min) {
      setRangeError(`Date cannot be before ${props.min}`);
      return;
    }
    if (typeof props.max === 'string' && props.max && nextValue > props.max) {
      setRangeError(`Date cannot be after ${props.max}`);
      return;
    }
    setRangeError('');
    onChange(nextValue);
  };

  return (
    <input
      {...props}
      type="date"
      value={value}
      onChange={handleChange}
      aria-invalid={rangeError ? true : props['aria-invalid']}
      title={rangeError || 'Select a date'}
    />
  );
}
