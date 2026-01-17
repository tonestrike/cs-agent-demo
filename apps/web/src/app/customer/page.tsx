"use client";

import { useCallback } from "react";
import { RealtimeChatView } from "./components";
import { useCustomers } from "./hooks";

export default function CustomerPage() {
  const { customers, selectedCustomer, phoneNumber, selectCustomer } =
    useCustomers();

  const handleCustomerChange = useCallback(
    (phone: string) => {
      selectCustomer(phone);
    },
    [selectCustomer],
  );

  return (
    <div className="fixed inset-0 top-[57px] flex flex-col overflow-hidden bg-sand-200">
      <RealtimeChatView
        customers={customers}
        selectedCustomer={selectedCustomer}
        phoneNumber={phoneNumber}
        onSelectCustomer={handleCustomerChange}
      />
    </div>
  );
}
