import { useLiveQuery } from 'dexie-react-hooks';
import { Banknote, Clock, HandCoins, Printer, Receipt as ReceiptIcon, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { holdCart, listHeldCarts, loadCurrentCart, resumeCart, saveCurrentCart } from '@/db/commands/carts';
import type { SaleReceipt } from '@/db/commands/post-sale';
import { noSale, reprintInvoice, type NoSaleReason } from '@/db/commands/receipts';
import { voidInvoice, type VOID_REASONS } from '@/db/commands/returns';
import { findByBarcode } from '@/db/lookup';
import { searchProducts } from '@/db/search';
import { loadDeviceSettings, loadSettings, type DeviceSettings } from '@/db/settings';
import type { Product, ProductUnit } from '@/db/types';
import {
  addItem,
  cartInvoice,
  EMPTY_CART,
  productToItem,
  removeLine,
  setCustomer,
  setInvoiceDiscount,
  setLineDiscount,
  setLinePrice,
  setQty,
  type Cart,
} from '@/domain/cart';
import { localizeDigits } from '@/domain/digits';
import { formatMoney, toMilli, toPiasters } from '@/domain/money';
import { discountNeedsApproval, priceNeedsApproval, DEFAULT_SETTINGS } from '@/domain/settings';
import { speakChange, speakTotal } from '@/domain/speak';
import type { Discount } from '@/domain/totals';
import { cairoTime } from '@/domain/receipt';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { Dialog } from '../components/Dialog';
import { Skeleton } from '../components/Skeleton';
import { play, setSoundEnabled } from '../sound';
import { strings } from '../strings.ar';

import { recordAudit } from '@/db/commands/audit';
import { useApproval } from './ApprovalDialog';
import { CartPanel } from './CartPanel';
import { ChangeDisplay } from './ChangeDisplay';
import { DiscountDialog } from './DiscountDialog';
import { NumEntry } from './NumEntry';
import { PayScreen } from './PayScreen';
import { HeldCartsDialog, NoSaleDialog, RecentInvoicesDialog, VoidReasonDialog } from './SellDialogs';
import { CollectionDialog } from './CollectionDialog';
import { ReturnDialog } from './ReturnDialog';
import {
  CloseShiftDialog,
  ExpenseDialog,
  ShiftMenuDialog,
  TransferDialog,
  type ShiftTool,
} from './ShiftTools';
import { ProductGrid } from './ProductGrid';
import { ShiftOpen } from './ShiftOpen';
import { TotalBar } from './TotalBar';
import { UndoToast } from './UndoToast';
import { setSpeechEnabled, speak } from './speech';
import { useBarcodeScanner } from './useBarcodeScanner';
import { useShortcuts } from './useShortcuts';

import styles from './SellScreen.module.css';

const DEVICE_DEFAULTS: DeviceSettings = {
  idleLockMinutes: 10,
  paper: '80',
  copies: 1,
  autoPrint: true,
  sounds: true,
  digits: 'latn',
};

type Step = 'items' | 'pay' | 'done';
type DiscountTarget = { key: string } | 'invoice' | null;

interface Done {
  sale: SaleReceipt;
  printFailed: boolean;
}

export function SellScreen() {
  const { db, identity } = useServices();
  const { context, worker } = useSession();
  const role = worker?.role ?? 'cashier';
  const settings = useLiveQuery(() => loadSettings(db), [db]) ?? DEFAULT_SETTINGS;
  const device = useLiveQuery(() => loadDeviceSettings(db), [db]) ?? DEVICE_DEFAULTS;
  const drawer = useLiveQuery(
    async () =>
      (await db.cashAccounts
        .filter((a) => a.kind === 'drawer' && a.ownerDeviceId === identity.deviceId && !a.deletedAt)
        .first()) ?? null,
    [db, identity.deviceId],
  );
  const warehouse = useLiveQuery(
    async () => (await db.warehouses.filter((w) => w.kind === 'main' && !w.deletedAt).first()) ?? null,
    [db],
  );
  const shift = useLiveQuery(
    async () =>
      drawer
        ? ((await db.shifts
            .where('status')
            .equals('open')
            .filter((s) => s.cashAccountId === drawer.id)
            .first()) ?? null)
        : null,
    [db, drawer],
  );
  const heldCount = useLiveQuery(async () => (await listHeldCarts(db)).length, [db]) ?? 0;

  const [cart, setCart] = useState<Cart>(EMPTY_CART);
  const loaded = useRef(false);
  const [step, setStep] = useState<Step>('items');
  const [searchText, setSearchText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [tokens, setTokens] = useState<string[]>([]);
  const [undo, setUndo] = useState<{
    prev: Cart;
    line: { productId: string; name: string; qtyMilli: number; unitPrice: number } | null;
  } | null>(null);
  const [qtyKey, setQtyKey] = useState<string | null>(null);
  const [priceKey, setPriceKey] = useState<string | null>(null);
  const [discountTarget, setDiscountTarget] = useState<DiscountTarget>(null);
  const [heldOpen, setHeldOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [noSaleOpen, setNoSaleOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [scannedReceipt, setScannedReceipt] = useState<string | null>(null);
  const [collectOpen, setCollectOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<string | null>(null);
  const [shiftMenu, setShiftMenu] = useState(false);
  const [shiftTool, setShiftTool] = useState<Exclude<ShiftTool, 'x'> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { ask, dialog: approvalDialog } = useApproval();

  const digits = useCallback((text: string) => localizeDigits(text, device.digits), [device.digits]);
  const inv = cartInvoice(cart);
  const invoice = inv.ok ? inv.value : { lines: [], invoiceDiscount: 0, taxAmount: 0 as const, total: 0 };
  const total = invoice.total;

  useEffect(() => {
    setSoundEnabled(device.sounds);
    setSpeechEnabled(device.sounds);
  }, [device.sounds]);

  // POS-06: the open cart survives a reload or a power cut
  useEffect(() => {
    void loadCurrentCart(db).then((saved) => {
      if (saved) setCart(saved);
      loaded.current = true;
    });
  }, [db]);
  useEffect(() => {
    if (loaded.current) void saveCurrentCart(db, cart);
  }, [db, cart]);

  const flash = (word: string): void => {
    setNotice(word);
    setTimeout(() => setNotice(null), 3000);
  };

  const add = useCallback((product: Product, unit: ProductUnit | null): void => {
    setCart((c) =>
      addItem(
        c,
        productToItem(product, unit ? { id: unit.id, factor: unit.factor, price: unit.price } : null),
      ),
    );
    play('ok');
  }, []);

  const scan = useCallback(
    (code: string): void => {
      if (returnOpen) return setScannedReceipt(code);
      if (step !== 'items' || !shift) return;
      void findByBarcode(db, code).then((found) => {
        if (found) add(found.product, found.unit);
        else {
          play('error');
          flash(strings.sell.scanUnknown);
        }
      });
    },
    [db, add, step, shift, returnOpen],
  );
  useBarcodeScanner(scan);

  const hold = useCallback(async (): Promise<void> => {
    if (!context || cart.lines.length === 0) return;
    await holdCart(context, cart, total);
    setCart(EMPTY_CART);
    setTokens([]);
    play('ok');
  }, [context, cart, total]);

  useShortcuts({
    search: () => searchRef.current?.focus(),
    customer: () => setPickerOpen(true),
    hold: () => void hold(),
    held: () => setHeldOpen(true),
    pay: () => cart.lines.length > 0 && step === 'items' && setStep('pay'),
    escape: () => setStep((s) => (s === 'pay' ? 'items' : s)),
  });

  const sayAmounts = (sale: { total: number; changeDue: number }): void =>
    void speak([...speakTotal(sale.total), ...(sale.changeDue > 0 ? speakChange(sale.changeDue) : [])]);

  const printHtmlFor = async (
    make: (render: typeof import('../print/render')) => string,
  ): Promise<boolean> => {
    try {
      const [render, { printHtml, cairoFontFaces }] = await Promise.all([
        import('../print/render'),
        import('../print/printHtml'),
      ]);
      void cairoFontFaces;
      const html = make(render);
      for (let i = 0; i < Math.max(1, device.copies); i++) await printHtml(html);
      return true;
    } catch {
      return false;
    }
  };

  const printInvoice = async (id: string, copy: boolean): Promise<boolean> => {
    if (!context) return false;
    const { loadReceipt } = await import('@/db/commands/receipts');
    const receipt = copy ? await reprintInvoice(context, id) : await loadReceipt(db, id, false);
    if (!receipt.ok) return false;
    const { cairoFontFaces } = await import('../print/printHtml');
    return printHtmlFor((r) => r.renderReceiptHtml(receipt.value, device.paper, cairoFontFaces()));
  };

  const printDoc = async (
    make: (render: typeof import('../print/render'), faces: string) => string,
  ): Promise<void> => {
    const { cairoFontFaces } = await import('../print/printHtml');
    if (!(await printHtmlFor((render) => make(render, cairoFontFaces())))) flash(strings.sell.printFailed);
  };

  const onReturnDone = (posted: { id: string }): void => {
    setReturnOpen(false);
    setScannedReceipt(null);
    flash(strings.returns.done);
    if (!device.autoPrint) return;
    void (async () => {
      const { loadReturnReceipt } = await import('@/db/commands/receipts');
      const receipt = await loadReturnReceipt(db, posted.id, false);
      if (receipt.ok) await printDoc((r, faces) => r.renderReceiptHtml(receipt.value, device.paper, faces));
    })();
  };

  const onCollectDone = (id: string): void => {
    setCollectOpen(false);
    flash(strings.collection.done);
    if (!device.autoPrint) return;
    void (async () => {
      const { loadCollectionSlip } = await import('@/db/commands/receipts');
      const slip = await loadCollectionSlip(db, id);
      if (slip.ok)
        await printDoc((r, faces) => r.renderCollectionHtml(slip.value, device.digits, device.paper, faces));
    })();
  };

  const doVoid = async (reason: (typeof VOID_REASONS)[number]): Promise<void> => {
    const id = voidTarget;
    setVoidTarget(null);
    if (!context || !id || !shift) return;
    const r = await voidInvoice(context, { invoiceId: id, reason, shiftId: shift.id });
    if (!r.ok) {
      play('error');
      return flash(
        r.code === 'HAS_RETURNS'
          ? strings.voidInvoice.hasReturns
          : r.code === 'ALREADY_VOIDED'
            ? strings.voidInvoice.already
            : strings.errors.saveFailed,
      );
    }
    play('done');
    flash(strings.voidInvoice.done);
    const { loadReceipt } = await import('@/db/commands/receipts');
    const receipt = await loadReceipt(db, id, false, 'void');
    if (receipt.ok)
      await printDoc((render, faces) => render.renderReceiptHtml(receipt.value, device.paper, faces));
  };

  const printShiftReport = (shiftId: string): void => {
    void (async () => {
      const { loadShiftReport } = await import('@/db/shift-report');
      const data = await loadShiftReport(db, shiftId);
      if (data) await printDoc((r, faces) => r.renderShiftHtml(data, device.digits, device.paper, faces));
    })();
  };

  const printMoneySlip = (kind: 'expense' | 'transfer', id: string): void => {
    void (async () => {
      const shop = (await db.companies.toCollection().first())?.name ?? '';
      const doc = kind === 'expense' ? await db.expenses.get(id) : await db.cashTransfers.get(id);
      if (!doc) return;
      const worker = doc.workerId ? await db.workers.get(doc.workerId) : undefined;
      const category =
        kind === 'expense' ? await db.expenseCategories.get(doc.categoryId as string) : undefined;
      await printDoc((r, faces) =>
        r.renderMoneySlipHtml(
          {
            shopName: shop,
            title: kind === 'expense' ? strings.cash.expense : strings.cash.transfer,
            number: doc.number,
            at: doc.issuedAt,
            lines: [{ label: category?.name ?? strings.cash.transfer, amount: doc.amount as number }],
            worker: worker?.name ?? '',
            digits: device.digits,
          },
          device.paper,
          faces,
        ),
      );
    })();
  };

  const pickShiftTool = (tool: ShiftTool): void => {
    setShiftMenu(false);
    if (tool === 'x' && shift) printShiftReport(shift.id);
    else if (tool !== 'x') setShiftTool(tool);
  };

  const onPaid = (sale: SaleReceipt): void => {
    setCart(EMPTY_CART);
    setTokens([]);
    setStep('done');
    play('done');
    sayAmounts(sale);
    setDone({ sale, printFailed: false });
    if (device.autoPrint) void printInvoice(sale.id, false).then((ok) => setDone({ sale, printFailed: !ok }));
  };

  const newCart = (): void => {
    setDone(null);
    setStep('items');
  };

  const guardApproval = async (
    needs: boolean,
    action: 'discountOverLimit' | 'priceOverride',
  ): Promise<boolean> => {
    if (!needs) return true;
    const token = await ask(action);
    if (!token) return false;
    setTokens((t) => [...t, token]);
    return true;
  };

  const applyDiscount = async (target: Exclude<DiscountTarget, null>, discount: Discount): Promise<void> => {
    setDiscountTarget(null);
    const lineIndex = target === 'invoice' ? -1 : cart.lines.findIndex((l) => l.key === target.key);
    const gross =
      target === 'invoice'
        ? invoice.lines.reduce((a, l) => a + l.netAmount, 0)
        : (invoice.lines[lineIndex]?.grossAmount ?? 0);
    if (!(await guardApproval(discountNeedsApproval(settings, role, discount, gross), 'discountOverLimit')))
      return;
    const next =
      target === 'invoice' ? setInvoiceDiscount(cart, discount) : setLineDiscount(cart, target.key, discount);
    if (next.ok) setCart(next.value);
    else {
      play('error');
      flash(strings.errors.invalid);
    }
  };

  const applyPrice = async (key: string, text: string): Promise<void> => {
    setPriceKey(null);
    const line = cart.lines.find((l) => l.key === key);
    const price = toPiasters(text);
    if (!line || !price.ok || price.value <= 0) return;
    if (
      !(await guardApproval(priceNeedsApproval(settings, role, price.value, line.listPrice), 'priceOverride'))
    )
      return;
    setCart((c) => setLinePrice(c, key, price.value));
  };

  const doNoSale = async (reason: NoSaleReason): Promise<void> => {
    setNoSaleOpen(false);
    if (!context) return;
    let token: string | undefined;
    if (role !== 'manager') {
      const t = await ask('noSaleDrawer');
      if (!t) return;
      token = t;
    }
    const r = await noSale(context, reason, token);
    if (!r.ok) return flash(strings.forbidden);
    const shop = (await db.companies.toCollection().first())?.name ?? '';
    const { cairoFontFaces } = await import('../print/printHtml');
    await printHtmlFor((render) =>
      render.renderNoSaleHtml(shop, r.value, digits(cairoTime(r.value.at)), device.paper, cairoFontFaces()),
    );
  };

  const onSearchKey = async (e: React.KeyboardEvent<HTMLInputElement>): Promise<void> => {
    if (e.key !== 'Enter' || !searchText.trim()) return;
    const [first] = await searchProducts(db, searchText, { limit: 1 });
    if (first) {
      add(first, null);
      setSearchText('');
    } else {
      play('error');
      flash(strings.sell.scanUnknown);
    }
  };

  if (drawer === undefined || shift === undefined || warehouse === undefined) return <Skeleton rows={3} />;
  if (!shift) return <ShiftOpen drawer={drawer} />;
  if (!warehouse) return <BigAlert tone="warn" word={strings.sell.noWarehouse} />;

  const qtyLine = cart.lines.find((l) => l.key === qtyKey);
  const sale = {
    warehouseId: warehouse.id,
    shiftId: shift.id,
    cashAccountId: shift.cashAccountId ?? drawer?.id ?? '',
  };
  const count = digits(String(cart.lines.length));

  if (step === 'done' && done) {
    return (
      <section className={styles.done} data-testid="done">
        <BigAlert tone="ok" word={strings.sell.paid} sound={false} />
        <div className={styles.doneTotal}>{digits(formatMoney(done.sale.total))}</div>
        <div dir="ltr" className={styles.doneNumber}>
          {digits(done.sale.number)}
        </div>
        {done.sale.changeDue > 0 && <ChangeDisplay change={done.sale.changeDue} digits={digits} />}
        {done.printFailed && <BigAlert tone="warn" word={strings.sell.printFailed} sound={false} />}
        <div className={styles.doneActions}>
          <ActionButton
            label={strings.sell.printAgain}
            icon={Printer}
            variant="ghost"
            layout="stack"
            onClick={() =>
              void printInvoice(done.sale.id, false).then((ok) => setDone({ ...done, printFailed: !ok }))
            }
            testId="print-again"
          />
          <ActionButton
            label={strings.sell.done}
            variant="ok"
            layout="stack"
            onClick={newCart}
            testId="new-sale"
          />
        </div>
        {approvalDialog}
      </section>
    );
  }

  if (step === 'pay') {
    return (
      <>
        <PayScreen
          cart={cart}
          total={total}
          digits={digits}
          sale={sale}
          tokens={tokens}
          ask={ask}
          pickerOpen={pickerOpen}
          setPickerOpen={setPickerOpen}
          onCustomer={(id) => setCart((c) => setCustomer(c, id))}
          onBack={() => setStep('items')}
          onPaid={onPaid}
        />
        {approvalDialog}
      </>
    );
  }

  const totalBar = (
    <TotalBar
      total={digits(formatMoney(total))}
      count={count}
      heldCount={heldCount}
      disabled={cart.lines.length === 0}
      onPay={() => setStep('pay')}
      onHold={() => void hold()}
      onHeld={() => setHeldOpen(true)}
      onSpeak={() => sayAmounts({ total, changeDue: 0 })}
      onCart={() => setSheetOpen(true)}
    />
  );
  const cartPanel = (
    <CartPanel
      cart={cart}
      invoice={invoice}
      digits={digits}
      onStep={(key, delta) =>
        setCart((c) => setQty(c, key, (c.lines.find((l) => l.key === key)?.qtyMilli ?? 0) + delta))
      }
      onQtyPad={setQtyKey}
      onRemove={(key) => {
        const gone = cart.lines.find((l) => l.key === key);
        setUndo({
          prev: cart,
          line: gone
            ? {
                productId: gone.productId,
                name: gone.name,
                qtyMilli: gone.qtyMilli,
                unitPrice: gone.unitPrice,
              }
            : null,
        });
        setCart((c) => removeLine(c, key));
      }}
      onDiscount={(key) => setDiscountTarget({ key })}
      onPrice={setPriceKey}
      onInvoiceDiscount={() => setDiscountTarget('invoice')}
    />
  );

  return (
    <section className={styles.sell}>
      <div className={styles.left}>
        <div className={styles.toolbar}>
          <input
            ref={searchRef}
            className="control"
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => void onSearchKey(e)}
            placeholder={strings.products.search}
            aria-label={strings.sell.search}
            data-testid="sell-search"
          />
          <ActionButton
            label={strings.sell.recent}
            icon={ReceiptIcon}
            variant="ghost"
            layout="stack"
            onClick={() => setRecentOpen(true)}
            testId="recent"
          />
          <ActionButton
            label={strings.returns.button}
            icon={Undo2}
            variant="ghost"
            layout="stack"
            onClick={() => setReturnOpen(true)}
            testId="return"
          />
          <ActionButton
            label={strings.collection.button}
            icon={HandCoins}
            variant="ghost"
            layout="stack"
            onClick={() => setCollectOpen(true)}
            testId="collect"
          />
          <ActionButton
            label={strings.sell.shiftOpen}
            icon={Clock}
            variant="ghost"
            layout="stack"
            onClick={() => setShiftMenu(true)}
            testId="shift-menu"
          />
          <ActionButton
            label={strings.sell.noSale}
            icon={Banknote}
            variant="ghost"
            layout="stack"
            onClick={() => setNoSaleOpen(true)}
            testId="no-sale"
          />
        </div>
        {notice && <BigAlert tone="danger" word={notice} sound={false} />}
        <ProductGrid searchText={searchText} digits={digits} onAdd={add} />
      </div>
      <aside className={styles.right}>
        <div className={styles.cart}>{cartPanel}</div>
        {totalBar}
      </aside>
      <div className={styles.phoneBar}>{totalBar}</div>

      {undo && (
        <UndoToast
          message={strings.sell.removed}
          onUndo={() => {
            setCart(undo.prev);
            setUndo(null);
          }}
          onExpire={() => {
            // VOID-01: a removed line that was not taken back is audited
            if (context && undo.line) void recordAudit(context, 'cart_line_removed', 'cart', null, undo.line);
            setUndo(null);
          }}
        />
      )}

      <Dialog title={strings.sell.cartLine} open={sheetOpen} onClose={() => setSheetOpen(false)}>
        {cartPanel}
      </Dialog>
      <NumEntry
        title={qtyLine?.name ?? strings.sell.quantity}
        open={qtyLine !== undefined}
        decimals={qtyLine?.qtyDecimals ?? 0}
        onCancel={() => setQtyKey(null)}
        onSubmit={(text) => {
          const q = toMilli(text);
          if (q.ok && qtyKey) setCart((c) => setQty(c, qtyKey, q.value));
          setQtyKey(null);
        }}
      />
      <NumEntry
        title={strings.sell.price}
        open={priceKey !== null}
        decimals={2}
        onCancel={() => setPriceKey(null)}
        onSubmit={(text) => priceKey && void applyPrice(priceKey, text)}
      />
      <DiscountDialog
        open={discountTarget !== null}
        onCancel={() => setDiscountTarget(null)}
        onApply={(d) => discountTarget && void applyDiscount(discountTarget, d)}
      />
      <HeldCartsDialog
        open={heldOpen}
        digits={digits}
        onClose={() => setHeldOpen(false)}
        onResume={(id) => {
          void (async () => {
            if (cart.lines.length > 0 && context) await holdCart(context, cart, total);
            const resumed = await resumeCart(db, id);
            if (resumed) setCart(resumed);
            setHeldOpen(false);
          })();
        }}
      />
      <RecentInvoicesDialog
        open={recentOpen}
        shiftId={shift.id}
        digits={digits}
        onClose={() => setRecentOpen(false)}
        onReprint={(id) => void printInvoice(id, true)}
        onVoid={role === 'manager' ? setVoidTarget : undefined}
      />
      <VoidReasonDialog
        open={voidTarget !== null}
        onPick={(r) => void doVoid(r)}
        onClose={() => setVoidTarget(null)}
      />
      <ReturnDialog
        open={returnOpen}
        shiftId={shift.id}
        cashAccountId={sale.cashAccountId}
        digits={digits}
        ask={ask}
        scanned={scannedReceipt}
        onClose={() => {
          setReturnOpen(false);
          setScannedReceipt(null);
        }}
        onDone={onReturnDone}
      />
      <ShiftMenuDialog open={shiftMenu} onPick={pickShiftTool} onClose={() => setShiftMenu(false)} />
      <ExpenseDialog
        open={shiftTool === 'expense'}
        shiftId={shift.id}
        cashAccountId={sale.cashAccountId}
        digits={digits}
        onClose={() => setShiftTool(null)}
        onDone={(id) => {
          setShiftTool(null);
          flash(strings.cash.saved);
          if (device.autoPrint) printMoneySlip('expense', id);
        }}
      />
      <TransferDialog
        open={shiftTool === 'transfer'}
        shiftId={shift.id}
        cashAccountId={sale.cashAccountId}
        onClose={() => setShiftTool(null)}
        onDone={(id) => {
          setShiftTool(null);
          flash(strings.cash.saved);
          if (device.autoPrint) printMoneySlip('transfer', id);
        }}
      />
      <CloseShiftDialog
        open={shiftTool === 'close'}
        shiftId={shift.id}
        digits={digits}
        ask={ask}
        onClose={() => setShiftTool(null)}
        onClosed={(id) => {
          setShiftTool(null);
          printShiftReport(id);
        }}
      />
      <CollectionDialog
        open={collectOpen}
        shiftId={shift.id}
        cashAccountId={sale.cashAccountId}
        digits={digits}
        onClose={() => setCollectOpen(false)}
        onDone={onCollectDone}
      />
      <NoSaleDialog open={noSaleOpen} onPick={(r) => void doNoSale(r)} onClose={() => setNoSaleOpen(false)} />
      {approvalDialog}
    </section>
  );
}
