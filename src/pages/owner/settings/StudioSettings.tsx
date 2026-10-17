import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {FileInput} from '@astryxdesign/core/FileInput';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {Selector} from '@astryxdesign/core/Selector';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {useToast} from '@astryxdesign/core/Toast';
import {useMutation} from '@tanstack/react-query';
import {useState} from 'react';
import {useTenant} from '../../../app/tenant.tsx';
import {errorText} from '../../../lib/errors.ts';
import {prepareImage, uniqueName} from '../../../lib/image.ts';
import {mediaUrl} from '../../../lib/media.ts';
import {bookingRulesSchema, fieldErrors, studioSettingsSchema} from '../../../lib/schemas.ts';
import {useOwner} from '../ownerContext.tsx';
import {errorStatus, IMAGE_ACCEPT, MAX_UPLOAD, useRefreshStudio} from './shared.tsx';
import {ApiError} from '../../../lib/errors.ts';
import {msg} from '../../../i18n/index.ts';

export function StudioSettings() {
  return (
    <VStack gap={6}>
      <StudioForm />
      <ImagesForm />
      <RulesForm />
    </VStack>
  );
}

function StudioForm() {
  const t = useTenant();
  const {api} = useOwner();
  const refresh = useRefreshStudio();
  const showToast = useToast();
  const [f, setF] = useState({
    name: t.name,
    tagline: t.tagline,
    description: t.description,
    phone: t.phone,
    address: t.address,
    legal_address: t.legal_address ?? '',
    map_url: t.map_url ?? '',
    accent_color: t.accent_color,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: async () => {
      const parsed = studioSettingsSchema.safeParse(f);
      if (!parsed.success) {
        setErrors(fieldErrors(parsed.error));
        throw new ApiError('CLIENT', msg.common.checkFields);
      }
      setErrors({});
      await api.updateTenant(parsed.data);
    },
    onSuccess: () => {
      refresh();
      showToast({body: msg.studioSettings.saved});
    },
  });
  const set = (k: keyof typeof f) => (v: string) => setF(x => ({...x, [k]: v}));
  return (
    <Card padding={4}>
      <VStack gap={4}>
        <Heading level={2}>{msg.studioSettings.title}</Heading>
        <FormLayout defaultOptionality="required">
          <TextInput label={msg.studioSettings.name} value={f.name} onChange={set('name')} status={errorStatus(errors.name)} />
          <TextInput label={msg.studioSettings.tagline} isOptional value={f.tagline} onChange={set('tagline')} status={errorStatus(errors.tagline)} />
          <TextArea label={msg.studioSettings.about} isOptional value={f.description} onChange={set('description')} rows={3} maxLength={600} />
          <TextInput label={msg.studioSettings.phone} value={f.phone} onChange={set('phone')} placeholder={msg.phonePlaceholder} status={errorStatus(errors.phone)} />
          <TextInput label={msg.studioSettings.address} value={f.address} onChange={set('address')} status={errorStatus(errors.address)} />
          <TextInput label={msg.studioSettings.legalAddress} isOptional value={f.legal_address} onChange={set('legal_address')} status={errorStatus(errors.legal_address)} />
          <TextInput label={msg.studioSettings.mapUrl} isOptional value={f.map_url} onChange={set('map_url')} placeholder={msg.studioSettings.mapPlaceholder} status={errorStatus(errors.map_url)} />
          <TextInput label={msg.studioSettings.accent} value={f.accent_color} onChange={set('accent_color')} description={msg.studioSettings.accentHint} status={errorStatus(errors.accent_color)} />
        </FormLayout>
        {save.isError && !Object.keys(errors).length && <Banner status="error" title={errorText(save.error)} collapsible={false} />}
        <Button label={msg.common.save} variant="primary" isLoading={save.isPending} onClick={() => save.mutate()} />
      </VStack>
    </Card>
  );
}

