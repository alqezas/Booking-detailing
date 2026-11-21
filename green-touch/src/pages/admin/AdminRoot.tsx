/**
 * Admin shell. The UI guard is only convenience: every read and write is
 * checked again by RLS and the admin_* functions on the server.
 */
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Center} from '@astryxdesign/core/Center';
import {Dialog} from '@astryxdesign/core/Dialog';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import type {Session} from '@supabase/supabase-js';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect, useState} from 'react';
import {Outlet, useLocation} from 'react-router';
import {Loading} from '../../components/Status.tsx';
import {useMeta} from '../../lib/browser.ts';
import {IDLE_MS, clearIdleMark, useAdminAppIdentity, useIdleSignOut} from '../../lib/adminApp.ts';
import {clearRuntimeCaches, useInstallApp} from '../../lib/pwa.ts';
import {env} from '../../lib/env.ts';
import {admin} from '../../lib/supabase.ts';

const NAV = [
  {href: '/admin', label: 'Замовлення'},
  {href: '/admin/tovary', label: 'Товари й набори'},
  {href: '/admin/kontent', label: 'Контент'},
  {href: '/admin/zapusk', label: 'Перед запуском'},
];

function InstallAdminHint() {
  const {hidden, platform, install} = useInstallApp();
  if (hidden) return null;
  if (platform === 'prompt') return <Button label="Встановити адмінку на робочий стіл" variant="secondary" width="100%" onClick={() => void install()} />;
  return (
    <Text type="supporting" color="secondary">
      {platform === 'ios'
        ? 'Щоб додати адмінку на екран iPhone: «Поділитися» → «На екран „Додому“». Значок «GT Адмін» щоразу відкриватиме цю форму входу.'
        : 'Адмінку можна встановити як окремий застосунок: меню браузера → «Встановити застосунок» або «Додати на головний екран».'}
    </Text>
  );
}

/** Header button: install the admin as its own app («GT Адмін»); hidden once installed. */
function InstallAdminButton() {
  const {hidden, platform, install} = useInstallApp();
  const [open, setOpen] = useState(false);
  if (hidden) return null;
  return (
    <>
      <Button label="На робочий стіл" size="sm" variant="secondary" onClick={() => (platform === 'prompt' ? void install() : setOpen(true))} />
      <Dialog isOpen={open} onOpenChange={setOpen} padding={5} width={440}>
        <VStack gap={3}>
          <Heading level={2}>Адмінка на робочому столі</Heading>
          {platform === 'ios' ? (
            <VStack gap={1}>
              <Text type="body">1. Відкрийте цю сторінку в Safari.</Text>
              <Text type="body">2. Натисніть «Поділитися» (квадрат зі стрілкою вгору).</Text>
              <Text type="body">3. Оберіть «На екран „Додому“» → «Додати».</Text>
            </VStack>
          ) : (
            <VStack gap={1}>
              <Text type="body">Chrome / Edge на компʼютері: значок встановлення праворуч в адресному рядку або меню ⋮ → «Встановити GT Адмін…» (у новіших версіях — у підменю «Трансляція, збереження й надсилання»).</Text>
              <Text type="body">Android: меню ⋮ → «Додати на головний екран» або «Встановити застосунок».</Text>
            </VStack>
          )}
          <Text type="supporting" color="secondary">
            Зʼявиться окремий значок «GT Адмін». Він щоразу відкриває форму входу, а після {IDLE_MS / 60_000} хв без дій вхід завершується.
          </Text>
          <HStack hAlign="end">
            <Button label="Зрозуміло" variant="primary" onClick={() => setOpen(false)} />
          </HStack>
        </VStack>
      </Dialog>
    </>
  );
}

function Login({notice}: {notice: string | null}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    setBusy(true);
    setError(null);
    const {error} = await admin().auth.signInWithPassword({email: email.trim(), password});
    setBusy(false);
    if (error) setError('Невірний email або пароль.');
  };
  return (
    <Center minHeight="80vh">
      <Card padding={6} width="min(420px, 92vw)">
        <VStack gap={4} as="form" onSubmit={(e: React.FormEvent) => (e.preventDefault(), void signIn())}>
          <Heading level={1}>Вхід для власниці</Heading>
          {notice && <Banner status="info" title={notice} collapsible={false} />}
          <TextInput label="Email" type="email" value={email} onChange={setEmail} autoComplete="username" isRequired />
          <TextInput label="Пароль" type="password" value={password} onChange={setPassword} autoComplete="current-password" isRequired onEnter={() => void signIn()} />
          {error && <Banner status="error" title={error} collapsible={false} />}
          <Button label="Увійти" variant="primary" width="100%" isLoading={busy} type="submit" />
          <Text type="supporting" color="secondary">
            Реєстрації немає: обліковий запис адміністратора створюється під час налаштування магазину. Вхід діє до закриття вкладки чи застосунку і завершується після {IDLE_MS / 60_000} хв без дій.
          </Text>
          <InstallAdminHint />
        </VStack>
      </Card>
    </Center>
  );
}

export default function AdminRoot() {
  useMeta({title: 'Адмін-панель', noindex: true});
  useAdminAppIdentity();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const qc = useQueryClient();
  const loc = useLocation();
  useEffect(() => {
    void admin().auth.getSession().then(r => setSession(r.data.session));
    const {data} = admin().auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  const isAdmin = useQuery({
    queryKey: ['am-i-admin', session?.user.id],
    queryFn: async () => (await admin().rpc('am_i_admin')).data === true,
    enabled: !!session,
  });
  const signOut = async () => {
    await admin().auth.signOut();
    clearIdleMark();
    qc.clear();
    clearRuntimeCaches();
  };
  useIdleSignOut(!!session, () => {
    setNotice(`Сесію завершено: ${IDLE_MS / 60_000} хв без дій. Увійдіть знову.`);
    void signOut();
  });
  if (session === undefined || (session && isAdmin.isPending)) return <Loading />;
  if (!session) return <Login notice={notice} />;
  if (!isAdmin.data) {
    return (
      <Center minHeight="80vh">
        <VStack gap={3} hAlign="center">
          <Heading level={1}>Немає доступу</Heading>
          <Text type="body">Цей обліковий запис не має прав адміністратора.</Text>
          <Button label="Вийти" onClick={() => void signOut()} />
        </VStack>
      </Center>
    );
  }
  return (
    <VStack gap={0}>
      <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap" paddingInline={4} paddingBlock={3} style={{borderBlockEnd: '1px solid var(--color-border)', background: 'var(--color-background-surface)'}}>
        <HStack gap={1} wrap="wrap">
          {NAV.map(n => (
            <Button key={n.href} label={n.label} size="sm" variant={loc.pathname === n.href || (n.href !== '/admin' && loc.pathname.startsWith(n.href)) ? 'primary' : 'ghost'} href={n.href} />
          ))}
        </HStack>
        <HStack gap={2} vAlign="center">
          <InstallAdminButton />
          <Button label="Магазин" size="sm" variant="ghost" href={`${env.siteUrl}/`} target="_blank" rel="noopener" />
          <Button label="Вийти" size="sm" variant="ghost" onClick={() => void signOut()} />
        </HStack>
      </HStack>
      <VStack gap={6} paddingInline={4} paddingBlock={6} maxWidth={1240} style={{marginInline: 'auto', width: '100%'}}>
        <Outlet />
      </VStack>
    </VStack>
  );
}
