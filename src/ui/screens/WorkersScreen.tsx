import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, UserCog } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';

import { useServices, useSession } from '@/app/session';
import { saveWorker } from '@/db/commands/save-master';
import { callRpc } from '@/sync/errors';
import { formatMoney, toPiasters } from '@/domain/money';
import type { Worker } from '@/db/types';

import { PermissionGroups } from './PermissionGroups';
import { SegmentedControl } from '../components/SegmentedControl';
import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { type Column, DataTable } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { FormField } from '../components/FormField';
import { NumberField } from '../components/NumberField';
import { Skeleton } from '../components/Skeleton';
import { strings } from '../strings.ar';

import styles from './screens.module.css';
import { useSaver } from './useSaver';

export function WorkersScreen() {
  const { db } = useServices();
  const { can } = useSession();
  const [tab, setTab] = useState<'workers' | 'groups'>('workers');
  const [editing, setEditing] = useState<Worker | 'new' | null>(null);
  const workers = useLiveQuery(() => db.workers.filter((w) => !w.deletedAt).toArray(), [db]);
  const columns: Column<Worker>[] = [
    { key: 'name', header: strings.workers.name, cell: (w) => w.name },
    { key: 'role', header: strings.workers.role, cell: (w) => strings.roles[w.role] },
    {
      key: 'active',
      header: strings.common.active,
      cell: (w) => (w.active ? strings.common.active : strings.common.inactive),
    },
  ];
  return (
    <section>
      <h1 className={styles.title}>{strings.workers.title}</h1>
      {can('manageGroups') === 'yes' && (
        <div className={styles.toolbar}>
          <div className={styles.fixed}>
            <SegmentedControl
              label={strings.workers.title}
              options={[
                { key: 'workers', label: strings.permissions.workersTab },
                { key: 'groups', label: strings.permissions.groups },
              ]}
              value={tab}
              onChange={setTab}
              testIdPrefix="workers-tab-"
            />
          </div>
        </div>
      )}
      {tab === 'groups' ? (
        <PermissionGroups />
      ) : (
        <>
          <div className={styles.toolbar}>
            <div className={styles.fixed}>
              <ActionButton
                label={strings.workers.newWorker}
                icon={Plus}
                onClick={() => setEditing('new')}
                testId="new-worker"
              />
            </div>
          </div>
          {!workers ? (
            <Skeleton />
          ) : workers.length === 0 ? (
            <EmptyState icon={UserCog} word={strings.workers.noWorkers} />
          ) : (
            <DataTable
              label={strings.workers.title}
              rows={[...workers].sort(
                (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'ar'),
              )}
              columns={columns}
              rowKey={(w) => w.id}
              onRowClick={setEditing}
            />
          )}
        </>
      )}
      <Dialog
        title={editing === 'new' ? strings.workers.newWorker : strings.workers.editWorker}
        open={editing !== null}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <WorkerForm worker={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        )}
      </Dialog>
    </section>
  );
}

