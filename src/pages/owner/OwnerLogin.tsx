import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Center} from '@astryxdesign/core/Center';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router';
import {useTenant} from '../../app/tenant.tsx';
import {errorText} from '../../lib/errors.ts';
import {fieldErrors, loginSchema} from '../../lib/schemas.ts';
import {ownerClient} from '../../lib/supabase.ts';

/**
 * Email + password sign-in. There is no sign-up: owner accounts are created
 * by the studio pipeline (`pnpm owner:invite`). Password managers and paste
 * work as usual.
 */
export default function OwnerLogin() {
  const tenant = useTenant();
  const client = ownerClient(tenant.slug);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    const {data} = client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      else if (session && event === 'SIGNED_IN') navigate(`/s/${tenant.slug}/owner`, {replace: true});
    });
    void client.auth.getSession().then(({data: d}) => {
      if (d.session && !location.hash.includes('type=recovery')) navigate(`/s/${tenant.slug}/owner`, {replace: true});
    });
    return () => data.subscription.unsubscribe();
  }, [client, navigate, tenant.slug]);

  const signIn = async () => {
    setError(null);
    const parsed = loginSchema.safeParse({email: email.trim(), password});
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    const {error: e} = await client.auth.signInWithPassword(parsed.data);
    setBusy(false);
    if (e) setError(errorText(e));
  };

  const sendReset = async () => {
    setError(null);
    const parsed = loginSchema.shape.email.safeParse(email.trim());
    if (!parsed.success) {
      setErrors({email: 'Введите почту, на которую придёт ссылка'});
      return;
    }
    const {error: e} = await client.auth.resetPasswordForEmail(parsed.data, {redirectTo: `${location.origin}/s/${tenant.slug}/owner/login`});
    if (e) setError(errorText(e));
    else setInfo('Если такая почта есть, на неё придёт ссылка для смены пароля.');
  };

  const setNewPassword = async () => {
    if (password.length < 8) {
      setErrors({password: 'Новый пароль — от 8 символов'});
      return;
    }
    setBusy(true);
    const {error: e} = await client.auth.updateUser({password});
    setBusy(false);
    if (e) setError(errorText(e));
    else navigate(`/s/${tenant.slug}/owner`, {replace: true});
  };

  return (
    <Center minHeight="100dvh" padding={4}>
      <Card padding={6} width="100%" maxWidth={420}>
        <VStack gap={4}>
          <VStack gap={1}>
            <Text type="supporting">{tenant.name}</Text>
            <Heading level={1}>{recovery ? 'Новый пароль' : 'Вход в кабинет'}</Heading>
          </VStack>
          {error && <Banner status="error" title={error} collapsible={false} />}
          {info && <Banner status="success" title={info} collapsible={false} />}
          <FormLayout>
            {!recovery && (
              <TextInput
                label="Почта"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="username"
                status={errors.email ? {type: 'error', message: errors.email} : undefined}
              />
            )}
            <TextInput
              label={recovery ? 'Новый пароль' : 'Пароль'}
              type="password"
              value={password}
              onChange={setPassword}
              onEnter={recovery ? setNewPassword : signIn}
              autoComplete={recovery ? 'new-password' : 'current-password'}
              status={errors.password ? {type: 'error', message: errors.password} : undefined}
            />
          </FormLayout>
          {recovery ? (
            <Button label="Сохранить пароль" variant="primary" size="lg" width="100%" isLoading={busy} onClick={setNewPassword} />
          ) : (
            <>
              <Button label="Войти" variant="primary" size="lg" width="100%" isLoading={busy} onClick={signIn} />
              <Button label="Забыли пароль?" variant="ghost" onClick={sendReset} />
              <Text type="supporting">Регистрации нет: доступ владельцу выдаёт администратор приложения.</Text>
            </>
          )}
          <Button label="На сайт студии" variant="ghost" href={`/s/${tenant.slug}/`} />
        </VStack>
      </Card>
    </Center>
  );
}
