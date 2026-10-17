import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {Heading} from '@astryxdesign/core/Heading';
import {Selector} from '@astryxdesign/core/Selector';
import {Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {useMutation} from '@tanstack/react-query';
import {useState} from 'react';
import {INFO_CARD_ICONS} from '../../../../shared/business.ts';
import {useTenant} from '../../../app/tenant.tsx';
import {errorText} from '../../../lib/errors.ts';
import {fieldErrors, infoCardSchema} from '../../../lib/schemas.ts';
import {useOwner} from '../ownerContext.tsx';
import {errorStatus, useRefreshStudio} from './shared.tsx';
import {ApiError} from '../../../lib/errors.ts';
import {msg} from '../../../i18n/index.ts';

export function InfoCardsSettings() {
  const t = useTenant();
  return (
    <VStack gap={4}>
      <Text color="secondary">{msg.cardsSettings.lead}</Text>
      {[1, 2, 3].map(pos => (
        <CardEditor key={pos} position={pos} initial={t.info_cards.find(c => c.position === pos)} />
      ))}
    </VStack>
  );
}

function CardEditor({position, initial}: {position: number; initial?: {icon: string; title: string; text: string}}) {
  const {api} = useOwner();
  const refresh = useRefreshStudio();
  const showToast = useToast();
  const [f, setF] = useState({icon: initial?.icon ?? 'sparkle', title: initial?.title ?? '', text: initial?.text ?? ''});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const p = infoCardSchema.safeParse(f);
      if (!p.success) {
        setErrors(fieldErrors(p.error));
        throw new ApiError('CLIENT', msg.cardsSettings.checkCard);
      }
      setErrors({});
      return api.saveInfoCard(position, p.data);
    },
    onSuccess: () => {
      refresh();
      showToast({body: msg.cardsSettings.saved(position)});
    },
  });
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <Heading level={2}>{msg.cardsSettings.card(position)}</Heading>
        <FormLayout defaultOptionality="required">
          <Selector label={msg.cardsSettings.icon} value={f.icon} onChange={v => v && setF(x => ({...x, icon: v}))} options={INFO_CARD_ICONS.map(i => ({value: i, label: msg.cardsSettings.icons[i] ?? i}))} />
          <TextInput label={msg.cardsSettings.heading} value={f.title} onChange={v => setF(x => ({...x, title: v}))} status={errorStatus(errors.title)} />
          <TextArea label={msg.cardsSettings.text} value={f.text} onChange={v => setF(x => ({...x, text: v}))} rows={2} maxLength={160} status={errorStatus(errors.text)} />
        </FormLayout>
        {save.isError && !Object.keys(errors).length && <Banner status="error" title={errorText(save.error)} collapsible={false} />}
        <Button label={msg.cardsSettings.save} isLoading={save.isPending} onClick={() => save.mutate()} />
      </VStack>
    </Card>
  );
}
