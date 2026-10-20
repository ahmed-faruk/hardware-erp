-- Security fix (audit 2026-10-20, H1 / HE-01): the ingest bundles are internal helpers of ingest_row (security definer) and devices never
-- call them. They kept PostgreSQL's default EXECUTE for PUBLIC, so anon could call them over /rest/v1/rpc. Devices call ingest_batch only.
revoke execute on function
  ingest_cash_adjustment_bundle(jsonb, uuid, uuid, workers),
  ingest_cash_transfer_bundle(jsonb, uuid, uuid, workers),
  ingest_customer_receipt_bundle(jsonb, uuid, uuid),
  ingest_expense_bundle(jsonb, uuid, uuid, workers),
  ingest_purchase_bundle(jsonb, uuid, uuid),
  ingest_purchase_return_bundle(jsonb, uuid, uuid, workers),
  ingest_sales_return_bundle(jsonb, uuid, uuid, workers),
  ingest_shift_bundle(jsonb, uuid, uuid),
  ingest_stock_adjustment_bundle(jsonb, uuid, uuid, workers),
  ingest_supplier_payment_bundle(jsonb, uuid, uuid),
  ingest_void_bundle(jsonb, uuid, uuid, workers)
from public, anon, authenticated;
