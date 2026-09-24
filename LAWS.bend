# LAWS.bend
# Paper desk constitution. The wall renders this file.
# Position caps are read by the book. The rest are hard gates.

law NeverPlaceRealOrders {
  scope: exchange
  allow: public_market_data
  forbid: place_order
  forbid: cancel_order
  forbid: withdraw
  forbid: api_key
  because: "Binance is a read-only print. This desk never sends an order."
}

law EscalateIsStubbed {
  scope: judgment
  when: action is escalate
  forbid: model_call
  forbid: human_page
  forbid: webhook
  emit: stub "Escalate (stub)"
  because: "Ambiguity is shown on the wall. It is never outsourced."
}

law PositionCaps {
  scope: paper
  starting_cash_usd: 10000
  max_trade_notional_usd: 200
  max_symbol_notional_usd: 1500
  max_gross_notional_usd: 3000
  because: "Paper risk stays inside a fixed envelope."
}

law JevGatesRisk {
  scope: paper
  when: jev is off
  allow: mark_to_market
  allow: market_stream
  forbid: open_risk
  forbid: new_fill
  because: "The tape may stay live. New paper risk may not."
}
