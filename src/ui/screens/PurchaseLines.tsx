import { Minus, Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';

import type { Product, ProductUnit } from '@/db/types';
import type { LineHints } from '@/db/purchase-hints';
import { formatMoney, formatQty, toMilli, toPiasters } from '@/domain/money';
import { priceChangePercent, priceChangeWarns } from '@/domain/purchase';

import { strings } from '../strings.ar';

import styles from './purchase.module.css';

export interface PurchaseRow {
  key: string;
  product: Product;
  unit: ProductUnit | null;
  qty: number | null;
  cost: number | null;
  price: number | null;
  /** the last price for THIS unit (a pack's price when the line is in packs), null when never bought */
  lastCost: number | null;
  hints: LineHints | null;
  isNew: boolean;
}

const t = strings.purchases;

/** A number typed as text, committed only when it parses; Enter moves on. */
function NumInput({
  value,
  parse,
  format,
  label,
  testId,
  onCommit,
  onEnter,
  inputRef,
}: {
  value: number | null;
  parse: (s: string) => { ok: true; value: number } | { ok: false };
  format: (n: number) => string;
  label: string;
  testId: string;
  onCommit: (n: number | null) => void;
  onEnter?: () => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : format(value));
  const [bad, setBad] = useState(false);
  return (
    <input
      ref={inputRef}
      className="control"
      dir="ltr"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={bad}
      value={text}
      data-testid={testId}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value.trim() === '') {
          setBad(false);
          return onCommit(null);
        }
        const r = parse(e.target.value);
        setBad(!r.ok);
        if (r.ok) onCommit(r.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onEnter?.();
        }
      }}
    />
  );
}

/** The lines of the invoice: quantity with + and −, the unit, the cost (last price filled in, a warning on a big change), the total. */
export function PurchaseLines({
  rows,
  lineTotals,
  canPrice,
  onPatch,
  onRemove,
  onDone,
}: {
  rows: PurchaseRow[];
  lineTotals: number[];
  canPrice: boolean;
  onPatch: (key: string, patch: Partial<PurchaseRow>) => void;
  onRemove: (key: string) => void;
  /** Enter on the last field of a line: back to the scan bar */
  onDone: () => void;
}) {
  const refs = useRef(new Map<string, HTMLInputElement | null>());
  return (
    <div className={styles.lines} role="table" aria-label={t.linesTitle}>
      <div className={`${styles.line} ${styles.head}`} role="row">
        <span>{t.item}</span>
        <span>{t.qty}</span>
        <span>{t.unit}</span>
        <span>{t.unitCost}</span>
        <span>{t.lineTotal}</span>
        <span />
      </div>
      {rows.map((r, i) => {
        const warn = r.cost !== null && priceChangeWarns(r.lastCost, r.cost);
        const pct = r.cost !== null ? priceChangePercent(r.lastCost, r.cost) : null;
        return (
          <div
            key={r.key}
            className={`${styles.line} ${warn ? styles.warnRow : ''} ${r.isNew ? styles.newRow : ''}`}
            role="row"
            data-testid="purchase-line"
          >
            <div className={styles.name}>
              <span>
                {r.product.name}
                {r.unit ? ` (${r.unit.name})` : ''}
              </span>
              {r.isNew && (
                <span className={`${styles.chip} ${styles.chipMuted}`} data-testid={`pl-new-${i}`}>
                  {t.newProductChip}
                  {r.product.price === 0 ? ` · ${t.noSalePrice}` : ''}
                </span>
              )}
            </div>
            <div className={styles.stepper}>
              <button
                type="button"
                aria-label={t.less}
                onClick={() => onPatch(r.key, { qty: Math.max(1000, (r.qty ?? 1000) - 1000) })}
                data-testid={`pl-minus-${i}`}
              >
                <Minus size={18} aria-hidden="true" />
              </button>
              <NumInput
                key={`q-${r.key}-${r.qty}`}
                value={r.qty}
                parse={toMilli}
                format={formatQty}
                label={t.qty}
                testId={`pl-qty-${i}`}
                onCommit={(n) => onPatch(r.key, { qty: n })}
                onEnter={() => refs.current.get(`c-${r.key}`)?.focus()}
              />
              <button
                type="button"
                aria-label={t.more}
                onClick={() => onPatch(r.key, { qty: (r.qty ?? 0) + 1000 })}
                data-testid={`pl-plus-${i}`}
              >
                <Plus size={18} aria-hidden="true" />
              </button>
            </div>
            <span>{r.unit ? r.unit.name : r.product.baseUnitName}</span>
            <div className={styles.price}>
              <NumInput
                value={r.cost}
                parse={toPiasters}
                format={formatMoney}
                label={t.unitCost}
                testId={`pl-cost-${i}`}
                onCommit={(n) => onPatch(r.key, { cost: n })}
                onEnter={onDone}
                inputRef={(el) => refs.current.set(`c-${r.key}`, el)}
              />
              {warn && pct !== null ? (
                <span className={`${styles.chip} ${styles.chipWarn}`} data-testid={`pl-warn-${i}`}>
                  {pct > 0 ? t.priceUp : t.priceDown}
                  {` ${Math.abs(pct)}%`}
                </span>
              ) : (
                <small data-testid={`pl-hint-${i}`}>
                  {r.hints
                    ? `${t.lastBought}: ${r.lastCost === null ? '—' : formatMoney(r.lastCost)} · ${t.currentCost}: ${formatMoney(r.hints.currentCost)} · ${t.inStock}: ${formatQty(r.hints.stockMilli)}`
                    : ''}
                </small>
              )}
              {canPrice && (
                <NumInput
                  value={r.price}
                  parse={toPiasters}
                  format={formatMoney}
                  label={t.salePrice}
                  testId={`pl-price-${i}`}
                  onCommit={(n) => onPatch(r.key, { price: n })}
                />
              )}
            </div>
            <div className={styles.num} data-testid={`pl-total-${i}`}>
              {formatMoney(lineTotals[i] ?? 0)}
            </div>
            <button
              type="button"
              className="control"
              style={{ inlineSize: 44, blockSize: 44, padding: 0 }}
              aria-label={t.removeLine}
              onClick={() => onRemove(r.key)}
              data-testid={`pl-remove-${i}`}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
