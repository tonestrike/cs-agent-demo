"use client";

import { Button } from "../../../components/ui";
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
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ink/10 bg-white/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <select
          id="customer-phone"
          className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-xs"
          value={phoneNumber}
          onChange={(event) => onSelectCustomer(event.target.value)}
        >
          {customers.map((option) => (
            <option key={option.id} value={option.phoneE164}>
              {option.displayName}
            </option>
          ))}
        </select>
      </div>

      {selectedCustomer && (
        <div className="hidden items-center gap-4 text-xs text-ink/60 sm:flex">
          <span>{selectedCustomer.phoneE164}</span>
          {selectedCustomer.zipCode && (
            <>
              <span className="text-ink/30">•</span>
              <span>ZIP: {selectedCustomer.zipCode}</span>
            </>
          )}
        </div>
      )}

      <div className="ml-auto">
        <Button
          type="button"
          onClick={onNewSession}
          className="!py-1.5 !px-3 text-xs"
        >
          New Session
        </Button>
      </div>
    </div>
  );
}
