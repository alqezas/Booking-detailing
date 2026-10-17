import {VStack} from '@astryxdesign/core/VStack';
import {useTenant} from '../../app/tenant.tsx';
import {ServicesSection} from '../../components/home/Sections.tsx';
import {PageContainer, PageTitle} from '../../components/layout/Page.tsx';
import {msg} from '../../i18n/index.ts';

export default function ServicesPage() {
  const t = useTenant();
  return (
    <PageContainer>
      <PageTitle title={msg.servicesPage.title} description={msg.servicesPage.lead(t.name)} />
      <VStack style={{paddingBlockEnd: 'var(--spacing-6)'}}>
        <ServicesSection />
      </VStack>
    </PageContainer>
  );
}
