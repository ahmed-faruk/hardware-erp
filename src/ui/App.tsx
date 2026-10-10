import {
  ClipboardList,
  Package,
  PackagePlus,
  Settings,
  ShoppingCart,
  Tags,
  Truck,
  UserCog,
  Users,
} from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { activateDevice, loadIdentity, signInDevice } from '@/app/device-setup';
import { SessionProvider, useServices, useSession, type Services } from '@/app/session';
import { APP_VERSION } from '@/app/version';
import { HanafyDB } from '@/db/schema';
import { rebuildSearchIndex } from '@/db/search';
import { can, type Action } from '@/domain/permissions';
import { requestPersistence } from '@/sync/backup';
import { SyncRunner } from '@/sync/runner';
import { createAppSupabase } from '@/sync/supabase';

import { ActionButton } from './components/ActionButton';
import { AppShell, type NavItem } from './components/AppShell';
import { BigAlert } from './components/BigAlert';
import { Skeleton } from './components/Skeleton';
import { SyncStatus } from './components/SyncStatus';
import { UpdateBanner } from './components/UpdateBanner';
import { navigate, useRoute } from './router';
import { SellScreen } from './cashier/SellScreen';
import { CategoriesScreen } from './screens/CategoriesScreen';
import { ComingSoonScreen } from './screens/ComingSoonScreen';
import { LoginScreen } from './screens/LoginScreen';
import { CustomersScreen, SuppliersScreen } from './screens/PartyScreens';
import { ProductFormScreen } from './screens/ProductFormScreen';
import { ProductsScreen } from './screens/ProductsScreen';
import { PurchasesScreen } from './screens/PurchasesScreen';
import { StockScreen } from './screens/StockScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SetupScreen } from './screens/SetupScreen';
import { WorkersScreen } from './screens/WorkersScreen';
import { strings } from './strings.ar';

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
        onActivate={async (code) => {
          const r = await activateDevice(db, client, code);
          if (!r.ok)
            return r.code === 'NO_NET'
              ? strings.setup.noNet
              : r.code === 'BAD_CODE'
                ? strings.setup.badCode
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
  { path: 'sell', label: strings.nav.sell, icon: ShoppingCart, action: 'sell' },
  { path: 'products', label: strings.nav.products, icon: Package, action: 'editProductData' },
  { path: 'categories', label: strings.nav.categories, icon: Tags, action: 'editProductData' },
  { path: 'purchases', label: strings.nav.purchases, icon: PackagePlus, action: 'receivePurchase' },
  { path: 'stock', label: strings.nav.stock, icon: ClipboardList, action: 'stockAdjustment' },
  { path: 'customers', label: strings.nav.customers, icon: Users, action: 'settings' },
  { path: 'suppliers', label: strings.nav.suppliers, icon: Truck, action: 'settings' },
  { path: 'workers', label: strings.nav.workers, icon: UserCog, action: 'manageUsers' },
  { path: 'settings', label: strings.nav.settings, icon: Settings, action: 'settings' },
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
  const { worker, lock } = useSession();
  const { runner } = useServices();
  const sync = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const route = useRoute();
  const role = worker?.role ?? 'cashier';
  const nav = NAV.filter((n) => can(role, n.action) === 'yes');
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
    else if (section === 'purchases') screen = <PurchasesScreen />;
    else if (section === 'stock') screen = <StockScreen />;
    else if (section === 'customers') screen = <CustomersScreen />;
    else if (section === 'suppliers') screen = <SuppliersScreen />;
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
      banner={<UpdateBanner />}
    >
      {screen}
    </AppShell>
  );
}