function ImagesForm() {
  const t = useTenant();
  const {api} = useOwner();
  const refresh = useRefreshStudio();
  const showToast = useToast();
  const [error, setError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: async ({file, field}: {file: File; field: 'logo_path' | 'hero_path'}) => {
      const {blob, ext} = await prepareImage(file, field === 'logo_path' ? 1024 : 2200);
      const path = await api.upload(blob, uniqueName(field === 'logo_path' ? 'logo' : 'hero', ext));
      await api.updateTenant({[field]: path});
    },
    onSuccess: (_d, v) => {
      setError(null);
      refresh();
      showToast({body: v.field === 'logo_path' ? msg.studioSettings.logoUpdated : msg.studioSettings.heroUpdated});
    },
    onError: e => setError(errorText(e)),
  });
  const hero = mediaUrl(t.hero_path);
  const logo = mediaUrl(t.logo_path);
  return (
    <Card padding={4}>
      <VStack gap={4}>
        <Heading level={2}>{msg.studioSettings.imagesTitle}</Heading>
        {error && <Banner status="error" title={error} collapsible={false} />}
        <HStack gap={4} wrap="wrap" align="start">
          <VStack gap={2} width={140}>
            {logo && <img src={logo} alt={msg.studioSettings.currentLogo} width={120} height={120} style={{borderRadius: 'var(--radius-container)', objectFit: 'contain', background: 'var(--color-background-muted)'}} />}
            <FileInput
              label={msg.studioSettings.replaceLogo}
              value={null}
              accept={IMAGE_ACCEPT}
              maxSize={MAX_UPLOAD}
              isLoading={upload.isPending && upload.variables?.field === 'logo_path'}
              onChange={f => f && !Array.isArray(f) && upload.mutate({file: f, field: 'logo_path'})}
            />
          </VStack>
          <VStack gap={2} style={{flex: 1, minWidth: 220}}>
            {hero && <img src={hero} alt={msg.studioSettings.currentHero} style={{width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: 'var(--radius-container)'}} />}
            <FileInput
              label={msg.studioSettings.replaceHero}
              value={null}
              accept={IMAGE_ACCEPT}
              maxSize={MAX_UPLOAD}
              description={msg.studioSettings.heroHint}
              isLoading={upload.isPending && upload.variables?.field === 'hero_path'}
              onChange={f => f && !Array.isArray(f) && upload.mutate({file: f, field: 'hero_path'})}
            />
          </VStack>
        </HStack>
        <Text type="supporting">{msg.studioSettings.iconNote}</Text>
      </VStack>
    </Card>
  );
}

function RulesForm() {
  const t = useTenant();
  const {api} = useOwner();
  const refresh = useRefreshStudio();
  const showToast = useToast();
  const [f, setF] = useState({
    slot_step_minutes: t.booking.slot_step_minutes,
    min_lead_minutes: t.booking.min_lead_minutes,
    horizon_days: t.booking.horizon_days,
    cancel_cutoff_hours: t.booking.cancel_cutoff_hours,
    default_buffer_minutes: t.booking.default_buffer_minutes,
  });
  const [assistant, setAssistant] = useState(t.assistant_enabled);
  const save = useMutation({
    mutationFn: async () => {
      const p = bookingRulesSchema.parse(f);
      await api.updateTenant({...p, assistant_enabled: assistant});
    },
    onSuccess: () => {
      refresh();
      showToast({body: msg.studioSettings.rulesSaved});
    },
  });
  const num = (k: keyof typeof f) => (v: number) => setF(x => ({...x, [k]: v}));
  return (
    <Card padding={4}>
      <VStack gap={4}>
        <Heading level={2}>{msg.studioSettings.rulesTitle}</Heading>
        <FormLayout>
          <Selector
            label={msg.studioSettings.step}
            value={String(f.slot_step_minutes)}
            onChange={v => v && setF(x => ({...x, slot_step_minutes: Number(v) as 15 | 30 | 60}))}
            options={[
              {value: '15', label: msg.studioSettings.every15},
              {value: '30', label: msg.studioSettings.every30},
              {value: '60', label: msg.studioSettings.every60},
            ]}
          />
          <NumberInput label={msg.studioSettings.minLead} value={f.min_lead_minutes} onChange={num('min_lead_minutes')} min={0} max={10080} step={30} />
          <NumberInput label={msg.studioSettings.horizon} value={f.horizon_days} onChange={num('horizon_days')} min={1} max={120} />
          <NumberInput label={msg.studioSettings.cutoff} value={f.cancel_cutoff_hours} onChange={num('cancel_cutoff_hours')} min={0} max={336} />
          <NumberInput
            label={msg.studioSettings.buffer}
            description={msg.studioSettings.bufferHint}
            value={f.default_buffer_minutes}
            onChange={num('default_buffer_minutes')}
            min={0}
            max={240}
            step={5}
          />
          <Switch label={msg.studioSettings.assistant} description={msg.studioSettings.assistantHint} value={assistant} onChange={setAssistant} />
        </FormLayout>
        {save.isError && <Banner status="error" title={errorText(save.error)} collapsible={false} />}
        <Button label={msg.studioSettings.saveRules} variant="primary" isLoading={save.isPending} onClick={() => save.mutate()} />
      </VStack>
    </Card>
  );
}
