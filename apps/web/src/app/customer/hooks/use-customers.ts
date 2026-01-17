"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { orpc } from "../../../lib/orpc";
import type { Customer } from "../types";

export function useCustomers() {
  const [phoneNumber, setPhoneNumber] = useState("");

  const customersQuery = useQuery(
    orpc.customers.list.queryOptions({
      input: { limit: 50 },
    }),
  );

  const customers = (customersQuery.data?.items ?? []) as Customer[];

  useEffect(() => {
    if (customers.length === 0) {
      return;
    }
    setPhoneNumber((current) => current || customers[0]?.phoneE164 || "");
  }, [customers]);

  const selectedCustomer = useMemo(() => {
    return customers.find((c) => c.phoneE164 === phoneNumber) ?? null;
  }, [customers, phoneNumber]);

  const selectCustomer = (phone: string) => {
    setPhoneNumber(phone);
  };

  return {
    customers,
    selectedCustomer,
    phoneNumber,
    selectCustomer,
    isLoading: customersQuery.isLoading,
  };
}
