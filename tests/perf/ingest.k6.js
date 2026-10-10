/* global __ENV, __ITER */
// Ingest burst (docs: skill testing-playbook §6): the three seeded devices push 500 sales invoices each, ten per ingest_batch call.
// Budget: nothing rejected, p95 of the RPC <= 1 s. Run: k6 run tests/perf/ingest.k6.js (needs `supabase start`; reads the local URL and anon key).
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const URL = __ENV.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON = __ENV.SUPABASE_ANON_KEY;
const PASSWORD = 'local-test-password';
const A = (suffix) => `a0000000-0000-7000-8000-${suffix}`;
const DEVICES = [
  { prefix: 'K1', email: 'k1@devices.test.local', id: A('0000000000f1'), worker: A('0000000000d3') },
  { prefix: 'K2', email: 'k2@devices.test.local', id: A('0000000000f2'), worker: A('0000000000d3') },
  { prefix: 'M1', email: 'm1@devices.test.local', id: A('0000000000f3'), worker: A('0000000000d1') },
];
const PER_BATCH = 10;
const BATCHES = 50;

const rejected = new Counter('rejected_rows');

export const options = {
  scenarios: Object.fromEntries(
    DEVICES.map((d, i) => [
      d.prefix,
      {
        executor: 'per-vu-iterations',
        vus: 1,
        iterations: BATCHES,
        exec: 'push',
        env: { DEVICE: String(i) },
      },
    ]),
  ),
  thresholds: {
    rejected_rows: ['count==0'],
    'http_req_duration{name:ingest}': ['p(95)<1000'],
    http_req_failed: ['rate==0'],
  },
};

export function setup() {
  if (!ANON) throw new Error('set SUPABASE_ANON_KEY (supabase status -o env)');
  return DEVICES.map((d) => {
    const res = http.post(
      `${URL}/auth/v1/token?grant_type=password`,
      JSON.stringify({ email: d.email, password: PASSWORD }),
      {
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
      },
    );
    check(res, { 'device signed in': (r) => r.status === 200 });
    return res.json('access_token');
  });
}

const invoice = (d, seq) => {
  const id = uuidv4();
  const line = uuidv4();
  const product = A(`00000000${String(1 + (seq % 20)).padStart(4, '0')}`);
  const now = new Date().toISOString();
  return {
    seq,
    table: 'sales_invoices',
    op: 'upsert',
    worker_id: d.worker,
    record: {
      id,
      number: `${d.prefix}-INV-${String(seq).padStart(6, '0')}`,
      issued_at: now,
      worker_id: d.worker,
      created_by: d.worker,
      warehouse_id: A('0000000000c1'),
      subtotal: 3000,
      total: 3000,
      lines: [
        {
          id: line,
          invoice_id: id,
          created_by: d.worker,
          line_no: 1,
          product_id: product,
          unit_factor: 1000,
          qty: 2000,
          unit_price: 1500,
          net_amount: 3000,
          unit_cost: 0,
        },
      ],
      payments: [
        {
          id: uuidv4(),
          created_by: d.worker,
          document_type: 'sales_invoice',
          document_id: id,
          method: 'card',
          amount: 3000,
          reference: '1234',
        },
      ],
      stock_movements: [
        {
          id: uuidv4(),
          created_by: d.worker,
          product_id: product,
          warehouse_id: A('0000000000c1'),
          qty: -2000,
          unit_cost: 0,
          doc_type: 'sales_invoice',
          doc_id: id,
          line_id: line,
          occurred_at: now,
        },
      ],
      party_ledger: [],
      cash_movements: [],
    },
  };
};

export function push(tokens) {
  const i = Number(__ENV.DEVICE);
  const d = DEVICES[i];
  const base =
    __ITER * PER_BATCH + 1 + Number(__ENV.RUN_OFFSET || Math.floor(Date.now() / 1000) % 100000) * 1000;
  const rows = Array.from({ length: PER_BATCH }, (_, n) => invoice(d, base + n));
  const res = http.post(
    `${URL}/rest/v1/rpc/ingest_batch`,
    JSON.stringify({ p_device_id: d.id, p_app_version: 'k6', p_rows: rows }),
    {
      headers: { apikey: ANON, Authorization: `Bearer ${tokens[i]}`, 'Content-Type': 'application/json' },
      tags: { name: 'ingest' },
    },
  );
  const ok = check(res, { 'batch accepted': (r) => r.status === 200 });
  if (ok) rejected.add((res.json('data.rejected') || []).length);
}
