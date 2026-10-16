import {Heading} from '@astryxdesign/core/Heading';
import {Section} from '@astryxdesign/core/Section';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {useTenant} from '../../app/tenant.tsx';
import {ServicesSection} from '../../components/home/Sections.tsx';

export default function ServicesPage() {
  const t = useTenant();
  return (
    <VStack maxWidth={760} width="100%" style={{marginInline: 'auto', paddingTop: 'env(safe-area-inset-top, 0px)'}}>
      <Section variant="transparent" padding={4} paddingBlockEnd={0}>
        <VStack gap={1}>
          <Heading level={1}>Услуги</Heading>
          <Text color="secondary">{t.name}: цены и длительность. Нажмите «Записаться» у нужной услуги.</Text>
        </VStack>
      </Section>
      <ServicesSection />
    </VStack>
  );
}
