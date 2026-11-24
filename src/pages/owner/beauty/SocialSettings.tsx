import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {Heading} from '@astryxdesign/core/Heading';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {useMutation} from '@tanstack/react-query';
import {useState} from 'react';
import {useTenant} from '../../../app/tenant.tsx';
import {msg} from '../../../i18n/index.ts';
import {errorText} from '../../../lib/errors.ts';
import {useOwner} from '../ownerContext.tsx';
import {errorStatus, useRefreshStudio} from '../settings/shared.tsx';

const HANDLE = /^@?[A-Za-z0-9._]{1,64}$/;
const TEXT: Record<string, {title: string; instagram: string; instagramHint: string; whatsapp: string; telegram: string; saved: string; bad: string}> = {
  ru: {title: 'Instagram и мессенджеры', instagram: 'Instagram', instagramHint: 'Имя профиля без ссылки, например aura.beauty', whatsapp: 'WhatsApp (номер)', telegram: 'Telegram (имя без @)', saved: 'Контакты сохранены', bad: 'Только латиница, цифры, точка и _'},
  uk: {title: 'Instagram і месенджери', instagram: 'Instagram', instagramHint: 'Імʼя профілю без посилання', whatsapp: 'WhatsApp (номер)', telegram: 'Telegram (імʼя без @)', saved: 'Контакти збережено', bad: 'Лише латиниця, цифри, крапка і _'},
  de: {title: 'Instagram und Messenger', instagram: 'Instagram', instagramHint: 'Profilname ohne Link', whatsapp: 'WhatsApp (Nummer)', telegram: 'Telegram (Name ohne @)', saved: 'Kontakte gespeichert', bad: 'Nur lateinische Buchstaben, Ziffern, Punkt und _'},
  cs: {title: 'Instagram a messengery', instagram: 'Instagram', instagramHint: 'Jméno profilu bez odkazu', whatsapp: 'WhatsApp (číslo)', telegram: 'Telegram (jméno bez @)', saved: 'Kontakty uloženy', bad: 'Jen latinka, číslice, tečka a _'},
  pl: {title: 'Instagram i komunikatory', instagram: 'Instagram', instagramHint: 'Nazwa profilu bez linku', whatsapp: 'WhatsApp (numer)', telegram: 'Telegram (nazwa bez @)', saved: 'Kontakty zapisane', bad: 'Tylko litery łacińskie, cyfry, kropka i _'},
};

/** The quick-action pills of the home page (Instagram) and the contact buttons, edited by the owner. */
export function SocialSettings() {
  const t = useTenant();
  const {api} = useOwner();
  const refresh = useRefreshStudio();
  const showToast = useToast();
  const T = TEXT[msg.lang] ?? TEXT.ru!;
  const [f, setF] = useState({instagram: t.instagram ?? '', whatsapp: t.whatsapp ?? '', telegram: t.telegram ?? ''});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const e: Record<string, string> = {};
      if (f.instagram.trim() && !HANDLE.test(f.instagram.trim())) e.instagram = T.bad;
      if (f.telegram.trim() && !HANDLE.test(f.telegram.trim())) e.telegram = T.bad;
      setErrors(e);
      if (Object.keys(e).length) throw new Error(msg.common.checkFields);
      return api.updateTenant({
        instagram: f.instagram.trim().replace(/^@/, ''),
        whatsapp: f.whatsapp.trim(),
        telegram: f.telegram.trim().replace(/^@/, ''),
      });
    },
    onSuccess: () => {
      refresh();
      showToast({body: T.saved});
    },
  });
  return (
    <Card padding={4}>
      <VStack gap={4}>
        <Heading level={2}>{T.title}</Heading>
        <FormLayout>
          <TextInput label={T.instagram} isOptional value={f.instagram} onChange={v => setF(x => ({...x, instagram: v}))} description={T.instagramHint} status={errorStatus(errors.instagram)} />
          <TextInput label={T.whatsapp} isOptional value={f.whatsapp} onChange={v => setF(x => ({...x, whatsapp: v}))} placeholder={msg.phonePlaceholder} />
          <TextInput label={T.telegram} isOptional value={f.telegram} onChange={v => setF(x => ({...x, telegram: v}))} status={errorStatus(errors.telegram)} />
        </FormLayout>
        {save.isError && !Object.keys(errors).length && <Banner status="error" title={errorText(save.error)} collapsible={false} />}
        <Button label={msg.common.save} variant="primary" isLoading={save.isPending} onClick={() => save.mutate()} />
      </VStack>
    </Card>
  );
}