/** The worker's login: a username (once) and a password the manager can reset. The server keeps the password; this needs the internet. */
function LoginBlock({ worker }: { worker: Worker | null }) {
  const { client, runner } = useServices();
  const { context } = useSession();
  const online = useSyncExternalStore(runner.subscribe, runner.getSnapshot).online;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; word: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!worker) return <p>{strings.workers.loginSaveFirst}</p>;
  const save = async (): Promise<void> => {
    if (!context) return;
    if (password.length < 6) return setMessage({ tone: 'danger', word: strings.workers.passwordShort });
    if (password !== password2) return setMessage({ tone: 'danger', word: strings.workers.passwordMismatch });
    setBusy(true);
    setMessage(null);
    const r = await callRpc<{ username: string }>(client, 'set_worker_login', {
      p_actor: context.workerId,
      p_worker: worker.id,
      p_username: worker.username ? null : username,
      p_password: password,
    });
    setBusy(false);
    if (r.ok) {
      setPassword('');
      setPassword2('');
      setMessage({ tone: 'ok', word: strings.workers.loginSaved });
      void runner.runOnce();
    } else
      setMessage({
        tone: 'danger',
        word: r.network
          ? strings.workers.needsNet
          : r.message.includes(strings.workers.serverNoWorker)
            ? strings.workers.waitAndRetry
            : r.message.includes(strings.workers.serverUsername)
              ? strings.workers.usernameBad
              : strings.errors.saveFailed,
      });
  };
  return (
    <fieldset className={styles.form} style={{ gridTemplateColumns: '1fr', border: 0, padding: 0 }}>
      <legend>{strings.workers.loginTitle}</legend>
      {!online && <BigAlert tone="warn" word={strings.workers.needsNet} sound={false} />}
      {worker.username ? (
        <p dir="ltr" data-testid="worker-username-shown">
          {worker.username}
        </p>
      ) : (
        <FormField label={strings.workers.username} hint={strings.workers.usernameHint}>
          {(id, d) => (
            <input
              id={id}
              className="control"
              dir="ltr"
              autoCapitalize="none"
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-describedby={d}
              data-testid="worker-username"
            />
          )}
        </FormField>
      )}
      <FormField label={strings.workers.password}>
        {(id) => (
          <input
            id={id}
            className="control"
            dir="ltr"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="worker-password"
          />
        )}
      </FormField>
      <FormField label={strings.workers.passwordRepeat}>
        {(id) => (
          <input
            id={id}
            className="control"
            dir="ltr"
            type="password"
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            data-testid="worker-password2"
          />
        )}
      </FormField>
      {message && <BigAlert tone={message.tone} word={message.word} sound={false} />}
      <ActionButton
        label={strings.workers.saveLogin}
        variant="soft"
        loading={busy}
        disabled={!online || (!worker.username && !username) || !password}
        onClick={() => void save()}
        testId="worker-save-login"
      />
    </fieldset>
  );
}

function WorkerForm({ worker, onDone }: { worker: Worker | null; onDone: () => void }) {
  const { db } = useServices();
  const { context } = useSession();
  const [name, setName] = useState(worker?.name ?? '');
  const [role, setRole] = useState<Worker['role']>(worker?.role ?? 'cashier');
  const [active, setActive] = useState(worker?.active ?? true);
  const [groupId, setGroupId] = useState(worker?.groupId ?? '');
  const [salary, setSalary] = useState<number | null>(worker?.monthlySalary ?? null);
  const groups = useLiveQuery(() => db.permissionGroups.filter((g) => !g.deletedAt).toArray(), [db]);
  const [error, setError] = useState<string | null>(null);
  const saver = useSaver(onDone);
  return (
    <form
      className={styles.form}
      style={{ gridTemplateColumns: '1fr' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setError(strings.common.required);
        setError(null);
        if (!context) return;
        void saver.run(() =>
          saveWorker(context, {
            id: worker?.id,
            baseVersion: worker?.version,
            fields: {
              name,
              role,
              active,
              groupId: groupId || null,
              monthlySalary: salary,
            },
          }),
        );
      }}
    >
      <FormField label={strings.workers.name}>
        {(id) => (
          <input
            id={id}
            className="control"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="worker-name"
          />
        )}
      </FormField>
      <FormField label={strings.workers.role}>
        {(id) => (
          <select
            id={id}
            className="control"
            value={role}
            onChange={(e) => setRole(e.target.value as Worker['role'])}
            data-testid="worker-role"
          >
            {(['cashier', 'storekeeper', 'manager'] as const).map((r) => (
              <option key={r} value={r}>
                {strings.roles[r]}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <NumberField
        label={strings.workers.monthlySalary}
        value={salary}
        onChange={setSalary}
        parse={toPiasters}
        format={formatMoney}
      />
      <FormField label={strings.permissions.group}>
        {(id) => (
          <select
            id={id}
            className="control"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            data-testid="worker-group"
          >
            <option value="">{strings.permissions.byRole}</option>
            {(groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <LoginBlock worker={worker} />
      {worker && (
        <label className={styles.check}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {active ? strings.common.active : strings.common.inactive}
        </label>
      )}
      {(error || saver.error) && <BigAlert tone="danger" word={error ?? saver.error ?? ''} />}
      <div className={styles.actions}>
        <ActionButton
          label={strings.common.save}
          type="submit"
          variant="ok"
          loading={saver.busy}
          testId="save-worker"
        />
        <ActionButton label={strings.common.cancel} variant="ghost" onClick={onDone} />
      </div>
    </form>
  );
}
