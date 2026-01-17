"use client";

import type { Customer } from "../types";

type CustomerBarProps = {
  customers: Customer[];
  selectedCustomer: Customer | null;
  phoneNumber: string;
  onSelectCustomer: (phone: string) => void;
  onNewSession: () => void;
};

export function CustomerBar({
  customers,
  selectedCustomer,
  phoneNumber,
  onSelectCustomer,
  onNewSession,
}: CustomerBarProps) {
  return (
    <div className="space-y-3">
      <select
        id="customer-phone"
        className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm font-medium text-ink focus:border-ink-400 focus:outline-none focus:ring-0"
        value={phoneNumber}
        onChange={(event) => onSelectCustomer(event.target.value)}
      >
        {customers.map((option) => (
          <option key={option.id} value={option.phoneE164}>
            {option.displayName}
          </option>
        ))}
      </select>

      {selectedCustomer && (
        <div className="space-y-2 text-sm text-ink-600">
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 text-ink-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
              />
            </svg>
            <span>{selectedCustomer.phoneE164}</span>
          </div>
          {selectedCustomer.zipCode && (
            <div className="flex items-center gap-2">
              <svg
                className="h-4 w-4 text-ink-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <span>ZIP: {selectedCustomer.zipCode}</span>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onNewSession}
        className="w-full rounded-lg border border-ink-200 bg-sand-100 py-2 text-xs font-semibold text-ink-700 hover:bg-sand-200"
      >
        New Session
      </button>
    </div>
  );
}
