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
import {msg} from '../../i18n/index.ts';
import {tireMsg} from '../../i18n/tire.ts';
import {useTenant} from '../../app/tenant.tsx';
import {SeasonsSettings} from './settings/SeasonsSettings.tsx';

const SECTIONS = [
  {value: 'studio', Component: StudioSettings},
  {value: 'services', Component: ServicesSettings},
  {value: 'bays', Component: ResourcesSettings},
  {value: 'schedule', Component: ScheduleSettings},
  {value: 'cards', Component: InfoCardsSettings},
  {value: 'gallery', Component: GallerySettings},
] as const;

/** Tyre services get one more section: the seasons. */
const TIRE_SECTIONS = [...SECTIONS.slice(0, 4), {value: 'seasons', Component: SeasonsSettings}, ...SECTIONS.slice(4)] as const;
const tabLabel = (v: string) => (v === 'seasons' ? tireMsg().seasonsSettings.title : msg.settings.tabs[v as keyof typeof msg.settings.tabs]);

export default function OwnerSettingsPage() {
  const [params, setParams] = useSearchParams();
  const tenant = useTenant();
  const sections: readonly {value: string; Component: () => React.JSX.Element}[] = tenant.tire ? TIRE_SECTIONS : SECTIONS;
  const current = sections.find(s => s.value === params.get('tab')) ?? sections[0]!;
  const Body = current.Component;
  return (
    <VStack>
      <Section variant="transparent" padding={4} paddingInline={0} paddingBlockEnd={0}>
        <VStack gap={3}>
          <Heading level={1}>{msg.settings.title}</Heading>
          <TabList value={current.value} onChange={v => setParams({tab: v}, {replace: true})} overflow="scroll" size="sm">
            {sections.map(s => (
              <Tab key={s.value} value={s.value} label={tabLabel(s.value)} />
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
