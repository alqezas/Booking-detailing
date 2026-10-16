import {Heading} from '@astryxdesign/core/Heading';
import {Section} from '@astryxdesign/core/Section';
import {Tab, TabList} from '@astryxdesign/core/TabList';
import {VStack} from '@astryxdesign/core/VStack';
import {useSearchParams} from 'react-router';
import {TEXT_MAX_WIDTH} from '../../components/layout/Page.tsx';
import {GallerySettings} from './settings/GallerySettings.tsx';
import {InfoCardsSettings} from './settings/InfoCardsSettings.tsx';
import {ResourcesSettings} from './settings/ResourcesSettings.tsx';
import {ScheduleSettings} from './settings/ScheduleSettings.tsx';
import {ServicesSettings} from './settings/ServicesSettings.tsx';
import {StudioSettings} from './settings/StudioSettings.tsx';

const SECTIONS = [
  {value: 'studio', label: 'Студия', Component: StudioSettings},
  {value: 'services', label: 'Услуги', Component: ServicesSettings},
  {value: 'bays', label: 'Боксы', Component: ResourcesSettings},
  {value: 'schedule', label: 'График', Component: ScheduleSettings},
  {value: 'cards', label: 'Главная', Component: InfoCardsSettings},
  {value: 'gallery', label: 'Фото работ', Component: GallerySettings},
] as const;

export default function OwnerSettingsPage() {
  const [params, setParams] = useSearchParams();
  const current = SECTIONS.find(s => s.value === params.get('tab')) ?? SECTIONS[0];
  const Body = current.Component;
  return (
    <VStack>
      <Section variant="transparent" padding={4} paddingInline={0} paddingBlockEnd={0}>
        <VStack gap={3}>
          <Heading level={1}>Настройки</Heading>
          <TabList value={current.value} onChange={v => setParams({tab: v}, {replace: true})} overflow="scroll" size="sm">
            {SECTIONS.map(s => (
              <Tab key={s.value} value={s.value} label={s.label} />
            ))}
          </TabList>
        </VStack>
      </Section>
      <Section variant="transparent" padding={4} paddingInline={0}>
        {/* Forms keep a readable measure; the photo grid uses the whole column. */}
        <VStack width="100%" maxWidth={current.value === 'gallery' ? undefined : TEXT_MAX_WIDTH}>
          <Body />
        </VStack>
      </Section>
    </VStack>
  );
}
