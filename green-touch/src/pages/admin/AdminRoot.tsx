/**
 * Admin shell. The UI guard is only convenience: every read and write is
 * checked again by RLS and the admin_* functions on the server.
 */
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Center} from '@astryxdesign/core/Center';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import type {Session} from '@supabase/supabase-js';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect, useState} from 'react';
import {Outlet, useLocation} from 'react-router';
import {Loading} from '../../components/Status.tsx';
import {useMeta} from '../../lib/browser.ts';
import {clearRuntimeCaches} from '../../lib/pwa.ts';
import {admin} from '../../lib/supabase.ts';

const NAV = [
  {href: '/admin', label: 'Замовлення'},
  {href: '/admin/tovary', label: 'Товари й набори'},
  {href: '/admin/kontent', label: 'Контент'},
  {href: '/admin/zapusk', label: 'Перед запуском'},
];

function Login() {
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
          <TextInput label="Email" type="email" value={email} onChange={setEmail} autoComplete="username" isRequired />
          <TextInput label="Пароль" type="password" value={password} onChange={setPassword} autoComplete="current-password" isRequired onEnter={() => void signIn()} />
          {error && <Banner status="error" title={error} collapsible={false} />}
          <Button label="Увійти" variant="primary" width="100%" isLoading={busy} type="submit" />
          <Text type="supporting" color="secondary">
            Реєстрації немає: обліковий запис адміністратора створюється під час налаштування магазину.
          </Text>
        </VStack>
      </Card>
    </Center>
  );
}

export default function AdminRoot() {
  useMeta({title: 'Адмін-панель', noindex: true});
  const [session, setSession] = useState<Session | null | undefined>(undefined);
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
    qc.clear();
    clearRuntimeCaches();
  };
  if (session === undefined || (session && isAdmin.isPending)) return <Loading />;
  if (!session) return <Login />;
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
          <Button label="Магазин" size="sm" variant="ghost" href="/" />
          <Button label="Вийти" size="sm" variant="ghost" onClick={() => void signOut()} />
        </HStack>
      </HStack>
      <VStack gap={6} paddingInline={4} paddingBlock={6} maxWidth={1240} style={{marginInline: 'auto', width: '100%'}}>
        <Outlet />
      </VStack>
    </VStack>
  );
}
