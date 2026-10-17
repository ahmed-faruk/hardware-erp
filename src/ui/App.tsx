import {
  ClipboardList,
  BarChart3,
  Wallet,
  Banknote,
  Package,
  PackagePlus,
  Receipt,
  Settings,
  ShoppingCart,
  Tags,
  Truck,
  UserCog,
  Users,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';

import { firstLogin, loadIdentity, signInDevice } from '@/app/device-setup';
import { SessionProvider, useServices, useSession, type Services } from '@/app/session';
import { APP_VERSION } from '@/app/version';
import { HanafyDB } from '@/db/schema';
import { rebuildSearchIndex } from '@/db/search';
import type { Action } from '@/domain/permissions';
import { requestPersistence } from '@/sync/backup';
import { SyncRunner } from '@/sync/runner';
import { createAppSupabase } from '@/sync/supabase';

import { ActionButton } from './components/ActionButton';
import { AppShell, type NavItem } from './components/AppShell';
import { BigAlert } from './components/BigAlert';
import { Skeleton } from './components/Skeleton';
import { SyncStatus } from './components/SyncStatus';
import { HealthBanner } from './components/HealthBanner';
import { UpdateBanner } from './components/UpdateBanner';
import { navigate, useRoute } from './router';
import { ComingSoonScreen } from './screens/ComingSoonScreen';
import { LoginScreen } from './screens/LoginScreen';
import { SetupScreen } from './screens/SetupScreen';
import { strings } from './strings.ar';

// manager screens load when first opened: the cashier's first paint carries only the sale screen
const SellScreen = lazy(() => import('./cashier/SellScreen').then((m) => ({ default: m.SellScreen })));
const CategoriesScreen = lazy(() =>
  import('./screens/CategoriesScreen').then((m) => ({ default: m.CategoriesScreen })),
);
const CustomersScreen = lazy(() =>
  import('./screens/PartyScreens').then((m) => ({ default: m.CustomersScreen })),
);
const SuppliersScreen = lazy(() =>
  import('./screens/PartyScreens').then((m) => ({ default: m.SuppliersScreen })),
);
const ExpensesScreen = lazy(() =>
  import('./screens/ExpensesScreen').then((m) => ({ default: m.ExpensesScreen })),
);
const SalesInvoicesScreen = lazy(() =>
  import('./screens/SalesInvoicesScreen').then((m) => ({ default: m.SalesInvoicesScreen })),
);
const PurchaseNewScreen = lazy(() =>
  import('./screens/PurchaseNewScreen').then((m) => ({ default: m.PurchaseNewScreen })),
);
const ProductFormScreen = lazy(() =>
  import('./screens/ProductFormScreen').then((m) => ({ default: m.ProductFormScreen })),
);
const ProductsScreen = lazy(() =>
  import('./screens/ProductsScreen').then((m) => ({ default: m.ProductsScreen })),
);
const PurchasesScreen = lazy(() =>
  import('./screens/PurchasesScreen').then((m) => ({ default: m.PurchasesScreen })),
);
const ReportsScreen = lazy(() =>
  import('./screens/ReportsScreen').then((m) => ({ default: m.ReportsScreen })),
);
const PayrollScreen = lazy(() =>
  import('./screens/PayrollScreen').then((m) => ({ default: m.PayrollScreen })),
);
const SettingsScreen = lazy(() =>
  import('./screens/SettingsScreen').then((m) => ({ default: m.SettingsScreen })),
);
const StockScreen = lazy(() => import('./screens/StockScreen').then((m) => ({ default: m.StockScreen })));
const WorkersScreen = lazy(() =>
  import('./screens/WorkersScreen').then((m) => ({ default: m.WorkersScreen })),
);

type Boot =
  | { state: 'loading' }
  | { state: 'setup'; db: HanafyDB; client: ReturnType<typeof createAppSupabase> }
  | { state: 'ready'; services: Services }
  | { state: 'error'; word: string };

async function startServices(
  db: HanafyDB,
  client: ReturnType<typeof createAppSupabase>,
): Promise<Services | null> {
  const identity = await loadIdentity(db);
  if (!identity) return null;
  if ((await db.searchIndex.count()) === 0 && (await db.products.count()) > 0) await rebuildSearchIndex(db);
  void signInDevice(client, identity).catch(() => undefined); // offline start is fine; selling never needs it
  const runner = new SyncRunner(db, client, identity.deviceId, { appVersion: APP_VERSION });
  await runner.start();
  return { db, client, identity, runner };
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  useEffect(() => {
    let services: Services | null = null;
    void (async () => {
      try {
        const db = new HanafyDB();
        const client = createAppSupabase();
        services = await startServices(db, client);
        setBoot(services ? { state: 'ready', services } : { state: 'setup', db, client });
      } catch {
        setBoot({ state: 'error', word: strings.env.missing });
      }
    })();
    return () => services?.runner.stop();
  }, []);

  if (boot.state === 'loading') return <Skeleton rows={3} />;
  if (boot.state === 'error') return <BigAlert tone="danger" word={boot.word} />;
  if (boot.state === 'setup') {
    const { db, client } = boot;
    return (
      <SetupScreen
        onLogin={async (username, password) => {
          const r = await firstLogin(db, client, username, password);
          if (!r.ok)
            return r.code === 'NO_NET'
              ? strings.setup.noNet
              : r.code === 'LOCKED'
                ? strings.login.locked
                : r.code === 'BAD_LOGIN'
                  ? strings.login.wrong
                  : strings.setup.failed;
          void requestPersistence().catch(() => false);
          const services = await startServices(db, client);
          if (services) setBoot({ state: 'ready', services });
          return null;
        }}
      />
    );
  }
  return (
    <SessionProvider services={boot.services}>
      <Gate />
    </SessionProvider>
  );
}

const NAV: (NavItem & { action: Action })[] = [
  { path: 'sell', label: strings.nav.sell, icon: ShoppingCart, action: 'view.sell' },
  { path: 'sales-invoices', label: strings.nav.salesInvoices, icon: Receipt, action: 'view.salesInvoices' },
  { path: 'products', label: strings.nav.products, icon: Package, action: 'view.products' },
  { path: 'categories', label: strings.nav.categories, icon: Tags, action: 'view.categories' },
  { path: 'purchases', label: strings.nav.purchases, icon: PackagePlus, action: 'view.purchases' },
  { path: 'stock', label: strings.nav.stock, icon: ClipboardList, action: 'view.stock' },
  { path: 'expenses', label: strings.nav.expenses, icon: Wallet, action: 'view.expenses' },
  { path: 'reports', label: strings.nav.reports, icon: BarChart3, action: 'view.reports' },
  { path: 'customers', label: strings.nav.customers, icon: Users, action: 'view.customers' },
  { path: 'suppliers', label: strings.nav.suppliers, icon: Truck, action: 'view.suppliers' },
  { path: 'payroll', label: strings.nav.payroll, icon: Banknote, action: 'view.payroll' },
  { path: 'workers', label: strings.nav.workers, icon: UserCog, action: 'view.workers' },
  { path: 'settings', label: strings.nav.settings, icon: Settings, action: 'view.settings' },
];

function Gate() {
  const { worker } = useSession();
  const { runner } = useServices();
  const sync = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  if (sync.revoked) return <Revoked />;
  return worker ? <Shell /> : <LoginScreen />;
}

function Revoked() {
  const { db } = useServices();
  return (
    <main style={{ padding: 24, display: 'grid', gap: 16, placeItems: 'center' }}>
      <BigAlert tone="danger" word={strings.revoked.title} />
      <p>{strings.revoked.body}</p>
      <ActionButton
        label={strings.revoked.reset}
        variant="danger"
        onClick={() => void db.delete().then(() => window.location.reload())}
      />
    </main>
  );
}

function Shell() {
  const { worker, lock, can } = useSession();
  const { runner } = useServices();
  const sync = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const route = useRoute();
  const role = worker?.role ?? 'cashier';
  const nav = NAV.filter((n) => can(n.action) === 'yes');
  const section = route[0] ?? '';
  const allowed = nav.some((n) => n.path === section);

  useEffect(() => {
    // a manager lands on the manager screens, a cashier on the sale screen
    const first = role === 'manager' ? (nav.find((n) => n.path === 'products') ?? nav[0]) : nav[0];
    if (first && !allowed) navigate(first.path);
  }, [allowed, nav, role]);

  let screen = <ComingSoonScreen />;
  if (allowed) {
    if (section === 'sell') screen = <SellScreen />;
    else if (section === 'products')
      screen = route[1] ? <ProductFormScreen id={route[1]} /> : <ProductsScreen />;
    else if (section === 'categories') screen = <CategoriesScreen />;
    else if (section === 'sales-invoices') screen = <SalesInvoicesScreen />;
    else if (section === 'purchases')
      screen = route[1] === 'new' ? <PurchaseNewScreen /> : <PurchasesScreen />;
    else if (section === 'stock') screen = <StockScreen />;
    else if (section === 'expenses') screen = <ExpensesScreen />;
    else if (section === 'reports') screen = <ReportsScreen />;
    else if (section === 'customers') screen = <CustomersScreen />;
    else if (section === 'suppliers') screen = <SuppliersScreen />;
    else if (section === 'payroll') screen = <PayrollScreen />;
    else if (section === 'workers') screen = <WorkersScreen />;
    else if (section === 'settings') screen = <SettingsScreen />;
  }
  return (
    <AppShell
      nav={nav}
      current={section}
      onNavigate={(p) => navigate(p)}
      status={<SyncStatus online={sync.online} pending={sync.pending} lastSyncAt={sync.lastSyncAt} />}
      workerName={worker?.name ?? ''}
      onLock={lock}
      banner={
        <>
          <UpdateBanner />
          <HealthBanner />
        </>
      }
    >
      <Suspense fallback={<Skeleton rows={3} />}>{screen}</Suspense>
    </AppShell>
  );
}
