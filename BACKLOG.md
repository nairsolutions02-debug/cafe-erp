# Backlog: to pick up after all phases are done

Owner's notes on things to fix later. Newest first.

## Customer doesn't see a cancelled order (reported 2026-10-04)
- **What happens:** staff cancel an order (Orders → Cancel). The customer's order screen still shows "Order placed".
- **First look:** the order screen gets the update live, but the status tracker (`components/OrderStatus.jsx`) has no
  "cancelled" step, so it falls back to the first step. Nothing else on the page says the order was cancelled.
- **Fix idea:** a clear "Order cancelled" state with the reason staff typed, the refund note if money was paid,
  points given back, and a "Order again" button; also a reminder toast when it happens while the customer is on another page.
