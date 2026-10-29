/**
 * Column widths shared by the shipments, lots, invoices and kegs lists, so a number, a date or a status sits
 * in the same place on every ledger. Figures (quantities, money) are right-aligned at the call site.
 */
export const LIST_WIDTHS = {
  number: "13rem",
  code: "9rem",
  type: "6.5rem",
  date: "7rem",
  status: "7.5rem",
  qty: "5.5rem",
  money: "7rem",
} as const;
